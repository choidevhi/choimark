//! The UserChoice hash Windows uses to sign "always open with" choices.
//!
//! Windows 10 and Windows 11 Enterprise/Education accept a UserChoice key whose
//! Hash matches this value, so the installer can make ChoiMark the default
//! without a prompt. Windows 11 Home/Pro (2025+) validate a newer, unpublished
//! UserChoiceLatest hash instead and ignore this one; there the user confirms
//! once in Windows' own "Open with" dialog.
//!
//! Algorithm: MD5 of the UTF-16 input seeds two 32-bit mixing passes
//! ("CS64 word swap" and "CS64 reversible"); the XOR of both is the hash.
//! Verified against every UserChoice Windows wrote on the development PC.

use md5::{Digest, Md5};

pub const EXPERIENCE: &str = "User Choice set via Windows User Experience {D18B6DD5-6124-4341-9318-804003BAFA0B}";

/// FILETIME truncated to the minute, as 16 lowercase hex digits.
pub fn minute_stamp(filetime: u64) -> String {
    let truncated = filetime - filetime % 600_000_000;

    format!("{:08x}{:08x}", truncated >> 32, truncated & 0xFFFF_FFFF)
}

pub fn input(ext: &str, sid: &str, prog_id: &str, filetime: u64) -> String {
    format!("{ext}{sid}{prog_id}{}{EXPERIENCE}", minute_stamp(filetime)).to_lowercase()
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();

    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);

        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(TABLE[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }

    out
}

pub fn hash(input: &str) -> String {
    let mut data: Vec<u8> = input.encode_utf16().flat_map(u16::to_le_bytes).collect();
    data.extend_from_slice(&[0, 0]);
    let digest = Md5::digest(&data);
    let m0 = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]);
    let m1 = u32::from_le_bytes([digest[4], digest[5], digest[6], digest[7]]);
    let byte_len = data.len();
    let length = usize::from(byte_len & 4 == 0) + (byte_len >> 2) - 1;

    if length <= 1 {
        return String::new();
    }

    let words: Vec<u32> = data
        .chunks_exact(4)
        .take(length)
        .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    let k0 = (m0 | 1).wrapping_add(0x69FB_0000);
    let k1 = (m1 | 1).wrapping_add(0x13DB_0000);
    let (mut a1, mut a2, mut cache) = (0u32, 0u32, 0u32);

    for pair in words.chunks_exact(2) {
        let r0 = pair[0].wrapping_add(a1);
        let r2a = r0.wrapping_mul(k0).wrapping_sub(0x10FA_9605u32.wrapping_mul(r0 >> 16));
        let r2b = 0x79F8_A395u32.wrapping_mul(r2a).wrapping_add(0x689B_6B9Fu32.wrapping_mul(r2a >> 16));
        let r3 = 0xEA97_0001u32.wrapping_mul(r2b).wrapping_sub(0x3C10_1569u32.wrapping_mul(r2b >> 16));
        let r4 = r3.wrapping_add(pair[1]);
        let r5 = cache.wrapping_add(r3);
        let r6a = r4.wrapping_mul(k1).wrapping_sub(0x3CE8_EC25u32.wrapping_mul(r4 >> 16));
        let r6b = 0x59C3_AF2Du32.wrapping_mul(r6a).wrapping_sub(0x2232_E0F1u32.wrapping_mul(r6a >> 16));
        a1 = 0x1EC9_0001u32.wrapping_mul(r6b).wrapping_add(0x35BD_1EC9u32.wrapping_mul(r6b >> 16));
        a2 = r5.wrapping_add(a1);
        cache = a2;
    }

    let k0 = m0 | 1;
    let k1 = m1 | 1;
    let (mut b1, mut b2) = (0u32, 0u32);
    cache = 0;

    for pair in words.chunks_exact(2) {
        let r0 = pair[0].wrapping_add(b1);
        let r1a = r0.wrapping_mul(k0);
        let r1b = 0xB111_0000u32.wrapping_mul(r1a).wrapping_sub(0x3067_4EEFu32.wrapping_mul(r1a >> 16));
        let r2a = 0x5B9F_0000u32.wrapping_mul(r1b).wrapping_sub(0x78F7_A461u32.wrapping_mul(r1b >> 16));
        let r2b = 0x12CE_B96Du32.wrapping_mul(r2a >> 16).wrapping_sub(0x4693_0000u32.wrapping_mul(r2a));
        let r3 = 0x1D83_0000u32.wrapping_mul(r2b).wrapping_add(0x257E_1D83u32.wrapping_mul(r2b >> 16));
        let r4a = k1.wrapping_mul(r3.wrapping_add(pair[1]));
        let r4b = 0x16F5_0000u32.wrapping_mul(r4a).wrapping_sub(0x5D8B_E90Bu32.wrapping_mul(r4a >> 16));
        let r5a = 0x96FF_0000u32.wrapping_mul(r4b).wrapping_sub(0x2C7C_6901u32.wrapping_mul(r4b >> 16));
        let r5b = 0x2B89_0000u32.wrapping_mul(r5a).wrapping_add(0x7C93_2B89u32.wrapping_mul(r5a >> 16));
        b1 = 0x9F69_0000u32.wrapping_mul(r5b).wrapping_sub(0x405B_6097u32.wrapping_mul(r5b >> 16));
        b2 = b1.wrapping_add(cache).wrapping_add(r3);
        cache = b2;
    }

    let mut out = [0u8; 8];
    out[..4].copy_from_slice(&(a1 ^ b1).to_le_bytes());
    out[4..].copy_from_slice(&(a2 ^ b2).to_le_bytes());

    base64(&out)
}

#[cfg(windows)]
pub fn current_user_sid() -> Option<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: standard token query; every handle and buffer is checked and
    // released, and the TOKEN_USER is read from a buffer of the size the API
    // asked for.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();

        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }

        let mut size = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
        let mut buffer = vec![0u8; size as usize];
        let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size);
        CloseHandle(token);

        if ok == 0 {
            return None;
        }

        let user = buffer.as_ptr().cast::<TOKEN_USER>().read_unaligned();
        let mut text: *mut u16 = std::ptr::null_mut();

        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 || text.is_null() {
            return None;
        }

        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());

        Some(sid.to_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(&[0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88]), "/+7dzLuqmYg=");
        assert_eq!(base64(b"Man"), "TWFu");
    }

    #[test]
    fn minute_stamp_truncates() {
        let ft = 0x01DC_3A1B_2C3D_4E5F_u64;
        assert_eq!(minute_stamp(ft).len(), 16);
        assert_eq!(minute_stamp(ft), minute_stamp(ft - ft % 600_000_000 + 599_999_999));
    }

    /// Reference value from the Python prototype that reproduced all 144
    /// UserChoice hashes Windows wrote on the development PC.
    #[test]
    fn hash_matches_reference_vector() {
        let text = input(".md", "s-1-5-21-1000000001-2000000002-3000000003-1001", "ChoiMark.Markdown", 0x01DC_3A1B_2C3D_4E5F);
        assert_eq!(hash(&text), REFERENCE);
    }

    const REFERENCE: &str = "h9toOgOGcZE=";

    /// Recomputes the hashes Windows itself stored for this user. Skips
    /// silently on machines without any UserChoice keys.
    #[cfg(windows)]
    #[test]
    fn reproduces_hashes_windows_wrote() {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let sid = current_user_sid().expect("sid");
        let exts = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts", KEY_READ)
            .expect("FileExts");
        let mut checked = 0;

        for ext in exts.enum_keys().flatten() {
            let Ok(choice) = exts.open_subkey_with_flags(format!(r"{ext}\UserChoice"), KEY_READ) else {
                continue;
            };
            let (Ok(prog), Ok(stored)) = (choice.get_value::<String, _>("ProgId"), choice.get_value::<String, _>("Hash")) else {
                continue;
            };

            if prog == "ChoiMark.Markdown" {
                continue;
            }

            let info = choice.query_info().expect("info");
            let ft = &*info.last_write_time;
            let filetime = (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime);
            assert_eq!(hash(&input(&ext, &sid, &prog, filetime)), stored, "{ext}");
            checked += 1;
        }

        eprintln!("verified {checked} UserChoice hashes");
    }
}
