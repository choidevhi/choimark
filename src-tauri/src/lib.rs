mod assoc;
mod files;
mod userchoice;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use files::{DirEntry, DocFile, Eol, PathStat, SearchResult, WriteResult};

#[derive(Default)]
struct StartupPaths(Mutex<Vec<String>>);

/// Turns a command line into the existing files it names. Flags are skipped
/// and relative paths resolve against the caller's working directory, which
/// matters when a second instance forwards its arguments.
fn paths_from_args(args: &[String], cwd: Option<&Path>) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a.trim_matches('"'));

            if p.is_absolute() {
                p
            } else if let Some(dir) = cwd {
                dir.join(p)
            } else {
                std::env::current_dir().map(|d| d.join(&p)).unwrap_or(p)
            }
        })
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn take_startup_paths(state: State<'_, StartupPaths>) -> Vec<String> {
    state.0.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

#[tauri::command]
async fn read_document(app: AppHandle, path: String) -> Result<DocFile, String> {
    let doc = files::read_document(Path::new(&path))?;

    if let Some(dir) = Path::new(&path).parent() {
        let _ = app.asset_protocol_scope().allow_directory(dir, true);
    }

    Ok(doc)
}

#[tauri::command]
async fn write_document(path: String, content: String, encoding: String, eol: String) -> Result<WriteResult, String> {
    files::write_document(Path::new(&path), &content, &encoding, Eol::parse(&eol))
}

#[tauri::command]
async fn write_text(path: String, content: String) -> Result<(), String> {
    files::write_bytes_safely(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn stat_path(path: String) -> PathStat {
    files::stat_path(Path::new(&path))
}

#[tauri::command]
async fn list_dir(app: AppHandle, path: String, all_files: bool) -> Result<Vec<DirEntry>, String> {
    let entries = files::list_dir(Path::new(&path), all_files)?;
    let _ = app.asset_protocol_scope().allow_directory(&path, true);

    Ok(entries)
}

#[tauri::command]
async fn list_markdown_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || files::list_markdown_files(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_in_dir(root: String, query: String, case_sensitive: bool) -> Result<SearchResult, String> {
    if query.trim().is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            files_scanned: 0,
            truncated: false,
        });
    }

    tauri::async_runtime::spawn_blocking(move || files::search_in_dir(Path::new(&root), &query, case_sensitive, 2000))
        .await
        .map_err(|e| e.to_string())
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(files::percent_decode)
}

/// Raw binary IPC: JSON-encoding a screenshot as a number array is slow.
#[tauri::command]
async fn save_image(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("이미지 데이터가 없습니다.".to_string());
    };
    let doc = header(&request, "x-doc-path").ok_or("문서 경로가 없습니다.")?;
    let folder = header(&request, "x-folder").unwrap_or_else(|| "assets".to_string());
    let name = header(&request, "x-file-name").ok_or("이미지 이름이 없습니다.")?;

    files::save_image(Path::new(&doc), &folder, &name, bytes)
}

#[tauri::command]
async fn create_file(dir: String, name: String) -> Result<String, String> {
    files::create_file(Path::new(&dir), &name)
}

#[tauri::command]
async fn create_dir(dir: String, name: String) -> Result<String, String> {
    files::create_dir(Path::new(&dir), &name)
}

#[tauri::command]
async fn rename_path(path: String, new_name: String) -> Result<String, String> {
    files::rename_path(Path::new(&path), &new_name)
}

#[tauri::command]
async fn open_with_default(path: String) -> Result<(), String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Err(format!("파일을 찾을 수 없습니다: {path}"));
    }

    if !files::is_safe_to_open(target) {
        return Err("실행 파일은 문서 링크로 열 수 없습니다.".to_string());
    }

    tauri_plugin_opener::open_path(target, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn allow_asset_dir(app: AppHandle, dir: String) {
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
}

#[tauri::command]
fn watch_file(app: AppHandle, watcher: State<'_, watcher::FileWatcher>, path: String) -> Result<(), String> {
    watcher.watch(&app, &path)
}

#[tauri::command]
fn unwatch_file(watcher: State<'_, watcher::FileWatcher>, path: String) -> Result<(), String> {
    watcher.unwatch(&path)
}

fn doc_icon_path(app: &AppHandle) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = [
        exe_dir.join("markdown-file.ico"),
        app.path().resource_dir().ok()?.join("markdown-file.ico"),
    ];

    candidates.into_iter().find(|p| p.exists())
}

#[tauri::command]
async fn association_status() -> Result<assoc::AssocStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    Ok(assoc::status(&exe))
}

#[tauri::command]
async fn make_default_app(app: AppHandle) -> Result<assoc::AssocStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let icon = doc_icon_path(&app);
    assoc::register(&exe, icon.as_deref()).map_err(|e| e.to_string())?;
    let status = assoc::status(&exe);

    // Windows 11 Home/Pro only accept a choice the user makes in Windows' own
    // UI, so take them straight to ChoiMark's page there.
    #[cfg(windows)]
    if status.needs_confirm {
        assoc::open_default_apps_settings();
    }

    Ok(status)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    build: u32,
    version: String,
}

#[cfg(windows)]
fn windows_build() -> u32 {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

#[cfg(not(windows))]
fn windows_build() -> u32 {
    0
}

#[tauri::command]
fn platform_info(app: AppHandle) -> PlatformInfo {
    PlatformInfo {
        build: windows_build(),
        version: app.package_info().version.to_string(),
    }
}

fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// `choimark.exe --register-associations`: run by the installer to register
/// the file types with the logic in assoc.rs, then exit without a window.
fn register_and_exit() {
    if let Ok(exe) = std::env::current_exe() {
        let icon = exe.parent().map(|dir| dir.join("markdown-file.ico"));
        let _ = assoc::register(&exe, icon.as_deref());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--register-associations") {
        register_and_exit();

        return;
    }

    let startup = paths_from_args(&args, None);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = paths_from_args(&argv, Some(Path::new(&cwd)));
            focus_main(app);
            let _ = app.emit("open-paths", paths);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupPaths(Mutex::new(startup)))
        .manage(watcher::FileWatcher::default())
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("ChoiMark")
                .inner_size(1280.0, 820.0)
                .min_inner_size(640.0, 420.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                .center()
                // Documents can contain links; the app page itself must never navigate away.
                .on_navigation(|url| is_app_url(url))
                .build()?;

            // The page shows the window once it has painted, so there is no
            // white flash. If the page fails, show it anyway after a moment.
            let fallback = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                if !fallback.is_visible().unwrap_or(true) {
                    let _ = fallback.show();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_startup_paths,
            read_document,
            write_document,
            write_text,
            stat_path,
            list_dir,
            list_markdown_files,
            search_in_dir,
            save_image,
            create_file,
            create_dir,
            rename_path,
            open_with_default,
            allow_asset_dir,
            watch_file,
            unwatch_file,
            association_status,
            make_default_app,
            platform_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChoiMark");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_args_keep_existing_files_only() {
        let dir = std::env::temp_dir();
        let file = dir.join("choimark-args-test.md");
        std::fs::write(&file, "x").unwrap();

        let args = vec![
            "choimark.exe".to_string(),
            "--flag".to_string(),
            file.to_string_lossy().into_owned(),
            "missing-file.md".to_string(),
        ];
        let paths = paths_from_args(&args, Some(&dir));
        assert_eq!(paths, vec![file.to_string_lossy().into_owned()]);

        let relative = vec!["choimark.exe".to_string(), "choimark-args-test.md".to_string()];
        assert_eq!(paths_from_args(&relative, Some(&dir)), vec![file.to_string_lossy().into_owned()]);
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn only_app_urls_may_load() {
        assert!(is_app_url(&"http://tauri.localhost/index.html".parse().unwrap()));
        assert!(is_app_url(&"http://localhost:1420/".parse().unwrap()));
        assert!(!is_app_url(&"https://example.com/".parse().unwrap()));
        assert!(!is_app_url(&"file:///C:/evil.html".parse().unwrap()));
    }
}
