//! Compiles the editor content with the managed distribution.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::images;
use super::index::{IndexCache, PackageIndex};
use super::log::{self, Diagnostic};
use super::process;
use super::synctex;
use crate::paths::AppPaths;
use crate::util::i18n::localized;

/// Covers all engine runs plus Biber and makeglossaries.
const TIMEOUT: Duration = Duration::from_secs(300);

/// latexmk has no built-in rules for glossaries and nomencl; these are the
/// ones from its manual, adapted to the separate output directory.
const LATEXMKRC: &str = r#"# Written by Gilgamesh before every build.
add_cus_dep('glo', 'gls', 0, 'makeglossaries');
add_cus_dep('acn', 'acr', 0, 'makeglossaries');
sub makeglossaries {
    my ($base_name, $path) = fileparse($_[0]);
    return system('makeglossaries', '-q', '-d', $path, $base_name);
}
add_cus_dep('nlo', 'nls', 0, 'makenlo2nls');
sub makenlo2nls {
    return system('makeindex', '-q', '-s', 'nomencl.ist', '-o', "$_[0].nls", "$_[0].nlo");
}
"#;

/// latexmk prints e.g. `Run number 1 of rule 'lualatex'` per engine run.
static ENGINE_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Run number \d+ of rule '\*?(?:pdf|lua|xe)?latex").unwrap());

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Lualatex,
    Xelatex,
    Pdflatex,
}

impl Engine {
    fn program(self) -> &'static str {
        match self {
            Self::Lualatex => "lualatex",
            Self::Xelatex => "xelatex",
            Self::Pdflatex => "pdflatex",
        }
    }

    fn latexmk_flag(self) -> &'static str {
        match self {
            Self::Lualatex => "-lualatex",
            Self::Xelatex => "-xelatex",
            Self::Pdflatex => "-pdf",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRequest {
    pub source: String,
    /// Saved location of the document; relative `\input`s and images resolve
    /// against its directory.
    pub file_path: Option<PathBuf>,
    pub engine: Engine,
    /// PDF standard such as `A-2b`, applied via `\DocumentMetadata`.
    #[serde(default)]
    pub pdf_standard: Option<String>,
    /// Compile only this `\include`d file (path without `.tex`), via `\includeonly`.
    #[serde(default)]
    pub include_only: Option<String>,
    /// Edited files not saved yet (without autosave); the build reads these
    /// texts instead of the files on disk, which stay as the user saved them.
    #[serde(default)]
    pub unsaved: Vec<UnsavedFile>,
}

#[derive(Debug, Deserialize)]
pub struct UnsavedFile {
    /// Relative to the document's folder, without `..`.
    pub path: String,
    pub text: String,
}

/// Folder in the build directory with the unsaved files, searched before the
/// document's folder (`TEXINPUTS`), so `\input{chapters/one}` finds them there.
const UNSAVED_DIR: &str = ".gilgamesh-unsaved";

/// The path an unsaved file has in the document's folder, if `file` (as the
/// build names it) is its stand-in in `out_dir`; with the case of `file`.
pub fn unsaved_original(out_dir: &Path, file: &str) -> Option<String> {
    let parts: Vec<&str> = file.split(['/', '\\']).collect();
    let at = parts.iter().position(|part| *part == UNSAVED_DIR)?;
    (synctex::normalize(&parts[..at].join("/")) == synctex::normalize(&out_dir.to_string_lossy())).then(|| parts[at + 1..].join("/"))
}

/// PDF standards `\DocumentMetadata` accepts that make sense for documents.
const PDF_STANDARDS: &[&str] = &["A-1b", "A-2b", "A-2u", "A-3b", "A-3u", "A-4", "UA-2"];

/// The source as compiled: project settings are added to the copy, never to
/// the user's file. Both go onto existing lines, so line numbers in errors
/// and SyncTeX stay those of the original.
pub fn prepare_source(source: &str, pdf_standard: Option<&str>, include_only: Option<&str>) -> Result<String, String> {
    let mut text = source.to_owned();
    if let Some(standard) = pdf_standard {
        if !PDF_STANDARDS.contains(&standard) {
            return Err(format!("Unbekannter PDF-Standard: {standard}"));
        }
        // A document that sets its own metadata keeps it.
        if !text.contains(r"\DocumentMetadata") {
            text.insert_str(0, &format!(r"\DocumentMetadata{{pdfstandard={standard}}}"));
        }
    }
    if let Some(file) = include_only {
        if file.contains(['{', '}', '\\', '\n']) {
            return Err(localized!("error_invalid_file_name", name = file));
        }
        if let Some(at) = text.find(r"\begin{document}") {
            text.insert_str(at, &format!(r"\includeonly{{{file}}}"));
        }
    }
    Ok(text)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompileStatus {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub status: CompileStatus,
    pub pdf_path: Option<PathBuf>,
    pub diagnostics: Vec<Diagnostic>,
    /// Files a package provides; the frontend offers to install them.
    pub missing_files: Vec<String>,
    /// Files no package provides, so the project itself lacks them (a wrong
    /// image path, a deleted chapter). Never installed.
    pub missing_project_files: Vec<String>,
    pub duration_ms: u64,
    pub runs: u32,
}

impl CompileResult {
    fn cancelled() -> Self {
        Self {
            status: CompileStatus::Cancelled,
            pdf_path: None,
            diagnostics: Vec::new(),
            missing_files: Vec::new(),
            missing_project_files: Vec::new(),
            duration_ms: 0,
            runs: 0,
        }
    }

    /// The build cannot start because a program is missing; reported like a
    /// missing file so the frontend offers to install it.
    fn missing_tool(tool: &str) -> Self {
        Self { status: CompileStatus::Failed, missing_files: vec![tool.into()], ..Self::cancelled() }
    }
}

/// Runs at most one build at a time per window; a new request cancels that
/// window's running one. Windows show different projects, so they build side by side.
#[derive(Default)]
pub struct BuildManager {
    lanes: Mutex<HashMap<String, Arc<Lane>>>,
    /// Bumped whenever packages are installed, removed or updated.
    distribution_version: AtomicU64,
    /// Distribution version and unsaved files each build directory was last built with.
    built_with: Mutex<HashMap<PathBuf, (u64, Vec<String>)>>,
}

/// The builds of one window.
#[derive(Default)]
struct Lane {
    cancel_current: Mutex<Option<oneshot::Sender<()>>>,
    running: tokio::sync::Mutex<()>,
}

impl BuildManager {
    /// latexmk only reruns when a file it saw last time changed. A file that
    /// was missing is not among them, so after installing the package it
    /// would report "up-to-date" with the old errors. The next build of every
    /// project is therefore forced.
    pub fn distribution_changed(&self) {
        self.distribution_version.fetch_add(1, Ordering::Relaxed);
    }

    /// `lane` names the window asking; its previous build is cancelled.
    pub async fn compile(
        &self,
        lane: &str,
        paths: &AppPaths,
        index: &IndexCache,
        request: CompileRequest,
    ) -> Result<CompileResult, String> {
        process::executable(paths, request.engine.program()).ok_or_else(|| localized!("error_latex_missing"))?;
        if process::latexmk_command(paths).is_none() {
            return Ok(CompileResult::missing_tool("latexmk"));
        }

        let lane = Arc::clone(self.lanes.lock().unwrap().entry(lane.to_owned()).or_default());
        let (cancel_tx, mut cancel) = oneshot::channel();
        if let Some(previous) = lane.cancel_current.lock().unwrap().replace(cancel_tx) {
            let _ = previous.send(());
        }
        // Wait until the cancelled build has killed its process, so two
        // engines never write into the same output directory.
        let _running = tokio::select! {
            guard = lane.running.lock() => guard,
            _ = &mut cancel => return Ok(CompileResult::cancelled()),
        };

        let job = Job::prepare(paths, &request).await?;
        let image_notes = images::prepare(job.project_dir.clone(), job.out_dir.clone()).await;
        let version = self.distribution_version.load(Ordering::Relaxed);
        // An unsaved file that appears or goes changes no file latexmk knows of, so
        // it would call the document up to date: forced then too. Also forced on the
        // first build after startup: packages may have changed in the meantime.
        let built_with = (version, request.unsaved.iter().map(|file| file.path.clone()).collect::<Vec<_>>());
        let force = self.built_with.lock().unwrap().get(&job.out_dir) != Some(&built_with);
        let started = Instant::now();
        let started_at = std::time::SystemTime::now();
        let output = run_latexmk(paths, request.engine, &job, force, &mut cancel).await;
        let Ok(Some(output)) = output else {
            // A killed engine leaves a cut-off log behind, while latexmk's
            // records may still call the document up to date: the next build
            // would then do nothing and report that log as a crash. Force it.
            self.built_with.lock().unwrap().remove(&job.out_dir);
            return output.map(|_| CompileResult::cancelled());
        };
        self.built_with.lock().unwrap().insert(job.out_dir.clone(), built_with);
        let log = read_lossy(&job.out_dir.join(format!("{}.log", job.name))).await.ok_or_else(|| localized!("error_log_missing"))?;

        let source_name = format!("{}.tex", job.name);
        let mut parsed = log::parse(&log, |file| Path::new(file).file_name().is_some_and(|name| name == source_name.as_str()));
        // The engine's terminal output (in latexmk's) is complete even when a crash cut the log short.
        let missfont = read_lossy(&job.out_dir.join("missfont.log")).await.unwrap_or_default();
        for file in log::missing_files(&output).into_iter().chain(log::missing_fonts(&missfont)) {
            if !parsed.missing_files.contains(&file) {
                parsed.missing_files.push(file);
            }
        }
        // Errors in an unsaved file's stand-in belong to the file in the project.
        for file in parsed.diagnostics.iter_mut().filter_map(|d| d.file.as_mut()) {
            if let Some(original) = unsaved_original(&job.out_dir, file) {
                *file = original;
            }
        }
        // Ahead of TeX's own messages, which only say that an image could not be read.
        parsed.diagnostics.splice(0..0, image_notes);
        if !log::is_complete(&log) {
            parsed.diagnostics.insert(
                0,
                Diagnostic { severity: log::Severity::Error, message: localized!("build_engine_crashed"), line: None, file: None },
            );
        }
        if let Some(blg) = read_lossy(&job.out_dir.join(format!("{}.blg", job.name))).await {
            parsed.diagnostics.extend(log::parse_biber(&blg));
        }
        // latexmk only reports a missing helper program in its own output,
        // so check for the ones the document needs.
        for (needed, tool) in [(log::needs_biber(&log), "biber"), (log::needs_makeindex(&log), "makeindex")] {
            if needed && process::executable(paths, tool).is_none() {
                parsed.missing_files.push(tool.into());
            }
        }
        let failed = parsed.has_errors();
        for file in &mut parsed.missing_files {
            if let Some(language) = file.strip_suffix(".ldf") {
                if let Some(definition) = babel_definition_file(paths, language).await {
                    *file = definition;
                }
            }
        }
        let (missing_files, missing_project_files) = classify_missing(parsed.missing_files, index.get(paths).await.as_deref());
        let pdf = job.out_dir.join(format!("{}.pdf", job.name));
        // A failed build may leave an older PDF behind, possibly of a project that had
        // the same folder before: it is no result. A successful build that latexmk found
        // up to date keeps its PDF, which matches the sources.
        let written_now = std::fs::metadata(&pdf).and_then(|m| m.modified()).is_ok_and(|modified| modified >= started_at);
        let current = pdf.is_file() && (!failed || written_now);
        Ok(CompileResult {
            status: if failed { CompileStatus::Failed } else { CompileStatus::Success },
            pdf_path: current.then_some(pdf),
            diagnostics: parsed.diagnostics,
            missing_files,
            missing_project_files,
            duration_ms: started.elapsed().as_millis() as u64,
            runs: ENGINE_RUN.find_iter(&output).count() as u32,
        })
    }
}

struct Job {
    name: String,
    project_dir: PathBuf,
    out_dir: PathBuf,
    source: PathBuf,
    latexmkrc: PathBuf,
}

/// `path` of an unsaved file, if it stays inside the folder it is written to.
fn unsaved_path(path: &str) -> Result<&Path, String> {
    let relative = Path::new(path);
    let inside = !path.is_empty() && relative.components().all(|c| matches!(c, Component::Normal(_)));
    inside.then_some(relative).ok_or_else(|| localized!("error_invalid_file_name", name = path))
}

impl Job {
    /// Writes the editor content into the build directory, so unsaved changes
    /// compile without touching the user's file.
    async fn prepare(paths: &AppPaths, request: &CompileRequest) -> Result<Self, String> {
        let file = request.file_path.as_deref();
        let project_dir = file.and_then(Path::parent).map_or_else(|| paths.scratch(), Path::to_path_buf);
        let name = file.and_then(Path::file_stem).map(|stem| sanitize_job_name(&stem.to_string_lossy())).unwrap_or_else(|| "main".into());

        let mut hasher = DefaultHasher::new();
        project_dir.hash(&mut hasher);
        let out_dir = paths.builds().join(format!("{:016x}", hasher.finish()));
        tokio::fs::create_dir_all(&out_dir).await.map_err(|e| e.to_string())?;

        let source = out_dir.join(format!("{name}.tex"));
        let text = prepare_source(&request.source, request.pdf_standard.as_deref(), request.include_only.as_deref())?;
        tokio::fs::write(&source, text).await.map_err(|e| e.to_string())?;
        // TeX only ever appends to it; start fresh so fonts installed since do not show up again.
        let _ = tokio::fs::remove_file(out_dir.join("missfont.log")).await;
        let latexmkrc = out_dir.join("latexmkrc");
        tokio::fs::write(&latexmkrc, LATEXMKRC).await.map_err(|e| e.to_string())?;
        // Only this build's unsaved files: one saved since is read from the project again.
        let unsaved_dir = out_dir.join(UNSAVED_DIR);
        let _ = tokio::fs::remove_dir_all(&unsaved_dir).await;
        for file in &request.unsaved {
            let target = unsaved_dir.join(unsaved_path(&file.path)?);
            if let Some(dir) = target.parent() {
                tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
            }
            tokio::fs::write(&target, &file.text).await.map_err(|e| e.to_string())?;
        }
        Ok(Self { name, project_dir, out_dir, source, latexmkrc })
    }
}

/// The unsaved files first, then the converted images, then TeX's own search path (the trailing separator).
fn texinputs(out_dir: &Path) -> std::ffi::OsString {
    let mut value = out_dir.join(UNSAVED_DIR).into_os_string();
    value.push(if cfg!(windows) { ";" } else { ":" });
    value.push(images::texinputs(out_dir));
    value
}

/// Runs latexmk, which repeats the engine until references settle and runs
/// Biber and makeglossaries when the document needs them. Returns latexmk's
/// output, or `None` if the build was cancelled.
async fn run_latexmk(
    paths: &AppPaths,
    engine: Engine,
    job: &Job,
    force: bool,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<Option<String>, String> {
    let output_path = job.out_dir.join("latexmk.out");
    let output = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let errors = output.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = process::latexmk_command(paths).ok_or_else(|| localized!("error_program_missing", program = "latexmk"))?;
    cmd.current_dir(&job.project_dir)
        .env("max_print_line", "10000")
        .env("TEXINPUTS", texinputs(&job.out_dir))
        // Ignore the user's own latexmkrc files; only ours applies.
        .arg("-norc")
        .arg("-r")
        .arg(&job.latexmkrc)
        // -f keeps going after errors, so the preview updates like a plain engine run would.
        .args([engine.latexmk_flag(), "-f", "-interaction=nonstopmode", "-file-line-error", "-synctex=1"])
        .arg(format!("-outdir={}", tex_path(&job.out_dir)))
        .arg(format!("-jobname={}", job.name))
        .arg(tex_path(&job.source))
        .args(force.then_some("-g"))
        .stdout(output)
        .stderr(errors);
    let mut child = cmd.spawn().map_err(|e| localized!("error_program_start", program = "latexmk", error = e))?;
    process::bind_to_app(&child);

    tokio::select! {
        status = child.wait() => {
            status.map_err(|e| e.to_string())?;
            Ok(Some(read_lossy(&output_path).await.unwrap_or_default()))
        }
        _ = &mut *cancel => {
            process::kill_tree(&mut child).await;
            Ok(None)
        }
        _ = tokio::time::sleep(TIMEOUT) => {
            process::kill_tree(&mut child).await;
            Err(format!("Kompilierung nach {} s abgebrochen", TIMEOUT.as_secs()))
        }
    }
}

/// Splits missing files into installable ones and ones the project lacks.
///
/// TeX reports a missing image or chapter exactly like a missing package file,
/// and some package's documentation may well contain a `logo.png`. So a name
/// with a folder is always the project's, as is any file no package installs.
/// Package names that do not exist are dropped: a package may ask for a language
/// module nobody wrote (`glossaries-russian`), and its warning says so already.
/// Without an index (tlmgr never reached the repository) everything stays
/// installable and the package lookup decides.
fn classify_missing(missing: Vec<String>, index: Option<&PackageIndex>) -> (Vec<String>, Vec<String>) {
    missing.into_iter().filter(|file| file.contains('.') || index.is_none_or(|index| index.has_package(file))).partition(|file| {
        // Names without an extension are package names (`biber`, `hyphen-german`).
        if !file.contains('.') {
            return true;
        }
        if file.contains(['/', '\\']) {
            return false;
        }
        index.is_none_or(|index| index.package_for(file).is_some())
    })
}

/// `\BabelDefinitionFile{0}{russianb}{}` in babel's `babel-russian.tex`.
static BABEL_DEFINITION_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\BabelDefinitionFile\{\d+\}\{([^}]+)\}").unwrap());

/// The file babel loads for a language option. Usually `<option>.ldf`, which is what
/// the log reports, but some languages have another (`russian` → `russianb.ldf`);
/// babel names it in its own `babel-<option>.tex`.
async fn babel_definition_file(paths: &AppPaths, language: &str) -> Option<String> {
    let kpsewhich = process::executable(paths, "kpsewhich")?;
    let mut cmd = process::tex_command(paths, kpsewhich);
    cmd.arg(format!("babel-{language}.tex"));
    let found = process::run_captured(cmd).await.ok()?;
    let text = read_lossy(Path::new(found.trim())).await?;
    definition_file(&text)
}

fn definition_file(babel_language_file: &str) -> Option<String> {
    BABEL_DEFINITION_FILE.captures(babel_language_file).map(|c| format!("{}.ldf", &c[1]))
}

/// Reads a TeX output file, which is not guaranteed to be valid UTF-8.
async fn read_lossy(path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// TeX expects forward slashes, also on Windows.
fn tex_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn sanitize_job_name(stem: &str) -> String {
    let name: String = stem.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if name.is_empty() {
        "main".into()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_project_settings_without_shifting_lines() {
        let source = "\\documentclass{article}\n\\begin{document}\n\\include{intro}\n\\end{document}\n";
        let text = prepare_source(source, Some("A-2b"), Some("chapters/intro")).unwrap();
        assert_eq!(text.lines().count(), source.lines().count());
        assert!(text.starts_with(r"\DocumentMetadata{pdfstandard=A-2b}\documentclass"));
        assert!(text.contains(r"\includeonly{chapters/intro}\begin{document}"));

        let own = "\\DocumentMetadata{lang=de}\n\\documentclass{article}";
        assert_eq!(prepare_source(own, Some("A-2b"), None).unwrap(), own);
        assert!(prepare_source(source, Some("A-9z"), None).is_err());
        assert!(prepare_source(source, None, Some(r"x}\input{y")).is_err());
    }

    #[test]
    fn reads_babel_definition_file() {
        let russian = "\\BabelBeforeIni{ru}{%\n  \\BabelDefinitionFile{0}{russianb}{}%\n}\n\\endinput";
        assert_eq!(definition_file(russian).as_deref(), Some("russianb.ldf"));
        assert_eq!(definition_file("\\BabelBeforeIni{x}{}"), None);
    }

    #[test]
    fn separates_project_files_from_package_files() {
        let index =
            PackageIndex::parse("name siunitx\nrunfiles size=1\n RELOC/tex/latex/siunitx/siunitx.sty\n\nname biber\ncategory Package\n");
        let missing =
            ["siunitx.sty", "logo.png", "images/chart.pdf", "biber", "glossaries-russian", "chapter\\intro.tex"].map(String::from);

        let (install, project) = classify_missing(missing.to_vec(), Some(&index));
        assert_eq!(install, ["siunitx.sty", "biber"], "a language module that does not exist is dropped");
        assert_eq!(project, ["logo.png", "images/chart.pdf", "chapter\\intro.tex"]);

        // Without an index only paths are known to be the project's.
        let (install, project) = classify_missing(missing.to_vec(), None);
        assert_eq!(install, ["siunitx.sty", "logo.png", "biber", "glossaries-russian"]);
        assert_eq!(project, ["images/chart.pdf", "chapter\\intro.tex"]);
    }

    #[test]
    fn maps_unsaved_stand_ins_back() {
        let out_dir = Path::new(r"C:\Builds\abc");
        let file = r"C:/Builds/abc/.gilgamesh-unsaved/Chapters/One.tex";
        assert_eq!(unsaved_original(out_dir, file).as_deref(), Some("Chapters/One.tex"));
        assert_eq!(unsaved_original(out_dir, r"C:/Project/Chapters/One.tex"), None);
        assert_eq!(unsaved_original(Path::new(r"C:\Builds\other"), file), None);
        assert!(unsaved_path("chapters/one.tex").is_ok());
        for outside in ["", "../one.tex", "/one.tex", "a/../../one.tex"] {
            assert!(unsaved_path(outside).is_err(), "{outside}");
        }
        // Elsewhere `C:\one.tex` is an ordinary file name inside the folder.
        #[cfg(windows)]
        assert!(unsaved_path(r"C:\one.tex").is_err());
    }

    /// An unsaved included file is compiled from its text, the saved one stays
    /// on disk untouched; errors and SyncTeX point to the file in the project.
    /// Needs a TinyTeX installation like `compiles_with_managed_distribution`.
    #[tokio::test]
    #[ignore]
    async fn compiles_unsaved_files_instead_of_saved_ones() {
        let base = std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE");
        let paths = AppPaths::from_base(base.into());
        for dir in [paths.builds(), paths.scratch()] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let project = paths.scratch().join("unsaved-project");
        std::fs::create_dir_all(project.join("chapters")).unwrap();
        let main = project.join("main.tex");
        let source = "\\documentclass{article}\n\\begin{document}\n\\input{chapters/one}\n\\end{document}\n";
        std::fs::write(&main, source).unwrap();
        // Saved: an error in line 2. Unsaved: fine.
        std::fs::write(project.join("chapters/one.tex"), "Saved.\n\\undefinedsaved\n").unwrap();
        let builds = BuildManager::default();
        let index = IndexCache::default();
        let compile = |unsaved: Vec<UnsavedFile>| {
            builds.compile(
                "main",
                &paths,
                &index,
                CompileRequest {
                    source: source.into(),
                    file_path: Some(main.clone()),
                    engine: Engine::Pdflatex,
                    pdf_standard: None,
                    include_only: None,
                    unsaved,
                },
            )
        };

        let saved = compile(Vec::new()).await.unwrap();
        assert_eq!(saved.status, CompileStatus::Failed, "the saved file is read without unsaved text");

        let text = "Unsaved.\n\n\\undefinedunsaved\n";
        let unsaved = compile(vec![UnsavedFile { path: "chapters/one.tex".into(), text: text.into() }]).await.unwrap();
        let error = unsaved.diagnostics.iter().find(|d| d.severity == log::Severity::Error).expect("an error");
        assert_eq!((error.line, error.file.as_deref()), (Some(3), Some("chapters/one.tex")), "{:?}", unsaved.diagnostics);
        assert!(error.message.contains("undefined") || error.message.contains("Undefined"), "{error:?}");
        assert_eq!(std::fs::read_to_string(project.join("chapters/one.tex")).unwrap(), "Saved.\n\\undefinedsaved\n");

        let pdf = unsaved.pdf_path.expect("a PDF");
        let out_dir = pdf.parent().unwrap();
        let synctex = synctex::SynctexCache::default().get(&pdf.with_extension("synctex.gz")).await.unwrap();
        let found = synctex.view(|input| unsaved_original(out_dir, input).as_deref() == Some("chapters/one.tex"), 1);
        assert!(found.is_some(), "SyncTeX does not know the unsaved file");

        // Saved since: read from the project again.
        let fixed = compile(Vec::new()).await.unwrap();
        assert_eq!(fixed.status, CompileStatus::Failed);
        assert!(!out_dir.join(UNSAVED_DIR).join("chapters/one.tex").exists());
    }

    /// Needs a TinyTeX installation at `$GILGAMESH_TEST_BASE/tex/distribution`:
    /// `GILGAMESH_TEST_BASE=... cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn compiles_with_managed_distribution() {
        let base = std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE");
        let paths = AppPaths::from_base(base.into());
        for dir in [paths.builds(), paths.scratch()] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let builds = BuildManager::default();
        let index = IndexCache::default();
        let compile = |source: &str| {
            builds.compile(
                "main",
                &paths,
                &index,
                CompileRequest {
                    source: source.into(),
                    file_path: None,
                    engine: Engine::Lualatex,
                    pdf_standard: None,
                    include_only: None,
                    unsaved: Vec::new(),
                },
            )
        };

        let ok = compile(r"\documentclass{article}\begin{document}\section{A}\label{a}See~\ref{a}.\end{document}").await.unwrap();
        assert_eq!(ok.status, CompileStatus::Success, "{:?}", ok.diagnostics);
        assert!(ok.pdf_path.is_some());
        assert_eq!(ok.runs, 2, "label change should trigger a rerun");

        let broken = compile("\\documentclass{article}\n\\begin{document}\n\\foo\n\\end{document}").await.unwrap();
        assert_eq!(broken.status, CompileStatus::Failed);
        let error = &broken.diagnostics[0];
        assert_eq!((error.line, error.file.as_deref()), (Some(3), None), "{:?}", broken.diagnostics);

        let missing = compile(r"\documentclass{article}\usepackage{siunitx-does-not-exist}\begin{document}x\end{document}").await.unwrap();
        // No package ships this file, so it must not be offered for installation.
        assert_eq!(missing.missing_project_files, ["siunitx-does-not-exist.sty"]);
        assert!(missing.missing_files.is_empty());

        let glossary = compile(
            r"\documentclass{article}\usepackage[acronym]{glossaries}\makeglossaries
              \newacronym{tex}{TeX}{a typesetting system}
              \begin{document}\gls{tex}\printglossaries\end{document}",
        )
        .await
        .unwrap();
        if process::executable(&paths, "makeindex").is_some() {
            assert_eq!(glossary.status, CompileStatus::Success, "{:?}", glossary.diagnostics);
            let out_dir = glossary.pdf_path.as_deref().and_then(Path::parent).unwrap();
            assert!(out_dir.join("main.acr").is_file(), "makeglossaries did not run");
        } else {
            assert_eq!(glossary.missing_files, ["makeindex"]);
        }

        let missing_image = compile(
            r"\documentclass{article}\usepackage{graphicx}\begin{document}
              \includegraphics{logo.png}\includegraphics{images/chart.pdf}\end{document}",
        )
        .await
        .unwrap();
        assert_eq!(missing_image.missing_project_files, ["logo.png", "images/chart.pdf"]);
        assert!(missing_image.missing_files.is_empty(), "{:?}", missing_image.missing_files);

        let unknown_language = compile(r"\documentclass{article}\usepackage[klingon]{babel}\begin{document}x\end{document}").await.unwrap();
        // Detected as a language file, but no package has one for Klingon.
        assert!(unknown_language.missing_project_files.contains(&"klingon.ldf".to_owned()));

        if process::executable(&paths, "biber").is_none() {
            let bib = compile(
                r"\documentclass{article}\usepackage[backend=biber]{biblatex}
                  \begin{document}\cite{x}\printbibliography\end{document}",
            )
            .await
            .unwrap();
            assert_eq!(bib.missing_files, ["biber"]);
        }

        let installed = crate::tex::packages::list(&paths, false).await.unwrap();
        assert!(installed.iter().any(|p| p.name == "amsmath" && p.installed));
        let providers = crate::tex::packages::packages_for_file(&paths, &index, "siunitx.sty").await.unwrap();
        assert_eq!(providers, ["siunitx"]);
    }

    /// A build cancelled mid-run must not leave its cut-off log to the next one.
    /// Same setup as `compiles_with_managed_distribution`.
    #[tokio::test]
    #[ignore]
    async fn build_after_a_cancelled_one_reads_a_complete_log() {
        let base = std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE");
        let paths = AppPaths::from_base(base.into());
        for dir in [paths.builds(), paths.scratch()] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let builds = BuildManager::default();
        let index = IndexCache::default();
        let compile = |source: &str| {
            builds.compile(
                "main",
                &paths,
                &index,
                CompileRequest {
                    source: source.into(),
                    file_path: None,
                    engine: Engine::Pdflatex,
                    pdf_standard: None,
                    include_only: None,
                    unsaved: Vec::new(),
                },
            )
        };
        let quick = r"\documentclass{article}\usepackage{hyperref}\begin{document}Quick.\end{document}";
        // Busy for a few seconds in the preamble, so it is cancelled before
        // touching the .aux file: latexmk then sees no reason to rerun.
        let slow = r"\documentclass{article}\usepackage{hyperref}
            \count255=0 \loop\advance\count255 1 \ifnum\count255<300000000 \repeat
            \begin{document}Slow.\end{document}";

        assert_eq!(compile(quick).await.unwrap().status, CompileStatus::Success);
        let (cancelled, again) = tokio::join!(compile(slow), async {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            compile(quick).await
        });
        assert_eq!(cancelled.unwrap().status, CompileStatus::Cancelled);
        let again = again.unwrap();
        assert_eq!(again.status, CompileStatus::Success, "{:?}", again.diagnostics);
    }

    /// Compiles projects like the app does, installing what each build reports
    /// missing, as on a fresh installation. Setup as in `compiles_with_managed_distribution`,
    /// plus `GILGAMESH_TEMPLATES`: a folder with one project per subfolder and its
    /// engine and PDF standard in `engine.txt`; `GILGAMESH_ONLY` filters the subfolders.
    #[tokio::test]
    #[ignore]
    async fn template_projects_compile() {
        let base = std::env::var("GILGAMESH_TEST_BASE").expect("GILGAMESH_TEST_BASE");
        let templates = std::env::var("GILGAMESH_TEMPLATES").expect("GILGAMESH_TEMPLATES");
        let only = std::env::var("GILGAMESH_ONLY").ok();
        let paths = AppPaths::from_base(base.into());
        for dir in [paths.builds(), paths.scratch()] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let builds = BuildManager::default();
        let index = IndexCache::default();
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&templates).unwrap().map(|e| e.unwrap().path()).collect();
        dirs.sort();
        let mut failures = Vec::new();
        for dir in dirs {
            let name = dir.file_name().unwrap().to_string_lossy().into_owned();
            if only.as_deref().is_some_and(|o| !name.contains(o)) {
                continue;
            }
            let settings = std::fs::read_to_string(dir.join("engine.txt")).unwrap();
            let mut lines = settings.lines();
            let engine = match lines.next() {
                Some("pdflatex") => Engine::Pdflatex,
                Some("xelatex") => Engine::Xelatex,
                _ => Engine::Lualatex,
            };
            let pdf_standard = lines.next().filter(|s| !s.is_empty()).map(str::to_owned);
            let main = dir.join("main.tex");
            let mut installed = Vec::new();
            let mut attempted = std::collections::HashSet::new();
            let result = loop {
                let result = builds
                    .compile(
                        "main",
                        &paths,
                        &index,
                        CompileRequest {
                            source: std::fs::read_to_string(&main).unwrap(),
                            file_path: Some(main.clone()),
                            engine,
                            pdf_standard: pdf_standard.clone(),
                            include_only: None,
                            unsaved: Vec::new(),
                        },
                    )
                    .await
                    .unwrap();
                let next: Vec<String> = result.missing_files.iter().filter(|f| !attempted.contains(*f)).cloned().collect();
                if next.is_empty() {
                    break result;
                }
                for file in next {
                    attempted.insert(file.clone());
                    let packages = crate::tex::packages::packages_for_file(&paths, &index, &file).await.unwrap();
                    if packages.is_empty() {
                        installed.push(format!("{file}->?"));
                        continue;
                    }
                    let mut cmd = process::tlmgr_command(&paths).unwrap();
                    cmd.arg("install").args(&packages);
                    if let Err(e) = process::run_captured(cmd).await {
                        installed.push(format!("{file}->{} FAILED: {e}", packages.join(",")));
                        continue;
                    }
                    installed.push(format!("{file}->{}", packages.join(",")));
                }
                builds.distribution_changed();
            };
            println!("== {name}: {:?} [{}]", result.status, installed.join(" "));
            for d in &result.diagnostics {
                println!("   {:?} {:?}:{:?} {}", d.severity, d.file, d.line, d.message);
            }
            if !result.missing_files.is_empty() || !result.missing_project_files.is_empty() {
                println!("   missing {:?} project {:?}", result.missing_files, result.missing_project_files);
            }
            if result.status != CompileStatus::Success {
                failures.push(name);
            }
        }
        assert!(failures.is_empty(), "{failures:?}");
    }
}
