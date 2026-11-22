//! Download, installation and removal of the managed TinyTeX distribution.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::{packages, process};
use crate::paths::AppPaths;
use crate::util::i18n::localized;
#[cfg(windows)]
use crate::util::process::hide_console;

const RELEASES_API: &str = "https://api.github.com/repos/rstudio/tinytex-releases/releases";

/// Installed right after TinyTeX, because their absence is easy to miss:
/// documents still compile, but bibliographies and glossaries stay empty or
/// German text is hyphenated with English rules. Anything else a document
/// needs is installed on demand when the build reports it missing.
const ESSENTIAL_PACKAGES: &[&str] = &[
    // Build tools that latexmk calls.
    "latexmk",
    "biber",
    "makeindex",
    "texcount",
    // German, the language of the UI's default locale.
    "babel-german",
    "hyphen-german",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Bundle {
    /// About 100 common LaTeX packages.
    #[serde(rename = "TinyTeX-1")]
    Standard,
    /// Additional packages requested by the TinyTeX community.
    #[serde(rename = "TinyTeX")]
    Extended,
}

impl Bundle {
    fn asset_prefix(self) -> &'static str {
        match self {
            Self::Standard => "TinyTeX-1",
            Self::Extended => "TinyTeX",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub bundle: Bundle,
    pub installed_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub root: PathBuf,
    pub user_dir: PathBuf,
    pub manifest: Option<Manifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

pub fn status(paths: &AppPaths) -> Status {
    let manifest = std::fs::read(paths.manifest()).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
    Status {
        installed: process::executable(paths, "lualatex").is_some(),
        root: paths.distribution(),
        user_dir: paths.texmf_user(),
        manifest,
    }
}

pub async fn install(app: &AppHandle, paths: &AppPaths, bundle: Bundle) -> Result<Manifest, String> {
    let emit = |phase, received, total| {
        let _ = app.emit("tex:install-progress", Progress { phase, received, total });
    };

    let (release, asset) = match release_asset(bundle, "latest").await {
        Ok(found) => found,
        Err(_) => release_asset(bundle, "tags/daily").await?,
    };
    let archive = paths.tex_root().join(if cfg!(windows) { "download.exe" } else { "download.tar.xz" });
    // The archive is run (Windows) or unpacked into programs the app runs: only exactly the published file.
    let sha256 = download(&asset.url, &archive, |received, total| emit("download", received, total)).await?;
    if sha256 != asset.sha256 {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(localized!("error_checksum", file = asset.name));
    }

    emit("extract", 0, None);
    let staging = paths.tex_root().join("staging");
    remove_dir_if_exists(&staging).await?;
    tokio::fs::create_dir_all(&staging).await.map_err(|e| e.to_string())?;
    extract(&archive, &staging).await?;
    let extracted = single_subdir(&staging)?;

    let target = paths.distribution();
    remove_dir_if_exists(&target).await?;
    tokio::fs::rename(&extracted, &target).await.map_err(|e| localized!("error_distribution_move", error = e))?;
    let _ = tokio::fs::remove_file(&archive).await;
    let _ = remove_dir_if_exists(&staging).await;

    emit("configure", 0, None);
    configure(paths).await?;

    emit("essentials", 0, None);
    let essentials: Vec<String> = ESSENTIAL_PACKAGES.iter().map(|&p| p.to_owned()).collect();
    // Offline or a mirror hiccup must not fail the whole setup; on-demand
    // installation catches up later.
    if let Err(e) = packages::install(app, paths, &essentials).await {
        let _ = app.emit("tex:log", localized!("log_essentials_incomplete", error = e));
    }

    let manifest = Manifest {
        version: release.trim_start_matches('v').to_owned(),
        bundle,
        installed_at: SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()),
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    tokio::fs::write(paths.manifest(), json).await.map_err(|e| e.to_string())?;
    emit("done", 0, None);
    Ok(manifest)
}

/// Updates `tlmgr` and every package. TeX Live comes out once a year, and
/// `tlmgr` cannot update across years: then TinyTeX is installed anew in the
/// same variant, with the new year, and every package the old installation
/// had is installed into it again. Returns whether that happened.
///
/// The old installation is only replaced once the new one is downloaded and
/// unpacked (see `install`), so being offline costs nothing. The user's own
/// packages in `texmf-user` stay as they are.
pub async fn update(app: &AppHandle, paths: &AppPaths) -> Result<bool, String> {
    let error = match packages::update_all(app, paths).await {
        Ok(()) => return Ok(false),
        Err(error) if is_new_release(&error) => error,
        Err(error) => return Err(error),
    };
    let _ = app.emit("tex:log", localized!("log_new_release", reason = error.lines().next().unwrap_or_default()));
    let before = packages::list(paths, false).await?;
    let bundle = status(paths).manifest.map_or(Bundle::Standard, |m| m.bundle);
    install(app, paths, bundle).await?;

    let after: std::collections::HashSet<String> =
        packages::list(paths, false).await.unwrap_or_default().into_iter().map(|p| p.name).collect();
    let missing: Vec<String> = before.into_iter().map(|p| p.name).filter(|name| !after.contains(name)).collect();
    if !missing.is_empty() {
        let _ = app.emit("tex:install-progress", Progress { phase: "restore", received: 0, total: Some(missing.len() as u64) });
        // One by one: a package dropped from the new year must not keep the others out.
        let mut failed = Vec::new();
        for name in &missing {
            if packages::install(app, paths, std::slice::from_ref(name)).await.is_err() {
                failed.push(name.as_str());
            }
        }
        if !failed.is_empty() {
            let _ = app.emit("tex:log", localized!("log_packages_unavailable", packages = failed.join(", ")));
        }
    }
    let _ = app.emit("tex:install-progress", Progress { phase: "done", received: 0, total: None });
    Ok(true)
}

/// Whether `tlmgr`'s error says the repository is of a newer TeX Live year than the installation.
fn is_new_release(error: &str) -> bool {
    let error = error.to_lowercase();
    ["older than remote repository", "cross release update", "is older than remote"].iter().any(|s| error.contains(s))
}

/// Removes the distribution but keeps the user's own packages in `texmf-user`.
pub async fn uninstall(paths: &AppPaths) -> Result<(), String> {
    remove_dir_if_exists(&paths.distribution()).await?;
    remove_dir_if_exists(&paths.texmf_var()).await?;
    let _ = tokio::fs::remove_file(paths.manifest()).await;
    Ok(())
}

/// A file of a TinyTeX release, with the SHA-256 GitHub computed when it was uploaded.
struct Asset {
    name: String,
    url: String,
    /// Lowercase hex.
    sha256: String,
}

/// The release `which` ("latest" or "tags/daily") and its archive for this platform.
async fn release_asset(bundle: Bundle, which: &str) -> Result<(String, Asset), String> {
    let release: serde_json::Value = reqwest::Client::new()
        .get(format!("{RELEASES_API}/{which}"))
        .header("User-Agent", "gilgamesh")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| localized!("error_release_unavailable", error = e))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let tag = release["tag_name"].as_str().ok_or_else(|| localized!("error_release_unavailable", error = "no tag_name"))?.to_owned();
    let name = asset_name(bundle, &tag)?;
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| assets.iter().find(|a| a["name"] == name.as_str()))
        .ok_or_else(|| localized!("error_release_asset_missing", file = name, release = tag))?;
    let url = asset["browser_download_url"]
        .as_str()
        .ok_or_else(|| localized!("error_release_unavailable", error = "no download URL"))?
        .to_owned();
    // Without a published checksum the file cannot be checked, so it is not installed.
    let sha256 = asset["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or_else(|| localized!("error_no_checksum", file = name))?
        .to_lowercase();
    Ok((tag, Asset { name, url, sha256 }))
}

fn asset_name(bundle: Bundle, release: &str) -> Result<String, String> {
    let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => "windows",
        ("linux", "x86_64") => "linux-x86_64",
        ("linux", "aarch64") => "linux-arm64",
        (os, arch) => return Err(localized!("error_platform_unsupported", platform = format!("{os}/{arch}"))),
    };
    let ext = if cfg!(windows) { "exe" } else { "tar.xz" };
    let prefix = bundle.asset_prefix();
    // Daily builds carry no version in the file name.
    Ok(if release == "daily" { format!("{prefix}-{platform}.{ext}") } else { format!("{prefix}-{platform}-{release}.{ext}") })
}

/// Downloads `url` to `dest`; returns the file's SHA-256 in lowercase hex.
async fn download(url: &str, dest: &Path, on_progress: impl Fn(u64, Option<u64>)) -> Result<String, String> {
    let response = reqwest::get(url).await.and_then(|r| r.error_for_status()).map_err(|e| format!("Download fehlgeschlagen: {e}"))?;
    let total = response.content_length();
    let mut file = tokio::fs::File::create(dest).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let (mut received, mut reported) = (0u64, 0u64);
    on_progress(0, total);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download abgebrochen: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - reported >= 512 * 1024 {
            on_progress(received, total);
            reported = received;
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    on_progress(received, total);
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

async fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    // Windows bundles are 7-Zip self-extracting archives that unpack into the
    // working directory.
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = Command::new(archive);
        hide_console(cmd.arg("-y").current_dir(dest));
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new("tar");
        cmd.arg("-xJf").arg(archive).arg("-C").arg(dest);
        cmd
    };
    let status = cmd
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map_err(|e| format!("Entpacken fehlgeschlagen: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Entpacken fehlgeschlagen ({status})"))
    }
}

async fn configure(paths: &AppPaths) -> Result<(), String> {
    // Same post-install step as TinyTeX's official Windows installer.
    if cfg!(windows) {
        let mut cmd = process::tlmgr_command(paths)?;
        cmd.args(["postaction", "install", "script", "xetex"]);
        process::run_captured(cmd).await?;
    }
    Ok(())
}

fn single_subdir(dir: &Path) -> Result<PathBuf, String> {
    std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .ok_or_else(|| localized!("error_archive_invalid"))
}

async fn remove_dir_if_exists(dir: &Path) -> Result<(), String> {
    match tokio::fs::remove_dir_all(dir).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(localized!("error_delete_failed", path = dir.display(), error = e)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_a_new_tex_live_year() {
        // What tlmgr says when the repository moved on to the next year.
        let message = "tlmgr: Local TeX Live (2025) is older than remote repository (2026).\n\
                       Cross release updates are only supported with\n  update-tlmgr-latest(.sh/.exe) --update\n\
                       See https://tug.org/texlive/upgrade.html for details.";
        assert!(is_new_release(message));
        assert!(!is_new_release("tlmgr: package repository https://mirror.ctan.org (not verified: gpg unavailable)\nconnection refused"));
    }
}
