use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;

/// CodeMirror copes with large files, but past this point the preview and
/// search stop being useful, so refuse instead of freezing the window.
pub const MAX_DOC_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_WALK_FILES: usize = 20_000;
const MAX_WALK_DEPTH: usize = 16;

pub const MARKDOWN_EXTS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "mdx", "rmd",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "target",
    ".next",
    ".nuxt",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vs",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eol {
    Lf,
    Crlf,
}

impl Eol {
    pub fn parse(value: &str) -> Eol {
        if value.eq_ignore_ascii_case("crlf") {
            Eol::Crlf
        } else {
            Eol::Lf
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Eol::Lf => "lf",
            Eol::Crlf => "crlf",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFile {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub eol: &'static str,
    pub mtime_ms: f64,
    pub readonly: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub encoding: String,
    pub mtime_ms: f64,
    pub encoding_changed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStat {
    pub exists: bool,
    pub is_dir: bool,
    pub mtime_ms: f64,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub files_scanned: usize,
    pub truncated: bool,
}

pub struct Decoded {
    pub text: String,
    pub encoding: String,
}

/// BOMs win, then strict UTF-8, then a statistical guess. On Korean Windows
/// the guess is usually EUC-KR, which encoding_rs decodes as the CP949 superset.
pub fn decode_bytes(bytes: &[u8]) -> Decoded {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let (text, _) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        let label = if enc == UTF_8 {
            "utf-8-bom"
        } else if enc == UTF_16LE {
            "utf-16le"
        } else {
            "utf-16be"
        };

        return Decoded {
            text: text.into_owned(),
            encoding: label.to_string(),
        };
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return Decoded {
            text: text.to_string(),
            encoding: "utf-8".to_string(),
        };
    }

    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let enc = detector.guess(None, chardetng::Utf8Detection::Deny);
    let (text, _) = enc.decode_without_bom_handling(bytes);

    Decoded {
        text: text.into_owned(),
        encoding: enc.name().to_string(),
    }
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    if Encoding::for_bom(bytes).is_some() {
        return false;
    }

    bytes.iter().take(8000).any(|b| *b == 0)
}

pub fn detect_eol(text: &str) -> Eol {
    let crlf = text.matches("\r\n").count();
    let lf_only = text.matches('\n').count() - crlf;

    if crlf > lf_only {
        Eol::Crlf
    } else {
        Eol::Lf
    }
}

pub fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub encoding: String,
}

fn utf16_bytes(text: &str, little_endian: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2 + 2);
    let bom: [u8; 2] = if little_endian { [0xFF, 0xFE] } else { [0xFE, 0xFF] };
    out.extend_from_slice(&bom);

    for unit in text.encode_utf16() {
        let pair = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        out.extend_from_slice(&pair);
    }

    out
}

/// Legacy encodings cannot represent every character. encoding_rs would
/// silently write `&#NNNN;` for those, which corrupts the document, so we
/// fall back to UTF-8 and report the switch instead.
pub fn encode_text(text: &str, encoding: &str) -> Encoded {
    let utf8 = || Encoded {
        bytes: text.as_bytes().to_vec(),
        encoding: "utf-8".to_string(),
    };

    match encoding {
        "utf-8" => utf8(),
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(text.as_bytes());

            Encoded {
                bytes,
                encoding: "utf-8-bom".to_string(),
            }
        }
        "utf-16le" => Encoded {
            bytes: utf16_bytes(text, true),
            encoding: "utf-16le".to_string(),
        },
        "utf-16be" => Encoded {
            bytes: utf16_bytes(text, false),
            encoding: "utf-16be".to_string(),
        },
        label => match Encoding::for_label(label.as_bytes()) {
            Some(enc) if enc != UTF_8 && enc.output_encoding() == enc && enc != UTF_16LE && enc != UTF_16BE => {
                let (bytes, _, had_errors) = enc.encode(text);

                if had_errors {
                    utf8()
                } else {
                    Encoded {
                        bytes: bytes.into_owned(),
                        encoding: enc.name().to_string(),
                    }
                }
            }
            _ => utf8(),
        },
    }
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn io_message(err: &io::Error, path: &Path) -> String {
    let name = path.display();

    match err.kind() {
        io::ErrorKind::NotFound => format!("파일을 찾을 수 없습니다: {name}"),
        io::ErrorKind::PermissionDenied => format!("접근 권한이 없습니다 (읽기 전용이거나 다른 프로그램이 사용 중): {name}"),
        _ => format!("{name}: {err}"),
    }
}

pub fn read_document(path: &Path) -> Result<DocFile, String> {
    let meta = fs::metadata(path).map_err(|e| io_message(&e, path))?;

    if meta.is_dir() {
        return Err(format!("폴더는 문서로 열 수 없습니다: {}", path.display()));
    }

    if meta.len() > MAX_DOC_BYTES {
        return Err(format!(
            "파일이 너무 큽니다 ({} MB). 64 MB 이하 파일만 열 수 있습니다.",
            meta.len() / (1024 * 1024)
        ));
    }

    let bytes = fs::read(path).map_err(|e| io_message(&e, path))?;

    if looks_binary(&bytes) {
        return Err(format!("텍스트 파일이 아닙니다: {}", path.display()));
    }

    let decoded = decode_bytes(&bytes);
    let eol = detect_eol(&decoded.text);

    Ok(DocFile {
        path: path.to_string_lossy().into_owned(),
        content: normalize_newlines(&decoded.text),
        encoding: decoded.encoding,
        eol: eol.as_str(),
        mtime_ms: mtime_ms(&meta),
        readonly: meta.permissions().readonly(),
    })
}

fn temp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_string());

    path.with_file_name(format!(".{name}.choimark-{}.tmp", std::process::id()))
}

#[cfg(windows)]
fn replace_file(target: &Path, replacement: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};

    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
    let target_w = wide(target);
    let replacement_w = wide(replacement);
    // SAFETY: both buffers are NUL-terminated UTF-16 strings that outlive the call.
    let ok = unsafe {
        ReplaceFileW(
            target_w.as_ptr(),
            replacement_w.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(target: &Path, replacement: &Path) -> io::Result<()> {
    fs::rename(replacement, target)
}

fn write_in_place(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // TRUNCATE_EXISTING instead of CREATE_ALWAYS so hidden files still save.
    let mut file = if path.exists() {
        fs::OpenOptions::new().write(true).truncate(true).open(path)?
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(path)?
    };
    file.write_all(bytes)?;
    file.sync_all()
}

/// Writes through a temp sibling and ReplaceFileW, so a crash or a full disk
/// never leaves a half-written document. ReplaceFileW keeps the original
/// file's attributes and ACL. If it is unavailable (some network shares),
/// fall back to a plain in-place write.
pub fn write_bytes_safely(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.permissions().readonly() {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "read-only file"));
        }
    }

    let tmp = temp_sibling(path);
    let staged = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();

    if staged.is_err() {
        let _ = fs::remove_file(&tmp);

        return write_in_place(path, bytes);
    }

    let swapped = if path.exists() {
        replace_file(path, &tmp)
    } else {
        fs::rename(&tmp, path)
    };

    if swapped.is_err() {
        let _ = fs::remove_file(&tmp);

        return write_in_place(path, bytes);
    }

    Ok(())
}

pub fn write_document(path: &Path, content: &str, encoding: &str, eol: Eol) -> Result<WriteResult, String> {
    let normalized = normalize_newlines(content);
    let text = match eol {
        Eol::Crlf => normalized.replace('\n', "\r\n"),
        Eol::Lf => normalized,
    };
    let encoded = encode_text(&text, encoding);

    write_bytes_safely(path, &encoded.bytes).map_err(|e| io_message(&e, path))?;
    let meta = fs::metadata(path).map_err(|e| io_message(&e, path))?;

    Ok(WriteResult {
        encoding_changed: encoded.encoding != encoding,
        encoding: encoded.encoding,
        mtime_ms: mtime_ms(&meta),
    })
}

pub fn stat_path(path: &Path) -> PathStat {
    match fs::metadata(path) {
        Ok(meta) => PathStat {
            exists: true,
            is_dir: meta.is_dir(),
            mtime_ms: mtime_ms(&meta),
            size: meta.len(),
        },
        Err(_) => PathStat {
            exists: false,
            is_dir: false,
            mtime_ms: 0.0,
            size: 0,
        },
    }
}

pub fn is_markdown_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|ext| {
            let ext = ext.to_string_lossy().to_ascii_lowercase();
            MARKDOWN_EXTS.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_hidden(entry: &fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;

    entry
        .metadata()
        .map(|m| m.file_attributes() & (HIDDEN | SYSTEM) != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_hidden(_entry: &fs::DirEntry) -> bool {
    false
}

fn natural_key(name: &str) -> String {
    name.to_lowercase()
}

pub fn list_dir(path: &Path, all_files: bool) -> Result<Vec<DirEntry>, String> {
    let reader = fs::read_dir(path).map_err(|e| io_message(&e, path))?;
    let mut entries = Vec::new();

    for entry in reader.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') || is_hidden(&entry) {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if !is_dir && !all_files && !is_markdown_name(&name) {
            continue;
        }

        entries.push(DirEntry {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            is_dir,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_key(&a.name).cmp(&natural_key(&b.name)))
    });

    Ok(entries)
}

fn walk_markdown(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_WALK_DEPTH || out.len() >= MAX_WALK_FILES {
        return;
    }

    let Ok(reader) = fs::read_dir(dir) else {
        return;
    };
    let mut subdirs = Vec::new();

    for entry in reader.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') || is_hidden(&entry) {
            continue;
        }

        let Ok(kind) = entry.file_type() else {
            continue;
        };

        if kind.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                subdirs.push(entry.path());
            }
        } else if is_markdown_name(&name) {
            out.push(entry.path());

            if out.len() >= MAX_WALK_FILES {
                return;
            }
        }
    }

    for sub in subdirs {
        walk_markdown(&sub, depth + 1, out);
    }
}

pub fn list_markdown_files(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    walk_markdown(root, 0, &mut found);

    found
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn make_preview(line: &str, byte_index: usize) -> String {
    const CONTEXT: usize = 60;
    let start = line[..byte_index]
        .char_indices()
        .rev()
        .nth(CONTEXT)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let snippet: String = line[start..].chars().take(200).collect();
    let snippet = snippet.trim_end();

    if start > 0 {
        format!("…{}", snippet.trim_start())
    } else {
        snippet.trim_start().to_string()
    }
}

pub fn search_in_dir(root: &Path, query: &str, case_sensitive: bool, max_hits: usize) -> SearchResult {
    let mut files = Vec::new();
    walk_markdown(root, 0, &mut files);

    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let mut hits = Vec::new();
    let mut files_scanned = 0;
    let mut truncated = false;

    'files: for file in &files {
        let Ok(meta) = fs::metadata(file) else {
            continue;
        };

        if meta.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }

        let Ok(bytes) = fs::read(file) else {
            continue;
        };

        if looks_binary(&bytes) {
            continue;
        }

        files_scanned += 1;
        let text = decode_bytes(&bytes).text;

        for (line_index, line) in text.lines().enumerate() {
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };

            let Some(found) = haystack.find(&needle) else {
                continue;
            };
            // Lowercasing can change byte lengths; clamp back onto a char boundary.
            let mut byte_index = found.min(line.len());

            while !line.is_char_boundary(byte_index) {
                byte_index -= 1;
            }

            hits.push(SearchHit {
                path: file.to_string_lossy().into_owned(),
                line: line_index + 1,
                column: line[..byte_index].chars().count() + 1,
                preview: make_preview(line, byte_index),
            });

            if hits.len() >= max_hits {
                truncated = true;
                break 'files;
            }
        }
    }

    SearchResult {
        hits,
        files_scanned,
        truncated,
    }
}

/// Only plain file names may come from the webview; anything with a path
/// separator or a reserved character is rejected.
pub fn sanitize_file_name(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_end_matches(['.', ' ']);

    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return None;
    }

    if trimmed
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control())
    {
        return None;
    }

    Some(trimmed.to_string())
}

pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);

    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    (2..10_000)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

/// Saves pasted image bytes next to the document and returns the
/// forward-slash path to put in the Markdown link.
pub fn save_image(doc_path: &Path, folder: &str, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let folder = sanitize_file_name(folder).unwrap_or_else(|| "assets".to_string());
    let file_name = sanitize_file_name(file_name).ok_or("잘못된 이미지 이름입니다.")?;
    let ext = Path::new(&file_name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err("지원하지 않는 이미지 형식입니다.".to_string());
    }

    let doc_dir = doc_path.parent().ok_or("문서 폴더를 찾을 수 없습니다.")?;
    let target_dir = doc_dir.join(&folder);
    fs::create_dir_all(&target_dir).map_err(|e| io_message(&e, &target_dir))?;
    let target = unique_path(&target_dir, &file_name);
    fs::write(&target, bytes).map_err(|e| io_message(&e, &target))?;
    let saved_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(file_name);

    Ok(format!("{folder}/{saved_name}"))
}

pub fn create_file(dir: &Path, name: &str) -> Result<String, String> {
    let name = sanitize_file_name(name).ok_or("파일 이름에 쓸 수 없는 문자가 있습니다.")?;
    let target = unique_path(dir, &name);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| io_message(&e, &target))?;

    Ok(target.to_string_lossy().into_owned())
}

pub fn create_dir(dir: &Path, name: &str) -> Result<String, String> {
    let name = sanitize_file_name(name).ok_or("폴더 이름에 쓸 수 없는 문자가 있습니다.")?;
    let target = unique_path(dir, &name);
    fs::create_dir(&target).map_err(|e| io_message(&e, &target))?;

    Ok(target.to_string_lossy().into_owned())
}

pub fn rename_path(from: &Path, new_name: &str) -> Result<String, String> {
    let name = sanitize_file_name(new_name).ok_or("이름에 쓸 수 없는 문자가 있습니다.")?;
    let parent = from.parent().ok_or("상위 폴더를 찾을 수 없습니다.")?;
    let target = parent.join(&name);
    let same_entry = target.to_string_lossy().to_lowercase() == from.to_string_lossy().to_lowercase();

    if target.exists() && !same_entry {
        return Err(format!("같은 이름이 이미 있습니다: {name}"));
    }

    fs::rename(from, &target).map_err(|e| io_message(&e, from))?;

    Ok(target.to_string_lossy().into_owned())
}

/// Extensions that run code when opened. Links in a document must never
/// launch these, even after a user click.
const BLOCKED_OPEN_EXTS: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp",
    "scr", "pif", "lnk", "url", "hta", "jar", "reg", "cpl", "msc", "inf", "dll", "sys", "appx",
    "msix", "appinstaller", "application", "gadget", "scf", "ws", "settingcontent-ms",
];

pub fn is_safe_to_open(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    !BLOCKED_OPEN_EXTS.contains(&ext.as_str())
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();

            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                i += 3;
                continue;
            }
        }

        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_and_boms() {
        assert_eq!(decode_bytes("한글 md".as_bytes()).encoding, "utf-8");

        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice("# 제목".as_bytes());
        let decoded = decode_bytes(&bom);
        assert_eq!(decoded.encoding, "utf-8-bom");
        assert_eq!(decoded.text, "# 제목");

        let utf16 = utf16_bytes("가나다", true);
        let decoded = decode_bytes(&utf16);
        assert_eq!(decoded.encoding, "utf-16le");
        assert_eq!(decoded.text, "가나다");
    }

    #[test]
    fn detects_euc_kr_and_round_trips() {
        let source = "# 회의록\n\n오늘은 마크다운 편집기를 만들었습니다. 한글 인코딩 확인용 문장입니다.\n";
        let (bytes, _, _) = encoding_rs::EUC_KR.encode(source);
        let decoded = decode_bytes(&bytes);
        assert_eq!(decoded.encoding, "EUC-KR");
        assert_eq!(decoded.text, source);

        let encoded = encode_text(&decoded.text, &decoded.encoding);
        assert_eq!(encoded.encoding, "EUC-KR");
        assert_eq!(encoded.bytes, bytes.into_owned());
    }

    #[test]
    fn legacy_encoding_falls_back_to_utf8_for_unmappable_text() {
        let encoded = encode_text("emoji 😀", "EUC-KR");
        assert_eq!(encoded.encoding, "utf-8");
        assert_eq!(encoded.bytes, "emoji 😀".as_bytes());
    }

    #[test]
    fn eol_detection_and_normalization() {
        assert_eq!(detect_eol("a\r\nb\r\nc"), Eol::Crlf);
        assert_eq!(detect_eol("a\nb\r\nc\n"), Eol::Lf);
        assert_eq!(normalize_newlines("a\r\nb\rc"), "a\nb\nc");
    }

    #[test]
    fn write_preserves_encoding_and_eol() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, "old").unwrap();

        let result = write_document(&path, "첫 줄\n둘째 줄\n", "utf-8-bom", Eol::Crlf).unwrap();
        assert_eq!(result.encoding, "utf-8-bom");
        assert!(!result.encoding_changed);

        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(std::str::from_utf8(&bytes[3..]).unwrap(), "첫 줄\r\n둘째 줄\r\n");

        let doc = read_document(&path).unwrap();
        assert_eq!(doc.content, "첫 줄\n둘째 줄\n");
        assert_eq!(doc.eol, "crlf");
        assert_eq!(doc.encoding, "utf-8-bom");

        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "temp file must not be left behind");
    }

    #[test]
    fn rejects_binary_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("x.md");
        fs::write(&bin, [0u8, 1, 2, 3, 0, 0]).unwrap();
        assert!(read_document(&bin).is_err());
        assert!(read_document(&dir.path().join("missing.md")).is_err());
    }

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(sanitize_file_name("assets"), Some("assets".to_string()));
        assert_eq!(sanitize_file_name("..\\evil"), None);
        assert_eq!(sanitize_file_name("a/b"), None);
        assert_eq!(sanitize_file_name(".."), None);
        assert_eq!(sanitize_file_name("새 문서.md"), Some("새 문서.md".to_string()));
    }

    #[test]
    fn saves_images_into_folder_with_unique_names() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        fs::write(&doc, "x").unwrap();

        let first = save_image(&doc, "assets", "shot.png", &[1, 2, 3]).unwrap();
        let second = save_image(&doc, "assets", "shot.png", &[4, 5]).unwrap();
        assert_eq!(first, "assets/shot.png");
        assert_eq!(second, "assets/shot (2).png");
        assert!(save_image(&doc, "assets", "run.exe", &[0]).is_err());
        assert_eq!(save_image(&doc, "../up", "a.png", &[0]).unwrap(), "assets/a.png");
    }

    #[test]
    fn lists_and_searches_markdown() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("b.md"), "# Beta\n찾을 단어 Needle 여기").unwrap();
        fs::write(dir.path().join("a.txt"), "Needle").unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules").join("c.md"), "Needle").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("d.markdown"), "needle lower").unwrap();

        let listed = list_dir(dir.path(), false).unwrap();
        let names: Vec<_> = listed.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["node_modules", "sub", "b.md"]);

        let result = search_in_dir(dir.path(), "needle", false, 100);
        assert_eq!(result.hits.len(), 2);
        let hit = result.hits.iter().find(|h| h.path.ends_with("b.md")).unwrap();
        assert_eq!(hit.line, 2);
        assert_eq!(hit.column, 7);

        let strict = search_in_dir(dir.path(), "Needle", true, 100);
        assert_eq!(strict.hits.len(), 1);
    }

    #[test]
    fn blocks_executable_links() {
        assert!(!is_safe_to_open(Path::new("C:\\x\\run.EXE")));
        assert!(!is_safe_to_open(Path::new("setup.msi")));
        assert!(is_safe_to_open(Path::new("report.pdf")));
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("C%3A%5C%ED%95%9C%20a.md"), "C:\\한 a.md");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
