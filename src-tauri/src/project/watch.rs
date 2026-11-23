//! Changes to project files from outside Gilgamesh.
//!
//! Each main window's project folder is watched. Whatever changes a text file
//! there without going through Gilgamesh, an AI agent with its own tools or
//! another program, was not done by the user in Gilgamesh, so it awaits
//! review like an assistant's edits. Which program it was cannot be told
//! from the file system, and not every AI tool announces its work, so all of
//! them are treated alike.
//!
//! For that, the text files' content as Gilgamesh last knew it is kept in
//! memory: read when the project opens, updated by Gilgamesh's own writes
//! (saving, renaming, deleting, …) and by each change from outside, which is
//! reported with the text before it. Other files (images, …) only make the
//! page refresh its file tree.

use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use super::{is_within, moved, project_key};

/// Files opened in the editor; must match `PROJECT_FILES.editable` in `project-files.ts`.
const TEXT_EXTENSIONS: [&str; 24] = [
    "tex", "bib", "sty", "cls", "tikz", "pgf", "def", "cfg", "clo", "ltx", "bst", "bbx", "cbx", "lbx", "dbx", "ist", "xdy", "lua", "csv",
    "dat", "tsv", "txt", "md", "markdown",
];
/// Larger files are no LaTeX sources anyone reviews line by line.
const MAX_FILE: u64 = 8 * 1024 * 1024;
const MAX_FILES: usize = 5000;
/// The several events of one save arrive as one batch.
const SETTLE: Duration = Duration::from_millis(250);
/// To the main window of the project; see `onProjectChanges` in the page.
const EVENT: &str = "project-changes";

/// Text files of a project by path relative to its root.
type Texts = HashMap<String, String>;

#[derive(Default)]
pub struct ProjectWatch {
    inner: Mutex<HashMap<String, Watched>>,
    events: OnceLock<mpsc::UnboundedSender<PathBuf>>,
}

/// A main window's project.
struct Watched {
    root: PathBuf,
    key: String,
    /// The text files as Gilgamesh last knew them.
    known: Texts,
    _watcher: RecommendedWatcher,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    pub path: String,
    /// `None`: the file was created.
    pub original: Option<String>,
    /// `None`: the file was deleted.
    pub text: Option<String>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Changes {
    /// Text files changed, created or deleted from outside.
    external: Vec<ExternalChange>,
    /// Other files and folders changed, created or deleted.
    other: Vec<String>,
}

impl ProjectWatch {
    /// Starts handing changes to the pages, in batches.
    pub fn start(app: &AppHandle) {
        let (sender, mut receiver) = mpsc::unbounded_channel::<PathBuf>();
        let _ = app.state::<ProjectWatch>().events.set(sender);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(first) = receiver.recv().await {
                let mut batch = vec![first];
                loop {
                    match tokio::time::timeout(SETTLE, receiver.recv()).await {
                        Ok(Some(path)) => batch.push(path),
                        Ok(None) => return,
                        Err(_) => break,
                    }
                }
                let app = app.clone();
                let _ = tokio::task::spawn_blocking(move || app.state::<ProjectWatch>().changed(&app, batch)).await;
            }
        });
    }

    /// The main window `label` now shows `root`.
    pub fn watch(&self, label: &str, root: &str) {
        let key = project_key(root);
        let mut projects = self.inner.lock().unwrap();
        if projects.get(label).is_some_and(|watched| watched.key == key) {
            return;
        }
        projects.remove(label);
        let Some(events) = self.events.get().cloned() else { return };
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Some(event) = event.ok().filter(|event| alters(&event.kind)) {
                for path in event.paths {
                    let _ = events.send(path);
                }
            }
        });
        let Ok(mut watcher) = watcher else { return };
        let root = PathBuf::from(root);
        if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
            eprintln!("Project folder not watched: {e}");
            return;
        }
        let known = texts(&root);
        projects.insert(label.to_owned(), Watched { root, key, known, _watcher: watcher });
    }

    /// The main window `label` closed.
    pub fn unwatch(&self, label: &str) {
        self.inner.lock().unwrap().remove(label);
    }

    /// Gilgamesh itself wrote `text` to `path` (relative to `root`).
    pub fn wrote(&self, root: &Path, path: &str, text: &str) {
        if !is_text(path) {
            return;
        }
        self.with_known(root, |known| {
            known.insert(path.to_owned(), text.to_owned());
        });
    }

    /// Gilgamesh itself moved `from` (a file or folder) to `to`.
    pub fn moved(&self, root: &Path, from: &str, to: &str) {
        self.with_known(root, |known| {
            let inside: Vec<String> = known.keys().filter(|path| is_within(path, from)).cloned().collect();
            for path in inside {
                if let (Some(text), Some(target)) = (known.remove(&path), moved(&path, from, to)) {
                    known.insert(target, text);
                }
            }
        });
    }

    /// Gilgamesh itself deleted `path` (a file or folder).
    pub fn removed(&self, root: &Path, path: &str) {
        self.with_known(root, |known| known.retain(|file, _| !is_within(file, path)));
    }

    fn with_known(&self, root: &Path, update: impl Fn(&mut Texts)) {
        let key = project_key(&root.to_string_lossy());
        for watched in self.inner.lock().unwrap().values_mut().filter(|w| w.key == key) {
            update(&mut watched.known);
        }
    }

    /// A batch of changed paths from the watchers.
    fn changed(&self, app: &AppHandle, paths: Vec<PathBuf>) {
        let mut projects = self.inner.lock().unwrap();
        for (label, watched) in projects.iter_mut() {
            let touched: BTreeSet<String> = paths.iter().filter_map(|path| relative(&watched.root, path)).collect();
            if touched.is_empty() {
                continue;
            }
            // A folder may have been deleted or moved away with text files inside.
            let gone: Vec<String> = watched.known.keys().filter(|file| touched.iter().any(|path| is_within(file, path))).cloned().collect();
            let candidates: BTreeSet<String> = touched.iter().filter(|path| is_text(path)).cloned().chain(gone).collect();
            let mut external = Vec::new();
            for path in &candidates {
                let text = read_text(&watched.root.join(path));
                let original = watched.known.get(path).cloned();
                if original == text {
                    continue;
                }
                match &text {
                    Some(text) => watched.known.insert(path.clone(), text.clone()),
                    None => watched.known.remove(path),
                };
                external.push(ExternalChange { path: path.clone(), original, text });
            }
            let other = touched.into_iter().filter(|path| !is_text(path)).collect();
            let _ = app.emit_to(label.as_str(), EVENT, Changes { external, other });
        }
    }
}

/// Whether an event can change what the project holds. Linux (inotify) also reports
/// files being read and their times changing; every build reads the project, so
/// counted as changes they would start the next build, and that one the next, forever.
fn alters(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_)))
}

fn is_text(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|ext| TEXT_EXTENSIONS.iter().any(|t| ext.eq_ignore_ascii_case(t)))
}

/// `path` relative to `root` with `/`; `None` outside it and for hidden entries (`.git`, …), as in the explorer.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for component in rest.components() {
        let Component::Normal(name) = component else { return None };
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            return None;
        }
        parts.push(name.into_owned());
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A text file's content; `None` if it is missing, too large or no text.
fn read_text(path: &Path) -> Option<String> {
    if !std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() <= MAX_FILE) {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// The project's text files and their content.
fn texts(root: &Path) -> Texts {
    let mut found = Texts::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            if found.len() >= MAX_FILES {
                return found;
            }
            let path = entry.path();
            let Some(name) = relative(root, &path) else { continue };
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                folders.push(path);
            } else if kind.is_file() && is_text(&name) {
                if let Some(text) = read_text(&path) {
                    found.insert(name, text);
                }
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;
    use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode};

    #[test]
    fn reading_the_project_is_no_change() {
        assert!(!alters(&EventKind::Access(AccessKind::Close(AccessMode::Read))));
        assert!(!alters(&EventKind::Access(AccessKind::Open(AccessMode::Any))));
        assert!(!alters(&EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime))));
        assert!(alters(&EventKind::Modify(ModifyKind::Data(DataChange::Content))));
        assert!(alters(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))));
        assert!(alters(&EventKind::Create(CreateKind::File)));
        assert!(alters(&EventKind::Remove(RemoveKind::Folder)));
        // Windows reports writes without saying what changed.
        assert!(alters(&EventKind::Modify(ModifyKind::Any)));
    }

    #[test]
    fn reads_text_files_and_skips_hidden_ones() {
        let root = TestDir::new("watch");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("main.tex"), "main").unwrap();
        std::fs::write(root.join("chapters/intro.TEX"), "intro").unwrap();
        std::fs::write(root.join("bild.png"), "png").unwrap();
        std::fs::write(root.join(".git/x.tex"), "hidden").unwrap();

        let found = texts(&root);
        let outside = relative(&root, Path::new("/elsewhere/a.tex"));
        let hidden = relative(&root, &root.join(".git").join("x.tex"));
        let nested = relative(&root, &root.join("chapters").join("intro.TEX"));
        let missing = read_text(&root.join("missing.tex"));

        let mut names: Vec<_> = found.keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["chapters/intro.TEX", "main.tex"]);
        assert_eq!((outside, hidden, nested.as_deref()), (None, None, Some("chapters/intro.TEX")));
        assert_eq!(missing, None);
    }
}
