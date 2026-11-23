//! Gilgamesh's backend: sets the app up (its state, the main window, the
//! host AI assistants call through) and registers the commands the page
//! invokes (see [`commands`]).

mod bib;
mod commands;
mod git;
pub mod mcp;
mod paths;
mod print;
mod project;
mod settings;
mod spell;
mod tex;
mod updates;
mod util;
mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    suppress_crash_dialogs();
    tauri::Builder::default()
        // First, as the plugin asks: a second start ends here and hands its arguments over.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| window::second_start(app, &args, std::path::Path::new(&cwd))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let paths = paths::AppPaths::resolve(app.handle())?;
            settings::watch(app.handle().clone(), &paths);
            app.manage(commands::AppState::new(paths));
            app.manage(updates::Updates::new(app.package_info().version.to_string()));
            app.manage(project::watch::ProjectWatch::default());
            project::watch::ProjectWatch::start(app.handle());
            // Started for a file ("Open with Gilgamesh"): its project instead of the last one.
            let args: Vec<String> = std::env::args().collect();
            let start = window::start_from_args(&args, &std::env::current_dir().unwrap_or_default());
            window::create_main(app.handle(), start)?;
            // Without it the app works as before; assistants then report that Gilgamesh is unreachable.
            if let Err(e) = mcp::host::McpHost::start(app.handle()) {
                eprintln!("MCP: {e}");
            }
            std::thread::spawn(mcp::connect::prepare_launcher);
            updates::spawn(app.handle().clone());
            for window in app.webview_windows().values() {
                window::taskbar_icon::apply(window);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(window) = window.get_webview_window(window.label()) {
                    window::taskbar_icon::apply(&window);
                }
            }
            tauri::WindowEvent::Focused(true) => window::focused(window.app_handle(), window.label()),
            // Its detached panes are run by its page and close with it; the last main window
            // ends the app (`main_closed` tells whether others are left). Closing saved its
            // files, which an update waiting for them counts as done.
            tauri::WindowEvent::Destroyed if window::is_main(window.label()) => {
                window.app_handle().state::<updates::Updates>().saved(window.label(), None);
                if !window::main_closed(window.app_handle(), window.label()) {
                    window.app_handle().exit(0);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::tex::tex_status,
            commands::tex::eps_to_pdf,
            commands::tex::tex_install,
            commands::tex::tex_uninstall,
            commands::tex::open_user_texmf,
            commands::tex::packages_list,
            commands::tex::packages_install,
            commands::tex::packages_remove,
            commands::tex::packages_update_all,
            commands::tex::packages_for_file,
            commands::tex::compile,
            commands::tex::system_fonts,
            commands::tex::tex_font,
            commands::tex::font_families,
            commands::tex::font_face,
            commands::tex::font_preview_host,
            commands::tex::read_build_file,
            commands::tex::build_contents,
            commands::tex::synctex_edit,
            commands::tex::synctex_view,
            commands::tex::word_count,
            commands::spell::spell_check,
            commands::spell::spell_suggest,
            commands::spell::spell_add,
            commands::spell::spell_words,
            commands::spell::spell_remove,
            commands::settings::settings_load,
            commands::settings::settings_save,
            commands::settings::system_measurement,
            commands::project::project_create_root,
            commands::project::project_default_location,
            commands::project::project_import_zip,
            commands::project::project_tree,
            commands::project::project_scan,
            commands::project::bib_lookup,
            commands::project::project_exists,
            commands::project::project_read,
            commands::project::project_read_bytes,
            commands::project::project_write,
            commands::project::project_create_file,
            commands::project::project_create_dir,
            commands::project::project_import_file,
            commands::project::project_rename,
            commands::project::project_delete,
            commands::project::review_list,
            commands::project::review_save,
            commands::project::review_remove,
            commands::project::history_snapshot,
            commands::project::history_list,
            commands::project::history_read,
            commands::git::git_info,
            commands::git::git_trust,
            commands::git::git_clone,
            commands::git::git_open_folder,
            commands::git::git_status,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_sync,
            commands::git::git_fetch,
            commands::git::git_identity,
            commands::git::git_set_identity,
            commands::git::git_init,
            commands::git::git_init_folder,
            commands::git::git_set_remote,
            commands::mcp::mcp_respond,
            commands::mcp::assistant_status,
            commands::mcp::assistant_connect_desktop,
            commands::mcp::assistant_connect_code,
            commands::mcp::assistant_connect_codex,
            commands::print::print_printers,
            commands::print::print_paper,
            commands::print::print_page,
            commands::print::print_add_printer,
            commands::window::window_open_main,
            commands::window::project_claim,
            commands::update::update_status,
            commands::update::update_check,
            commands::update::update_install,
            commands::update::update_saved,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// A crashing TeX engine (LuaTeX aborts e.g. on a missing font) would open a
/// Windows error dialog and block the build until it is clicked away. The error
/// mode is inherited by every child process, so the engine just exits and the
/// build reports the problem instead.
fn suppress_crash_dialogs() {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX};
        // SAFETY: only changes how this process (and its children) report errors.
        unsafe {
            SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
        }
    }
}
