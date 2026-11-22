fn main() {
    // The window/taskbar icon is embedded at compile time, but tauri-build only
    // watches the config; without this a changed icon needs a clean build.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
