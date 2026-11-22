//! File access inside a project folder.
//!
//! Every path from the frontend is relative to the project root and must stay
//! inside it, so the webview cannot read or write arbitrary files.

use std::io::{ErrorKind, Read};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::util::i18n::localized;

/// Upper bound for the tree, so accidentally opening e.g. the home folder
/// does not walk the whole disk.
const MAX_ENTRIES: usize = 5000;
/// What a ZIP may unpack to at most: far more than any LaTeX project, far less
/// than a disk (a "ZIP bomb" of a few kilobytes can expand to terabytes).
const MAX_ZIP_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 50_000;
/// Folders a ZIP's entries are never unpacked from: macOS metadata, and Git's
/// own folder, whose configuration and hooks could make Git run programs.
const SKIPPED_IN_ZIP: [&str; 2] = ["__MACOSX", ".git"];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub name: String,
    /// Relative to the project root, always with `/` separators.
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeEntry>,
}

/// Joins `relative` onto `root`, rejecting anything that could escape it.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    let safe = relative.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if !safe || relative.as_os_str().is_empty() {
        return Err(localized!("error_invalid_path", path = relative.display()));
    }
    Ok(root.join(relative))
}

/// Folders first, then files, both sorted case-insensitively. Hidden entries
/// (`.git`, …) are skipped.
pub fn tree(root: &Path) -> Result<Vec<TreeEntry>, String> {
    if !root.is_dir() {
        return Err(localized!("error_folder_not_found", path = root.display()));
    }
    let mut budget = MAX_ENTRIES;
    read_dir(root, "", &mut budget)
}

fn read_dir(dir: &Path, prefix: &str, budget: &mut usize) -> Result<Vec<TreeEntry>, String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .collect();
    entries.sort_by_cached_key(|entry| {
        let is_file = !entry.path().is_dir();
        (is_file, entry.file_name().to_string_lossy().to_lowercase())
    });

    let mut result = Vec::new();
    for entry in entries {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let is_dir = entry.path().is_dir();
        // Unreadable subfolders show up empty instead of failing the whole tree.
        let children = if is_dir { read_dir(&entry.path(), &path, budget).unwrap_or_default() } else { Vec::new() };
        result.push(TreeEntry { name, path, is_dir, children });
    }
    Ok(result)
}

pub async fn read(root: &Path, relative: &str) -> Result<String, String> {
    let path = resolve(root, relative)?;
    tokio::fs::read_to_string(&path).await.map_err(|e| format!("{relative}: {e}"))
}

/// A file's bytes, e.g. an image for its tab.
pub async fn read_bytes(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = resolve(root, relative)?;
    tokio::fs::read(&path).await.map_err(|e| format!("{relative}: {e}"))
}

pub async fn write(root: &Path, relative: &str, contents: &str) -> Result<(), String> {
    let path = resolve(root, relative)?;
    tokio::fs::write(&path, contents).await.map_err(|e| format!("{relative}: {e}"))
}

/// Creates a new file; fails if it already exists.
pub async fn create_file(root: &Path, relative: &str, contents: &str) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let path = resolve(root, relative)?;
    let mut file =
        tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map_err(|e| already_exists_or(e, relative))?;
    file.write_all(contents.as_bytes()).await.map_err(|e| format!("{relative}: {e}"))
}

/// Writes a file brought in from outside (dropped onto the explorer) as
/// `relative`, creating missing folders. Never overwrites: if `bild.png` is
/// taken it becomes `bild-2.png`, `bild-3.png`, … Returns the path written.
pub async fn import(root: &Path, relative: &str, contents: &[u8]) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;
    let path = resolve(root, relative)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{relative}: {e}"))?;
    }
    let (dir, name) = relative.rsplit_once('/').map_or(("", relative), |(d, n)| (d, n));
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    };
    for n in 1.. {
        let candidate = match n {
            1 => relative.to_string(),
            _ if dir.is_empty() => format!("{stem}-{n}{extension}"),
            _ => format!("{dir}/{stem}-{n}{extension}"),
        };
        let opened = tokio::fs::OpenOptions::new().write(true).create_new(true).open(resolve(root, &candidate)?).await;
        match opened {
            Ok(mut file) => {
                file.write_all(contents).await.map_err(|e| format!("{candidate}: {e}"))?;
                return Ok(candidate);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{candidate}: {e}")),
        }
    }
    unreachable!()
}

pub async fn create_dir(root: &Path, relative: &str) -> Result<(), String> {
    let path = resolve(root, relative)?;
    tokio::fs::create_dir(&path).await.map_err(|e| already_exists_or(e, relative))
}

/// Creates the folder `parent/name` for a new project; fails if it already exists.
pub async fn create_root(parent: &Path, name: &str) -> Result<PathBuf, String> {
    super::check_name(name)?;
    let path = parent.join(name);
    tokio::fs::create_dir(&path).await.map_err(|e| already_exists_or(e, name))?;
    Ok(path)
}

/// Unpacks a ZIP (e.g. an Overleaf download) into the new, empty folder `root`
/// and returns the number of files. Entries that would land outside it are
/// skipped, as is a `.git` folder (see `SKIPPED_IN_ZIP`); a single folder
/// wrapping everything (GitHub downloads) is dropped.
pub fn extract_zip(archive: &Path, root: &Path) -> Result<usize, String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| localized!("error_zip_invalid", error = e))?;
    if zip.len() > MAX_ZIP_ENTRIES {
        return Err(localized!("error_zip_too_many_entries", count = MAX_ZIP_ENTRIES));
    }
    let names: Vec<Option<PathBuf>> = (0..zip.len()).map(|i| zip.by_index(i).ok().and_then(|entry| entry.enclosed_name())).collect();
    let wrapper = single_wrapper(names.iter().flatten());

    let mut count = 0;
    let mut budget = MAX_ZIP_BYTES;
    for (i, name) in names.iter().enumerate() {
        // `enclosed_name` is `None` for absolute paths and `..` tricks.
        let Some(name) = name else { continue };
        if name.components().any(|c| SKIPPED_IN_ZIP.iter().any(|s| c.as_os_str().eq_ignore_ascii_case(s))) {
            continue;
        }
        let relative = wrapper.as_ref().map_or(name.as_path(), |w| name.strip_prefix(w).unwrap_or(name));
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = root.join(relative);
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&target).map_err(|e| format!("{}: {e}", relative.display()))?;
        // Counted as unpacked, not as the archive claims: its sizes may lie.
        let written = std::io::copy(&mut (&mut entry).take(budget + 1), &mut out).map_err(|e| format!("{}: {e}", relative.display()))?;
        if written > budget {
            return Err(localized!("error_zip_too_large", size = MAX_ZIP_BYTES >> 30));
        }
        budget -= written;
        count += 1;
    }
    Ok(count)
}

/// The folder every entry lies in, if there is exactly one and nothing else.
fn single_wrapper<'a>(names: impl Iterator<Item = &'a PathBuf>) -> Option<PathBuf> {
    let mut wrapper: Option<PathBuf> = None;
    for name in names {
        let mut components = name.components();
        let first = PathBuf::from(components.next()?.as_os_str());
        if SKIPPED_IN_ZIP.iter().any(|s| first.as_os_str().eq_ignore_ascii_case(s)) {
            continue;
        }
        // A file directly at the top level: nothing to unwrap.
        if components.next().is_none() && !name.to_string_lossy().ends_with('/') {
            return None;
        }
        match &wrapper {
            Some(existing) if *existing != first => return None,
            Some(_) => {}
            None => wrapper = Some(first),
        }
    }
    wrapper
}

/// Renames or moves a file or folder inside the project; never overwrites.
pub async fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let source = resolve(root, from)?;
    let target = resolve(root, to)?;
    if target.starts_with(&source) && target != source {
        return Err(localized!("error_move_into_itself", name = from));
    }
    // A case-only rename (`Main.tex` -> `main.tex`) finds itself on Windows.
    let same_file = source.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();
    if target.exists() && !same_file {
        return Err(format!("{to} existiert bereits"));
    }
    tokio::fs::rename(&source, &target).await.map_err(|e| format!("{from}: {e}"))
}

/// Moves a file or folder to the system's recycle bin, so it can be restored.
pub async fn delete(root: &Path, relative: &str) -> Result<(), String> {
    let path = resolve(root, relative)?;
    tokio::task::spawn_blocking(move || trash::delete(&path)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{relative}: {e}"))
}

pub fn exists(root: &Path, relative: &str) -> Result<bool, String> {
    Ok(resolve(root, relative)?.exists())
}

fn already_exists_or(e: std::io::Error, relative: &str) -> String {
    if e.kind() == ErrorKind::AlreadyExists {
        format!("{relative} existiert bereits")
    } else {
        format!("{relative}: {e}")
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn rejects_paths_outside_the_root() {
        let root = Path::new("/project");
        assert!(resolve(root, "chapters/intro.tex").is_ok());
        assert!(resolve(root, "./main.tex").is_ok());
        assert!(resolve(root, "../secret.tex").is_err());
        assert!(resolve(root, "chapters/../../secret.tex").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "").is_err());
        #[cfg(windows)]
        assert!(resolve(Path::new(r"C:\project"), r"D:\other.tex").is_err());
    }

    #[tokio::test]
    async fn creates_project_root_only_as_direct_child() {
        let parent = TestDir::new("root");

        let created = create_root(&parent, "Thesis").await;
        let duplicate = create_root(&parent, "Thesis").await;
        let nested = create_root(&parent, "a/b").await;
        let escaping = create_root(&parent, "..").await;

        assert_eq!(created.unwrap(), parent.join("Thesis"));
        assert!(duplicate.unwrap_err().contains("existiert bereits"));
        assert!(nested.is_err());
        assert!(escaping.is_err());
    }

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        for (name, content) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_zips_safely_and_unwraps_a_single_folder() {
        let base = TestDir::new("zip");

        let wrapped = base.join("wrapped.zip");
        write_zip(
            &wrapped,
            &[
                ("thesis-main/main.tex", "x"),
                ("thesis-main/chapters/a.tex", "a"),
                ("__MACOSX/._main.tex", "junk"),
                ("thesis-main/.git/config", "[core]\n\tfsmonitor = calc.exe\n"),
                (".git/hooks/pre-commit", "evil"),
            ],
        );
        let flat = base.join("flat.zip");
        write_zip(&flat, &[("main.tex", "x"), ("../evil.tex", "evil"), ("images/logo.png", "png")]);

        let one = base.join("one");
        let two = base.join("two");
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        let unwrapped = extract_zip(&wrapped, &one).unwrap();
        let kept = extract_zip(&flat, &two).unwrap();
        let results = (
            one.join("main.tex").is_file(),
            one.join("chapters/a.tex").is_file(),
            one.join("__MACOSX").exists() || one.join(".git").exists(),
            two.join("images/logo.png").is_file(),
            base.join("evil.tex").exists(),
        );

        assert_eq!((unwrapped, kept), (2, 2));
        assert_eq!(results, (true, true, false, true, false));
    }

    #[tokio::test]
    async fn renames_without_overwriting() {
        let root = TestDir::new("rename");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("a.tex"), "a").unwrap();
        std::fs::write(root.join("b.tex"), "b").unwrap();

        let overwrite = rename(&root, "a.tex", "b.tex").await;
        let into_itself = rename(&root, "chapters", "chapters/sub").await;
        let moved = rename(&root, "a.tex", "chapters/a.tex").await;
        let case_only = rename(&root, "b.tex", "B.tex").await;
        let content = std::fs::read_to_string(root.join("chapters/a.tex"));

        assert!(overwrite.unwrap_err().contains("existiert bereits"));
        assert!(into_itself.is_err());
        assert!(moved.is_ok());
        assert!(case_only.is_ok());
        assert_eq!(content.unwrap(), "a");
    }

    #[tokio::test]
    async fn imports_without_overwriting() {
        let root = TestDir::new("import");

        let first = import(&root, "bilder/logo.png", b"one").await;
        let second = import(&root, "bilder/logo.png", b"two").await;
        let third = import(&root, "bilder/logo.png", b"three").await;
        let no_extension = import(&root, "README", b"x").await;
        let no_extension_again = import(&root, "README", b"y").await;
        let escaping = import(&root, "../evil.png", b"evil").await;
        let content = std::fs::read(root.join("bilder/logo.png"));

        assert_eq!(first.unwrap(), "bilder/logo.png");
        assert_eq!(second.unwrap(), "bilder/logo-2.png");
        assert_eq!(third.unwrap(), "bilder/logo-3.png");
        assert_eq!(no_extension.unwrap(), "README");
        assert_eq!(no_extension_again.unwrap(), "README-2");
        assert!(escaping.is_err());
        assert_eq!(content.unwrap(), b"one");
    }

    #[test]
    fn lists_folders_first_and_skips_hidden_entries() {
        let root = TestDir::new("tree");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("main.tex"), "").unwrap();
        std::fs::write(root.join("chapters/intro.tex"), "").unwrap();

        let entries = tree(&root).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["chapters", "main.tex"]);
        assert_eq!(entries[0].children[0].path, "chapters/intro.tex");
    }
}
