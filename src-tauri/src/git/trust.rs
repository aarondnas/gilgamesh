//! Repositories the user trusts.
//!
//! Git runs programs a repository configures: `core.fsmonitor` on `git status`,
//! hooks on commit, `core.sshCommand` on fetch, filters on staging. A folder
//! from elsewhere (a ZIP, a USB stick, a download) may bring such a
//! configuration along in its `.git` folder. So, as VS Code asks for "workspace
//! trust", Gilgamesh lets Git work in a repository only once the user has said
//! they trust its authors. Repositories Gilgamesh made or cloned itself are
//! trusted from the start; reading where a repository is and which branch it is
//! on runs no such programs and needs no trust.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::paths::AppPaths;
use crate::project::project_key;
use crate::util::fs::write_atomic_sync;

pub struct GitTrust {
    file: PathBuf,
    /// Repository folders, as `project_key`s; read from the file on first use.
    trusted: Mutex<Option<BTreeSet<String>>>,
}

impl GitTrust {
    pub fn new(paths: &AppPaths) -> Self {
        Self { file: paths.trusted_repositories(), trusted: Mutex::new(None) }
    }

    /// Whether the user trusts the repository whose folder is `repository`.
    pub fn is_trusted(&self, repository: &Path) -> bool {
        self.with(|trusted| trusted.contains(&key(repository)))
    }

    /// Trusts the repository whose folder is `repository` from now on, also after restarts.
    pub fn trust(&self, repository: &Path) -> Result<(), String> {
        self.with(|trusted| {
            if !trusted.insert(key(repository)) {
                return Ok(());
            }
            if let Some(dir) = self.file.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_string_pretty(trusted).map_err(|e| e.to_string())?;
            write_atomic_sync(&self.file, json + "\n")
        })
    }

    fn with<T>(&self, action: impl FnOnce(&mut BTreeSet<String>) -> T) -> T {
        let mut trusted = self.trusted.lock().unwrap();
        // A missing or damaged file trusts nothing.
        let trusted = trusted.get_or_insert_with(|| {
            std::fs::read_to_string(&self.file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
        });
        action(trusted)
    }
}

fn key(repository: &Path) -> String {
    project_key(&repository.to_string_lossy())
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn remembers_trusted_repositories() {
        let base = TestDir::new("trust");
        let paths = AppPaths::from_base(base.to_path_buf());

        let before = GitTrust::new(&paths).is_trusted(Path::new("C:/Projects/Thesis"));
        GitTrust::new(&paths).trust(Path::new(r"C:\Projects\Thesis\")).unwrap();
        let reloaded = GitTrust::new(&paths);
        let after = reloaded.is_trusted(Path::new("C:/Projects/Thesis"));
        let other = reloaded.is_trusted(Path::new("C:/Projects/Other"));

        assert!(!before && after && !other);
    }
}
