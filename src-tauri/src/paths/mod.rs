//! The folders the app keeps its data in: settings, the TeX distribution,
//! builds, dictionaries, and the history and reviews of projects.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[cfg(windows)]
mod windows;

/// All directories managed by the app.
///
/// TeX Live cannot handle spaces or non-ASCII characters in its paths, so the
/// base directory falls back to a safe location when the platform default
/// (e.g. `C:\Users\Jörg Müller\AppData\Local`) does not qualify.
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// Large and re-creatable data (`AppData\Local` on Windows).
    base: PathBuf,
    /// Small, valuable user data that roams with the profile (`AppData\Roaming`).
    config: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let base = if is_tex_safe(&data) { data } else { fallback_base()? };
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let paths = Self { base, config };
        for dir in [paths.tex_root(), paths.texmf_user(), paths.builds(), paths.scratch()] {
            std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        Ok(paths)
    }

    #[cfg(test)]
    pub fn from_base(base: PathBuf) -> Self {
        Self { config: base.join("config"), base }
    }

    /// Installation-wide settings, see `settings`.
    pub fn settings_file(&self) -> PathBuf {
        self.config.join("settings.json")
    }

    /// Git repositories the user trusts, see `git::trust`.
    pub fn trusted_repositories(&self) -> PathBuf {
        self.config.join("trusted-repositories.json")
    }

    /// Words the user added to the spelling dictionaries, one file per language.
    pub fn user_dictionaries(&self) -> PathBuf {
        self.config.join("dictionaries")
    }

    pub fn tex_root(&self) -> PathBuf {
        self.base.join("tex")
    }

    /// The TinyTeX installation itself (binaries, packages, tlmgr).
    pub fn distribution(&self) -> PathBuf {
        self.tex_root().join("distribution")
    }

    /// User-provided packages and classes (`TEXMFHOME`).
    pub fn texmf_user(&self) -> PathBuf {
        self.tex_root().join("texmf-user")
    }

    pub fn texmf_var(&self) -> PathBuf {
        self.tex_root().join("texmf-var")
    }

    pub fn texmf_config(&self) -> PathBuf {
        self.tex_root().join("texmf-config")
    }

    pub fn manifest(&self) -> PathBuf {
        self.tex_root().join("manifest.json")
    }

    pub fn builds(&self) -> PathBuf {
        self.base.join("builds")
    }

    /// Project directory for documents that have not been saved yet.
    pub fn scratch(&self) -> PathBuf {
        self.base.join("scratch")
    }

    /// Downloaded spelling dictionaries and the user's own words, see `spell`.
    pub fn dictionaries(&self) -> PathBuf {
        self.base.join("dictionaries")
    }

    /// Snapshots of project files, see `history`.
    pub fn history(&self) -> PathBuf {
        self.base.join("history")
    }

    /// Originals of files whose AI changes await review, see `review`.
    pub fn reviews(&self) -> PathBuf {
        self.base.join("reviews")
    }
}

fn is_tex_safe(path: &Path) -> bool {
    path.to_str().is_some_and(|s| s.chars().all(|c| c.is_ascii_graphic()))
}

/// A folder of this user's for the app's data where the usual one does not qualify (see `is_tex_safe`).
fn fallback_base() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let base = {
        let base = windows::private_data_dir()?;
        take_over_legacy(&base);
        Some(base)
    };
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share/gilgamesh"));

    match base {
        Some(base) if is_tex_safe(&base) => Ok(base),
        _ => Err("No data directory without spaces or special characters was found".into()),
    }
}

/// Earlier versions used `C:\ProgramData\Gilgamesh`, which other users of the
/// computer could write into. What the user made there comes along if the folder
/// is theirs: versions, pending reviews and their own packages. The TeX
/// distribution, programs that may have been tampered with, is installed anew.
#[cfg(windows)]
fn take_over_legacy(base: &Path) {
    let Some(legacy) = std::env::var_os("ProgramData").map(|d| PathBuf::from(d).join("Gilgamesh")) else { return };
    if !legacy.is_dir() || !windows::owned_by_user(&legacy) {
        return;
    }
    for part in ["history", "reviews", "tex/texmf-user"] {
        let (from, to) = (legacy.join(part), base.join(part));
        if from.is_dir() && !to.exists() {
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::rename(&from, &to);
        }
    }
}
