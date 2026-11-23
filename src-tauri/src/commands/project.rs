//! The open project: its files and structure, and what the app keeps about
//! it (AI changes awaiting review, file versions). Every command checks that
//! the calling window works in `root` (see `check_root`).

use std::path::{Path, PathBuf};

use tauri::ipc::Response;
use tauri::{Manager, State, Window};

use super::{blocking, check_root, AppState, CmdResult};
use crate::project::files::{self, TreeEntry};
use crate::project::history::{self, Version};
use crate::project::review::{self, PendingReview, ReviewKind};
use crate::project::scan::{self, ProjectScan};
use crate::project::watch::ProjectWatch;
use crate::window;

#[tauri::command]
pub async fn project_tree(window: Window, root: PathBuf) -> CmdResult<Vec<TreeEntry>> {
    check_root(&window, &root)?;
    blocking(move || files::tree(&root)).await?
}

/// Creates `parent/name` (a folder the user chose) as a new project.
#[tauri::command]
pub async fn project_create_root(window: Window, parent: PathBuf, name: String) -> CmdResult<PathBuf> {
    let root = files::create_root(&parent, &name).await?;
    window::grant_created(window.app_handle(), window.label(), &root);
    Ok(root)
}

/// Where new projects go until the user picks a folder (see `files::default_location`).
#[tauri::command]
pub fn project_default_location() -> Option<PathBuf> {
    files::default_location()
}

/// Outline, labels and bibliography entries for the outline view and completions.
#[tauri::command]
pub async fn project_scan(window: Window, root: PathBuf, main: Option<String>) -> CmdResult<ProjectScan> {
    check_root(&window, &root)?;
    blocking(move || scan::scan(&root, main.as_deref())).await?
}

/// A BibTeX entry for a DOI or an ISBN, fetched from doi.org or Open Library (see `bib.rs`).
#[tauri::command]
pub async fn bib_lookup(id: String) -> CmdResult<String> {
    crate::bib::lookup(&id).await
}

/// Creates `parent/name` and unpacks the ZIP `archive` into it; returns the new root.
#[tauri::command]
pub async fn project_import_zip(window: Window, archive: PathBuf, parent: PathBuf, name: String) -> CmdResult<PathBuf> {
    let root = files::create_root(&parent, &name).await?;
    let target = root.clone();
    match blocking(move || files::extract_zip(&archive, &target)).await? {
        Ok(_) => {
            window::grant_created(window.app_handle(), window.label(), &root);
            Ok(root)
        }
        Err(e) => {
            // The folder was created just now; do not leave a half-filled one behind.
            let _ = tokio::fs::remove_dir_all(&root).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub fn project_exists(window: Window, root: PathBuf, path: String) -> CmdResult<bool> {
    check_root(&window, &root)?;
    files::exists(&root, &path)
}

#[tauri::command]
pub async fn project_read(window: Window, root: PathBuf, path: String) -> CmdResult<String> {
    check_root(&window, &root)?;
    files::read(&root, &path).await
}

/// A file as bytes (an image shown in a tab), not as text.
#[tauri::command]
pub async fn project_read_bytes(window: Window, root: PathBuf, path: String) -> CmdResult<Response> {
    check_root(&window, &root)?;
    Ok(Response::new(files::read_bytes(&root, &path).await?))
}

#[tauri::command]
pub async fn project_write(window: Window, watch: State<'_, ProjectWatch>, root: PathBuf, path: String, contents: String) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::write(&root, &path, &contents).await?;
    watch.wrote(&root, &path, &contents);
    Ok(())
}

#[tauri::command]
pub async fn project_create_file(
    window: Window,
    watch: State<'_, ProjectWatch>,
    root: PathBuf,
    path: String,
    contents: String,
) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::create_file(&root, &path, &contents).await?;
    watch.wrote(&root, &path, &contents);
    Ok(())
}

#[tauri::command]
pub async fn project_create_dir(window: Window, root: PathBuf, path: String) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::create_dir(&root, &path).await
}

/// Writes a file dropped onto the explorer; returns the path actually used.
/// The body is the raw file content (no JSON round trip for large images);
/// the headers `root` and `path` carry the URI-encoded paths.
#[tauri::command]
pub async fn project_import_file(window: Window, watch: State<'_, ProjectWatch>, request: tauri::ipc::Request<'_>) -> CmdResult<String> {
    let tauri::ipc::InvokeBody::Raw(contents) = request.body() else {
        return Err("The request carries no file content".into());
    };
    let header = |name: &str| -> CmdResult<String> {
        let value = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or(format!("The request lacks the header {name}"))?;
        Ok(percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned())
    };
    let root = header("root")?;
    check_root(&window, Path::new(&root))?;
    let written = files::import(Path::new(&root), &header("path")?, contents).await?;
    if let Ok(text) = std::str::from_utf8(contents) {
        watch.wrote(Path::new(&root), &written, text);
    }
    Ok(written)
}

#[tauri::command]
pub async fn project_rename(
    window: Window,
    state: State<'_, AppState>,
    watch: State<'_, ProjectWatch>,
    root: PathBuf,
    from: String,
    to: String,
) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::rename(&root, &from, &to).await?;
    watch.moved(&root, &from, &to);
    review::rename(&state.paths, &root, &from, &to).await?;
    history::rename(&state.paths, &root, &from, &to).await
}

#[tauri::command]
pub async fn project_delete(
    window: Window,
    state: State<'_, AppState>,
    watch: State<'_, ProjectWatch>,
    root: PathBuf,
    path: String,
) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::delete(&root, &path).await?;
    watch.removed(&root, &path);
    review::forget(&state.paths, &root, &path).await
}

/// Files of the project with AI changes awaiting review, and their originals.
#[tauri::command]
pub fn review_list(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<Vec<PendingReview>> {
    check_root(&window, &root)?;
    Ok(review::list(&state.paths, &root))
}

#[tauri::command]
pub async fn review_save(
    window: Window,
    state: State<'_, AppState>,
    root: PathBuf,
    path: String,
    original: String,
    kind: ReviewKind,
) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::resolve(&root, &path)?;
    review::save(&state.paths, &root, &path, &original, kind).await
}

#[tauri::command]
pub async fn review_remove(window: Window, state: State<'_, AppState>, root: PathBuf, path: String) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::resolve(&root, &path)?;
    review::remove(&state.paths, &root, &path).await
}

#[tauri::command]
pub async fn history_snapshot(window: Window, state: State<'_, AppState>, root: PathBuf, path: String, contents: String) -> CmdResult<()> {
    check_root(&window, &root)?;
    files::resolve(&root, &path)?;
    history::snapshot(&state.paths, &root, &path, &contents).await
}

#[tauri::command]
pub fn history_list(window: Window, state: State<'_, AppState>, root: PathBuf, path: String) -> CmdResult<Vec<Version>> {
    check_root(&window, &root)?;
    files::resolve(&root, &path)?;
    Ok(history::list(&state.paths, &root, &path))
}

#[tauri::command]
pub async fn history_read(window: Window, state: State<'_, AppState>, root: PathBuf, path: String, timestamp: u64) -> CmdResult<String> {
    check_root(&window, &root)?;
    files::resolve(&root, &path)?;
    history::read(&state.paths, &root, &path, timestamp).await
}
