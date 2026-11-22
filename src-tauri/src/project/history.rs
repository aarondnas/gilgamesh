//! Version history of project files.
//!
//! Autosave overwrites files continuously, and undo only lasts as long as the
//! app runs. Snapshots therefore go into the app's data folder, one folder per
//! project and file: `history/<project hash>/<encoded path>/<unix ms>.tex`.
//! The project folder itself stays untouched.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::{moved, stable_hash};
use crate::paths::AppPaths;

/// Edits within this window replace the window's snapshot instead of adding one.
const BUCKET_MS: u64 = 5 * 60 * 1000;
const MAX_VERSIONS: usize = 100;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    /// Unix time in milliseconds; also the version's id.
    pub timestamp: u64,
    pub size: u64,
}

/// Records `contents` as the newest version of `file`.
pub async fn snapshot(paths: &AppPaths, root: &Path, file: &str, contents: &str) -> Result<(), String> {
    let dir = file_dir(paths, root, file);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let versions = timestamps(&dir);
    let now = now_ms();
    if let Some(&newest) = versions.first() {
        let path = version_path(&dir, newest);
        if tokio::fs::read_to_string(&path).await.is_ok_and(|old| old == contents) {
            return Ok(());
        }
        if now.saturating_sub(newest) < BUCKET_MS && versions.len() > 1 {
            // Keep the window's latest state only. The very first version (the
            // file as it was opened) is never replaced.
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
    tokio::fs::write(version_path(&dir, now), contents).await.map_err(|e| e.to_string())?;
    for old in timestamps(&dir).into_iter().skip(MAX_VERSIONS) {
        let _ = tokio::fs::remove_file(version_path(&dir, old)).await;
    }
    Ok(())
}

/// Versions of `file`, newest first.
pub fn list(paths: &AppPaths, root: &Path, file: &str) -> Vec<Version> {
    let dir = file_dir(paths, root, file);
    timestamps(&dir)
        .into_iter()
        .map(|timestamp| Version { timestamp, size: std::fs::metadata(version_path(&dir, timestamp)).map_or(0, |m| m.len()) })
        .collect()
}

pub async fn read(paths: &AppPaths, root: &Path, file: &str, timestamp: u64) -> Result<String, String> {
    let path = version_path(&file_dir(paths, root, file), timestamp);
    tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

/// Keeps the history of `from` (a file or folder) after it was renamed to `to`.
pub async fn rename(paths: &AppPaths, root: &Path, from: &str, to: &str) -> Result<(), String> {
    let project = project_dir(paths, root);
    let Ok(entries) = std::fs::read_dir(&project) else { return Ok(()) };
    for entry in entries.filter_map(Result::ok) {
        let file = decode(&entry.file_name().to_string_lossy());
        let Some(moved) = moved(&file, from, to) else { continue };
        let target = project.join(encode(&moved));
        if !target.exists() {
            tokio::fs::rename(entry.path(), target).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn project_dir(paths: &AppPaths, root: &Path) -> PathBuf {
    paths.history().join(format!("{:016x}", stable_hash(root)))
}

fn file_dir(paths: &AppPaths, root: &Path, file: &str) -> PathBuf {
    project_dir(paths, root).join(encode(file))
}

fn version_path(dir: &Path, timestamp: u64) -> PathBuf {
    dir.join(format!("{timestamp}.tex"))
}

/// Snapshot times in a file's folder, newest first.
fn timestamps(dir: &Path) -> Vec<u64> {
    let mut times: Vec<u64> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".tex")?.parse().ok())
        .collect();
    times.sort_unstable_by(|a, b| b.cmp(a));
    times
}

/// One folder name per project file: `/`, `\` and `%` are escaped, so the
/// name never leads into another folder.
pub(crate) fn encode(file: &str) -> String {
    file.replace('%', "%25").replace('/', "%2F").replace('\\', "%5C")
}

pub(crate) fn decode(name: &str) -> String {
    name.replace("%5C", "\\").replace("%2F", "/").replace("%25", "%")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::fs::TestDir;

    #[tokio::test]
    async fn keeps_first_version_and_latest_of_each_window() {
        let base = TestDir::new("history-window");
        let paths = AppPaths::from_base(base.to_path_buf());
        let root = Path::new("C:/Projects/Thesis");
        snapshot(&paths, root, "chapters/intro.tex", "opened").await.unwrap();
        snapshot(&paths, root, "chapters/intro.tex", "opened").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        snapshot(&paths, root, "chapters/intro.tex", "edit 1").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        snapshot(&paths, root, "chapters/intro.tex", "edit 2").await.unwrap();

        let versions = list(&paths, root, "chapters/intro.tex");
        let newest = read(&paths, root, "chapters/intro.tex", versions[0].timestamp).await.unwrap();
        let oldest = read(&paths, root, "chapters/intro.tex", versions[1].timestamp).await.unwrap();

        // Unchanged content is not stored twice; edits in one window collapse.
        assert_eq!(versions.len(), 2);
        assert_eq!((newest.as_str(), oldest.as_str()), ("edit 2", "opened"));
    }

    #[tokio::test]
    async fn history_follows_renamed_folders() {
        let base = TestDir::new("history-rename");
        let paths = AppPaths::from_base(base.to_path_buf());
        let root = Path::new("/projects/thesis");
        snapshot(&paths, root, "chapters/intro.tex", "x").await.unwrap();
        rename(&paths, root, "chapters", "kapitel").await.unwrap();
        let moved = list(&paths, root, "kapitel/intro.tex").len();
        let old = list(&paths, root, "chapters/intro.tex").len();
        assert_eq!((moved, old), (1, 0));
    }

    #[test]
    fn encoded_names_stay_in_their_folder() {
        for file in ["chapters/intro.tex", "..\\..\\secret", "100%/a.tex"] {
            let name = encode(file);
            assert!(!name.contains(['/', '\\']), "{name}");
            assert_eq!(decode(&name), file);
        }
    }
}
