//! Connects AI assistants to Gilgamesh with one click, so nobody has to edit
//! configuration files by hand.
//!
//! - Claude Desktop: a desktop extension (`.mcpb`) that Claude Desktop installs
//!   after a confirmation. It holds the MCP server in JavaScript (`bridge.js`;
//!   Claude Desktop ships Node.js), which talks to the running app over its
//!   local socket itself and starts no Gilgamesh program. Where `.mcpb` files
//!   do not open in Claude Desktop, Gilgamesh adds itself (`--mcp`) to Claude
//!   Desktop's configuration file instead. Where Claude Desktop keeps its files
//!   has changed between its versions, so Gilgamesh does not rely on one path:
//!   the extension reports where it is installed (see `desktop_config_dirs`).
//! - Claude Code: its own `claude mcp add` command.
//! - Codex (OpenAI): a table in its `config.toml`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{tools, APP_IDENTIFIER};
use crate::util::fs::write_atomic_sync;
use crate::util::i18n::localized;
use crate::util::process::{hide_console, hide_console_std};

/// Name in the assistants' lists; also the key in configuration files.
const SERVER_NAME: &str = "gilgamesh";
const ICON: &[u8] = include_bytes!("../../icons/128x128.png");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    pub installed: bool,
    /// Gilgamesh is entered in the assistant's configuration.
    pub connected: bool,
    /// The entry no longer matches this Gilgamesh (another or a missing program,
    /// an extension from an older version); connecting again fixes it.
    pub outdated: bool,
}

impl AssistantStatus {
    fn new(installed: bool, connected: bool, current: bool) -> Self {
        AssistantStatus { installed, connected, outdated: connected && !current }
    }
}

/// Whether an entry's `command` starts this very program. A missing file never does.
fn is_this_program(command: &str) -> bool {
    let Ok(exe) = executable() else { return true };
    match (std::fs::canonicalize(command), std::fs::canonicalize(&exe)) {
        (Ok(entered), Ok(exe)) => entered == exe,
        (Ok(_), Err(_)) => Path::new(command) == exe,
        (Err(_), _) => false,
    }
}

/// How Claude Desktop was connected, which decides what the user does next.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopConnection {
    /// Claude Desktop shows its install dialog for the extension.
    Extension,
    /// Written into its configuration; takes effect after a restart.
    Config,
}

/// What assistants start as `--mcp`: on Windows a copy of this program in
/// Gilgamesh's data folder, not the program itself. A running bridge locks its
/// exe for as long as the assistant runs; started from the install (or build)
/// folder, it would block every update and `cargo build`.
fn executable() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(all(windows, not(test)))]
    if let Some(dir) = dirs::data_local_dir().map(|d| d.join(APP_IDENTIFIER).join("mcp")) {
        let launcher = dir.join(exe.file_name().unwrap_or("gilgamesh.exe".as_ref()));
        refresh_launcher(&exe, &launcher).map_err(|e| e.to_string())?;
        return Ok(launcher);
    }
    Ok(exe)
}

/// Brings the launcher copy up to date (at startup, so an update reaches assistants
/// that are already connected). Without a working copy, entries keep their path.
pub fn prepare_launcher() {
    if let Err(e) = executable() {
        eprintln!("MCP launcher: {e}");
    }
}

/// Copies `exe` to `launcher` unless it is there already (same size and time).
#[cfg(all(windows, not(test)))]
fn refresh_launcher(exe: &Path, launcher: &Path) -> std::io::Result<()> {
    let dir = launcher.parent().unwrap_or(Path::new("."));
    // Copies moved aside earlier; still locked while an old bridge runs.
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().contains(".old-") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let source = std::fs::metadata(exe)?;
    let current =
        std::fs::metadata(launcher).is_ok_and(|copy| copy.len() == source.len() && copy.modified().ok() == source.modified().ok());
    if current || exe == launcher {
        return Ok(());
    }

    std::fs::create_dir_all(dir)?;
    let staged = launcher.with_extension("new");
    std::fs::copy(exe, &staged)?;
    std::fs::File::options().write(true).open(&staged)?.set_modified(source.modified()?)?;
    if launcher.exists() {
        // A running exe cannot be replaced or deleted, but Windows lets it be renamed.
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
        std::fs::rename(launcher, launcher.with_extension(format!("old-{stamp}")))?;
    }
    std::fs::rename(&staged, launcher)
}

// ---------------------------------------------------------------- Claude Desktop

/// Folders Claude Desktop keeps its settings and extensions in. They have moved
/// before (the Store version's from its package folder to `Claude-Data`), so no
/// single path is relied on:
/// - where installed extensions reported they are (see [`remember_extension`]),
/// - the known places,
/// - a short search for folders named like Claude that hold its files.
///
/// Folders Claude Desktop has left (it leaves a `.user-data-left.…` file) are skipped.
fn desktop_config_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = remembered_extensions()
        .iter()
        .filter_map(|folder| Some(folder.parent()?.parent()?.to_path_buf()))
        .filter(|dir| is_claude_dir(dir))
        .collect();
    if let Some(config) = dirs::config_dir() {
        dirs.push(config.join("Claude"));
    }
    // The Store version's folder as Windows redirected it, too deep for the search.
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        if let Ok(entries) = std::fs::read_dir(local.join("Packages")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("Claude_") {
                    dirs.push(entry.path().join("LocalCache").join("Roaming").join("Claude"));
                }
            }
        }
    }
    let roots: Vec<PathBuf> = [dirs::config_dir(), dirs::data_local_dir()].into_iter().flatten().collect();
    dirs.extend(search_claude_dirs(&roots));
    unique(dirs.into_iter().filter(|dir| dir.is_dir() && !has_left(dir)))
}

/// Whether `dir` holds Claude Desktop's files.
fn is_claude_dir(dir: &Path) -> bool {
    dir.join("claude_desktop_config.json").is_file() || dir.join("Claude Extensions").is_dir()
}

/// Folders below `roots` that hold Claude Desktop's files: at most three levels
/// deep, and only through folders whose name contains "claude", so it stays quick.
fn search_claude_dirs(roots: &[PathBuf]) -> Vec<PathBuf> {
    fn visit(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let named_claude = entry.file_name().to_string_lossy().to_lowercase().contains("claude");
            if !named_claude || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let path = entry.path();
            if is_claude_dir(&path) {
                found.push(path);
            } else if depth > 1 {
                visit(&path, depth - 1, found);
            }
        }
    }
    let mut found = Vec::new();
    for root in roots {
        visit(root, 3, &mut found);
    }
    found
}

/// Whether Claude Desktop moved its data out of `dir` (it leaves a marker file).
fn has_left(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .is_ok_and(|entries| entries.flatten().any(|entry| entry.file_name().to_string_lossy().starts_with(".user-data-left.")))
}

/// Each folder once, however it was spelled.
fn unique(dirs: impl Iterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    dirs.filter(|dir| seen.insert(std::fs::canonicalize(dir).unwrap_or_else(|_| dir.clone()))).collect()
}

/// Whether `folder` is an installed Gilgamesh extension.
fn is_our_extension(folder: &Path) -> bool {
    read_json(&folder.join("manifest.json")).is_some_and(|manifest| manifest["name"] == SERVER_NAME)
        && folder.join("server").join("index.js").is_file()
}

/// Where installed extensions reported they are, in Gilgamesh's own config folder.
fn extensions_file() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join(APP_IDENTIFIER).join("extensions.json"))
}

fn read_extensions(file: &Path) -> Vec<PathBuf> {
    read_json(file).and_then(|value| serde_json::from_value(value).ok()).unwrap_or_default()
}

fn write_extensions(file: &Path, folders: &[PathBuf]) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(folders) {
        let _ = write_atomic_sync(file, text + "\n");
    }
}

/// Notes where the extension that sent a call is installed (see `bridge.js`).
/// It reports over the app's socket rather than writing a file itself: Windows
/// may redirect files written by Store apps (and their child processes).
pub fn remember_extension(folder: &Path) {
    let Some(file) = extensions_file() else { return };
    let mut folders = read_extensions(&file);
    if folders.iter().any(|known| known == folder) || !is_our_extension(folder) {
        return;
    }
    folders.push(folder.to_path_buf());
    write_extensions(&file, &folders);
}

/// The remembered extensions still installed; forgets the others.
fn remembered_extensions() -> Vec<PathBuf> {
    let Some(file) = extensions_file() else { return Vec::new() };
    let folders = read_extensions(&file);
    let installed: Vec<PathBuf> = folders.iter().filter(|folder| is_our_extension(folder)).cloned().collect();
    if installed.len() != folders.len() {
        write_extensions(&file, &installed);
    }
    installed
}

pub fn desktop_status() -> AssistantStatus {
    let dirs = desktop_config_dirs();
    // Whether each entry found is up to date.
    let mut entries: Vec<bool> = Vec::new();
    for dir in &dirs {
        if let Some(entry) = read_json(&dir.join("claude_desktop_config.json"))
            .and_then(|config| config.pointer(&format!("/mcpServers/{SERVER_NAME}")).cloned())
        {
            entries.push(entry["command"].as_str().is_some_and(is_this_program));
        }
    }
    // Installed extensions: in those folders, and wherever one reported from.
    let mut folders = remembered_extensions();
    for dir in &dirs {
        let Ok(found) = std::fs::read_dir(dir.join("Claude Extensions")) else { continue };
        folders.extend(found.flatten().map(|entry| entry.path()).filter(|folder| is_our_extension(folder)));
    }
    // An extension's server does not depend on where Gilgamesh lives; it is up to
    // date while it is the script and instructions this Gilgamesh would write.
    let revision = bridge_revision();
    for folder in unique(folders.into_iter()) {
        let script = std::fs::read_to_string(folder.join("server").join("index.js")).unwrap_or_default();
        entries.push(installed_revision(&script) == Some(revision.as_str()));
    }
    let installed = !dirs.is_empty() || opens_mcpb() || desktop_alias().is_some();
    AssistantStatus::new(installed, !entries.is_empty(), entries.contains(&true))
}

/// Offers the extension to Claude Desktop, or writes its configuration.
pub fn connect_desktop(app: &tauri::AppHandle, work_dir: &Path) -> Result<DesktopConnection, String> {
    use tauri_plugin_opener::OpenerExt;
    let exe = executable()?;
    let alias = desktop_alias();
    if opens_mcpb() || alias.is_some() {
        let bundle = work_dir.join("gilgamesh.mcpb");
        write_bundle(&bundle)?;
        match alias {
            // The Microsoft Store version registers no file types, only this command,
            // which hands the file to the running Claude Desktop like a double click.
            Some(alias) => {
                hide_console_std(std::process::Command::new(alias).arg(&bundle))
                    .spawn()
                    .map_err(|e| localized!("error_program_start", program = "Claude Desktop", error = e))?;
            }
            None => app.opener().open_path(bundle.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())?,
        }
        // An entry from an earlier connection would list Gilgamesh twice.
        for dir in desktop_config_dirs() {
            remove_from_desktop_config(&dir.join("claude_desktop_config.json"));
        }
        return Ok(DesktopConnection::Extension);
    }
    let dirs = desktop_config_dirs();
    if dirs.is_empty() {
        return Err(localized!("error_program_missing", program = "Claude Desktop"));
    }
    for dir in dirs {
        add_to_desktop_config(&dir.join("claude_desktop_config.json"), &exe)?;
    }
    Ok(DesktopConnection::Config)
}

/// `claude-desktop.exe`, the command the Microsoft Store version of Claude Desktop registers.
fn desktop_alias() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let alias = dirs::data_local_dir()?.join("Microsoft").join("WindowsApps").join("claude-desktop.exe");
        // An app execution alias is a reparse point; `exists` follows it, so ask for the link itself.
        std::fs::symlink_metadata(&alias).is_ok().then_some(alias)
    }
    #[cfg(not(windows))]
    None
}

/// Whether Windows opens `.mcpb` files with a program (Claude Desktop registers them).
fn opens_mcpb() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ};
        let name: Vec<u16> = ".mcpb".encode_utf16().chain([0]).collect();
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: `name` is NUL-terminated and `key` is closed again right away.
        unsafe {
            if RegOpenKeyExW(HKEY_CLASSES_ROOT, name.as_ptr(), 0, KEY_READ, &mut key) == 0 {
                RegCloseKey(key);
                return true;
            }
        }
        false
    }
    #[cfg(not(windows))]
    false
}

/// The extension: manifest, icon and the MCP server in JavaScript (`bridge.js`).
/// It starts no Gilgamesh program, so it does not depend on where Gilgamesh is
/// installed, and never keeps `gilgamesh.exe` locked against updates.
fn write_bundle(target: &Path) -> Result<(), String> {
    let tools: Vec<Value> = tools::list()
        .as_array()
        .into_iter()
        .flatten()
        .map(|tool| json!({ "name": tool["name"], "description": tool["description"] }))
        .collect();
    let manifest = json!({
        "manifest_version": "0.3",
        "name": SERVER_NAME,
        "display_name": "Gilgamesh",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Read, edit and compile the LaTeX project open in Gilgamesh.",
        "long_description": tools::INSTRUCTIONS,
        "author": { "name": "Gilgamesh" },
        "icon": "icon.png",
        "server": {
            "type": "node",
            "entry_point": "server/index.js",
            "mcp_config": { "command": "node", "args": ["${__dirname}/server/index.js"], "env": {} }
        },
        "tools": tools,
        "compatibility": { "platforms": ["win32", "linux"], "runtimes": { "node": ">=16.0.0" } }
    });
    let server = bridge_script()?;

    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let file = std::fs::File::create(target).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let manifest = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    for (name, bytes) in [("manifest.json", manifest.as_slice()), ("icon.png", ICON), ("server/index.js", server.as_bytes())] {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// `bridge.js` with the tools and texts it serves filled in.
fn bridge_script() -> Result<String, String> {
    let json = |value: &Value| serde_json::to_string(value).map_err(|e| e.to_string());
    Ok(include_str!("bridge.js")
        .replace("__TOOLS__", &json(&tools::list())?)
        .replace("__INSTRUCTIONS__", &json(&json!(tools::INSTRUCTIONS))?)
        .replace("__VERSION__", &json(&json!(env!("CARGO_PKG_VERSION")))?)
        .replace("__APP_IDENTIFIER__", &json(&json!(APP_IDENTIFIER))?)
        .replace("__REVISION__", &json(&json!(bridge_revision()))?))
}

/// Fingerprint of what an installed extension serves by itself: `bridge.js` and
/// the instructions. Not the tools, which it asks the running app for, nor the
/// version number: a new Gilgamesh asks to reconnect only when it has to.
fn bridge_revision() -> String {
    revision_of(include_str!("bridge.js"), tools::INSTRUCTIONS)
}

/// The first 16 hex digits of a SHA-256 over the texts, without carriage
/// returns: Git may check `bridge.js` out with either line ending.
fn revision_of(script: &str, instructions: &str) -> String {
    let mut hasher = Sha256::new();
    for text in [script, instructions] {
        hasher.update(text.replace('\r', ""));
    }
    hasher.finalize().iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

/// The revision an installed `index.js` was written with; none for extensions
/// from before revisions.
fn installed_revision(script: &str) -> Option<&str> {
    let value = script.lines().find_map(|line| line.trim().strip_prefix("const REVISION = "))?;
    value.trim().trim_end_matches(';').strip_prefix('"')?.strip_suffix('"')
}

/// Adds (or updates) our entry, keeping everything else in the file.
fn add_to_desktop_config(file: &Path, exe: &Path) -> Result<(), String> {
    let mut config = match std::fs::read_to_string(file) {
        Ok(text) if !text.trim().is_empty() => {
            serde_json::from_str::<Value>(&text).map_err(|_| localized!("error_config_damaged", file = file.display()))?
        }
        _ => json!({}),
    };
    let root = config.as_object_mut().ok_or("Unerwarteter Inhalt in claude_desktop_config.json")?;
    let servers = root.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    let servers = servers.as_object_mut().ok_or("Unerwarteter Inhalt in claude_desktop_config.json")?;
    servers.insert(SERVER_NAME.into(), json!({ "command": exe.to_string_lossy(), "args": ["--mcp"] }));
    if file.is_file() {
        let _ = std::fs::copy(file, file.with_extension("json.bak"));
    }
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    // Claude Desktop writes its own preferences into this file while it runs:
    // replace it in one step, so neither ever reads half of the other's write.
    write_atomic_sync(file, text + "\n")
}

/// Takes our entry out again, if there is one; leaves the file alone otherwise.
fn remove_from_desktop_config(file: &Path) {
    let Some(mut config) = read_json(file) else { return };
    let removed = config.get_mut("mcpServers").and_then(Value::as_object_mut).is_some_and(|servers| servers.remove(SERVER_NAME).is_some());
    if !removed {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(&config) else { return };
    let _ = write_atomic_sync(file, text + "\n");
}

fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

// ---------------------------------------------------------------- Claude Code

/// The `claude` command, as the npm package (`claude.cmd`) or the native installer (`claude.exe`) put it.
fn claude_command() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    // Where the native installer puts it; not always on the PATH of apps started from the desktop.
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
    }
    let on_path = dirs.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name))).find(|path| path.is_file());
    on_path.or_else(editor_extension_claude)
}

/// The Claude Code extension for VS Code (and its forks) brings its own `claude`,
/// which shares the user's MCP servers with the command line. The newest one wins.
fn editor_extension_claude() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let binary = if cfg!(windows) { "claude.exe" } else { "claude" };
    [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]
        .iter()
        .filter_map(|editor| std::fs::read_dir(home.join(editor).join("extensions")).ok())
        .flat_map(|entries| entries.flatten())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("anthropic.claude-code-"))
        .map(|entry| entry.path().join("resources").join("native-binary").join(binary))
        .filter(|path| path.is_file())
        .max_by_key(|path| std::fs::metadata(path).and_then(|m| m.modified()).ok())
}

pub fn code_status() -> AssistantStatus {
    // User-scope servers live in ~/.claude.json.
    let entry = dirs::home_dir()
        .and_then(|home| read_json(&home.join(".claude.json")))
        .and_then(|config| config.pointer(&format!("/mcpServers/{SERVER_NAME}")).cloned());
    let current = entry.as_ref().and_then(|entry| entry["command"].as_str()).is_some_and(is_this_program);
    AssistantStatus::new(claude_command().is_some(), entry.is_some(), current)
}

pub async fn connect_code() -> Result<(), String> {
    let claude = claude_command().ok_or_else(|| localized!("error_program_missing", program = "Claude Code"))?;
    let exe = executable()?;
    // An older entry (e.g. from a Gilgamesh elsewhere) would make `add` fail.
    let _ = run_claude(&claude, &["mcp", "remove", "--scope", "user", SERVER_NAME]).await;
    let exe = exe.to_string_lossy();
    run_claude(&claude, &["mcp", "add", "--scope", "user", SERVER_NAME, "--", &exe, "--mcp"]).await
}

async fn run_claude(claude: &Path, args: &[&str]) -> Result<(), String> {
    let output = hide_console(tokio::process::Command::new(claude).args(args))
        .output()
        .await
        .map_err(|e| localized!("error_program_start", program = "Claude Code", error = e))?;
    if output.status.success() {
        Ok(())
    } else {
        let message = String::from_utf8_lossy(&output.stderr);
        let message = if message.trim().is_empty() { String::from_utf8_lossy(&output.stdout) } else { message };
        Err(message.trim().to_owned())
    }
}

// ---------------------------------------------------------------- Codex (OpenAI)

/// Where Codex keeps its settings: `CODEX_HOME`, or `~/.codex`. The command line,
/// the editor extensions and the Codex app all read the same `config.toml`, so
/// writing it directly works without the `codex` command on the PATH.
fn codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| Some(dirs::home_dir()?.join(".codex")))
}

fn codex_table() -> String {
    format!("[mcp_servers.{SERVER_NAME}]")
}

pub fn codex_status() -> AssistantStatus {
    let Some(home) = codex_home() else {
        return AssistantStatus::new(false, false, false);
    };
    let config = std::fs::read_to_string(home.join("config.toml")).unwrap_or_default();
    let connected = config.lines().any(|line| line.trim() == codex_table());
    let current = codex_command(&config).is_some_and(|command| is_this_program(&command));
    AssistantStatus::new(home.is_dir(), connected, current)
}

/// The `command` of our table in Codex's `config.toml`, as a basic ("…") or literal ('…') string.
fn codex_command(config: &str) -> Option<String> {
    let table = codex_table();
    let mut ours = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            ours = line == table;
        } else if ours {
            let Some(value) = line.strip_prefix("command").map(str::trim_start).and_then(|rest| rest.strip_prefix('=')) else {
                continue;
            };
            let value = value.trim();
            return match value.chars().next()? {
                '"' => serde_json::Deserializer::from_str(value).into_iter::<String>().next()?.ok(),
                '\'' => value[1..].split('\'').next().map(str::to_owned),
                _ => None,
            };
        }
    }
    None
}

pub fn connect_codex() -> Result<(), String> {
    let home = codex_home().filter(|home| home.is_dir()).ok_or_else(|| localized!("error_program_missing", program = "Codex"))?;
    let file = home.join("config.toml");
    let config = std::fs::read_to_string(&file).unwrap_or_default();
    let text = with_codex_server(&config, &executable()?);
    if file.is_file() {
        let _ = std::fs::copy(&file, file.with_extension("toml.bak"));
    }
    // A running Codex may read the file at any moment: replace it in one step.
    write_atomic_sync(&file, text)
}

/// `config` with Gilgamesh's server table at the end. An older one (e.g. from a
/// Gilgamesh elsewhere) is replaced, everything else is kept as written.
fn with_codex_server(config: &str, exe: &Path) -> String {
    let table = codex_table();
    let subtable = format!("[mcp_servers.{SERVER_NAME}.");
    let mut kept = String::new();
    let mut ours = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            // Our table and its subtables (e.g. `.env`) end where another table starts.
            ours = trimmed == table || trimmed.starts_with(&subtable);
        }
        if !ours {
            kept.push_str(line);
            kept.push('\n');
        }
    }
    let kept = kept.trim_end();
    // A TOML basic string: the same escapes as JSON for a path.
    let command = serde_json::to_string(&exe.to_string_lossy()).unwrap_or_default();
    let entry = format!("{table}\ncommand = {command}\nargs = [\"--mcp\"]\n");
    if kept.is_empty() {
        entry
    } else {
        format!("{kept}\n\n{entry}")
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn bundle_holds_manifest_icon_and_server() {
        let dir = TestDir::new("mcpb");
        let bundle = dir.join("gilgamesh.mcpb");
        write_bundle(&bundle).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&bundle).unwrap()).unwrap();
        let manifest: Value = serde_json::from_reader(zip.by_name("manifest.json").unwrap()).unwrap();
        assert_eq!(manifest["manifest_version"], "0.3");
        assert_eq!(manifest["server"]["entry_point"], "server/index.js");
        assert_eq!(manifest["tools"].as_array().unwrap().len(), tools::list().as_array().unwrap().len());
        let mut server = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("server/index.js").unwrap(), &mut server).unwrap();
        // Every placeholder was filled in.
        assert!(!server.contains("__TOOLS__") && !server.contains("__APP_IDENTIFIER__"));
        assert!(server.contains(r#"const APP_IDENTIFIER = "com.aaron.gilgamesh";"#));
        assert!(zip.by_name("icon.png").is_ok());
    }

    #[test]
    fn extension_carries_its_revision() {
        let script = bridge_script().unwrap();
        assert_eq!(installed_revision(&script), Some(bridge_revision().as_str()));
        // Extensions from before revisions count as outdated.
        assert_eq!(installed_revision(include_str!("bridge.js")), None);
        // The same revision whichever line endings Git checked out.
        assert_eq!(revision_of("a\r\nb", "c"), revision_of("a\nb", "c"));
        assert_ne!(revision_of("a\nb", "c"), revision_of("a\nb", "d"));
    }

    #[test]
    fn search_finds_moved_claude_folders() {
        let root = TestDir::new("search");
        let moved = root.join("Claude-Data").join("claude_abc");
        std::fs::create_dir_all(moved.join("Claude Extensions")).unwrap();
        let classic = root.join("Claude");
        std::fs::create_dir_all(&classic).unwrap();
        std::fs::write(classic.join("claude_desktop_config.json"), "{}").unwrap();
        // Not named like Claude: not searched, even with Claude's files inside.
        std::fs::create_dir_all(root.join("Other").join("Claude Extensions")).unwrap();
        // Named like Claude, but without its files.
        std::fs::create_dir_all(root.join("AnthropicClaude").join("app-1.0")).unwrap();

        let mut found = search_claude_dirs(&[root.to_path_buf()]);
        found.sort();
        assert_eq!(found, vec![classic.clone(), moved]);

        std::fs::write(classic.join(".user-data-left.claude_abc"), "").unwrap();
        assert!(has_left(&classic));
    }

    #[test]
    fn desktop_config_keeps_other_servers() {
        let dir = TestDir::new("claude");
        let file = dir.join("claude_desktop_config.json");
        std::fs::write(&file, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        add_to_desktop_config(&file, Path::new("C:/g/gilgamesh.exe")).unwrap();
        let config = read_json(&file).unwrap();
        assert_eq!(config["mcpServers"]["other"]["command"], "x");
        assert_eq!(config["mcpServers"]["gilgamesh"]["args"][0], "--mcp");
        assert_eq!(config["theme"], "dark");
    }

    #[test]
    fn codex_config_replaces_old_entry_and_keeps_the_rest() {
        let config = "model = \"o3\"\n\n[mcp_servers.gilgamesh]\ncommand = \"old.exe\"\n\n\
                      [mcp_servers.gilgamesh.env]\nX = \"1\"\n\n[mcp_servers.other]\ncommand = \"x\"\n";
        let result = with_codex_server(config, Path::new(r"C:\g\gilgamesh.exe"));
        assert!(result.starts_with("model = \"o3\""));
        assert!(result.contains("[mcp_servers.other]\ncommand = \"x\""));
        assert!(!result.contains("old.exe") && !result.contains("X = "));
        assert!(result.ends_with(
            r#"[mcp_servers.gilgamesh]
command = "C:\\g\\gilgamesh.exe"
args = ["--mcp"]
"#
        ));
        assert_eq!(with_codex_server("", Path::new("g")), "[mcp_servers.gilgamesh]\ncommand = \"g\"\nargs = [\"--mcp\"]\n");
        // What it wrote, it reads back.
        assert_eq!(codex_command(&result).as_deref(), Some(r"C:\g\gilgamesh.exe"));
    }

    #[test]
    fn codex_command_reads_both_string_forms_of_our_table_only() {
        let literal =
            "[mcp_servers.other]\ncommand = 'x.exe'\n\n[mcp_servers.gilgamesh]\nargs = []\ncommand = 'C:\\g\\gilgamesh.exe' # moved\n";
        assert_eq!(codex_command(literal).as_deref(), Some(r"C:\g\gilgamesh.exe"));
        let basic = "[mcp_servers.gilgamesh]\ncommand=\"C:\\\\g\\\\gilgamesh.exe\"\n";
        assert_eq!(codex_command(basic).as_deref(), Some(r"C:\g\gilgamesh.exe"));
        assert_eq!(codex_command("[mcp_servers.other]\ncommand = 'x.exe'\n"), None);
    }

    #[test]
    fn missing_program_is_not_this_one() {
        assert!(!is_this_program(r"C:\does\not\exist\gilgamesh.exe"));
        assert!(is_this_program(&executable().unwrap().to_string_lossy()));
    }
}
