// The typeface as the ribbon shows and sets it: which font the main file
// sets for the document, the fonts it declares for parts of it, and the
// preamble that sets them for pdfLaTeX or for XeLaTeX and LuaLaTeX
// (fontspec). Pure text in, one change out, as in format.ts.
//
// A font is named by a key: `tex:termes` for one of the catalog below, which
// every engine can use; `system:Arial` for a font installed on the system,
// which only fontspec can use; `custom:…` for a setup Gilgamesh does not know,
// which it shows but never changes unasked. A font of the font manager's
// catalog (fonts.svelte.ts) is `otf:EBGaramond-Regular.otf` under fontspec,
// set by its files, so a build that misses them installs its package; and
// `pkg:ebgaramond` under pdfLaTeX, set by its LaTeX package.

import type { FontFamily } from "$lib/api";
import { fonts } from "$lib/state/fonts.svelte";
import { fileName } from "$lib/util/paths";
import { selectAll, sizeCommandLine, sizeCommandName, sizeCommandsOf, type Declarations, type FormatEdit } from "./format";
import { convertSymbolFont, hasSymbolFont } from "./symbols";
import { BEGIN_DOCUMENT, loadedPackages, maskComments, packageNames, USEPACKAGE } from "./syntax";

/** How an engine sets fonts: pdfLaTeX by NFSS families, XeLaTeX and LuaLaTeX by OpenType names (fontspec). */
export type FontMode = "pdflatex" | "unicode";
export const fontModeOf = (engine: string): FontMode => (engine === "pdflatex" ? "pdflatex" : "unicode");

type Kind = "serif" | "sans" | "mono";

export interface CatalogFont {
  id: string;
  name: string;
  kind: Kind;
  /** The NFSS family for pdfLaTeX (`\fontfamily{qtm}`). */
  nfss: string;
  /** The OpenType family for fontspec. */
  otf: string;
  /** Packages that set it for the document under pdfLaTeX, by which a preamble is recognised. */
  packages: string[];
  /** Its upright face in the distribution, under `fonts/opentype/public`, which the font list shows it in. */
  file: string;
}

/** Fonts every engine can use, all in the TeX distribution (lm, tex-gyre). */
export const CATALOG: readonly CatalogFont[] = [
  {
    id: "latin-modern",
    name: "Latin Modern",
    kind: "serif",
    nfss: "lmr",
    otf: "Latin Modern Roman",
    packages: ["lmodern"],
    file: "lm/lmroman10-regular.otf",
  },
  {
    id: "termes",
    name: "Times (TeX Gyre Termes)",
    kind: "serif",
    nfss: "qtm",
    otf: "TeX Gyre Termes",
    packages: ["newtxtext", "tgtermes", "qtimes", "times", "mathptmx", "txfonts"],
    file: "tex-gyre/texgyretermes-regular.otf",
  },
  {
    id: "pagella",
    name: "Palatino (TeX Gyre Pagella)",
    kind: "serif",
    nfss: "qpl",
    otf: "TeX Gyre Pagella",
    packages: ["newpxtext", "tgpagella", "qpalatin", "palatino", "mathpazo", "pxfonts"],
    file: "tex-gyre/texgyrepagella-regular.otf",
  },
  {
    id: "bonum",
    name: "Bookman (TeX Gyre Bonum)",
    kind: "serif",
    nfss: "qbk",
    otf: "TeX Gyre Bonum",
    packages: ["tgbonum", "qbookman", "bookman"],
    file: "tex-gyre/texgyrebonum-regular.otf",
  },
  {
    id: "schola",
    name: "Century Schoolbook (TeX Gyre Schola)",
    kind: "serif",
    nfss: "qcs",
    otf: "TeX Gyre Schola",
    packages: ["tgschola", "newcent"],
    file: "tex-gyre/texgyreschola-regular.otf",
  },
  {
    id: "latin-modern-sans",
    name: "Latin Modern Sans",
    kind: "sans",
    nfss: "lmss",
    otf: "Latin Modern Sans",
    packages: [],
    file: "lm/lmsans10-regular.otf",
  },
  {
    id: "heros",
    name: "Helvetica (TeX Gyre Heros)",
    kind: "sans",
    nfss: "qhv",
    otf: "TeX Gyre Heros",
    packages: ["tgheros", "qswiss", "helvet"],
    file: "tex-gyre/texgyreheros-regular.otf",
  },
  {
    id: "adventor",
    name: "Avant Garde (TeX Gyre Adventor)",
    kind: "sans",
    nfss: "qag",
    otf: "TeX Gyre Adventor",
    packages: ["tgadventor", "avant"],
    file: "tex-gyre/texgyreadventor-regular.otf",
  },
  {
    id: "latin-modern-mono",
    name: "Latin Modern Mono",
    kind: "mono",
    nfss: "lmtt",
    otf: "Latin Modern Mono",
    packages: [],
    file: "lm/lmmono10-regular.otf",
  },
  {
    id: "cursor",
    name: "Courier (TeX Gyre Cursor)",
    kind: "mono",
    nfss: "qcr",
    otf: "TeX Gyre Cursor",
    packages: ["tgcursor", "qcourier", "courier"],
    file: "tex-gyre/texgyrecursor-regular.otf",
  },
];

export const DEFAULT_FONT = "tex:latin-modern";

/** Font packages outside the catalog: a document set in one of them shows it as its own font. */
const OTHER_FONT_PACKAGES = [
  "libertine",
  "libertinus",
  "libertinust1math",
  "ebgaramond",
  "garamondx",
  "XCharter",
  "charter",
  "fourier",
  "kpfonts",
  "mlmodern",
  "sourceserifpro",
  "sourcesanspro",
  "sourcecodepro",
  "FiraSans",
  "FiraMono",
  "roboto",
  "opensans",
  "lato",
  "inter",
  "plex-serif",
  "plex-sans",
  "noto",
  "noto-serif",
  "noto-sans",
  "crimson",
  "CrimsonPro",
  "cochineal",
  "baskervillef",
  "utopia",
  "erewhon",
  "gentium",
  "mathdesign",
  "merriweather",
  "montserrat",
  "raleway",
  "tgchorus",
  "cmbright",
  "arev",
  "bera",
  "beraserif",
  "berasans",
  "concrete",
  "newpxmath",
  "mathpple",
];

/** Packages whose job is the text font: what setting another one replaces. Math fonts (newtxmath) stay. */
const FONT_PACKAGES = new Set([...CATALOG.flatMap((font) => font.packages), ...OTHER_FONT_PACKAGES]);

/** Packages that only XeLaTeX and LuaLaTeX can load. */
const UNICODE_PACKAGES = ["fontspec", "unicode-math", "polyglossia"];

const catalogFont = (key: string) => (key.startsWith("tex:") ? CATALOG.find((font) => `tex:${font.id}` === key) : undefined);

/** A font named by its file (`EBGaramond-Regular.otf`) rather than by its family. */
const FONT_FILE = /\.(otf|ttf)$/i;

/** The family of the font manager's catalog behind an `otf:` or `pkg:` key. */
export const managedFamily = (key: string) =>
  key.startsWith("otf:") ? fonts.byFile(key.slice(4)) : key.startsWith("pkg:") ? fonts.bySty(key.slice(4)) : undefined;
const isManaged = (key: string) => key.startsWith("otf:") || key.startsWith("pkg:");

/** The key that sets `family` of the font manager under `mode`; `null` where `mode` cannot use it. */
export function managedFontKey(family: FontFamily, mode: FontMode): string | null {
  const catalog = CATALOG.find((font) => family.regular.endsWith(`/${font.file}`));
  if (catalog) return `tex:${catalog.id}`;
  if (mode === "unicode") return `otf:${fileName(family.regular)}`;
  return family.sty ? `pkg:${family.sty}` : null;
}

/** What the font list shows for `key`. */
export function fontLabel(key: string): string {
  const font = catalogFont(key);
  if (font) return font.name;
  if (isManaged(key)) return managedFamily(key)?.name ?? key.slice(4).replace(FONT_FILE, "");
  return key.slice(key.indexOf(":") + 1);
}

// ---------------------------------------------------------------------------
// Reading the preamble.

/** The preamble: the main file up to the line with `\begin{document}`; `null` without one. */
function preambleText(main: string): string | null {
  const begin = BEGIN_DOCUMENT.exec(maskComments(main));
  if (!begin) return null;
  return main.slice(0, main.lastIndexOf("\n", begin.index) + 1);
}

/** `\renewcommand{\rmdefault}{qtm}` and its kin: which family each sets, the last one counting. */
const DEFAULT_LINE = /^[ \t]*\\renewcommand\*?\s*\{?\\(rm|sf|tt|family)default\}?\s*\{([^}]*)\}[ \t]*(?:%[^\n]*)?(?:\n|$)/gm;
const MAIN_FONT = /^[ \t]*\\setmainfont\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}(?:\s*\[[^\]]*\])?[ \t]*(?:%[^\n]*)?(?:\n|$)/gm;
const OTHER_FONT = /^[ \t]*\\set(?:sans|mono)font\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}(?:\s*\[[^\]]*\])?[ \t]*(?:%[^\n]*)?(?:\n|$)/gm;
/** `\newcommand*{\fontTermes}{\fontfamily{qtm}\selectfont}`: a font for parts of the document under pdfLaTeX; empty where it was lost. */
const NFSS_COMMAND =
  /^[ \t]*\\newcommand\*?\s*\{?\\(font[A-Z][A-Za-z]*)\}?\s*\{(?:\\fontfamily\s*\{([^}]*)\}\s*\\selectfont)?\s*\}[ \t]*(?:\n|$)/gm;
/** `\newfontfamily{\fontTermes}{TeX Gyre Termes}`: the same for fontspec. */
const FONTSPEC_COMMAND =
  /^[ \t]*\\newfontfamily\s*\{?\\(font[A-Z][A-Za-z]*)\}?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}(?:\s*\[[^\]]*\])?[ \t]*(?:\n|$)/gm;

const byNfss = (code: string) => CATALOG.find((font) => font.nfss === code.trim());
const byOtf = (name: string) => CATALOG.find((font) => font.otf.toLowerCase() === name.trim().toLowerCase());

/** The document font as pdfLaTeX sets it: by the `…default` families, else by the packages loaded. */
function pdfFontOf(head: string): string {
  const masked = maskComments(head);
  const defaults: Record<string, string> = {};
  for (const line of masked.matchAll(DEFAULT_LINE)) defaults[line[1]] = line[2].trim();
  const family = defaults.family;
  let kind: Kind = "serif";
  if (family === "\\sfdefault") kind = "sans";
  else if (family === "\\ttdefault") kind = "mono";
  else if (family && family !== "\\rmdefault") {
    const font = byNfss(family);
    return font ? `tex:${font.id}` : `custom:${family}`;
  }
  const code = defaults[{ serif: "rm", sans: "sf", mono: "tt" }[kind]];
  if (code) {
    const font = byNfss(code);
    return font ? `tex:${font.id}` : `custom:${code}`;
  }
  const loaded = loadedPackages(head);
  const known = CATALOG.find((font) => font.kind === kind && font.packages.some((name) => loaded.has(name)));
  if (known) return `tex:${known.id}`;
  const managed = [...loaded].find((name) => fonts.bySty(name));
  if (managed) return `pkg:${managed}`;
  const other = OTHER_FONT_PACKAGES.find((name) => loaded.has(name));
  if (other) return `custom:${other}`;
  return kind === "sans" ? "tex:latin-modern-sans" : kind === "mono" ? "tex:latin-modern-mono" : DEFAULT_FONT;
}

/** The document font of the main file `main` under `mode`. */
export function documentFontOf(main: string, mode: FontMode): string {
  const head = preambleText(main) ?? main;
  if (mode === "unicode") {
    const set = [...maskComments(head).matchAll(MAIN_FONT)].at(-1);
    if (set) {
      const font = byOtf(set[1]);
      if (font) return `tex:${font.id}`;
      return FONT_FILE.test(set[1].trim()) ? `otf:${set[1].trim()}` : `system:${set[1].trim()}`;
    }
  }
  return pdfFontOf(head);
}

/** The fonts the main file declares for parts of the document: command name → font key (`null` where it was lost). */
export function fontCommandsOf(main: string): Map<string, string | null> {
  const head = maskComments(preambleText(main) ?? "");
  const commands = new Map<string, string | null>();
  for (const line of head.matchAll(NFSS_COMMAND)) {
    const font = line[2] ? byNfss(line[2]) : undefined;
    commands.set(line[1], line[2] ? (font ? `tex:${font.id}` : `custom:${line[2].trim()}`) : null);
  }
  for (const line of head.matchAll(FONTSPEC_COMMAND)) {
    const font = byOtf(line[2]);
    const name = line[2].trim();
    commands.set(line[1], font ? `tex:${font.id}` : FONT_FILE.test(name) ? `otf:${name}` : `system:${name}`);
  }
  return commands;
}

/** The font commands as a family of declarations, for groups around text (see `setGroup`). */
export const fontDeclarations = (main: string): Declarations => ({
  names: [...fontCommandsOf(main).keys()],
  par: false,
  reset: null,
});

// ---------------------------------------------------------------------------
// Writing the preamble.

/** Replaces the preamble of `main` by what `change` makes of it; `null` without `\begin{document}` or without a change. */
function rewritePreamble(main: string, change: (head: string) => string): FormatEdit | null {
  const head = preambleText(main);
  if (head === null) return null;
  const next = change(head);
  return next === head ? null : selectAll(0, head.length, next);
}

/** Takes `names` out of the `\usepackage` lines of `head`; a line left empty goes. */
function dropPackages(head: string, names: (name: string) => boolean): string {
  const lines = head.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const code = maskComments(line);
    let changed = false;
    let result = line;
    for (const use of [...code.matchAll(USEPACKAGE)].reverse()) {
      const all = packageNames(use);
      const rest = all.filter((name) => !names(name));
      if (rest.length === all.length) continue;
      changed = true;
      const replacement = rest.length ? `\\usepackage${use[1] !== undefined ? `[${use[1]}]` : ""}{${rest.join(",")}}` : "";
      result = result.slice(0, use.index) + replacement + result.slice(use.index! + use[0].length);
    }
    if (changed && maskComments(result).trim() === "") continue;
    kept.push(result);
  }
  return kept.join("\n");
}

const dropLines = (head: string, pattern: RegExp) => head.replace(new RegExp(pattern.source, pattern.flags), "");

/** Puts `lines` after the last `\usepackage` line of `head`, else after `\documentclass`, else at its end. */
function insertLines(head: string, lines: string[]): string {
  if (!lines.length) return head;
  const all = head.split("\n");
  let at = -1;
  all.forEach((line, index) => {
    if (/\\usepackage\b|\\documentclass\b/.test(maskComments(line))) at = index;
  });
  if (at < 0) at = Math.max(0, all.length - 2);
  all.splice(at + 1, 0, ...lines);
  return all.join("\n");
}

const hasPackage = (head: string, name: string) => loadedPackages(head).has(name);

/** What sets `key` as the document font under `mode`; nothing for the default font, and for what cannot be set there. */
function documentLines(key: string, mode: FontMode): string[] {
  if (isManaged(key)) return managedLines(key, mode);
  const font = catalogFont(key);
  if (mode === "unicode") {
    if (key.startsWith("system:")) return [`\\setmainfont{${fontLabel(key)}}`];
    if (!font || key === DEFAULT_FONT) return [];
    return [`\\setmainfont{${font.otf}}`];
  }
  if (!font) return [];
  if (key === DEFAULT_FONT) return ["\\usepackage{lmodern}"];
  if (font.kind === "serif") return [`\\renewcommand{\\rmdefault}{${font.nfss}}`];
  const slot = font.kind === "sans" ? "sf" : "tt";
  return [`\\renewcommand{\\${slot}default}{${font.nfss}}`, `\\renewcommand{\\familydefault}{\\${slot}default}`];
}

/** fontspec's options for the other faces of `family`: `[BoldFont=EBGaramond-Bold.otf, …]`. */
function fontspecFaces(family: FontFamily): string {
  const faces: [string, string | null][] = [
    ["BoldFont", family.bold],
    ["ItalicFont", family.italic],
    ["BoldItalicFont", family.boldItalic],
  ];
  const options = faces.filter(([, file]) => file).map(([option, file]) => `${option}=${fileName(file!)}`);
  return options.length ? `[${options.join(", ")}]` : "";
}

/**
 * What sets a font of the font manager (an `otf:` or `pkg:` key) for the document:
 * under fontspec by its files; under pdfLaTeX by its package, made the document's
 * font where it is a sans or mono one. Nothing where `mode` cannot use it.
 */
function managedLines(key: string, mode: FontMode): string[] {
  const family = managedFamily(key);
  if (mode === "unicode") {
    const file = family ? fileName(family.regular) : key.startsWith("otf:") ? key.slice(4) : null;
    return file ? [`\\setmainfont{${file}}${family ? fontspecFaces(family) : ""}`] : [];
  }
  const sty = family ? family.sty : key.startsWith("pkg:") ? key.slice(4) : null;
  if (!sty) return [];
  if (family?.kind === "sans") return [`\\usepackage[sfdefault]{${sty}}`];
  if (family?.kind === "mono") return [`\\usepackage{${sty}}`, "\\renewcommand{\\familydefault}{\\ttdefault}"];
  return [`\\usepackage{${sty}}`];
}

/** `head` without what sets the document font: font packages, `…default` families, `\setmainfont`. */
function withoutDocumentFont(head: string): string {
  return dropLines(
    dropLines(
      dropPackages(head, (name) => FONT_PACKAGES.has(name) || !!fonts.bySty(name)),
      DEFAULT_LINE,
    ),
    MAIN_FONT,
  );
}

/** `head` with fontspec loaded where `lines` need it. */
function withFontspec(head: string, lines: string[]): string {
  return lines.some((line) => /\\(setmainfont|newfontfamily)\b/.test(line)) && !hasPackage(head, "fontspec")
    ? insertLines(head, ["\\usepackage{fontspec}"])
    : head;
}

/**
 * Sets `key` as the font of the whole document under `mode`, in the main file
 * `main`: what set the font before goes, and the catalog's setup (or
 * `\setmainfont` for a system font) takes its place after the last package.
 * `null` without `\begin{document}`, or where nothing changes.
 */
export function setDocumentFont(main: string, key: string, mode: FontMode): FormatEdit | null {
  return rewritePreamble(main, (head) => {
    const lines = documentLines(key, mode);
    const base = withFontspec(withoutDocumentFont(head), lines);
    return insertLines(base, lines);
  });
}

/** `\fontPagella`: a command name from a font's name, letters only. */
function commandNameFor(key: string): string {
  const font = catalogFont(key);
  const words = (font ? font.id : fontLabel(key)).split(/[^A-Za-z]+/).filter(Boolean);
  return `font${words.map((word) => word[0].toUpperCase() + word.slice(1)).join("") || "Custom"}`;
}

/** The line that declares `name` as the command for `key` under `mode`; an empty one where `mode` cannot set it. */
function commandLine(name: string, key: string, mode: FontMode): string {
  const font = catalogFont(key);
  if (mode === "unicode" && isManaged(key)) {
    const [line] = managedLines(key, mode);
    return line ? line.replace("\\setmainfont{", `\\newfontfamily{\\${name}}{`) : `\\newcommand*{\\${name}}{}`;
  }
  if (mode === "unicode") return `\\newfontfamily{\\${name}}{${font ? font.otf : fontLabel(key)}}`;
  return font ? `\\newcommand*{\\${name}}{\\fontfamily{${font.nfss}}\\selectfont}` : `\\newcommand*{\\${name}}{}`;
}

/**
 * The command that sets `key` for part of the document (`{\fontPagella …}`),
 * declared in the preamble of `main` where it is not yet: `edit` adds it.
 * `null` without `\begin{document}`.
 */
export function fontCommand(main: string, key: string, mode: FontMode): { name: string; edit: FormatEdit | null } | null {
  if (preambleText(main) === null) return null;
  const commands = fontCommandsOf(main);
  for (const [name, declared] of commands) if (declared === key) return { name, edit: null };
  const base = commandNameFor(key);
  let name = base;
  for (let n = 2; commands.has(name); n++) name = `${base}${String.fromCharCode(64 + n)}`;
  const line = commandLine(name, key, mode);
  return { name, edit: rewritePreamble(main, (head) => insertLines(withFontspec(head, [line]), [line])) };
}

/**
 * The command that sets `points` for part of the document (`{\sizeFourteen …}`),
 * declared in the preamble of `main` where it is not yet: `edit` adds it.
 * `null` without `\begin{document}`.
 */
export function sizeCommand(main: string, points: number): { name: string; edit: FormatEdit | null } | null {
  if (preambleText(main) === null) return null;
  const commands = sizeCommandsOf(main);
  for (const [name, declared] of commands) if (declared === points) return { name, edit: null };
  const base = sizeCommandName(points);
  let name = base;
  for (let n = 2; commands.has(name); n++) name = `${base}${String.fromCharCode(64 + n)}`;
  const line = sizeCommandLine(name, points);
  return { name, edit: rewritePreamble(main, (head) => insertLines(head, [line])) };
}

// ---------------------------------------------------------------------------
// Another engine.

export interface FontConversion {
  /** The new preamble; `null` where nothing changes. */
  edit: FormatEdit | null;
  /** System fonts pdfLaTeX cannot use, which the document loses. */
  lost: string[];
  /** Packages only XeLaTeX and LuaLaTeX can load that stay and need replacing by hand. */
  unsupported: string[];
}

/**
 * The fonts of the main file `main` rewritten for `to` after `from`: the
 * catalog's fonts set the other way (`\setmainfont{TeX Gyre Termes}` ↔
 * `\renewcommand{\rmdefault}{qtm}`), the font commands too. System fonts
 * cannot go to pdfLaTeX: they are taken out (their commands set nothing) and
 * listed as lost. A setup Gilgamesh does not know stays as it is.
 */
export function convertFonts(main: string, from: FontMode, to: FontMode): FontConversion {
  const none: FontConversion = { edit: null, lost: [], unsupported: [] };
  const head = preambleText(main);
  if (from === to || head === null) return none;
  const lost: string[] = [];
  const key = documentFontOf(main, from);
  const commands = fontCommandsOf(main);
  const masked = maskComments(head);

  const edit = rewritePreamble(main, (old) => {
    // The symbol dialog's fallback font goes with the engine (only fontspec can load it).
    if (to === "pdflatex" && hasSymbolFont(old)) lost.push("FreeSerif");
    let next = convertSymbolFont(old, to);
    if (!key.startsWith("custom:")) {
      if (key.startsWith("system:") && to === "pdflatex") lost.push(fontLabel(key));
      const lines = documentLines(key, to);
      // A font of the font manager pdfLaTeX has no package for.
      if (isManaged(key) && !lines.length) lost.push(fontLabel(key));
      next = insertLines(withFontspec(withoutDocumentFont(next), lines), lines);
    }
    // The font commands, each declared the other way.
    const pattern = from === "pdflatex" ? NFSS_COMMAND : FONTSPEC_COMMAND;
    next = next.replace(new RegExp(pattern.source, pattern.flags), (line, name: string) => {
      const declared = commands.get(name);
      if (!declared || declared.startsWith("custom:")) return line;
      if (declared.startsWith("system:") && to === "pdflatex") lost.push(fontLabel(declared));
      return `${commandLine(name, declared, to)}\n`;
    });
    if (to === "unicode") {
      const fontspecLines = [
        ...(next.match(new RegExp(FONTSPEC_COMMAND.source, "gm")) ?? []),
        ...(hasSymbolFont(next) ? ["\\newfontfamily"] : []),
      ];
      return withFontspec(next, fontspecLines);
    }
    // pdfLaTeX: no fontspec, and the sans and mono fonts it set are lost too.
    for (const other of masked.matchAll(OTHER_FONT)) lost.push(other[1].trim());
    return dropPackages(dropLines(next, OTHER_FONT), (name) => name === "fontspec");
  });
  const loaded = loadedPackages(head);
  const unsupported = to === "pdflatex" ? UNICODE_PACKAGES.filter((name) => name !== "fontspec" && loaded.has(name)) : [];
  return { edit, lost: [...new Set(lost)], unsupported };
}
