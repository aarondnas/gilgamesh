//! Updates of Gilgamesh itself, from the releases on GitHub (tauri-plugin-updater). A published
//! release carries a `latest.json` with the new version, its notes and a signed installer per
//! system (.github/workflows/release.yml); the updater only installs what carries the signature of
//! the key in tauri.conf.json (plugins > updater > pubkey).
//!
//! Gilgamesh checks a minute after it starts and then once a day (`Settings::check_updates`), or
//! when asked in the settings. It never installs by itself: the user starts it. The installer is
//! downloaded and its signature checked first; only then every main window saves what is not
//! written yet (as when it closes) and Gilgamesh ends. Windows' installer starts it again,
//! elsewhere it restarts itself. Not while tlmgr runs: ending it halfway would damage TinyTeX.
//!
//! If updates can no longer come this way (the signing key or its password was lost, so new
//! releases are signed with a new key, maybe from a new repository), Gilgamesh says so and points
//! to the website, where the new version can be downloaded and installed by hand (`Lost`). Being
//! offline is not such a case.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use tokio::sync::oneshot;

use crate::commands::AppState;
use crate::util::i18n::localized;
use crate::{settings, window};

/// After this many checks in a row that reached the server but found no release there, the
/// release is taken as gone (one may be a hiccup of GitHub).
const MISSES_UNTIL_LOST: u32 = 2;

/// The first check waits a moment, so the start of Gilgamesh stays quick.
const FIRST_CHECK: Duration = Duration::from_secs(60);
/// How often the timer looks whether the daily check is due (it also notices sleep and the
/// setting being switched on).
const TICK: Duration = Duration::from_secs(60 * 60);
/// Checked again after this long.
const CHECK_EVERY_MS: u64 = 24 * 60 * 60 * 1000;
/// How long the main windows get to save their files before the update gives up.
const SAVE_TIMEOUT: Duration = Duration::from_secs(30);

/// Sent to every main window before the install: save everything, then answer with
/// `update_saved` (see `src/lib/state/updates.svelte.ts`).
const SAVE_EVENT: &str = "update-save";

/// What the settings and the status bar show about updates.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// The version running now.
    pub current: String,
    /// A newer version on GitHub, if the last check found one.
    pub available: Option<Available>,
    /// When the last check ended, in milliseconds since 1970.
    pub checked_at: Option<u64>,
    pub checking: bool,
    /// Downloading and installing; Gilgamesh ends when it is done.
    pub installing: bool,
    pub downloaded: u64,
    pub total: Option<u64>,
    /// Why the last check or install failed (see `localize` in the page).
    pub error: Option<String>,
    /// This installation can update itself: an installed build (NSIS, MSI, AppImage, deb, rpm),
    /// not one started from the sources.
    pub can_install: bool,
    /// Updates no longer come this way: the new version has to come from the website.
    pub lost: Option<Lost>,
}

/// Why updates no longer come from GitHub with the known key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Lost {
    /// GitHub answers, but has no release with a `latest.json` (any more): the repository was
    /// deleted, renamed, moved or made private.
    Missing,
    /// The update found is not signed with the key this version knows (the key was replaced),
    /// so it was not installed.
    Untrusted,
}

#[derive(Debug, Clone, Serialize)]
pub struct Available {
    pub version: String,
    /// The release notes.
    pub notes: Option<String>,
}

/// The main windows asked to save before the install, and who waits for them.
struct Saving {
    waiting: HashSet<String>,
    done: Option<oneshot::Sender<Result<(), String>>>,
}

/// Managed by Tauri: the status, and the update found (needed to install it).
pub struct Updates {
    status: Mutex<UpdateStatus>,
    found: Mutex<Option<Update>>,
    /// Checks in a row that found no release on the server (`MISSES_UNTIL_LOST`).
    misses: Mutex<u32>,
    /// Version whose signature did not fit (`Lost::Untrusted`).
    rejected: Mutex<Option<String>>,
    saving: Mutex<Option<Saving>>,
}

impl Updates {
    pub fn new(current: String) -> Self {
        let status = UpdateStatus { current, can_install: bundle_type().is_some(), ..Default::default() };
        Updates {
            status: Mutex::new(status),
            found: Mutex::new(None),
            misses: Mutex::new(0),
            rejected: Mutex::new(None),
            saving: Mutex::new(None),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }

    /// The main window `label` saved its files (`error` if it could not). A window that closes
    /// meanwhile counts as saved: closing saves as well.
    pub fn saved(&self, label: &str, error: Option<String>) {
        let mut saving = self.saving.lock().unwrap();
        let Some(saving) = saving.as_mut() else { return };
        if let Some(error) = error {
            if let Some(done) = saving.done.take() {
                let _ = done.send(Err(localized!("update_save_failed", error = error)));
            }
            return;
        }
        saving.waiting.remove(label);
        if saving.waiting.is_empty() {
            if let Some(done) = saving.done.take() {
                let _ = done.send(Ok(()));
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The update could not be installed because its signature does not fit the known key (or was
/// tampered with): it will never install, only a download by hand helps.
fn untrusted(e: &Error) -> bool {
    matches!(e, Error::Minisign(_) | Error::SignatureUtf8(_) | Error::Base64(_) | Error::SignedVersionMismatch { .. })
}

/// Asks GitHub for a newer version. Returns the status afterwards (also when it failed: then
/// with `error`). A check already running or an install going on is not disturbed.
pub async fn check(app: &AppHandle) -> UpdateStatus {
    let updates = app.state::<Updates>();
    {
        let mut s = updates.status.lock().unwrap();
        if s.checking || s.installing {
            return s.clone();
        }
        s.checking = true;
        s.error = None;
    }
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    let mut s = updates.status.lock().unwrap();
    s.checking = false;
    s.checked_at = Some(now_ms());
    let mut misses = updates.misses.lock().unwrap();
    match result {
        Ok(found) => {
            *misses = 0;
            s.available = found.as_ref().map(|u| Available { version: u.version.clone(), notes: u.body.clone() });
            // Still the version that was refused: it stays refused; another one gets its chance.
            let rejected = updates.rejected.lock().unwrap();
            let refused = found.as_ref().is_some_and(|u| rejected.as_deref() == Some(u.version.as_str()));
            s.lost = refused.then_some(Lost::Untrusted);
            *updates.found.lock().unwrap() = found;
        }
        // The server answered, but without a release (offline is a network error instead).
        Err(Error::ReleaseNotFound) => {
            *misses += 1;
            if *misses >= MISSES_UNTIL_LOST {
                s.lost = Some(Lost::Missing);
            }
            s.error = Some(localized!("update_release_missing"));
        }
        Err(e) => s.error = Some(localized!("update_check_failed", error = e)),
    }
    s.clone()
}

/// Why an install stopped.
enum Failure {
    Updater(Error),
    Refused(String),
}

/// Downloads the update found by the last check, has every main window save and installs it,
/// then Gilgamesh ends (see the module notes). Returns only if it failed: then everything goes on
/// as before.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    if !updates.status.lock().unwrap().can_install {
        return Err(localized!("update_cannot_install"));
    }
    let update = updates.found.lock().unwrap().clone().ok_or_else(|| localized!("update_none_found"))?;
    {
        let mut s = updates.status.lock().unwrap();
        if s.installing {
            return Ok(());
        }
        s.installing = true;
        s.downloaded = 0;
        s.total = None;
        s.error = None;
    }
    let failure = match download_and_install(app, &update).await {
        Ok(()) => return Ok(()),
        Err(failure) => failure,
    };
    let mut s = updates.status.lock().unwrap();
    s.installing = false;
    let message = match failure {
        Failure::Updater(e) => {
            if untrusted(&e) {
                // Signed with another key: it would fail every time, the website has it.
                s.lost = Some(Lost::Untrusted);
                *updates.rejected.lock().unwrap() = Some(update.version.clone());
            }
            localized!("update_failed", error = e)
        }
        Failure::Refused(message) => message,
    };
    s.error = Some(message.clone());
    Err(message)
}

async fn download_and_install(app: &AppHandle, update: &Update) -> Result<(), Failure> {
    let state = app.state::<AppState>();
    let tex_busy = || Failure::Refused(localized!("update_tex_busy"));
    // Asked first, so the download is not for nothing; held from the end of the download on.
    drop(state.tlmgr.try_lock().map_err(|_| tex_busy())?);

    let updates = app.state::<Updates>();
    let progress = |chunk: usize, total: Option<u64>| {
        let mut s = updates.status.lock().unwrap();
        s.downloaded += chunk as u64;
        s.total = total;
    };
    // Checks the signature as well: nothing is saved or ended for an installer that would not install.
    let bytes = update.download(progress, || {}).await.map_err(Failure::Updater)?;

    let _tlmgr = state.tlmgr.try_lock().map_err(|_| tex_busy())?;
    save_all(app).await.map_err(Failure::Refused)?;
    // Windows: starts the installer and ends Gilgamesh, which the installer starts again.
    update.install(&bytes).map_err(Failure::Updater)?;
    app.restart();
}

/// Has every main window write what is not saved yet, as when it closes, and waits until all of
/// them did (`Updates::saved`).
async fn save_all(app: &AppHandle) -> Result<(), String> {
    let labels: HashSet<String> = app.webview_windows().into_keys().filter(|label| window::is_main(label)).collect();
    if labels.is_empty() {
        return Ok(());
    }
    let updates = app.state::<Updates>();
    let (done, finished) = oneshot::channel();
    *updates.saving.lock().unwrap() = Some(Saving { waiting: labels.clone(), done: Some(done) });
    for label in &labels {
        if app.emit_to(label.as_str(), SAVE_EVENT, ()).is_err() {
            // Gone already; closing saved its files.
            updates.saved(label, None);
        }
    }
    let result = match tokio::time::timeout(SAVE_TIMEOUT, finished).await {
        Ok(Ok(result)) => result,
        _ => Err(localized!("update_save_timeout")),
    };
    *updates.saving.lock().unwrap() = None;
    result
}

/// The check in the background: a minute after the start, then once a day, while the setting
/// allows it. The page shows what it found (the status bar and the settings).
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let paths = app.state::<AppState>().paths.clone();
            // No settings yet: the default, on.
            let enabled = settings::load(&paths).await.is_none_or(|s| s.check_updates);
            let due = app.state::<Updates>().status().checked_at.is_none_or(|at| now_ms().saturating_sub(at) >= CHECK_EVERY_MS);
            if enabled && due {
                check(&app).await;
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_signature_that_does_not_fit_counts_as_untrusted() {
        assert!(untrusted(&Error::SignatureUtf8("x".into())));
        assert!(untrusted(&Error::SignedVersionMismatch { signed: "1.0.0".into(), announced: "2.0.0".into() }));
        // Offline or a missing release are other cases.
        assert!(!untrusted(&Error::Network("offline".into())));
        assert!(!untrusted(&Error::ReleaseNotFound));
    }

    #[test]
    fn the_install_waits_for_every_main_window() {
        let updates = Updates::new("1.0.0".into());
        let (done, mut finished) = oneshot::channel();
        let waiting = ["main", "main-2"].map(String::from).into();
        *updates.saving.lock().unwrap() = Some(Saving { waiting, done: Some(done) });
        updates.saved("main", None);
        assert!(finished.try_recv().is_err(), "main-2 has not saved yet");
        updates.saved("main-2", None);
        assert_eq!(finished.try_recv().unwrap(), Ok(()));
    }

    #[test]
    fn a_window_that_cannot_save_stops_the_install() {
        let updates = Updates::new("1.0.0".into());
        let (done, mut finished) = oneshot::channel();
        let waiting = ["main", "main-2"].map(String::from).into();
        *updates.saving.lock().unwrap() = Some(Saving { waiting, done: Some(done) });
        updates.saved("main-2", Some("disk full".into()));
        assert!(finished.try_recv().unwrap().unwrap_err().contains("disk full"));
    }
}
