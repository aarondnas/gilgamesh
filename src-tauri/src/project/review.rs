//! Changes by AI assistants that the user has not accepted or rejected yet
//! (see `ai-review.ts` in the frontend), kept across restarts as VS Code does.
//! Only the original text is stored, the file's text from before the
//! assistant's edits: `reviews/<project hash>/<encoded path>.txt` in the app's
//! data folder, so the project folder stays untouched and the review belongs
//! to this user on this computer. The frontend compares it with the file to
//! find what still awaits review. A file the assistant created has the empty
//! text as original (rejecting it deletes the file); one it deleted keeps its
//! last text (rejecting it brings the file back). These two kinds have folders
//! of their own, `created/` and `deleted/`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::history::{decode, encode};
use super::{is_within, moved, stable_hash};
use crate::paths::AppPaths;
use crate::util::fs::write_atomic;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReviewKind {
    Modified,
    Created,
    Deleted,
}

const KINDS: [ReviewKind; 3] = [ReviewKind::Modified, ReviewKind::Created, ReviewKind::Deleted];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingReview {
    pub file: String,
    pub original: String,
    pub kind: ReviewKind,
}

const EXTENSION: &str = ".txt";

fn project_dir(paths: &AppPaths, root: &Path) -> PathBuf {
    paths.reviews().join(format!("{:016x}", stable_hash(root)))
}

fn kind_dir(paths: &AppPaths, root: &Path, kind: ReviewKind) -> PathBuf {
    let dir = project_dir(paths, root);
    match kind {
        ReviewKind::Modified => dir,
        ReviewKind::Created => dir.join("created"),
        ReviewKind::Deleted => dir.join("deleted"),
    }
}

fn file_path(paths: &AppPaths, root: &Path, file: &str, kind: ReviewKind) -> PathBuf {
    kind_dir(paths, root, kind).join(format!("{}{EXTENSION}", encode(file)))
}

/// Keeps `original` as the text `file` had before an assistant changed, created or deleted it.
pub async fn save(paths: &AppPaths, root: &Path, file: &str, original: &str, kind: ReviewKind) -> Result<(), String> {
    // A file has one kind at a time, e.g. a created file the assistant deleted again.
    remove(paths, root, file).await?;
    let path = file_path(paths, root, file, kind);
    tokio::fs::create_dir_all(kind_dir(paths, root, kind)).await.map_err(|e| e.to_string())?;
    // Written aside first: a half-written original would show wrong changes.
    write_atomic(&path, original).await
}

/// Nothing in `file` awaits review any more (or the file itself is gone).
pub async fn remove(paths: &AppPaths, root: &Path, file: &str) -> Result<(), String> {
    for kind in KINDS {
        match tokio::fs::remove_file(file_path(paths, root, file, kind)).await {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

/// Every file of the project with changes awaiting review.
pub fn list(paths: &AppPaths, root: &Path) -> Vec<PendingReview> {
    let mut pending: Vec<PendingReview> = KINDS
        .into_iter()
        .filter_map(|kind| Some((kind, std::fs::read_dir(kind_dir(paths, root, kind)).ok()?)))
        .flat_map(|(kind, entries)| entries.filter_map(Result::ok).map(move |entry| (kind, entry)))
        .filter_map(|(kind, entry)| {
            if !entry.file_type().ok()?.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let file = decode(name.strip_suffix(EXTENSION)?);
            let original = std::fs::read_to_string(entry.path()).ok()?;
            Some(PendingReview { file, original, kind })
        })
        .collect();
    pending.sort_by(|a, b| a.file.cmp(&b.file));
    pending
}

/// Keeps the reviews under `from` (a file or folder) after it was renamed to `to`.
pub async fn rename(paths: &AppPaths, root: &Path, from: &str, to: &str) -> Result<(), String> {
    for review in list(paths, root) {
        let Some(moved) = moved(&review.file, from, to) else { continue };
        remove(paths, root, &review.file).await?;
        save(paths, root, &moved, &review.original, review.kind).await?;
    }
    Ok(())
}

/// Drops the reviews under `path` (a file or folder) after it was deleted.
pub async fn forget(paths: &AppPaths, root: &Path, path: &str) -> Result<(), String> {
    for review in list(paths, root) {
        if is_within(&review.file, path) {
            remove(paths, root, &review.file).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[tokio::test]
    async fn keeps_renames_and_forgets_originals() {
        let base = TestDir::new("review");
        let paths = AppPaths::from_base(base.to_path_buf());
        let root = Path::new("C:/projects/thesis");

        save(&paths, root, "chapters/intro.tex", "before\n", ReviewKind::Modified).await.unwrap();
        save(&paths, root, "main.tex", "main before\n", ReviewKind::Modified).await.unwrap();
        save(&paths, root, "chapters/new.tex", "", ReviewKind::Created).await.unwrap();
        save(&paths, root, "old.tex", "gone\n", ReviewKind::Deleted).await.unwrap();
        let listed = list(&paths, root);
        // Deleted again after it was created: one kind only.
        save(&paths, root, "chapters/new.tex", "", ReviewKind::Deleted).await.unwrap();
        let kinds = list(&paths, root).into_iter().map(|r| (r.file, r.kind)).collect::<Vec<_>>();
        rename(&paths, root, "chapters", "parts").await.unwrap();
        let renamed = list(&paths, root).into_iter().map(|r| r.file).collect::<Vec<_>>();
        forget(&paths, root, "main.tex").await.unwrap();
        let after_forget = list(&paths, root).into_iter().map(|r| r.file).collect::<Vec<_>>();
        remove(&paths, root, "missing.tex").await.unwrap();
        let other_project = list(&paths, Path::new("C:/projects/other"));
        std::fs::remove_dir_all(base).unwrap();

        assert_eq!(listed[0], PendingReview { file: "chapters/intro.tex".into(), original: "before\n".into(), kind: ReviewKind::Modified });
        assert_eq!(listed.len(), 4);
        assert_eq!(
            kinds,
            [
                ("chapters/intro.tex".to_owned(), ReviewKind::Modified),
                ("chapters/new.tex".to_owned(), ReviewKind::Deleted),
                ("main.tex".to_owned(), ReviewKind::Modified),
                ("old.tex".to_owned(), ReviewKind::Deleted),
            ]
        );
        assert_eq!(renamed, ["main.tex", "old.tex", "parts/intro.tex", "parts/new.tex"]);
        assert_eq!(after_forget, ["old.tex", "parts/intro.tex", "parts/new.tex"]);
        assert!(other_project.is_empty());
    }
}
