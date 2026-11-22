//! Windows: a data folder for users whose own one TeX cannot use (a user name
//! with a space or an umlaut, as in `C:\Users\Jürgen Müller`).
//!
//! It lies in `C:\ProgramData`, where every user may create folders. Its
//! subfolders inherit write access for all users, so a folder made there in the
//! usual way would let another account on the computer put programs into the
//! TeX distribution, which this user then runs. So the folder is this user's
//! alone (`Gilgamesh-<SID>`, with an access list that no longer inherits), and
//! one that someone else made first is never used.

use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// Owners besides the user that are fine: the built-in Administrators group,
/// which owns what an elevated administrator creates.
const ADMINISTRATORS: &str = "S-1-5-32-544";

/// This user's private folder in `C:\ProgramData`, created if need be.
pub fn private_data_dir() -> Result<PathBuf, String> {
    let program_data = std::env::var_os("ProgramData").ok_or("ProgramData is not set")?;
    let sid = user_sid()?;
    let dir = PathBuf::from(program_data).join(format!("Gilgamesh-{sid}"));
    // Full control for this user, the system and administrators; nothing inherited from ProgramData.
    let sddl = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `sddl` is NUL-terminated; the descriptor is freed below.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(wide(sddl.as_ref()).as_ptr(), SDDL_REVISION_1, &mut descriptor, null_mut())
    };
    if converted == 0 {
        return Err(format!("Access rights could not be applied: {}", std::io::Error::last_os_error()));
    }
    let attributes =
        SECURITY_ATTRIBUTES { nLength: size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
    // SAFETY: the path is NUL-terminated; `attributes` points to a valid descriptor.
    let (created, error) = unsafe {
        let created = CreateDirectoryW(wide(dir.as_os_str()).as_ptr(), &attributes);
        let error = GetLastError();
        LocalFree(descriptor);
        (created != 0, error)
    };
    if !created && error != ERROR_ALREADY_EXISTS {
        return Err(format!("{}: {}", dir.display(), std::io::Error::from_raw_os_error(error as i32)));
    }
    let owner = owner_of(&dir)?;
    if owner != sid && owner != ADMINISTRATORS {
        return Err(format!("{} belongs to another user and is not used.", dir.display()));
    }
    Ok(dir)
}

fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    text.encode_wide().chain(Some(0)).collect()
}

/// `sid` as text (`S-1-5-21-…`).
///
/// SAFETY: `sid` must point to a valid SID.
unsafe fn sid_string(sid: PSID) -> Result<String, String> {
    let mut text = null_mut();
    // SAFETY: as promised by the caller; the string is freed below.
    unsafe {
        if ConvertSidToStringSidW(sid, &mut text) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let result = OsString::from_wide(std::slice::from_raw_parts(text, len)).to_string_lossy().into_owned();
        LocalFree(text.cast());
        Ok(result)
    }
}

/// The SID of the user this process runs as.
fn user_sid() -> Result<String, String> {
    let mut token: HANDLE = null_mut();
    // SAFETY: the token is closed below; the buffer is as large as Windows asked for
    // and aligned for TOKEN_USER (u64 words), whose SID points into it.
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len);
        let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
        let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), len, &mut len);
        CloseHandle(token);
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        sid_string(user.User.Sid)
    }
}

/// Whether this user (or the Administrators group) owns `path`.
pub fn owned_by_user(path: &Path) -> bool {
    match (owner_of(path), user_sid()) {
        (Ok(owner), Ok(user)) => owner == user || owner == ADMINISTRATORS,
        _ => false,
    }
}

/// The SID of the owner of `path`, as text.
fn owner_of(path: &Path) -> Result<String, String> {
    let mut owner: PSID = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: the path is NUL-terminated; `owner` points into `descriptor`, freed after use.
    unsafe {
        let error = GetNamedSecurityInfoW(
            wide(path.as_os_str()).as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut descriptor,
        );
        if error != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(error as i32).to_string());
        }
        let result = sid_string(owner);
        LocalFree(descriptor);
        result
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn tells_own_folders_from_others() {
        let mine = TestDir::new("owner");
        let own = owned_by_user(&mine);
        // The Windows folder belongs to TrustedInstaller.
        let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap());

        assert!(user_sid().unwrap().starts_with("S-1-5-"));
        assert!(own && !owned_by_user(&windows));
    }

    /// Makes the real folder in ProgramData and removes it again: `cargo test -- --ignored private_folder`.
    #[test]
    #[ignore]
    fn private_folder_is_this_users_alone() {
        let dir = private_data_dir().unwrap();
        let again = private_data_dir().unwrap();
        let name = dir.file_name().unwrap().to_string_lossy().into_owned();
        let owned = owned_by_user(&dir);
        let acl = std::process::Command::new("icacls").arg(&dir).output().unwrap();
        std::fs::remove_dir(&dir).unwrap();

        let acl = String::from_utf8_lossy(&acl.stdout).to_lowercase();
        assert_eq!(dir, again);
        assert!(name.starts_with("Gilgamesh-S-1-5-") && super::super::is_tex_safe(&dir), "{name}");
        assert!(owned);
        // Nothing for all users (BUILTIN\Users, "Benutzer" in German), nothing inherited.
        assert!(!acl.contains("users:") && !acl.contains("benutzer:") && !acl.contains("(i)"), "{acl}");
    }
}
