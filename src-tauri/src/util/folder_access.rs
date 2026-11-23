//! Windows' Controlled Folder Access ("ransomware protection"). When it is on,
//! programs Microsoft does not know, such as Gilgamesh or Git, may not write to
//! the folders it protects: Documents, Desktop, Pictures, Videos, Music,
//! Favorites and whatever the user added. Windows does not say so: it answers
//! "file not found" (`os error 2`) for a folder that is there. These helpers
//! recognize that case, so the user learns what happened and what to do.

use std::fmt::Display;
use std::io::{Error, ErrorKind};
use std::path::Path;

use crate::util::i18n::localized;

/// What to tell the user about `error` while writing `target`, a file or folder
/// (also a new one) that is shown as `label`.
pub fn write_error(error: &Error, target: &Path, label: impl Display) -> String {
    match blocked_in(error, target) {
        Some(folder) => protected(folder),
        None => format!("{label}: {error}"),
    }
}

/// [`write_error`] for creating `target`, which must not exist yet.
pub fn create_error(error: &Error, target: &Path, label: impl Display) -> String {
    if error.kind() == ErrorKind::AlreadyExists {
        localized!("error_already_exists", name = label)
    } else {
        write_error(error, target, label)
    }
}

/// [`write_error`] for `create_dir_all(dir)`: it makes the missing folders on
/// the way, so "not found" there means the nearest existing one is protected.
pub fn create_dirs_error(error: &Error, dir: &Path, label: impl Display) -> String {
    let existing = dir.ancestors().find(|folder| folder.is_dir());
    match existing.filter(|_| error.kind() == ErrorKind::NotFound && blocks_writes()) {
        Some(folder) => protected(folder),
        None => format!("{label}: {error}"),
    }
}

/// The message that Windows keeps Gilgamesh from writing to `folder`.
pub fn protected(folder: &Path) -> String {
    localized!("error_folder_protected", folder = folder.display())
}

/// The folder Controlled Folder Access kept `error` from writing to, if it did:
/// Windows says "not found" although the folder `target` goes into is there.
fn blocked_in<'a>(error: &Error, target: &'a Path) -> Option<&'a Path> {
    let folder = target.parent().filter(|folder| folder.is_dir())?;
    (error.kind() == ErrorKind::NotFound && blocks_writes()).then_some(folder)
}

/// Whether Git's error output for work in the existing folder `folder` (a
/// repository, or where one is cloned to) means Controlled Folder Access kept it
/// from writing there: Git then says a file or folder does not exist or may not be made.
pub fn blocked_git(output: &str, folder: &Path) -> bool {
    const SIGNS: [&str; 4] = ["No such file or directory", "Permission denied", "cannot mkdir", "unable to create"];
    SIGNS.iter().any(|sign| output.contains(sign)) && folder.is_dir() && blocks_writes()
}

/// Whether Controlled Folder Access is on and blocks (not only audits).
pub fn blocks_writes() -> bool {
    platform::blocks_writes()
}

#[cfg(windows)]
mod platform {
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};

    /// Set by group policy or by the user in Windows Security; the policy wins.
    const KEYS: [&str; 2] = [
        r"SOFTWARE\Policies\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access",
        r"SOFTWARE\Microsoft\Windows Defender\Windows Defender Exploit Guard\Controlled Folder Access",
    ];
    /// `EnableControlledFolderAccess`: 0 off, 1 blocks, 2 audits only, 3 and 4 concern disk sectors.
    const BLOCK: u32 = 1;

    pub fn blocks_writes() -> bool {
        KEYS.iter().find_map(|key| dword(key, "EnableControlledFolderAccess")) == Some(BLOCK)
    }

    /// A DWORD in `HKEY_LOCAL_MACHINE`, which every user may read here.
    fn dword(key: &str, value: &str) -> Option<u32> {
        let key: Vec<u16> = key.encode_utf16().chain([0]).collect();
        let value: Vec<u16> = value.encode_utf16().chain([0]).collect();
        let mut data = 0u32;
        let mut size = size_of::<u32>() as u32;
        // SAFETY: `key` and `value` are NUL-terminated; `data` holds the `size` bytes a DWORD takes.
        let status = unsafe {
            RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), RRF_RT_REG_DWORD, null_mut(), (&raw mut data).cast(), &mut size)
        };
        (status == ERROR_SUCCESS).then_some(data)
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn blocks_writes() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn says_what_failed_where() {
        let dir = TestDir::new("folder-access");
        let target = dir.join("chapter.tex");
        let denied = Error::from(ErrorKind::PermissionDenied);
        assert_eq!(write_error(&denied, &target, "chapter.tex"), format!("chapter.tex: {denied}"));

        let exists = Error::from(ErrorKind::AlreadyExists);
        assert_eq!(create_error(&exists, &target, "chapter.tex"), localized!("error_already_exists", name = "chapter.tex"));

        // "Not found" in a folder that is there: Controlled Folder Access, if it is on.
        let missing = Error::from(ErrorKind::NotFound);
        let expected = if blocks_writes() { protected(&dir) } else { format!("chapter.tex: {missing}") };
        assert_eq!(write_error(&missing, &target, "chapter.tex"), expected);
        // In a folder that is not there, it is just that.
        let nowhere = dir.join("gone").join("chapter.tex");
        assert_eq!(write_error(&missing, &nowhere, "chapter.tex"), format!("chapter.tex: {missing}"));
    }

    #[test]
    fn reads_git_errors() {
        let dir = TestDir::new("folder-access-git");
        let mkdir = format!("fatal: cannot mkdir {}: No such file or directory", dir.join("x").display());
        assert_eq!(blocked_git(&mkdir, &dir), blocks_writes());
        assert!(!blocked_git("fatal: repository not found", &dir));
        assert!(!blocked_git(&mkdir, &dir.join("gone")));
    }
}
