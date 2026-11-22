//! Jumps between source lines and PDF positions using the engine's
//! `.synctex.gz`. TinyTeX ships no `synctex` program, so the file is read here.
//!
//! Records look like `(tag,line:h,v:W,H,D` (boxes) or `xtag,line:h,v` (points),
//! grouped into pages by `{n` … `}n`. Coordinates are TeX scaled points from
//! the top-left corner of the paper; they are converted to PDF points (bp).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::Serialize;

#[derive(Debug, Clone, Copy)]
struct Record {
    kind: u8,
    tag: u32,
    line: u32,
    h: f64,
    v: f64,
    width: f64,
    height: f64,
    depth: f64,
}

impl Record {
    fn is_box(&self) -> bool {
        matches!(self.kind, b'(' | b'h' | b'[' | b'v')
    }
}

#[derive(Debug, Default)]
pub struct Synctex {
    inputs: HashMap<u32, String>,
    /// Records per page; index 0 is page 1.
    pages: Vec<Vec<Record>>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    /// Input path as recorded by TeX.
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfLocation {
    /// 1-based.
    pub page: u32,
    /// Top-left corner and size of the matched line, in PDF points from the
    /// top-left corner of the page.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Synctex {
    pub fn parse(text: &str) -> Self {
        let mut synctex = Self::default();
        // Scaled points to big points, with the file's unit and magnification.
        let mut scale = 72.0 / 72.27 / 65536.0;
        let mut current: Option<usize> = None;
        for line in text.lines() {
            let Some(&kind) = line.as_bytes().first() else { continue };
            match kind {
                b'I' => {
                    if let Some((tag, path)) = line.strip_prefix("Input:").and_then(|rest| rest.split_once(':')) {
                        if let Ok(tag) = tag.parse() {
                            synctex.inputs.insert(tag, path.to_owned());
                        }
                    }
                }
                b'U' => {
                    if let Some(unit) = line.strip_prefix("Unit:").and_then(|u| u.trim().parse::<f64>().ok()) {
                        scale *= unit;
                    }
                }
                b'M' => {
                    if let Some(mag) = line.strip_prefix("Magnification:").and_then(|m| m.trim().parse::<f64>().ok()) {
                        scale *= mag / 1000.0;
                    }
                }
                b'{' => {
                    let page: usize = line[1..].trim().parse().unwrap_or(synctex.pages.len() + 1);
                    if synctex.pages.len() < page {
                        synctex.pages.resize_with(page, Vec::new);
                    }
                    current = Some(page - 1);
                }
                b'}' => current = None,
                b'(' | b'h' | b'[' | b'v' | b'x' | b'k' | b'g' | b'$' | b'r' => {
                    if let (Some(page), Some(record)) = (current, parse_record(kind, &line[1..], scale)) {
                        synctex.pages[page].push(record);
                    }
                }
                _ => {}
            }
        }
        synctex
    }

    /// Source line at a point of a page (1-based, PDF points from top-left).
    pub fn edit(&self, page: u32, x: f64, y: f64) -> Option<SourceLocation> {
        let records = self.pages.get(page.checked_sub(1)? as usize)?;
        let in_inputs = |r: &&Record| self.inputs.contains_key(&r.tag) && r.line > 0;
        // The innermost horizontal box around the point is the clicked text line…
        let line_box = records
            .iter()
            .filter(in_inputs)
            .filter(|r| matches!(r.kind, b'(' | b'h'))
            .filter(|r| r.h <= x && x <= r.h + r.width && r.v - r.height <= y && y <= r.v + r.depth)
            .min_by(|a, b| (a.width * (a.height + a.depth)).total_cmp(&(b.width * (b.height + b.depth))));
        // …and the last record on its baseline left of the point is the clicked word.
        let record = match line_box {
            Some(b) => records
                .iter()
                .filter(in_inputs)
                .filter(|r| (r.v - b.v).abs() < 0.5 && r.h >= b.h && r.h <= x)
                .max_by(|a, b| a.h.total_cmp(&b.h))
                .unwrap_or(b),
            None => records.iter().filter(in_inputs).min_by(|a, b| distance(a, x, y).total_cmp(&distance(b, x, y)))?,
        };
        Some(SourceLocation { file: self.inputs[&record.tag].clone(), line: record.line })
    }

    /// PDF position of a source line. `is_file` decides which recorded inputs
    /// mean the requested file. Takes the line itself or else the next one
    /// that produced output (comments and blank lines produce none).
    pub fn view(&self, is_file: impl Fn(&str) -> bool, line: u32) -> Option<PdfLocation> {
        let tags: Vec<u32> = self.inputs.iter().filter(|(_, path)| is_file(path)).map(|(&tag, _)| tag).collect();
        let target = self.pages.iter().flatten().filter(|r| tags.contains(&r.tag) && r.line >= line).map(|r| r.line).min()?;
        let (page, records) =
            self.pages.iter().enumerate().find(|(_, records)| records.iter().any(|r| tags.contains(&r.tag) && r.line == target))?;
        let matches: Vec<&Record> = records.iter().filter(|r| tags.contains(&r.tag) && r.line == target).collect();
        let first = matches.iter().copied().find(|r| r.kind == b'(').unwrap_or(matches[0]);
        // A point record: highlight the text line around it.
        let area = if first.is_box() && first.width > 0.0 {
            first
        } else {
            records
                .iter()
                .filter(|r| r.kind == b'(' && (r.v - first.v).abs() < 0.5 && r.h <= first.h && first.h <= r.h + r.width)
                .min_by(|a, b| a.width.total_cmp(&b.width))
                .unwrap_or(first)
        };
        Some(PdfLocation {
            page: page as u32 + 1,
            x: area.h,
            y: area.v - area.height,
            width: area.width,
            height: (area.height + area.depth).max(1.0),
        })
    }
}

fn distance(r: &Record, x: f64, y: f64) -> f64 {
    // Lines are far apart vertically but long horizontally: weigh height more.
    let dy = if y < r.v - r.height {
        r.v - r.height - y
    } else if y > r.v + r.depth {
        y - r.v - r.depth
    } else {
        0.0
    };
    let dx = if x < r.h {
        r.h - x
    } else if x > r.h + r.width {
        x - r.h - r.width
    } else {
        0.0
    };
    dy * 10.0 + dx
}

/// `tag,line[,column]:h,v[:W[,H,D]]`
fn parse_record(kind: u8, body: &str, scale: f64) -> Option<Record> {
    let mut parts = body.split(':');
    let mut link = parts.next()?.split(',');
    let tag = link.next()?.parse().ok()?;
    let line = link.next()?.parse().ok()?;
    let mut position = parts.next()?.split(',');
    let h = position.next()?.parse::<f64>().ok()? * scale;
    let v = position.next()?.parse::<f64>().ok()? * scale;
    let mut size = parts.next().into_iter().flat_map(|s| s.split(',')).map(|n| n.parse::<f64>().unwrap_or(0.0) * scale);
    let (width, height, depth) = (size.next().unwrap_or(0.0), size.next().unwrap_or(0.0), size.next().unwrap_or(0.0));
    Some(Record { kind, tag, line, h, v, width, height, depth })
}

/// Normalized form of a path for comparisons: forward slashes, no `.` or `..`
/// segments, and case-insensitive on Windows.
pub fn normalize(path: &str) -> String {
    // `canonicalize` on Windows returns verbatim paths (`\\?\C:\…`).
    let path = path.strip_prefix(r"\\?\").or_else(|| path.strip_prefix("//?/")).unwrap_or(path);
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    let joined = parts.join("/");
    if cfg!(windows) {
        joined.to_lowercase()
    } else {
        joined
    }
}

/// The parsed file of the last build, re-read when the build changes it.
#[derive(Default)]
pub struct SynctexCache {
    current: Mutex<Option<(PathBuf, SystemTime, Arc<Synctex>)>>,
}

impl SynctexCache {
    pub async fn get(&self, file: &Path) -> Result<Arc<Synctex>, String> {
        let modified = std::fs::metadata(file).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
        if let Some((path, time, synctex)) = &*self.current.lock().unwrap() {
            if path == file && *time == modified {
                return Ok(synctex.clone());
            }
        }
        let source = file.to_owned();
        let synctex = tokio::task::spawn_blocking(move || -> Result<Synctex, String> {
            let mut text = String::new();
            let compressed = std::fs::File::open(&source).map_err(|e| e.to_string())?;
            flate2::read::GzDecoder::new(compressed).read_to_string(&mut text).map_err(|e| e.to_string())?;
            Ok(Synctex::parse(&text))
        })
        .await
        .map_err(|e| e.to_string())??;
        let synctex = Arc::new(synctex);
        *self.current.lock().unwrap() = Some((file.to_owned(), modified, synctex.clone()));
        Ok(synctex)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two lines of text in main.tex (lines 5 and 6) and one in an included chapter.
    const FILE: &str = "\
SyncTeX Version:1
Input:1:/build/main.tex
Input:2:/project/./chapter/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{1
[1,5:4736286,4736286:30000000,40000000,0
(1,5:4736286,6000000:30000000,500000,100000
x1,5:4736286,6000000
k1,5:9000000,6000000:100000
x1,6:12000000,6000000
)
(1,7:4736286,8000000:30000000,500000,100000
x1,7:4736286,8000000
)
]
}1
{2
(2,3:4736286,6000000:30000000,500000,100000
x2,3:4736286,6000000
)
}2
";

    fn bp(sp: f64) -> f64 {
        sp * 72.0 / 72.27 / 65536.0
    }

    #[test]
    fn finds_the_source_of_a_click() {
        let synctex = Synctex::parse(FILE);
        // Right of the word that starts on line 6 of the same paragraph line.
        let at = synctex.edit(1, bp(13_000_000.0), bp(5_900_000.0)).unwrap();
        assert_eq!(at, SourceLocation { file: "/build/main.tex".into(), line: 6 });
        // Left part of the same text line.
        assert_eq!(synctex.edit(1, bp(5_000_000.0), bp(5_900_000.0)).unwrap().line, 5);
        // Page 2 belongs to the chapter.
        assert_eq!(synctex.edit(2, bp(5_000_000.0), bp(5_900_000.0)).unwrap().file, "/project/./chapter/intro.tex");
    }

    #[test]
    fn finds_the_pdf_position_of_a_line() {
        let synctex = Synctex::parse(FILE);
        let main = |p: &str| p == "/build/main.tex";
        let at = synctex.view(main, 7).unwrap();
        assert_eq!(at.page, 1);
        assert!((at.y - bp(8_000_000.0 - 500_000.0)).abs() < 1e-6);
        // Line 4 produced nothing; the next line with output is used.
        assert_eq!(synctex.view(main, 4).unwrap().y, synctex.view(main, 5).unwrap().y);

        let chapter = |p: &str| normalize(p) == normalize("/project/chapter/intro.tex");
        assert_eq!(synctex.view(chapter, 1).unwrap().page, 2);
        assert!(synctex.view(main, 99).is_none());
    }

    #[test]
    fn normalizes_paths() {
        if cfg!(windows) {
            assert_eq!(normalize(r"\\?\C:\Builds\main.tex"), normalize("c:/builds/./main.tex"));
        }
        assert_eq!(normalize("/p/./chapter/../main.tex"), normalize("/p/main.tex"));
    }

    /// Round trip on a real build: `SYNCTEX_FILE=…/main.synctex.gz cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn round_trips_on_a_real_file() {
        let file = PathBuf::from(std::env::var("SYNCTEX_FILE").expect("SYNCTEX_FILE"));
        let synctex = SynctexCache::default().get(&file).await.unwrap();
        let main = normalize(&file.with_extension("").with_extension("tex").to_string_lossy());
        let is_main = |p: &str| normalize(p) == main;
        let mut checked = 0;
        for line in (230..400).step_by(7) {
            let Some(at) = synctex.view(is_main, line) else { continue };
            let back = synctex.edit(at.page, at.x + 2.0, at.y + at.height / 2.0).unwrap();
            let name = back.file.rsplit('/').next().unwrap().to_owned();
            println!("line {line} -> page {} ({:.0},{:.0} {:.0}x{:.0}) -> {name}:{}", at.page, at.x, at.y, at.width, at.height, back.line);
            checked += 1;
        }
        assert!(checked > 0);
    }
}
