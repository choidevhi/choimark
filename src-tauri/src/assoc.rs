//! Markdown file association for the current user.
//!
//! The installer registers the same keys (src-tauri/windows/hooks.nsh). This
//! module lets the app check the result and repair it from Settings, for
//! example after another editor takes the extension back.

use serde::Serialize;

pub const PROG_ID: &str = "ChoiMark.Markdown";
pub const APP_NAME: &str = "ChoiMark";
pub const EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssocStatus {
    pub is_default: bool,
    /// Windows 11 Home/Pro: the user has to pick ChoiMark once in Windows' UI.
    pub needs_confirm: bool,
    pub handler: String,
    pub handler_name: String,
    pub linked: Vec<String>,
    pub unlinked: Vec<String>,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::userchoice;
    use std::ffi::OsString;
    use std::io;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::Path;

    use windows_sys::Win32::UI::Shell::{
        AssocQueryStringW, SHChangeNotify, ASSOCF_NOTRUNCATE, ASSOCSTR, ASSOCSTR_EXECUTABLE,
        ASSOCSTR_FRIENDLYAPPNAME, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    fn wide(text: &str) -> Vec<u16> {
        std::ffi::OsStr::new(text).encode_wide().chain(Some(0)).collect()
    }

    fn assoc_query(ext: &str, what: ASSOCSTR) -> Option<String> {
        let ext_w = wide(&format!(".{ext}"));
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: ext_w is NUL-terminated; buf/len describe a writable buffer.
        let hr = unsafe {
            AssocQueryStringW(
                ASSOCF_NOTRUNCATE as _,
                what,
                ext_w.as_ptr(),
                std::ptr::null(),
                buf.as_mut_ptr(),
                &mut len,
            )
        };

        if hr != 0 || len == 0 {
            return None;
        }

        let end = buf.iter().position(|c| *c == 0).unwrap_or(len as usize);
        let value = OsString::from_wide(&buf[..end]).to_string_lossy().into_owned();

        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }

    fn same_file(a: &str, b: &Path) -> bool {
        let left = a.trim_matches('"').replace('/', "\\").to_lowercase();
        let right = b.to_string_lossy().replace('/', "\\").to_lowercase();

        left == right
    }

    const FILE_EXTS: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

    /// Windows 11 Home/Pro (2025+) only trust UserChoiceLatest, whose hash is
    /// not public. Windows writes such keys for its own defaults, so finding
    /// any means the newer check is active and the user must confirm once.
    pub fn latest_enforced(hkcu: &RegKey) -> bool {
        let Ok(exts) = hkcu.open_subkey_with_flags(FILE_EXTS, KEY_READ) else {
            return false;
        };

        exts.enum_keys()
            .flatten()
            .any(|ext| exts.open_subkey_with_flags(format!(r"{ext}\UserChoiceLatest"), KEY_READ).is_ok())
    }

    fn read_prog_id(hkcu: &RegKey, path: String) -> Option<String> {
        hkcu.open_subkey_with_flags(path, KEY_READ)
            .and_then(|k| k.get_value::<String, _>("ProgId"))
            .ok()
    }

    fn latest_choice(hkcu: &RegKey, dotted: &str) -> Option<String> {
        read_prog_id(hkcu, format!(r"{FILE_EXTS}\{dotted}\UserChoiceLatest\ProgId"))
    }

    fn legacy_choice(hkcu: &RegKey, dotted: &str) -> Option<String> {
        read_prog_id(hkcu, format!(r"{FILE_EXTS}\{dotted}\UserChoice"))
    }

    pub fn status(exe: &Path) -> AssocStatus {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let enforced = latest_enforced(&hkcu);
        let mut linked = Vec::new();
        let mut unlinked = Vec::new();

        for ext in EXTENSIONS {
            let dotted = format!(".{ext}");
            // A signed choice wins. Without one, Windows 11 Home/Pro shows its
            // "Open with" picker, while older checks follow the class default.
            let ours = match latest_choice(&hkcu, &dotted) {
                Some(prog) => prog.eq_ignore_ascii_case(PROG_ID),
                None if enforced => false,
                None => assoc_query(ext, ASSOCSTR_EXECUTABLE)
                    .as_deref()
                    .map(|h| same_file(h, exe))
                    .unwrap_or(false),
            };

            if ours {
                linked.push((*ext).to_string());
            } else {
                unlinked.push((*ext).to_string());
            }
        }

        AssocStatus {
            is_default: unlinked.is_empty(),
            needs_confirm: enforced && !unlinked.is_empty(),
            handler: assoc_query("md", ASSOCSTR_EXECUTABLE).unwrap_or_default(),
            handler_name: assoc_query("md", ASSOCSTR_FRIENDLYAPPNAME).unwrap_or_default(),
            linked,
            unlinked,
        }
    }

    fn last_write(key: &RegKey) -> io::Result<u64> {
        let info = key.query_info()?;
        let ft = &*info.last_write_time;

        Ok((u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime))
    }

    /// Writes a hashed UserChoice. Honoured by Windows 10 and by Windows 11
    /// editions without UserChoiceLatest; harmless elsewhere. The hash covers
    /// the key's write time to the minute, so retry if the minute rolled over.
    fn write_user_choice(exts: &RegKey, dotted: &str, sid: &str) -> io::Result<()> {
        for _ in 0..3 {
            let (choice, _) = exts.create_subkey("UserChoice")?;
            set(&choice, "ProgId", PROG_ID)?;
            let before = last_write(&choice)?;
            set(&choice, "Hash", &userchoice::hash(&userchoice::input(dotted, sid, PROG_ID, before)))?;

            if userchoice::minute_stamp(before) == userchoice::minute_stamp(last_write(&choice)?) {
                return Ok(());
            }
        }

        Ok(())
    }

    fn set(key: &RegKey, name: &str, value: &str) -> io::Result<()> {
        key.set_value(name, &value.to_string())
    }

    pub fn register(exe: &Path, doc_icon: Option<&Path>) -> io::Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe_str = exe.to_string_lossy();
        let open_command = format!("\"{exe_str}\" \"%1\"");
        let app_icon = format!("\"{exe_str}\",0");
        let file_icon = doc_icon
            .filter(|p| p.exists())
            .map(|p| format!("\"{}\",0", p.to_string_lossy()))
            .unwrap_or_else(|| app_icon.clone());

        let (prog, _) = hkcu.create_subkey(format!("Software\\Classes\\{PROG_ID}"))?;
        set(&prog, "", "Markdown 문서")?;
        set(&prog, "FriendlyTypeName", "Markdown 문서")?;
        let (icon, _) = prog.create_subkey("DefaultIcon")?;
        set(&icon, "", &file_icon)?;
        let (shell, _) = prog.create_subkey("shell")?;
        set(&shell, "", "open")?;
        let (open, _) = shell.create_subkey("open")?;
        set(&open, "", "ChoiMark로 열기")?;
        let (command, _) = open.create_subkey("command")?;
        set(&command, "", &open_command)?;

        let (app, _) = hkcu.create_subkey("Software\\Classes\\Applications\\choimark.exe")?;
        set(&app, "FriendlyAppName", APP_NAME)?;
        let (app_command, _) = app.create_subkey("shell\\open\\command")?;
        set(&app_command, "", &open_command)?;
        let (supported, _) = app.create_subkey("SupportedTypes")?;

        let (caps, _) = hkcu.create_subkey(format!("Software\\{APP_NAME}\\Capabilities"))?;
        set(&caps, "ApplicationName", APP_NAME)?;
        set(&caps, "ApplicationDescription", "마크다운 편집기 · 미리보기")?;
        set(&caps, "ApplicationIcon", &app_icon)?;
        let (cap_assoc, _) = caps.create_subkey("FileAssociations")?;
        let (registered, _) = hkcu.create_subkey("Software\\RegisteredApplications")?;
        set(&registered, APP_NAME, &format!("Software\\{APP_NAME}\\Capabilities"))?;

        let sid = userchoice::current_user_sid();

        for ext in EXTENSIONS {
            let dotted = format!(".{ext}");
            set(&supported, &dotted, "")?;
            set(&cap_assoc, &dotted, PROG_ID)?;

            let (class, _) = hkcu.create_subkey(format!("Software\\Classes\\{dotted}"))?;
            set(&class, "", PROG_ID)?;
            set(&class, "Content Type", "text/markdown")?;
            set(&class, "PerceivedType", "text")?;
            let (open_with, _) = class.create_subkey("OpenWithProgids")?;
            set(&open_with, PROG_ID, "")?;

            if *ext == "md" {
                let (shell_new, _) = class.create_subkey("ShellNew")?;
                set(&shell_new, "NullFile", "")?;
            }

            // A saved "always use this app" choice for another app overrides the
            // class default. Windows denies writing it but allows deleting it.
            // A choice that already names ChoiMark stays: on Windows 11 it is
            // the user's own confirmation and cannot be recreated by us.
            let (exts, _) = hkcu.create_subkey(format!(r"{FILE_EXTS}\{dotted}"))?;

            if latest_choice(&hkcu, &dotted).is_some_and(|p| !p.eq_ignore_ascii_case(PROG_ID)) {
                delete_key(&exts, "UserChoiceLatest");
            }

            if !legacy_choice(&hkcu, &dotted).is_some_and(|p| p.eq_ignore_ascii_case(PROG_ID)) {
                delete_key(&exts, "UserChoice");

                if let Some(sid) = sid.as_deref() {
                    let _ = write_user_choice(&exts, &dotted, sid);
                }
            }
        }

        notify_shell();

        Ok(())
    }

    /// Deletes a key and its subkeys one key at a time. RegDeleteTree (what
    /// `delete_subkey_all` uses) also needs SetValue, which Windows denies on
    /// UserChoice; plain RegDeleteKey only needs Delete, which is allowed.
    pub(super) fn delete_key(parent: &RegKey, name: &str) {
        if let Ok(key) = parent.open_subkey_with_flags(name, KEY_READ) {
            let children: Vec<String> = key.enum_keys().flatten().collect();

            for child in children {
                delete_key(&key, &child);
            }
        }

        let _ = parent.delete_subkey(name);
    }

    pub fn notify_shell() {
        // SAFETY: SHCNE_ASSOCCHANGED takes no item pointers.
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
    }
}

#[cfg(windows)]
pub use imp::{register, status};

/// Opens Windows Settings at ChoiMark's default-apps page.
#[cfg(windows)]
pub fn open_default_apps_settings() {
    let _ = std::process::Command::new("explorer.exe")
        .arg(format!("ms-settings:defaultapps?registeredAppUser={APP_NAME}"))
        .spawn();
}

#[cfg(not(windows))]
pub fn status(_exe: &std::path::Path) -> AssocStatus {
    AssocStatus {
        is_default: false,
        needs_confirm: false,
        handler: String::new(),
        handler_name: String::new(),
        linked: Vec::new(),
        unlinked: EXTENSIONS.iter().map(|e| e.to_string()).collect(),
    }
}

#[cfg(not(windows))]
pub fn register(_exe: &std::path::Path, _icon: Option<&std::path::Path>) -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    /// Mirrors the real UserChoice ACL (Deny SetValue for the user) on a
    /// scratch key and checks that our delete still removes it.
    #[test]
    fn deletes_keys_whose_values_are_write_protected() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let root = r"Software\ChoiMarkAssocTest";

        if let Ok(stale) = hkcu.open_subkey_with_flags(root, KEY_READ) {
            super::imp::delete_key(&stale, "UserChoice");
        }

        let (choice, _) = hkcu.create_subkey(format!(r"{root}\UserChoice\Nested")).unwrap();
        choice.set_value("ProgId", &"Dummy".to_string()).unwrap();
        drop(choice);

        let user = std::env::var("USERNAME").unwrap();
        let script = format!(
            r"$p='HKCU:\{root}\UserChoice'; $a=Get-Acl $p; $r=New-Object System.Security.AccessControl.RegistryAccessRule('{user}','SetValue','Deny'); $a.AddAccessRule($r); Set-Acl -Path $p -AclObject $a"
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .unwrap();
        assert!(status.success());

        let protected = hkcu.open_subkey_with_flags(format!(r"{root}\UserChoice"), KEY_READ).unwrap();
        assert!(protected.set_value("ProgId", &"Other".to_string()).is_err(), "deny ACE must block writes");
        drop(protected);

        let parent = hkcu.open_subkey_with_flags(root, KEY_READ).unwrap();
        super::imp::delete_key(&parent, "UserChoice");
        assert!(hkcu.open_subkey(format!(r"{root}\UserChoice")).is_err());
        hkcu.delete_subkey_all(root).unwrap();
    }
}
