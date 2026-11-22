//! A project folder: its files ([`files`]), its structure ([`scan`]), changes
//! from outside ([`watch`]), and what the app keeps about it in its own data
//! folder: AI changes awaiting review ([`review`]) and file versions ([`history`]).
//!
//! Paths inside a project are relative to its root, with `/` separators.

pub mod files;
pub mod history;
pub mod review;
pub mod scan;
pub mod watch;

use std::path::{Component, Path};

use crate::util::i18n::localized;

/// The same folder however the path was written (separators, trailing slash, case on Windows).
pub fn project_key(root: &str) -> String {
    let key = root.replace('\\', "/").trim_end_matches('/').to_owned();
    if cfg!(windows) {
        key.to_lowercase()
    } else {
        key
    }
}

/// FNV-1a over [`project_key`]. Unlike `DefaultHasher` it never changes between
/// Rust versions, so a project finds its history and reviews again after updates.
pub fn stable_hash(root: &Path) -> u64 {
    project_key(&root.to_string_lossy())
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3))
}

/// Whether `path` is `entry` itself or lies inside the folder `entry`.
pub fn is_within(path: &str, entry: &str) -> bool {
    path == entry || path.strip_prefix(entry).is_some_and(|rest| rest.starts_with('/'))
}

/// Where `path` is after `from` (a file or folder) was renamed to `to`; `None` if it was not moved.
pub fn moved(path: &str, from: &str, to: &str) -> Option<String> {
    is_within(path, from).then(|| format!("{to}{}", &path[from.len()..]))
}

/// A name for a new folder directly in a parent folder: one plain component, no `..`.
pub fn check_name(name: &str) -> Result<(), String> {
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(localized!("error_invalid_name", name = name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_folder_however_written() {
        assert_eq!(project_key(r"C:\Thesis\"), project_key("C:/Thesis"));
        if cfg!(windows) {
            assert_eq!(project_key(r"c:\thesis"), project_key(r"C:\Thesis"));
        }
        assert_eq!(stable_hash(Path::new(r"C:\Projects\Thesis\")), stable_hash(Path::new("C:/Projects/Thesis")));
    }

    #[test]
    fn follows_renamed_entries() {
        assert!(is_within("chapters/a.tex", "chapters") && !is_within("chapters2/a.tex", "chapters"));
        assert_eq!(moved("chapters/a.tex", "chapters", "parts").as_deref(), Some("parts/a.tex"));
        assert_eq!(moved("main.tex", "main.tex", "thesis.tex").as_deref(), Some("thesis.tex"));
        assert_eq!(moved("chapters2/a.tex", "chapters", "parts"), None);
    }

    #[test]
    fn accepts_plain_names_only() {
        assert!(check_name("Thesis").is_ok());
        assert!(check_name("a/b").is_err() && check_name("..").is_err() && check_name("").is_err());
    }
}
