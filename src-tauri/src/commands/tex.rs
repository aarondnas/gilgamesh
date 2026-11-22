//! The TeX distribution, its packages, and building: compiling, the build's
//! output, SyncTeX and the word count.

use std::path::{Path, PathBuf};

use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::{blocking, check_file, check_root, AppState, CmdResult};
use crate::project::files;
use crate::tex::compile::{unsaved_original, CompileRequest, CompileResult};
use crate::tex::contents::{self, ContentsEntry};
use crate::tex::distribution::{self, Bundle, Manifest};
use crate::tex::eps;
use crate::tex::fonts::{self, FontFamily};
use crate::tex::packages::{self, Package};
use crate::tex::synctex::{self, PdfLocation, SourceLocation};
use crate::tex::wordcount::{self, WordCount};
use crate::util::i18n::localized;

#[tauri::command]
pub fn tex_status(state: State<'_, AppState>) -> distribution::Status {
    distribution::status(&state.paths)
}

#[tauri::command]
pub async fn tex_install(app: AppHandle, state: State<'_, AppState>, bundle: Bundle) -> CmdResult<Manifest> {
    let _lock = state.tlmgr.lock().await;
    let result = distribution::install(&app, &state.paths, bundle).await;
    state.builds.distribution_changed();
    result
}

#[tauri::command]
pub async fn tex_uninstall(state: State<'_, AppState>) -> CmdResult<()> {
    let _lock = state.tlmgr.lock().await;
    distribution::uninstall(&state.paths).await
}

#[tauri::command]
pub fn open_user_texmf(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let dir = state.paths.texmf_user();
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn packages_list(state: State<'_, AppState>, remote: bool) -> CmdResult<Vec<Package>> {
    let _lock = state.tlmgr.lock().await;
    packages::list(&state.paths, remote).await
}

#[tauri::command]
pub async fn packages_install(app: AppHandle, state: State<'_, AppState>, names: Vec<String>) -> CmdResult<()> {
    let _lock = state.tlmgr.lock().await;
    let result = packages::install(&app, &state.paths, &names).await;
    state.builds.distribution_changed();
    result
}

/// An EPS figure of the project as PDF, for its tab. `epstopdf` is installed
/// first where it is missing, as building with the figure would need it too.
#[tauri::command]
pub async fn eps_to_pdf(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, AppState>,
    root: PathBuf,
    path: String,
) -> CmdResult<Response> {
    check_root(&window, &root)?;
    let file = files::resolve(&root, &path)?;
    if !eps::available(&state.paths) {
        let _lock = state.tlmgr.lock().await;
        if !eps::available(&state.paths) {
            let result = packages::install(&app, &state.paths, &[eps::PACKAGE.to_owned()]).await;
            state.builds.distribution_changed();
            result?;
        }
    }
    Ok(Response::new(eps::to_pdf(&state.paths, &file).await?))
}

#[tauri::command]
pub async fn packages_remove(app: AppHandle, state: State<'_, AppState>, names: Vec<String>) -> CmdResult<()> {
    let _lock = state.tlmgr.lock().await;
    let result = packages::remove(&app, &state.paths, &names).await;
    state.builds.distribution_changed();
    result
}

/// Updates everything; after a new TeX Live year, installs TinyTeX anew with the same
/// packages. Returns whether it did.
#[tauri::command]
pub async fn packages_update_all(app: AppHandle, state: State<'_, AppState>) -> CmdResult<bool> {
    let _lock = state.tlmgr.lock().await;
    let result = distribution::update(&app, &state.paths).await;
    state.builds.distribution_changed();
    result
}

#[tauri::command]
pub async fn packages_for_file(state: State<'_, AppState>, file: String) -> CmdResult<Vec<String>> {
    let _lock = state.tlmgr.lock().await;
    packages::packages_for_file(&state.paths, &state.index, &file).await
}

#[tauri::command]
pub async fn compile(window: tauri::Window, state: State<'_, AppState>, request: CompileRequest) -> CmdResult<CompileResult> {
    // The build reads the document's folder; without a saved location it reads none.
    if let Some(file) = &request.file_path {
        check_file(&window, file)?;
    }
    state.builds.compile(window.label(), &state.paths, &state.index, request).await
}

/// Build output (PDF) as raw bytes; restricted to the build directory.
#[tauri::command]
pub async fn read_build_file(state: State<'_, AppState>, path: PathBuf) -> CmdResult<Response> {
    let path = build_file(&state, &path)?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// The table of contents of the build that made `pdf_path`: numbers and pages as the PDF shows them.
#[tauri::command]
pub async fn build_contents(state: State<'_, AppState>, pdf_path: PathBuf) -> CmdResult<Vec<ContentsEntry>> {
    let aux = build_file(&state, &pdf_path)?.with_extension("aux");
    blocking(move || contents::read(&aux)).await
}

/// Source line under a point of the PDF. `file` is `None` for the main file
/// (the build compiles a copy of it next to the PDF).
#[tauri::command]
pub async fn synctex_edit(state: State<'_, AppState>, pdf_path: PathBuf, page: u32, x: f64, y: f64) -> CmdResult<Option<SourceLocation>> {
    let pdf = build_file(&state, &pdf_path)?;
    let data = state.synctex.get(&pdf.with_extension("synctex.gz")).await?;
    let main = synctex::normalize(&pdf.with_extension("tex").to_string_lossy());
    let out_dir = pdf.parent().unwrap_or(&pdf).to_path_buf();
    Ok(data.edit(page, x, y).map(|mut at| {
        if synctex::normalize(&at.file) == main {
            at.file = String::new();
        } else if let Some(original) = unsaved_original(&out_dir, &at.file) {
            // Relative to the main file's folder, as in the log.
            at.file = original;
        }
        at
    }))
}

/// PDF position of `line` in `file` (absolute path, or `None` for the main file).
#[tauri::command]
pub async fn synctex_view(
    state: State<'_, AppState>,
    pdf_path: PathBuf,
    file: Option<PathBuf>,
    line: u32,
) -> CmdResult<Option<PdfLocation>> {
    let pdf = build_file(&state, &pdf_path)?;
    let data = state.synctex.get(&pdf.with_extension("synctex.gz")).await?;
    let wanted = synctex::normalize(&file.unwrap_or_else(|| pdf.with_extension("tex")).to_string_lossy());
    let out_dir = pdf.parent().unwrap_or(&pdf).to_path_buf();
    // An unsaved file was built from its stand-in, under its path relative to the main file's folder.
    let is_file = |input: &str| {
        synctex::normalize(input) == wanted
            || unsaved_original(&out_dir, input).is_some_and(|original| wanted.ends_with(&format!("/{}", synctex::normalize(&original))))
    };
    Ok(data.view(is_file, line))
}

/// Words in the document starting at `main` (absolute); `None` if texcount is missing.
#[tauri::command]
pub async fn word_count(window: tauri::Window, state: State<'_, AppState>, main: PathBuf, by: String) -> CmdResult<Option<WordCount>> {
    check_file(&window, &main)?;
    wordcount::count(&state.paths, &main, &by).await
}

/// `path` canonicalized, if it lies inside the build directory.
fn build_file(state: &AppState, path: &Path) -> CmdResult<PathBuf> {
    let builds = state.paths.builds().canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&builds) {
        return Err(localized!("error_outside_builds"));
    }
    Ok(path)
}

/// The font families installed on the system, for XeLaTeX and LuaLaTeX.
#[tauri::command]
pub async fn system_fonts() -> CmdResult<Vec<String>> {
    blocking(crate::tex::system_fonts::families).await
}

/// A font file of the TeX distribution, for showing its fonts in the font list:
/// `file` as `lm/lmroman10-regular.otf`, under `fonts/opentype/public`.
#[tauri::command]
pub async fn tex_font(state: State<'_, AppState>, file: String) -> CmdResult<Response> {
    let valid = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let well_formed = match file.strip_suffix(".otf").and_then(|name| name.split_once('/')) {
        Some((dir, name)) => valid(dir) && valid(name),
        None => false,
    };
    if !well_formed {
        return Err(localized!("error_not_distribution_font", file = file));
    }
    let path = state.paths.distribution().join("texmf-dist/fonts/opentype/public").join(&file);
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

/// Every font family of the repository, for the font manager.
#[tauri::command]
pub async fn font_families(state: State<'_, AppState>) -> CmdResult<Vec<FontFamily>> {
    fonts::families(&state.paths, &state.index).await
}

/// A face of a font family for its preview (`face` as `font_families` names it).
/// A package not installed yet is fetched for it only with `fetch`; without, a face
/// neither installed nor fetched before comes back empty.
#[tauri::command]
pub async fn font_face(state: State<'_, AppState>, package: String, face: String, fetch: bool) -> CmdResult<Response> {
    Ok(Response::new(fonts::face(&state.paths, &state.index, &package, &face, fetch).await?.unwrap_or_default()))
}

/// The server font previews come from, for asking the user before.
#[tauri::command]
pub async fn font_preview_host(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(fonts::preview_host(&state.paths).await)
}
