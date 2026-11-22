//! The Tauri commands the page invokes, one file per domain as in `src/lib/api/`.
//! They only unpack the request and call into the domain modules; `lib.rs`
//! registers them all.

pub mod git;
pub mod mcp;
pub mod print;
pub mod project;
pub mod settings;
pub mod spell;
pub mod tex;
pub mod update;
pub mod window;

use std::path::Path;

use crate::git::trust::GitTrust;
use crate::paths::AppPaths;
use crate::spell::SpellChecker;
use crate::tex::compile::BuildManager;
use crate::tex::index::IndexCache;
use crate::tex::synctex::SynctexCache;

pub struct AppState {
    pub paths: AppPaths,
    pub builds: BuildManager,
    /// tlmgr must never run twice at the same time.
    pub tlmgr: tokio::sync::Mutex<()>,
    /// Which package ships which file, read from tlmgr's repository database.
    pub index: IndexCache,
    pub synctex: SynctexCache,
    pub spell: SpellChecker,
    pub git_trust: GitTrust,
}

impl AppState {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            git_trust: GitTrust::new(&paths),
            paths,
            builds: BuildManager::default(),
            tlmgr: tokio::sync::Mutex::new(()),
            index: IndexCache::default(),
            synctex: SynctexCache::default(),
            spell: SpellChecker::default(),
        }
    }
}

pub type CmdResult<T> = Result<T, String>;

/// The calling window may work in the project folder `root` (see `window::check_access`).
fn check_root(window: &tauri::Window, root: &Path) -> CmdResult<()> {
    crate::window::check_access(tauri::Manager::app_handle(window), window.label(), root)
}

/// The absolute `file` lies in a project folder the calling window may work in.
fn check_file(window: &tauri::Window, file: &Path) -> CmdResult<()> {
    crate::window::check_file_access(tauri::Manager::app_handle(window), window.label(), file)
}

/// Runs blocking work (file system walks, archives) off the async runtime.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> CmdResult<T> {
    tokio::task::spawn_blocking(work).await.map_err(|e| e.to_string())
}
