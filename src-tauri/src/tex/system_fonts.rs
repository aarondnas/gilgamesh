//! The font families installed on the system, which XeLaTeX and LuaLaTeX
//! (fontspec) can set text in by name. pdfLaTeX cannot use them.

use std::collections::BTreeSet;

/// The installed OpenType and TrueType families, sorted, each once.
pub fn families() -> Vec<String> {
    let mut families = BTreeSet::new();
    for entry in platform::entries() {
        families.extend(families_of(&entry));
    }
    families.into_iter().collect()
}

/// Style words at the end of a registered name, which belong to the face, not the family.
const STYLES: &[&str] = &[
    "Regular",
    "Bold",
    "Italic",
    "Oblique",
    "Light",
    "Semilight",
    "SemiLight",
    "Semibold",
    "SemiBold",
    "Demibold",
    "Medium",
    "Black",
    "Heavy",
    "Thin",
    "ExtraLight",
    "Extralight",
    "UltraLight",
    "ExtraBold",
    "UltraBold",
];

/// The families of a registered font, e.g. "Cambria & Cambria Math (TrueType)" → Cambria, Cambria Math.
/// Raster fonts ("Modern (Plotter)", "Courier 10,12,15") are no use to fontspec and give none.
fn families_of(entry: &str) -> Vec<String> {
    let Some(name) = entry.strip_suffix(" (TrueType)").or_else(|| entry.strip_suffix(" (OpenType)")) else {
        return Vec::new();
    };
    name.split(" & ")
        .filter_map(|face| {
            let mut words: Vec<&str> = face.split_whitespace().collect();
            while words.len() > 1 && STYLES.contains(words.last().unwrap()) {
                words.pop();
            }
            let family = words.join(" ");
            (!family.is_empty()).then_some(family)
        })
        .collect()
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ,
    };

    const FONTS: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";

    /// The names under which fonts are registered, for all users and for this one.
    pub fn entries() -> Vec<String> {
        let mut names = Vec::new();
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            names.extend(value_names(root, FONTS));
        }
        names
    }

    fn value_names(root: HKEY, path: &str) -> Vec<String> {
        let path: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let mut key: HKEY = std::ptr::null_mut();
        let mut names = Vec::new();
        // SAFETY: `path` is NUL-terminated, `name` is as long as passed, and `key` is closed below.
        unsafe {
            if RegOpenKeyExW(root, path.as_ptr(), 0, KEY_READ, &mut key) != 0 {
                return names;
            }
            let mut name = [0u16; 512];
            for index in 0.. {
                let mut length = name.len() as u32;
                let status = RegEnumValueW(
                    key,
                    index,
                    name.as_mut_ptr(),
                    &mut length,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                );
                if status != 0 {
                    break;
                }
                names.push(String::from_utf16_lossy(&name[..length as usize]));
            }
            RegCloseKey(key);
        }
        names
    }
}

#[cfg(not(windows))]
mod platform {
    /// The fonts fontconfig knows, named as Windows registers them ("Family (TrueType)"),
    /// so `families_of` reads both alike. Without fontconfig's `fc-list`, none.
    pub fn entries() -> Vec<String> {
        let output = std::process::Command::new("fc-list").args(["--format", "%{fontformat}\t%{family[0]}\n"]).output();
        output.map(|output| parse(&String::from_utf8_lossy(&output.stdout))).unwrap_or_default()
    }

    /// `fc-list` lines "format<TAB>family"; only OpenType (CFF) and TrueType are of use to fontspec.
    pub(super) fn parse(text: &str) -> Vec<String> {
        text.lines()
            .filter_map(|line| {
                let (format, family) = line.split_once('\t')?;
                let kind = match format {
                    "TrueType" => "TrueType",
                    "CFF" => "OpenType",
                    _ => return None,
                };
                let family = family.trim();
                (!family.is_empty()).then(|| format!("{family} ({kind})"))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn reads_fontconfigs_list() {
        let entries = super::platform::parse("TrueType\tDejaVu Sans\nCFF\tNoto Serif CJK JP\nType 1\tNimbus Roman\nTrueType\t\n");
        assert_eq!(entries, ["DejaVu Sans (TrueType)", "Noto Serif CJK JP (OpenType)"]);
        assert_eq!(super::families_of(&entries[0]), ["DejaVu Sans"]);
    }

    use super::families_of;

    #[test]
    fn families_from_registered_names() {
        assert_eq!(families_of("Arial Bold Italic (TrueType)"), ["Arial"]);
        assert_eq!(families_of("Cambria & Cambria Math (TrueType)"), ["Cambria", "Cambria Math"]);
        assert_eq!(families_of("Segoe UI Semibold (TrueType)"), ["Segoe UI"]);
        assert_eq!(families_of("Source Sans Pro Black (OpenType)"), ["Source Sans Pro"]);
        assert!(families_of("Modern (Plotter)").is_empty());
    }
}
