//! Reads a project's structure for the outline and for completions: sections
//! in document order (following `\input`/`\include`/`\subfile` from the main
//! file), labels from every `.tex` file and entries from every `.bib` file.

use std::collections::HashSet;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use super::files::{self, TreeEntry};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    pub outline: Vec<Heading>,
    pub labels: Vec<Label>,
    pub citations: Vec<Citation>,
    /// Files pulled in with `\include` (not `\input`); only those can be
    /// compiled alone via `\includeonly`.
    pub includes: Vec<String>,
    /// Where each file of the outline is read in, in reading order; a file
    /// read twice is listed twice. Lets the outline move whole chapter files.
    pub inclusions: Vec<Inclusion>,
    /// Where `\appendix` switches to the appendix, if the document has one.
    pub appendix: Option<Appendix>,
    /// Spelling dictionary for the document's main language (from babel or
    /// polyglossia), e.g. "de".
    pub language: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    /// 0 = part, 1 = chapter, 2 = section … 5 = paragraph.
    pub level: u8,
    /// As LaTeX numbers it, e.g. "2.1", "A" or "IV"; `None` for `\section*` and below `secnumdepth`.
    pub number: Option<String>,
    pub title: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inclusion {
    /// The file read in.
    pub file: String,
    /// The file whose line reads it in, and that line.
    pub parent: String,
    pub line: u32,
    /// "input", "include" or "subfile".
    pub command: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Appendix {
    /// The file and line of `\appendix`.
    pub file: String,
    pub line: u32,
    /// How many headings of the outline come before it.
    pub index: usize,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub key: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub key: String,
    pub kind: String,
    pub title: String,
    pub author: String,
    /// The year, also from a biblatex `date`; empty where neither is given.
    pub year: String,
    /// The `.bib` file the entry is in.
    pub file: String,
}

const HEADINGS: &[(&str, u8)] = &[("part", 0), ("chapter", 1), ("section", 2), ("subsection", 3), ("subsubsection", 4), ("paragraph", 5)];

static HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{").unwrap());
/// What changes the numbering: the appendix, book matter, and how deep headings are numbered.
static NUMBERING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\\(?:(appendix|frontmatter|mainmatter|backmatter)\b|setcounter\s*\{secnumdepth\}\s*\{\s*(-?\d+)\s*\})").unwrap()
});
static DOCUMENT_CLASS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}").unwrap());
static INCLUDE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\(input|include|subfile)\s*\{([^}]+)\}").unwrap());
static LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\label\s*\{([^}]+)\}").unwrap());
static BIB_ENTRY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@(\w+)\s*[{(]\s*([^,\s]+)\s*,").unwrap());
static BIB_FIELD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\b(title|author|year|date)\s*=\s*(?:[{"]|(\d{4}))"#).unwrap());

pub fn scan(root: &Path, main: Option<&str>) -> Result<ProjectScan, String> {
    let tree = files::tree(root)?;
    let mut files = Vec::new();
    collect_files(&tree, &mut files);

    let mut result = ProjectScan::default();
    if let Some(main) = main {
        let base = main.rsplit_once('/').map_or("", |(dir, _)| dir).to_owned();
        let mut seen = HashSet::new();
        let text = std::fs::read_to_string(root.join(main)).unwrap_or_default();
        let mut numbering = Numbering::for_class(DOCUMENT_CLASS.captures(&text).map(|c| c[1].trim().to_owned()).as_deref());
        outline(root, main, &base, &mut seen, &mut numbering, &mut result);
        result.language = document_language(&text).map(str::to_owned);
    }
    for file in files.iter().filter(|f| f.ends_with(".tex")) {
        let Ok(text) = std::fs::read_to_string(root.join(file)) else { continue };
        for (number, line) in code_lines(&text) {
            for c in LABEL.captures_iter(line) {
                result.labels.push(Label { key: c[1].trim().to_owned(), file: file.clone(), line: number });
            }
        }
    }
    for file in files.iter().filter(|f| f.ends_with(".bib")) {
        if let Ok(text) = std::fs::read_to_string(root.join(file)) {
            result.citations.extend(parse_bib(&text).into_iter().map(|c| Citation { file: file.clone(), ..c }));
        }
    }
    Ok(result)
}

fn collect_files(entries: &[TreeEntry], out: &mut Vec<String>) {
    for entry in entries {
        if entry.is_dir {
            collect_files(&entry.children, out);
        } else {
            out.push(entry.path.clone());
        }
    }
}

/// Headings of `file` and the files it includes, in reading order. Included
/// paths are relative to the main file's folder (`base`), as TeX resolves them.
fn outline(root: &Path, file: &str, base: &str, seen: &mut HashSet<String>, numbering: &mut Numbering, out: &mut ProjectScan) {
    if !seen.insert(file.to_owned()) {
        return;
    }
    let Ok(text) = std::fs::read_to_string(root.join(file)) else { return };
    for (number, line) in code_lines(&text) {
        // Headings, includes and numbering changes in the order they appear on the line.
        let mut events: Vec<(usize, Event)> = Vec::new();
        for c in HEADING.captures_iter(line) {
            let whole = c.get(0).unwrap();
            if let Some(title) = braced(&line[whole.end()..]) {
                let level = HEADINGS.iter().find(|(name, _)| *name == &c[1]).map_or(2, |(_, l)| *l);
                events.push((whole.start(), Event::Heading(level, &c[2] == "*", clean_title(&title))));
            }
        }
        for c in INCLUDE.captures_iter(line) {
            events.push((c.get(0).unwrap().start(), Event::Include(c.get(1).unwrap().as_str(), c[2].trim().to_owned())));
        }
        for c in NUMBERING.captures_iter(line) {
            let change = match (c.get(1).map(|m| m.as_str()), c.get(2)) {
                (Some(matter), _) => Change::Matter(matter.to_owned()),
                (None, Some(depth)) => Change::Depth(depth.as_str().parse().unwrap_or(3)),
                _ => continue,
            };
            events.push((c.get(0).unwrap().start(), Event::Numbering(change)));
        }
        events.sort_by_key(|(at, _)| *at);
        for (_, event) in events {
            match event {
                Event::Heading(level, starred, title) => {
                    let heading_number = numbering.next(level, starred);
                    out.outline.push(Heading { level, number: heading_number, title, file: file.to_owned(), line: number });
                }
                Event::Numbering(change) => {
                    if matches!(&change, Change::Matter(matter) if matter == "appendix") && out.appendix.is_none() {
                        out.appendix = Some(Appendix { file: file.to_owned(), line: number, index: out.outline.len() });
                    }
                    numbering.apply(change);
                }
                Event::Include(command, target) => {
                    let is_include = command == "include";
                    let mut path = if base.is_empty() { target.clone() } else { format!("{base}/{target}") };
                    if !path.ends_with(".tex") {
                        path.push_str(".tex");
                    }
                    let path = path.trim_start_matches("./").replace("/./", "/");
                    if files::resolve(root, &path).is_ok() {
                        out.inclusions.push(Inclusion {
                            file: path.clone(),
                            parent: file.to_owned(),
                            line: number,
                            command: command.to_owned(),
                        });
                        if is_include {
                            out.includes.push(path.clone());
                        }
                        outline(root, &path, base, seen, numbering, out);
                    }
                }
            }
        }
    }
}

enum Event<'a> {
    /// Level, whether starred (`\section*`), title.
    Heading(u8, bool, String),
    /// The command (`input`, `include` or `subfile`) and the target.
    Include(&'a str, String),
    Numbering(Change),
}

enum Change {
    /// `appendix`, `frontmatter`, `mainmatter` or `backmatter`.
    Matter(String),
    /// `\setcounter{secnumdepth}{…}`.
    Depth(i32),
}

/// Heading numbers as the standard classes (and KOMA-Script, memoir) set them.
#[derive(Debug)]
struct Numbering {
    /// Counters by level: part, chapter, section, subsection, subsubsection, paragraph.
    counters: [u32; 6],
    /// book, report and the like: sections are numbered within chapters.
    chapters: bool,
    /// Headings up to this LaTeX level (chapter 0, section 1, …) get a number.
    depth: i32,
    appendix: bool,
    /// Between `\frontmatter` and `\mainmatter`, or after `\backmatter`: chapters without numbers.
    unnumbered_matter: bool,
}

impl Numbering {
    fn for_class(class: Option<&str>) -> Self {
        let chapters = class.is_some_and(|c| ["book", "report", "scrbook", "scrreprt", "memoir"].contains(&c));
        Numbering { counters: [0; 6], chapters, depth: if chapters { 2 } else { 3 }, appendix: false, unnumbered_matter: false }
    }

    fn apply(&mut self, change: Change) {
        match change {
            Change::Depth(depth) => self.depth = depth,
            Change::Matter(matter) => match matter.as_str() {
                "appendix" => {
                    self.appendix = true;
                    // The level the appendix numbers with letters starts again, and below it.
                    let from = if self.chapters { 1 } else { 2 };
                    self.counters[from..].fill(0);
                }
                "mainmatter" => self.unnumbered_matter = false,
                _ => self.unnumbered_matter = true,
            },
        }
    }

    /// The number of the next heading at `level`, counting it.
    fn next(&mut self, level: u8, starred: bool) -> Option<String> {
        let level = usize::from(level.min(5));
        // LaTeX's own levels: part is -1 with chapters and 0 without, chapter 0, section 1, …
        let latex = if level == 0 {
            if self.chapters {
                -1
            } else {
                0
            }
        } else {
            level as i32 - 1
        };
        let matter = self.unnumbered_matter && level <= 1;
        if starred || latex > self.depth || matter {
            return None;
        }
        self.counters[level] += 1;
        // A part leaves chapters and sections counting on.
        if level > 0 {
            self.counters[level + 1..].fill(0);
        }
        Some(self.format(level))
    }

    fn format(&self, level: usize) -> String {
        let n = self.counters[level];
        match level {
            0 => roman(n),
            1 if self.appendix => alph(n),
            1 => n.to_string(),
            2 if !self.chapters => {
                if self.appendix {
                    alph(n)
                } else {
                    n.to_string()
                }
            }
            _ => format!("{}.{n}", self.format(level - 1)),
        }
    }
}

fn roman(mut n: u32) -> String {
    const DIGITS: [(u32, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, digit) in DIGITS {
        while n >= value {
            out.push_str(digit);
            n -= value;
        }
    }
    out
}

/// 1 → A, 26 → Z, as LaTeX's `\Alph` (which stops at Z).
fn alph(n: u32) -> String {
    char::from_u32(u32::from(b'A') + n.saturating_sub(1).min(25)).map_or_else(String::new, String::from)
}

/// Main language of a document: polyglossia's `\setmainlanguage`, else the
/// last language among the options of babel and the document class (babel's
/// own rule: the last one listed is the main language).
fn document_language(text: &str) -> Option<&'static str> {
    static MAIN_LANGUAGE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\\set(?:main|default)language\s*(?:\[[^\]]*\])?\s*\{(\w+)\}").unwrap());
    // babel options, and document class options (babel takes global options too).
    static OPTIONS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\\(?:usepackage\s*\[([^\]]*)\]\s*\{babel\}|documentclass\s*\[([^\]]*)\])").unwrap());
    let preamble =
        code_lines(text).map(|(_, line)| line).take_while(|line| !line.contains(r"\begin{document}")).collect::<Vec<_>>().join("\n");
    if let Some(c) = MAIN_LANGUAGE.captures(&preamble) {
        return crate::spell::dictionary_for(&c[1]);
    }
    OPTIONS
        .captures_iter(&preamble)
        .flat_map(|c| {
            let options = c.get(1).or_else(|| c.get(2)).map_or("", |m| m.as_str());
            options.split(',').map(|o| o.trim().to_owned()).collect::<Vec<_>>()
        })
        .filter_map(|option| crate::spell::dictionary_for(&option))
        .last()
}

/// Lines with their 1-based numbers, comments removed.
fn code_lines(text: &str) -> impl Iterator<Item = (u32, &str)> {
    text.lines().enumerate().map(|(i, line)| {
        let mut end = line.len();
        let bytes = line.as_bytes();
        for (at, &b) in bytes.iter().enumerate() {
            if b == b'%' && (at == 0 || bytes[at - 1] != b'\\') {
                end = at;
                break;
            }
        }
        (i as u32 + 1, &line[..end])
    })
}

/// Content up to the closing brace matching an already consumed `{`.
fn braced(rest: &str) -> Option<String> {
    let mut depth = 1;
    for (at, c) in rest.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(rest[..at].to_owned());
                }
            }
            _ => {}
        }
    }
    None
}

/// Headings shown as plain text: `\emph{New} ideas` becomes "New ideas".
fn clean_title(title: &str) -> String {
    static COMMAND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\[a-zA-Z]+\*?\s*").unwrap());
    let plain = COMMAND.replace_all(title, "").replace(['{', '}'], "").replace('~', " ");
    plain.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_bib(text: &str) -> Vec<Citation> {
    let entries: Vec<_> = BIB_ENTRY.captures_iter(text).collect();
    entries
        .iter()
        .enumerate()
        .filter(|(_, c)| !["comment", "string", "preamble"].contains(&c[1].to_lowercase().as_str()))
        .map(|(i, c)| {
            let start = c.get(0).unwrap().end();
            let end = entries.get(i + 1).map_or(text.len(), |n| n.get(0).unwrap().start());
            let body = &text[start..end];
            let mut citation = Citation {
                key: c[2].to_owned(),
                kind: c[1].to_lowercase(),
                title: String::new(),
                author: String::new(),
                year: String::new(),
                file: String::new(),
            };
            for field in BIB_FIELD.captures_iter(body) {
                let value_start = field.get(0).unwrap().end();
                let open = body[..value_start].chars().last();
                // A bare number: `year = 1984`.
                let value = if let Some(number) = field.get(2) {
                    Some(number.as_str().to_owned())
                } else if open == Some('"') {
                    body[value_start..].split('"').next().map(str::to_owned)
                } else {
                    braced(&body[value_start..])
                };
                let value = clean_title(&value.unwrap_or_default());
                match field[1].to_lowercase().as_str() {
                    "title" if citation.title.is_empty() => citation.title = value,
                    "author" if citation.author.is_empty() => citation.author = value,
                    "year" | "date" if citation.year.is_empty() => citation.year = value.chars().take(4).collect(),
                    _ => {}
                }
            }
            citation
        })
        .collect()
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn detects_the_main_language() {
        assert_eq!(document_language("\\documentclass{article}\n\\usepackage[english,ngerman]{babel}"), Some("de"));
        assert_eq!(document_language("\\documentclass[british]{article}\n\\usepackage{babel}"), Some("en-GB"));
        assert_eq!(document_language("\\usepackage{polyglossia}\n\\setmainlanguage[variant=uk]{french}"), Some("fr"));
        assert_eq!(document_language("% \\usepackage[ngerman]{babel}\n\\usepackage[T1]{fontenc}"), None);
        // After \begin{document} babel options no longer count.
        assert_eq!(document_language("\\begin{document}\n\\usepackage[ngerman]{babel}"), None);
    }

    #[test]
    fn numbers_headings_as_latex_does() {
        let root = TestDir::new("numbers");
        let numbers = |main: &str| {
            std::fs::write(root.join("main.tex"), main).unwrap();
            std::fs::write(root.join("anhang.tex"), "\\section{Anhang}\n\\subsection{Daten}\n").unwrap();
            let scan = scan(&root, Some("main.tex")).unwrap();
            scan.outline.into_iter().map(|h| h.number.unwrap_or_default()).collect::<Vec<_>>()
        };
        let article = numbers(
            "\\documentclass[12pt]{article}\n\\setcounter{secnumdepth}{2}\n\\section*{Kurzfassung}\n\\section{Beispiel}\n\
             \\subsection{Formeln}\n\\subsubsection{Zu tief}\n\\section{Petar}\n\\subsection{Herkunft}\n\\appendix\n\\input{anhang}\n",
        );
        let book = numbers(
            "\\documentclass{book}\n\\frontmatter\n\\chapter{Vorwort}\n\\mainmatter\n\\part{Grundlagen}\n\\chapter{Einleitung}\n\
             \\section{Ziel}\n\\part{Hauptteil}\n\\chapter{Methoden}\n\\section{Daten}\n\\appendix\n\\chapter{Tabellen}\n\\section{Mehr}\n",
        );

        assert_eq!(article, ["", "1", "1.1", "", "2", "2.1", "A", "A.1"]);
        assert_eq!(book, ["", "I", "1", "1.1", "II", "2", "2.1", "A", "A.1"]);
    }

    #[test]
    fn follows_includes_in_reading_order() {
        let root = TestDir::new("scan");
        std::fs::create_dir_all(root.join("chapter")).unwrap();
        std::fs::write(
            root.join("main.tex"),
            "\\chapter{Einleitung}\\label{ch:intro}\n% \\section{Auskommentiert}\n\\input{chapter/methods}\n\\include{chapter/end}\n\\chapter*{Fazit \\emph{und} Ausblick}\n",
        )
        .unwrap();
        std::fs::write(root.join("chapter/methods.tex"), "\\section[kurz]{Methoden}\n\\label{sec:m}\n").unwrap();
        std::fs::write(
            root.join("refs.bib"),
            "@book{knuth84,\n  title = {The {\\TeX}book},\n  author = \"Donald Knuth\",\n  date = {1984-01},\n}\n@comment{x,}\n@article{doe, title={A}, year = 2001}\n",
        )
        .unwrap();

        let scan = scan(&root, Some("main.tex")).unwrap();

        let titles: Vec<_> = scan.outline.iter().map(|h| (h.level, h.title.as_str(), h.file.as_str())).collect();
        assert_eq!(titles, [(1, "Einleitung", "main.tex"), (2, "Methoden", "chapter/methods.tex"), (1, "Fazit und Ausblick", "main.tex")]);
        let labels: Vec<_> = scan.labels.iter().map(|l| (l.key.as_str(), l.line)).collect();
        assert!(labels.contains(&("ch:intro", 1)) && labels.contains(&("sec:m", 2)));
        assert_eq!(scan.includes, ["chapter/end.tex"]);
        assert_eq!(scan.citations.len(), 2);
        assert_eq!((scan.citations[0].year.as_str(), scan.citations[0].file.as_str()), ("1984", "refs.bib"));
        assert_eq!(scan.citations[1].year, "2001");
        assert_eq!((scan.citations[0].title.as_str(), scan.citations[0].author.as_str()), ("The book", "Donald Knuth"));
    }
}
