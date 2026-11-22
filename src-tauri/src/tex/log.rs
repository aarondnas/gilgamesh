//! Extracts diagnostics from TeX log files.
//!
//! Expects logs written with `-file-line-error` and `max_print_line` raised so
//! that lines are not wrapped.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub line: Option<u32>,
    /// `None` for the main document, otherwise the included file.
    pub file: Option<String>,
}

#[derive(Debug, Default)]
pub struct ParsedLog {
    pub diagnostics: Vec<Diagnostic>,
    pub missing_files: Vec<String>,
}

impl ParsedLog {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == Severity::Error)
    }
}

static FILE_LINE_ERROR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?\.\w+):(\d+): (.+)$").unwrap());
static PLAIN_ERROR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^! (.+)$").unwrap());
static WARNING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:LaTeX|Package \S+|Class \S+) Warning: (.+?)(?: on input line (\d+))?\.?$").unwrap());
static OVERFULL_BOX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(Overfull \\[hv]box \([^)]*\)).*?lines? (\d+)").unwrap());
static MISSING_FILE: LazyLock<Regex> =
    // Also "Encoding file `t2aenc.def' not found" from fontenc.
    LazyLock::new(|| Regex::new(r"[Ff]ile `([^']+)' not found").unwrap());
/// A font that could not be loaded, see `font_file`. LuaTeX on Windows often aborts
/// right after this message, so it may only appear on the terminal, not in the log.
static MISSING_FONT: LazyLock<Regex> = LazyLock::new(|| {
    // The terminal shows `Font \T1/ptm/m/n/10=…`, the log with -file-line-error `Font T1/…`.
    Regex::new(r"Font \\?[^=\s]*=(.+?) at \S+ not loadable: (?:metric data not found|Metric \(TFM\) file not found)").unwrap()
});
/// A font fontspec looked for before loading it, by file or by name; it names the
/// file without its extension (`FreeSerif` for `FreeSerif.otf`), see `fontspec_file`.
static FONTSPEC_MISSING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"The font "([^"]+)" cannot be found"#).unwrap());
/// An encoding without the font description of its default font, e.g. Greek after
/// Tempora loads it: "For encoding scheme LGR the defaults cmr/m/n do not form a
/// valid font shape" means `lgrcmr.fd` is missing.
static MISSING_DEFAULT_FONT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"For encoding scheme (\S+) the defaults ([^/\s]+)/").unwrap());
/// Color profiles for PDF/A (`sRGB.icc not found.`), reported by the PDF management.
static MISSING_PROFILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([\w.-]+\.ic[cm]) not found").unwrap());
/// babel reports a missing language definition (`ngerman.ldf`) as an unknown option.
static BABEL_UNKNOWN_OPTION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Package babel Error: Unknown option '([^']+)'").unwrap());
/// Glossary (`.glo`, `.acn`) or index (`.idx`) files, which latexmk processes with makeindex.
static MAKEINDEX_INPUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\\openout\d+ = `?[^\s']+\.(?:glo|acn|idx|nlo)'?\.?$").unwrap());
/// `[123] Biber.pm:456> ERROR - message` in Biber's `.blg` log.
static BIBER_MESSAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"> (ERROR|WARN) - (.+)$").unwrap());

/// Which file TeX reads at a point of the log: it writes `(path` when it opens
/// one and `)` when it is done with it. Warnings and boxes name only the line,
/// so their file is the one open where they stand.
#[derive(Default)]
struct OpenFiles {
    /// One entry per open parenthesis; `None` for one that opens no file, e.g. `(re)run`.
    stack: Vec<Option<String>>,
    /// Inside the text an overfull or underfull box prints after its message, up to the
    /// next empty line: it is the paragraph's, whose parentheses open and close no files.
    in_box: bool,
}

impl OpenFiles {
    fn current(&self) -> Option<&str> {
        self.stack.iter().rev().find_map(|f| f.as_deref())
    }

    /// Takes in `line`, after its diagnostic has its file.
    fn read(&mut self, line: &str) {
        if self.in_box {
            self.in_box = !line.trim().is_empty();
            return;
        }
        if line.starts_with("Overfull \\") || line.starts_with("Underfull \\") {
            self.in_box = true;
            return;
        }
        let mut rest = line;
        while let Some(at) = rest.find(['(', ')']) {
            if rest[at..].starts_with(')') {
                self.stack.pop();
                rest = &rest[at + 1..];
                continue;
            }
            rest = &rest[at + 1..];
            match opened_file(rest) {
                Some((path, length)) => {
                    self.stack.push(Some(path));
                    rest = &rest[length..];
                }
                None => self.stack.push(None),
            }
        }
    }
}

/// The file a `(` opens, and how much of `rest` (after the `(`) names it: a path
/// with a folder and an extension, `./chapter.tex` or `c:/tex/article.cls`, or
/// quoted where it has spaces. `None` for any other parenthesis.
fn opened_file(rest: &str) -> Option<(String, usize)> {
    let (path, length) = match rest.strip_prefix('"') {
        Some(quoted) => {
            let end = quoted.find('"')?;
            (&quoted[..end], end + 2)
        }
        None => {
            let end = rest.find(|c: char| c.is_whitespace() || c == '(' || c == ')').unwrap_or(rest.len());
            (&rest[..end], end)
        }
    };
    let name = path.rsplit('/').next()?;
    let extension = name.rsplit_once('.').map(|(_, e)| e)?;
    let is_path = path.contains('/') && !extension.is_empty() && extension.len() <= 8;
    (is_path && extension.chars().all(|c| c.is_ascii_alphanumeric())).then(|| (path.to_owned(), length))
}

/// `is_main` decides whether a file name from the log is the main document.
pub fn parse(log: &str, is_main: impl Fn(&str) -> bool) -> ParsedLog {
    let mut parsed = ParsedLog::default();
    let lines: Vec<&str> = log.lines().collect();
    let mut files = OpenFiles::default();
    for (i, &line) in lines.iter().enumerate() {
        // Where TeX reads, for the messages that do not say it themselves.
        let here = files.current().filter(|f| !is_main(f)).map(str::to_owned);
        files.read(line);
        let diagnostic = if let Some(c) = FILE_LINE_ERROR.captures(line) {
            let file = &c[1];
            Some(Diagnostic {
                severity: Severity::Error,
                message: with_undefined_command(&c[3], &lines[i + 1..]),
                line: c[2].parse().ok(),
                file: (!is_main(file)).then(|| file.to_owned()),
            })
        } else if let Some(c) = PLAIN_ERROR.captures(line) {
            Some(Diagnostic { severity: Severity::Error, message: c[1].to_owned(), line: None, file: None })
        } else if let Some(c) = WARNING.captures(line).filter(|c| !is_harmless(&c[1])) {
            let line = c.get(2).and_then(|m| m.as_str().parse().ok());
            // Without a line, a file says little; and "on input line" counts in the file open there.
            Some(Diagnostic { severity: Severity::Warning, message: c[1].to_owned(), file: line.and(here), line })
        } else {
            OVERFULL_BOX.captures(line).map(|c| Diagnostic {
                severity: Severity::Warning,
                message: c[1].to_owned(),
                line: c[2].parse().ok(),
                file: here,
            })
        };

        if let Some(file) = missing_file(line) {
            if !parsed.missing_files.contains(&file) {
                parsed.missing_files.push(file);
            }
        }
        if let Some(d) = diagnostic {
            if !parsed.diagnostics.contains(&d) {
                parsed.diagnostics.push(d);
            }
        }
    }
    for package in missing_hyphenation(log).into_iter().chain(missing_language_modules(log)) {
        if !parsed.missing_files.contains(&package) {
            parsed.missing_files.push(package);
        }
    }
    parsed
}

/// TeX's context after an error, `l.12 Text with \foo`: the line up to where it stopped.
static CONTEXT_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^l\.\d+ (.*)$").unwrap());
static COMMAND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[a-zA-Z@]+").unwrap());

/// "Undefined control sequence" with the command it means, `Undefined control sequence: \foo`,
/// from the context TeX prints a few lines after it: the command it stopped at is the last there.
fn with_undefined_command(message: &str, after: &[&str]) -> String {
    if message.trim_end_matches('.') != "Undefined control sequence" {
        return message.to_owned();
    }
    let command = after
        .iter()
        .take(6)
        .find_map(|line| CONTEXT_LINE.captures(line))
        .and_then(|c| COMMAND.find_iter(&c[1]).last().map(|m| m.as_str().to_owned()));
    match command {
        Some(command) => format!("Undefined control sequence: {command}"),
        None => message.to_owned(),
    }
}

/// babel's fallback when a language's patterns are not installed: it warns
/// "No hyphenation patterns were preloaded …" and then hyphenates with
/// English rules, which silently changes line and page breaks.
/// Language files with their own fallback (Polish) report it as
/// "No hyphenation patterns were set for\n(babel)   language 'polish'".
static HYPHEN_FALLBACK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Package babel Info: (?:Hyphen rules for '([^']+)' set to \\l@|No hyphenation patterns were set for\s*\(babel\)\s*language '([^']+)')")
        .unwrap()
});

/// glossaries names its missing translation, spread over two log lines:
/// "Please check on CTAN for a bundle called\n(glossaries)   `glossaries-german' or similar."
static LANGUAGE_MODULE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"bundle called\s*(?:\(\w+\)\s*)?`([\w-]+)'").unwrap());

/// Translation packages a package asked for by name, e.g. `glossaries-german`.
fn missing_language_modules(log: &str) -> Vec<String> {
    let mut packages: Vec<String> = Vec::new();
    for c in LANGUAGE_MODULE.captures_iter(log) {
        if !packages.contains(&c[1].to_owned()) {
            packages.push(c[1].to_owned());
        }
    }
    packages
}

/// babel language names whose patterns ship in a differently named package.
/// All others are in `hyphen-<name>`.
const HYPHEN_ALIASES: &[(&[&str], &str)] = &[
    (&["ngerman", "austrian", "naustrian", "swissgerman", "nswissgerman"], "german"),
    (&["british", "american", "UKenglish", "USenglish", "canadian", "australian", "newzealand"], "english"),
    (&["francais", "acadian", "canadien"], "french"),
    (&["brazil", "brazilian", "portuges"], "portuguese"),
    (&["norsk", "nynorsk", "bokmal"], "norwegian"),
    (&["polutonikogreek"], "greek"),
    (&["persian"], "farsi"),
    (&["bahasa", "bahasai", "indon"], "indonesian"),
    (&["magyar"], "hungarian"),
    (&["slovene"], "slovenian"),
];

/// Hyphenation packages (`hyphen-german`) for languages babel had to fall back on.
fn missing_hyphenation(log: &str) -> Vec<String> {
    if !log.contains("No hyphenation patterns were preloaded") {
        return Vec::new();
    }
    let mut packages: Vec<String> = Vec::new();
    for c in HYPHEN_FALLBACK.captures_iter(log) {
        let Some(language) = c.get(1).or(c.get(2)).map(|m| m.as_str()) else { continue };
        let base = HYPHEN_ALIASES.iter().find(|(names, _)| names.contains(&language)).map_or(language, |(_, base)| base);
        let package = format!("hyphen-{base}");
        if !packages.contains(&package) {
            packages.push(package);
        }
    }
    packages
}

/// Warnings that cannot be fixed by installing anything and do not affect the
/// output, so they are not shown. Matched as substrings of the message.
const HARMLESS_WARNINGS: &[&str] = &[
    // TeX Live has no German (or most other) datatool modules; glossaries
    // loads datatool internally and sorts correctly without it.
    "support for dialect",
];

fn is_harmless(message: &str) -> bool {
    HARMLESS_WARNINGS.iter().any(|w| message.contains(w))
}

/// Messages that mean a support file is missing without naming it the usual
/// way, with the file whose package fixes them.
const KNOWN_MISSING: &[(&str, &str)] = &[
    // `\DocumentMetadata` (PDF/A, tagging) needs latex-lab.
    (r"No support files for \DocumentMetadata", "documentmetadata-support.ltx"),
];

/// The file a log line reports as missing, named so `tlmgr search` finds its package.
fn missing_file(line: &str) -> Option<String> {
    if let Some((_, file)) = KNOWN_MISSING.iter().find(|(message, _)| line.contains(message)) {
        return Some((*file).to_owned());
    }
    if let Some(c) = MISSING_FILE.captures(line) {
        Some(c[1].to_owned())
    } else if let Some(c) = MISSING_PROFILE.captures(line) {
        Some(c[1].to_owned())
    } else if let Some(c) = MISSING_FONT.captures(line) {
        font_file(&c[1])
    } else if let Some(c) = FONTSPEC_MISSING.captures(line) {
        fontspec_file(&c[1])
    } else if let Some(c) = MISSING_DEFAULT_FONT.captures(line) {
        // Font description files are named in lower case (`lgrcmr.fd`).
        Some(format!("{}{}.fd", c[1].to_lowercase(), &c[2]))
    } else {
        BABEL_UNKNOWN_OPTION.captures(line).map(|c| format!("{}.ldf", &c[1]))
    }
}

/// The file behind a font TeX could not load: metrics (`ptmr8t` → `ptmr8t.tfm`), or an
/// OpenType font LuaTeX was asked for by file, by luaotfload (`file:HaranoAjiMincho-Regular.otf:-kern`)
/// or fontspec (`[cmunrm.otf]:mode=node`). A request by font name (`name:TeX Gyre Termes`)
/// names no file to install.
fn font_file(request: &str) -> Option<String> {
    let opentype = |name: &str| {
        let lower = name.to_ascii_lowercase();
        let file = if [".otf", ".ttf", ".ttc", ".otc"].iter().any(|ext| lower.ends_with(ext)) {
            name.to_owned()
        } else {
            // luaotfload tries OpenType first when the extension is left out.
            format!("{name}.otf")
        };
        Some(file)
    };
    if let Some(rest) = request.strip_prefix('[') {
        // May be a whole path, and on Windows contain a drive's colon.
        let path = rest.split(']').next()?;
        opentype(path.rsplit(['/', '\\']).next()?)
    } else if let Some(rest) = request.strip_prefix("file:") {
        opentype(rest.split(':').next()?)
    } else if request.starts_with("name:") || request.contains(' ') {
        None
    } else {
        Some(format!("{}.tfm", request.split(':').next()?))
    }
}

/// The file behind a font fontspec could not find: one of the distribution's asked
/// for by file (`FreeSerif`, the symbol dialog's fallback, is `FreeSerif.otf`). A
/// name with spaces (`TeX Gyre Termes`, `Times New Roman`) is a family's, not a file's.
fn fontspec_file(name: &str) -> Option<String> {
    if name.contains(' ') {
        None
    } else {
        font_file(&format!("file:{name}"))
    }
}

/// Missing files mentioned anywhere in `text`, e.g. the terminal output of a
/// crashed engine whose log was cut off.
pub fn missing_files(text: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for file in text.lines().filter_map(missing_file) {
        if !files.contains(&file) {
            files.push(file);
        }
    }
    files
}

/// Fonts listed in `missfont.log`, which TeX writes as `mktextfm <name>` for
/// every font whose metrics it could not find.
pub fn missing_fonts(missfont_log: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for line in missfont_log.lines() {
        let Some(font) = line.trim().strip_prefix("mktextfm ").and_then(|rest| rest.split_whitespace().next()) else {
            continue;
        };
        let file = format!("{font}.tfm");
        if !files.contains(&file) {
            files.push(file);
        }
    }
    files
}

/// TeX ends every log, even after a fatal error, with its memory statistics.
/// Without them the engine crashed and the log is cut off.
pub fn is_complete(log: &str) -> bool {
    log.contains("Here is how much of")
}

/// Whether biblatex still waits for Biber, i.e. Biber did not run successfully.
pub fn needs_biber(log: &str) -> bool {
    log.contains("run Biber on the file")
}

/// Whether the document writes files that need makeindex (glossaries, index, nomencl).
pub fn needs_makeindex(log: &str) -> bool {
    MAKEINDEX_INPUT.is_match(log)
}

/// Errors and warnings from Biber's `.blg` log.
pub fn parse_biber(blg: &str) -> Vec<Diagnostic> {
    blg.lines()
        .filter_map(|line| BIBER_MESSAGE.captures(line))
        .map(|c| Diagnostic {
            severity: if &c[1] == "ERROR" { Severity::Error } else { Severity::Warning },
            message: format!("Biber: {}", &c[2]),
            line: None,
            file: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = r"
C:/app/builds/abc/main.tex:12: Undefined control sequence.
./chapter.tex:3: LaTeX Error: File `siunitx.sty' not found.
! Emergency stop.
LaTeX Warning: Reference `fig' on page 1 undefined on input line 20.
Package hyperref Warning: Token not allowed in a PDF string.
Overfull \hbox (12.3pt too wide) in paragraph at lines 30--31
C:/tex/babel/babel.sty:4460: Package babel Error: Unknown option 'ngerman'.
";

    #[test]
    fn parses_errors_warnings_and_missing_files() {
        let parsed = parse(LOG, |f| f.ends_with("builds/abc/main.tex"));
        let d = &parsed.diagnostics;
        assert_eq!(d.len(), 7);
        assert_eq!((d[0].severity, d[0].line, d[0].file.as_deref()), (Severity::Error, Some(12), None));
        assert_eq!(d[1].file.as_deref(), Some("./chapter.tex"));
        assert_eq!((d[2].message.as_str(), d[2].line), ("Emergency stop.", None));
        assert_eq!((d[3].severity, d[3].line), (Severity::Warning, Some(20)));
        assert_eq!(d[3].message, "Reference `fig' on page 1 undefined");
        assert_eq!(d[4].line, None);
        assert_eq!((d[5].message.as_str(), d[5].line), (r"Overfull \hbox (12.3pt too wide)", Some(30)));
        assert_eq!(parsed.missing_files, ["siunitx.sty", "ngerman.ldf"]);
        assert!(parsed.has_errors());
    }

    #[test]
    fn places_warnings_in_the_file_open_there() {
        let log = r"(c:/builds/abc/main.tex (c:/tex/article.cls (c:/tex/size12.clo))
Package biblatex Warning: Please (re)run Biber on input line 3.
(./abschnitte/vicky.tex (./abschnitte/wendepunkt.tex
Overfull \hbox (3.4pt too wide) in paragraph at lines 9--9
[][][]\T1/ntxtlf/m/n/12 Hallo (ohne Klammer zu[]

LaTeX Warning: Reference `x' on page 2 undefined on input line 11.
) (./abschnitte/vicky.aux)
LaTeX Warning: Citation `y' on page 3 undefined on input line 14.
)
LaTeX Warning: Label `z' multiply defined on input line 40.
LaTeX Warning: There were undefined references.
)";
        let parsed = parse(log, |f| f.ends_with("builds/abc/main.tex"));
        let files: Vec<_> = parsed.diagnostics.iter().map(|d| (d.line, d.file.as_deref())).collect();
        assert_eq!(
            files,
            [
                (Some(3), None),
                (Some(9), Some("./abschnitte/wendepunkt.tex")),
                (Some(11), Some("./abschnitte/wendepunkt.tex")),
                (Some(14), Some("./abschnitte/vicky.tex")),
                (Some(40), None),
                (None, None),
            ]
        );
    }

    #[test]
    fn reads_quoted_file_names() {
        let log =
            "(c:/builds/abc/main.tex (\"./abschnitte/wende punkt.tex\"\nOverfull \\hbox (1pt too wide) in paragraph at lines 2--2\n\n))";
        let parsed = parse(log, |f| f.ends_with("main.tex"));
        assert_eq!(parsed.diagnostics[0].file.as_deref(), Some("./abschnitte/wende punkt.tex"));
    }

    #[test]
    fn names_the_undefined_command() {
        let log = "./main.tex:5: Undefined control sequence.\nl.5 Ein Bild \\includegraphics\n                                {a.png}\n";
        assert_eq!(parse(log, |_| true).diagnostics[0].message, r"Undefined control sequence: \includegraphics");
    }

    #[test]
    fn parses_biber_log() {
        let blg = "[0] Config.pm:311> INFO - This is Biber 2.20\n\
                   [12] Utils.pm:410> WARN - Duplicate entry key 'a'\n\
                   [14] Biber.pm:131> ERROR - Cannot find 'literatur.bib'!";
        let d = parse_biber(blg);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].severity, d[0].message.as_str()), (Severity::Warning, "Biber: Duplicate entry key 'a'"));
        assert_eq!((d[1].severity, d[1].message.as_str()), (Severity::Error, "Biber: Cannot find 'literatur.bib'!"));
    }

    #[test]
    fn detects_pending_biber_run() {
        assert!(needs_biber("Package biblatex Warning: Please (re)run Biber on the file:\n(biblatex) main"));
        assert!(!needs_biber("Output written on main.pdf"));
    }

    #[test]
    fn finds_missing_font_encodings() {
        let log = "./main.tex:115: Package fontenc Error: Encoding file `t2aenc.def' not found.";
        assert_eq!(missing_files(log), ["t2aenc.def"]);

        let nfss = "./main.tex:117: LaTeX Error: This NFSS system isn't set up properly.\n\
                    For encoding scheme LGR the defaults cmr/m/n do not form a valid font shape";
        assert_eq!(missing_files(nfss), ["lgrcmr.fd"]);
    }

    #[test]
    fn finds_missing_fonts_in_terminal_output() {
        let output = "! Font \\=txsyc at 10pt not loadable: metric data not found or bad.\n\
                      ! Font \\T1/ptm/m/n/10=ptmr8t at 10.0pt not loadable: Metric (TFM) file not found.\n\
                      ! Font \\=txsyc at 12pt not loadable: metric data not found or bad.";
        assert_eq!(missing_files(output), ["txsyc.tfm", "ptmr8t.tfm"]);

        let log = "./chapter/a.tex:34: Font TS1/ntxtlf/m/n/12=ts1-qtmr at 12.0pt not loadable: Metric (TFM) file not found.";
        assert_eq!(missing_files(log), ["ts1-qtmr.tfm"]);
    }

    #[test]
    fn finds_missing_opentype_fonts() {
        // LuaTeX-ja's default Japanese font, through luaotfload.
        let luatexja = "./main.tex:8: Font \\JY3/mc/m/n/10=file:HaranoAjiMincho-Regular.otf:-kern;jfm=ujis at 9.62219pt not loadable: metric data not found or bad.";
        // fontspec with a font given by file name.
        let fontspec = "./main.tex:4: Font \\TU/cmun(0)/m/n/10=[cmunrm.otf]:mode=node;script=cyrl;language=RUS;+tlig;family=rm; at 10pt not loadable: metric data not found or bad.";
        let path = "! Font \\TU/x(0)/m/n/10=[C:/fonts/FandolSong-Regular]:mode=node; at 10pt not loadable: metric data not found or bad.";
        let by_name = "! Font \\TU/x(0)/m/n/10=name:TeX Gyre Termes:mode=node; at 10pt not loadable: metric data not found or bad.";
        assert_eq!(
            missing_files(&[luatexja, fontspec, path, by_name].join("\n")),
            ["HaranoAjiMincho-Regular.otf", "cmunrm.otf", "FandolSong-Regular.otf"]
        );
    }

    #[test]
    fn finds_fonts_fontspec_cannot_find() {
        // The symbol dialog's fallback font on a distribution without gnu-freefont.
        let by_file = "./main.tex:5: Package fontspec Error: \n\
                       (fontspec)                The font \"FreeSerif\" cannot be found; this may be\n\
                       (fontspec)                but a typo, a missing file or a font family name.";
        let by_name = "(fontspec)                The font \"Times New Roman\" cannot be found; this may be";
        assert_eq!(missing_files(&[by_file, by_name].join("\n")), ["FreeSerif.otf"]);
    }

    #[test]
    fn detects_missing_hyphenation_patterns() {
        let log = "Package babel Warning: No hyphenation patterns were preloaded for\n\
                   (babel)                the language 'German (current orthography)' into the format.\n\
                   Package babel Info: Hyphen rules for 'ngerman' set to \\l@english\n\
                   Package babel Info: Hyphen rules for 'french' set to \\l@english\n";
        assert_eq!(parse(log, |_| false).missing_files, ["hyphen-german", "hyphen-french"]);

        let polish = "Package babel Warning: No hyphenation patterns were preloaded for\n\
                      (babel)                the language 'Polish' into the format.\n\
                      Package babel Info: No hyphenation patterns were set for\n\
                      (babel)             language 'polish'. Reported on input line 116.\n";
        assert_eq!(parse(polish, |_| false).missing_files, ["hyphen-polish"]);

        // Without the warning the mapping is intentional, e.g. \babelprovide with hyphenrules.
        assert!(parse("Package babel Info: Hyphen rules for 'ngerman' set to \\l@english\n", |_| false).missing_files.is_empty());
    }

    #[test]
    fn detects_missing_glossaries_language_module() {
        let log = "Package glossaries Warning: No language module detected for `ngerman'.\n\
                   (glossaries)                Language modules need to be installed separately.\n\
                   (glossaries)                Please check on CTAN for a bundle called\n\
                   (glossaries)                `glossaries-german' or similar.\n";
        assert_eq!(parse(log, |_| false).missing_files, ["glossaries-german"]);
    }

    #[test]
    fn hides_harmless_warnings() {
        let log = "Package tracklang Warning: No `datatool' support for dialect `ngerman'  on input line 9924.\n\
                   LaTeX Warning: Reference `fig' on page 1 undefined on input line 20.\n";
        let d = parse(log, |_| false).diagnostics;
        assert_eq!(d.len(), 1);
        assert!(d[0].message.starts_with("Reference"));
    }

    #[test]
    fn maps_known_messages_to_missing_files() {
        let log = r"./main.tex:1: LaTeX Error: No support files for \DocumentMetadata found.";
        assert_eq!(parse(log, |_| false).missing_files, ["documentmetadata-support.ltx"]);
        assert_eq!(parse("sRGB.icc not found.\n", |_| false).missing_files, ["sRGB.icc"]);
    }

    #[test]
    fn reads_missfont_log() {
        assert_eq!(missing_fonts("mktextfm ts1-qtmr\nmktextfm ts1-qtmr\nmktextfm txsyc\n"), ["ts1-qtmr.tfm", "txsyc.tfm"]);
    }

    #[test]
    fn detects_cut_off_logs() {
        assert!(is_complete("...\nHere is how much of LuaTeX's memory you used:\n"));
        assert!(!is_complete("LaTeX Font Info:    Font shape `U/ntxmia/m/it' will be\nLaT"));
    }

    #[test]
    fn detects_makeindex_inputs() {
        assert!(needs_makeindex("x\n\\openout5 = main.acn\ny"));
        assert!(needs_makeindex("\\openout2 = `main.idx'."));
        assert!(needs_makeindex("\\openout3 = `main.nlo'."));
        assert!(!needs_makeindex("\\openout1 = main.aux"));
    }
}
