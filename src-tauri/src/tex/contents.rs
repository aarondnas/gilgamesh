//! The table of contents as the last build set it: every entry LaTeX writes
//! into the `.aux` file (`\@writefile{toc}{\contentsline …}`), with its number
//! as the document prints it (also `\Roman`, appendix letters, …) and its page
//! (also roman ones such as "iii" in the front matter). Chapters brought in
//! with `\include` have `.aux` files of their own, read where they are input.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentsEntry {
    /// The sectioning level's name, e.g. "section" or "chapter".
    pub level: String,
    /// `None` for unnumbered entries (`\section*` added with `\addcontentsline`, lists of figures, …).
    pub number: Option<String>,
    /// As written to the `.aux` file, LaTeX commands and all.
    pub title: String,
    pub page: String,
}

/// Includes nested deeper than this are a loop.
const MAX_DEPTH: usize = 8;

/// The entries of `aux` and the `.aux` files it inputs, in document order.
pub fn read(aux: &Path) -> Vec<ContentsEntry> {
    let mut entries = Vec::new();
    collect(aux, 0, &mut entries);
    entries
}

fn collect(aux: &Path, depth: usize, out: &mut Vec<ContentsEntry>) {
    let Ok(bytes) = std::fs::read(aux) else { return };
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("\\@input{") {
            if depth < MAX_DEPTH {
                if let (Some(name), Some(dir)) = (rest.strip_suffix('}'), aux.parent()) {
                    collect(&dir.join(name), depth + 1, out);
                }
            }
        } else if let Some(entry) = line.strip_prefix("\\@writefile{toc}").and_then(parse_entry) {
            out.push(entry);
        }
    }
}

/// `{\contentsline {section}{\numberline {1}Title}{3}{section.1}…}`.
fn parse_entry(text: &str) -> Option<ContentsEntry> {
    let (body, _) = group(text)?;
    let rest = body.trim_start().strip_prefix("\\contentsline")?;
    let (level, rest) = group(rest)?;
    let (title, rest) = group(rest)?;
    let (page, _) = group(rest)?;
    let title = title.trim();
    let (number, title) = match title.strip_prefix("\\numberline") {
        Some(numbered) => {
            let (number, title) = group(numbered)?;
            (Some(number.trim().to_owned()).filter(|n| !n.is_empty()), title.trim())
        }
        None => (None, title),
    };
    Some(ContentsEntry { level: level.trim().to_owned(), number, title: title.to_owned(), page: page.trim().to_owned() })
}

/// The content of the braced group `text` starts with (after spaces), and what follows it.
fn group(text: &str) -> Option<(&str, &str)> {
    let text = text.trim_start();
    if !text.starts_with('{') {
        return None;
    }
    let mut depth = 0usize;
    let mut escaped = false;
    for (i, c) in text.char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' => escaped = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&text[1..i], &text[i + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::util::fs::TestDir;

    #[test]
    fn reads_numbers_and_pages_through_included_files() {
        let dir = TestDir::new("contents");
        std::fs::create_dir_all(dir.join("abschnitte")).unwrap();
        std::fs::write(
            dir.join("main.aux"),
            "\\relax\n\
             \\@writefile{toc}{\\contentsline {section}{Kurzfassung}{i}{section*.1}\\protected@file@percent }\n\
             \\@writefile{lof}{\\contentsline {figure}{\\numberline {1}Bild}{2}{figure.1}}\n\
             \\@input{abschnitte/kapitel.aux}\n\
             \\@writefile{toc}{\\contentsline {section}{\\numberline {A}Anhang mit \\emph {Betonung}}{IV}{appendix.A}\\protected@file@percent }\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("abschnitte/kapitel.aux"),
            "\\@writefile{toc}{\\contentsline {section}{\\numberline {II}Zweites}{3}{section.2}\\protected@file@percent }\n\
             \\@writefile{toc}{\\contentsline {subsection}{\\numberline {II.1}Teil}{3}{subsection.2.1}\\protected@file@percent }\n",
        )
        .unwrap();

        let entries = read(&dir.join("main.aux"));

        let summary: Vec<_> = entries.iter().map(|e| (e.level.as_str(), e.number.as_deref(), e.title.as_str(), e.page.as_str())).collect();
        assert_eq!(
            summary,
            [
                ("section", None, "Kurzfassung", "i"),
                ("section", Some("II"), "Zweites", "3"),
                ("subsection", Some("II.1"), "Teil", "3"),
                ("section", Some("A"), "Anhang mit \\emph {Betonung}", "IV"),
            ]
        );
        assert!(read(Path::new("does/not/exist.aux")).is_empty());
    }
}

#[cfg(test)]
mod real_build {
    /// Prints the entries of a real build: `GILGAMESH_AUX=…/main.aux cargo test -- --ignored real_build --nocapture`.
    #[test]
    #[ignore]
    fn prints_a_real_build() {
        let aux = std::env::var("GILGAMESH_AUX").expect("GILGAMESH_AUX");
        for e in super::read(std::path::Path::new(&aux)) {
            println!("{:<12} {:<6} {:<45} {}", e.level, e.number.unwrap_or_default(), e.title, e.page);
        }
    }
}
