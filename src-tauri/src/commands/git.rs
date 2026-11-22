//! Git for projects in a repository. Like the project's files, Git works only
//! in the calling window's project (see `check_root`), and only in
//! repositories the user trusts (see `git::trust`).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State, Window};
use tauri_plugin_opener::OpenerExt;

use super::{check_root, AppState, CmdResult};
use crate::git::{self, GitInfo, GitStatus, Identity};
use crate::util::i18n::localized;
use crate::{project, window};

/// The folder of the repository `root` lies in.
async fn repository(root: &Path) -> CmdResult<PathBuf> {
    git::repository(root).await.map(|(_, top)| top)
}

/// `root` is the calling window's project and lies in a repository the user trusts.
async fn check_trusted(window: &Window, state: &AppState, root: &Path) -> CmdResult<()> {
    check_root(window, root)?;
    // Git must not work in a repository the user has not trusted: its configuration could run programs.
    if state.git_trust.is_trusted(&repository(root).await?) {
        Ok(())
    } else {
        Err(localized!("git_untrusted"))
    }
}

/// Whether Git is installed, and the repository of the project at `root`, and whether it is trusted.
/// Finding it runs no program of the repository's, so it needs no trust.
#[tauri::command]
pub async fn git_info(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<GitInfo> {
    check_root(&window, &root)?;
    let mut info = git::info(&root).await;
    if let Some(repository) = &mut info.repository {
        repository.trusted = state.git_trust.is_trusted(&repository.path);
    }
    Ok(info)
}

/// The user trusts the authors of the repository the project at `root` lies in; Git may work there.
#[tauri::command]
pub async fn git_trust(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<()> {
    check_root(&window, &root)?;
    state.git_trust.trust(&repository(&root).await?)
}

/// Shows the folder of the repository the project at `root` lies in, in the system's file manager.
#[tauri::command]
pub async fn git_open_folder(app: AppHandle, window: Window, root: PathBuf) -> CmdResult<()> {
    check_root(&window, &root)?;
    let folder = repository(&root).await?;
    app.opener().open_path(folder.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Branch, remote state and changed files of the repository the project at `root` lies in.
#[tauri::command]
pub async fn git_status(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<GitStatus> {
    check_trusted(&window, &state, &root).await?;
    git::status(&root).await
}

/// Stages `paths` (relative to the repository's folder) for the next commit.
#[tauri::command]
pub async fn git_stage(window: Window, state: State<'_, AppState>, root: PathBuf, paths: Vec<String>) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::stage(&root, &paths).await
}

#[tauri::command]
pub async fn git_unstage(window: Window, state: State<'_, AppState>, root: PathBuf, paths: Vec<String>) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::unstage(&root, &paths).await
}

#[tauri::command]
pub async fn git_commit(window: Window, state: State<'_, AppState>, root: PathBuf, message: String) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::commit(&root, &message).await
}

/// Pulls and pushes, or publishes a branch that has no remote branch yet.
#[tauri::command]
pub async fn git_sync(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::sync(&root).await
}

#[tauri::command]
pub async fn git_fetch(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::fetch(&root).await
}

/// Name and e-mail Git commits with; missing on a fresh installation.
#[tauri::command]
pub async fn git_identity() -> CmdResult<Identity> {
    git::identity().await
}

#[tauri::command]
pub async fn git_set_identity(name: String, email: String) -> CmdResult<()> {
    git::set_identity(&name, &email).await
}

/// Makes the open project folder a repository; nothing is committed yet. Made here, it is trusted.
#[tauri::command]
pub async fn git_init_folder(window: Window, state: State<'_, AppState>, root: PathBuf) -> CmdResult<()> {
    check_root(&window, &root)?;
    git::init_folder(&root).await?;
    state.git_trust.trust(&root)
}

/// Makes `url` the repository's `origin`.
#[tauri::command]
pub async fn git_set_remote(window: Window, state: State<'_, AppState>, root: PathBuf, url: String) -> CmdResult<()> {
    check_trusted(&window, &state, &root).await?;
    git::set_remote(&root, &url).await
}

/// Makes the project at `root` a repository with a first commit, and `remote` its `origin`.
/// Made here, it is trusted.
#[tauri::command]
pub async fn git_init(window: Window, state: State<'_, AppState>, root: PathBuf, message: String, remote: Option<String>) -> CmdResult<()> {
    check_root(&window, &root)?;
    let result = git::init(&root, &message, remote.as_deref().filter(|r| !r.trim().is_empty())).await;
    // Also when committing or publishing failed: the repository is Gilgamesh's own.
    if root.join(".git").is_dir() {
        state.git_trust.trust(&root)?;
    }
    result
}

/// Clones `url` into the new folder `parent/name`; returns it, to be opened as a project.
/// Git made its `.git` folder itself (hooks do not come along), so it is trusted.
#[tauri::command]
pub async fn git_clone(window: Window, state: State<'_, AppState>, url: String, parent: PathBuf, name: String) -> CmdResult<PathBuf> {
    project::check_name(&name)?;
    let root = git::clone(&url, &parent, &name).await?;
    window::grant_created(window.app_handle(), window.label(), &root);
    state.git_trust.trust(&root)?;
    Ok(root)
}
