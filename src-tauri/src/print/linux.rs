//! Printing on Linux: the printers CUPS knows, and WebKitGTK printing the page,
//! as WebView2 does on Windows: same sheets, same options, no dialog.

use std::cell::RefCell;
use std::process::Command;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use super::{Duplex, Paper, PrintOptions, PrintStatus, Printer};

/// The printers CUPS knows, which GTK prints to as well: those set up, and (CUPS 2.2
/// and later) the driverless ones it finds on the network. None without the CUPS tools.
pub fn printers() -> Vec<Printer> {
    let Some(list) = lpstat(&["-e"]) else {
        return Vec::new();
    };
    let default = lpstat(&["-d"]).and_then(|text| parse_default(&text));
    parse_destinations(&list, default.as_deref())
}

/// `lpstat`'s output, in English whatever the user's language; `None` if it cannot run.
fn lpstat(args: &[&str]) -> Option<String> {
    let output = Command::new("lpstat").args(args).env("LC_ALL", "C").output().ok()?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// `lpstat -e`: one destination per line.
fn parse_destinations(list: &str, default: Option<&str>) -> Vec<Printer> {
    list.lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| Printer { name: name.to_owned(), is_default: default == Some(name) })
        .collect()
}

/// `lpstat -d`: "system default destination: NAME", or "no system default destination".
fn parse_default(text: &str) -> Option<String> {
    text.lines().find_map(|line| line.strip_prefix("system default destination:")).map(|name| name.trim().to_owned())
}

/// The paper GTK prints on: the locale's (A4, or US Letter where that is usual), upright.
pub fn paper() -> Paper {
    let size = gtk::PaperSize::new(None);
    Paper { width: size.width(gtk::Unit::Mm), height: size.height(gtk::Unit::Mm) }
}

/// Prints the calling page as it looks under `@media print`; resolves once WebKitGTK
/// handed the job to the print system.
pub async fn print(webview: tauri::Webview, options: PrintOptions) -> Result<PrintStatus, String> {
    use gtk::{PageOrientation, PageSetup, PaperSize, PrintDuplex, PrintSettings, Unit};
    use webkit2gtk::{PrintError, PrintOperation, PrintOperationExt};

    type Reply = Arc<Mutex<Option<tokio::sync::oneshot::Sender<PrintStatus>>>>;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx: Reply = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform| {
            let settings = PrintSettings::new();
            if let Some(name) = &options.printer {
                settings.set_printer(name);
            }
            settings.set_n_copies(options.copies.max(1));
            settings.set_collate(options.collate);
            // GTK names the edge the sheet turns about: horizontal is the long edge of a portrait sheet.
            settings.set_duplex(match options.duplex {
                Duplex::OneSided => PrintDuplex::Simplex,
                Duplex::LongEdge => PrintDuplex::Horizontal,
                Duplex::ShortEdge => PrintDuplex::Vertical,
            });
            settings.set_use_color(!options.grayscale);

            // The paper the sheets were laid out for (see `paper`). Landscape sheets go on that
            // paper given across, not turned: with a landscape orientation WebKitGTK prints blank
            // pages. The print system turns them onto the paper (CUPS marks them rotated).
            let named = PaperSize::new(None);
            let paper = if options.landscape {
                let (width, height) = (named.width(Unit::Mm), named.height(Unit::Mm));
                let name = named.name().map(|n| n.to_string()).unwrap_or_default();
                let display_name = named.display_name().map(|n| n.to_string()).unwrap_or_default();
                PaperSize::new_custom(&format!("{name}-across"), &display_name, height, width, Unit::Mm)
            } else {
                named
            };
            settings.set_paper_size(&paper);
            settings.set_orientation(PageOrientation::Portrait);

            // The page images bring the PDF's own margins.
            let page = PageSetup::new();
            page.set_paper_size(&paper);
            page.set_orientation(PageOrientation::Portrait);
            page.set_top_margin(0.0, Unit::Points);
            page.set_bottom_margin(0.0, Unit::Points);
            page.set_left_margin(0.0, Unit::Points);
            page.set_right_margin(0.0, Unit::Points);

            let operation = PrintOperation::builder().web_view(&platform.inner()).print_settings(&settings).page_setup(&page).build();
            // `failed` comes first if anything goes wrong; `finished` ends every operation.
            let failure: Rc<RefCell<Option<PrintStatus>>> = Rc::default();
            let failed = failure.clone();
            operation.connect_failed(move |_, error| {
                let unavailable = error.matches(PrintError::PrinterNotFound);
                *failed.borrow_mut() = Some(if unavailable { PrintStatus::PrinterUnavailable } else { PrintStatus::Failed });
            });
            // Kept alive until it is done, then let go.
            let running = Rc::new(RefCell::new(Some(operation.clone())));
            operation.connect_finished(move |_| {
                let status = failure.borrow_mut().take().unwrap_or(PrintStatus::Succeeded);
                if let Some(tx) = tx.lock().ok().and_then(|mut tx| tx.take()) {
                    let _ = tx.send(status);
                }
                running.borrow_mut().take();
            });
            operation.print();
        })
        .map_err(|err| err.to_string())?;

    rx.await.map_err(|_| "print job lost".to_string())
}

/// A program that opens printer settings, with its arguments.
type Program = (&'static str, &'static [&'static str]);

const GNOME: &[Program] = &[("gnome-control-center", &["printers"])];
const KDE: &[Program] =
    &[("systemsettings", &["kcm_printer_manager"]), ("kcmshell6", &["kcm_printer_manager"]), ("kcmshell5", &["kcm_printer_manager"])];
/// Independent of the desktop; the usual one of Xfce, Cinnamon, MATE and others.
const GENERIC: &[Program] = &[("system-config-printer", &[])];

/// The web interface every CUPS serves, where no settings program is installed.
const CUPS_WEB: &str = "http://localhost:631/printers/";

/// Opens the desktop's printer settings, which also find printers on the network;
/// without one installed, the web interface of CUPS.
pub fn add_printer(app: &AppHandle) -> Result<(), String> {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    for (program, args) in settings_programs(&desktop) {
        if let Ok(mut child) = Command::new(program).args(args).spawn() {
            // Waited for, so it leaves no zombie behind when it closes.
            std::thread::spawn(move || child.wait());
            return Ok(());
        }
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(CUPS_WEB, None::<&str>).map_err(|e| e.to_string())
}

/// The settings programs to try, the current desktop's own first.
fn settings_programs(desktop: &str) -> Vec<Program> {
    let desktop = desktop.to_ascii_lowercase();
    let own = if desktop.contains("kde") {
        KDE
    } else if desktop.contains("gnome") || desktop.contains("unity") {
        GNOME
    } else {
        GENERIC
    };
    let mut programs: Vec<Program> = Vec::new();
    for program in own.iter().chain(GENERIC).chain(GNOME).chain(KDE) {
        if !programs.contains(program) {
            programs.push(*program);
        }
    }
    programs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_printers_and_the_default_one() {
        let default = parse_default("system default destination: Office_Laser\n");
        assert_eq!(default.as_deref(), Some("Office_Laser"));
        let printers = parse_destinations("Office_Laser\nHP_Color_Network\n\n", default.as_deref());
        assert_eq!(
            printers,
            [Printer { name: "Office_Laser".into(), is_default: true }, Printer { name: "HP_Color_Network".into(), is_default: false },]
        );
        assert_eq!(parse_default("no system default destination\n"), None);
    }

    #[test]
    fn tries_the_desktops_own_settings_first() {
        assert_eq!(settings_programs("KDE")[0].0, "systemsettings");
        assert_eq!(settings_programs("ubuntu:GNOME")[0].0, "gnome-control-center");
        assert_eq!(settings_programs("XFCE")[0].0, "system-config-printer");
        // Every program once, whatever the desktop.
        assert_eq!(settings_programs("KDE").len(), GNOME.len() + KDE.len() + GENERIC.len());
    }
}
