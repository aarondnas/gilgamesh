// The page margins of the main file, as the geometry package sets them: read
// for the margins dialog, and written back to the preamble.

import type { Unit } from "$lib/state/units.svelte";
import {
  afterPackages,
  DOCUMENT_CLASS,
  documentClassOf,
  headOf,
  lineEnd,
  maskComments,
  packageNames,
  splitOptions,
  type TextEdit,
} from "./syntax";

/** In one unit (cm unless said otherwise). With two-sided printing `left` is the inner, `right` the outer margin (as geometry reads them). */
export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type MarginPreset = "normal" | "narrow" | "moderate" | "wide";

/**
 * Word's choices, which users know: in inches as Word has them, and metric in
 * round centimetres instead of Word's converted inches (1,27 cm, 1,91 cm).
 */
export const MARGIN_PRESETS: Record<"metric" | "imperial", Record<MarginPreset, Margins>> = {
  metric: {
    normal: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
    narrow: { top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 },
    moderate: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
    wide: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
  },
  imperial: {
    normal: { top: 1, bottom: 1, left: 1, right: 1 },
    narrow: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    moderate: { top: 1, bottom: 1, left: 0.75, right: 0.75 },
    wide: { top: 1, bottom: 1, left: 2, right: 2 },
  },
};

export interface PageLayout {
  /** The margins geometry is given, per side; `null` where the class decides or the value is not a plain length. */
  margins: { [side in keyof Margins]: number | null };
  /** Paper size in cm, landscape already applied: for the dialog's preview. */
  paper: { width: number; height: number };
  /** Inner and outer margins instead of left and right. */
  twoSided: boolean;
  /** Landscape, by geometry's or the class's options. */
  landscape: boolean;
  /** The paper by its name, as the class's and geometry's options set it; `null` for a size given otherwise (`paperwidth=…`). */
  paperName: PaperName | null;
}

const MARGIN_KEYS = new Set([
  "margin",
  "hmargin",
  "vmargin",
  "left",
  "right",
  "top",
  "bottom",
  "lmargin",
  "rmargin",
  "tmargin",
  "bmargin",
  "inner",
  "outer",
  "marginratio",
  "hmarginratio",
  "vmarginratio",
  "ratio",
  "scale",
  "hscale",
  "vscale",
  "width",
  "height",
  "textwidth",
  "textheight",
  "total",
  "body",
  "text",
  "centering",
  "hcentering",
  "vcentering",
  "divide",
  "hdivide",
  "vdivide",
]);

/** The papers geometry and the classes know by name (`a4paper`), as the ribbon offers them. */
export const PAPER_NAMES = ["a4", "a5", "b5", "letter", "legal", "executive"] as const;
export type PaperName = (typeof PAPER_NAMES)[number];

/** Width and height in cm, portrait. */
export const PAPERS: Record<PaperName, [number, number]> = {
  a4: [21, 29.7],
  a5: [14.8, 21],
  b5: [17.6, 25],
  letter: [21.59, 27.94],
  legal: [21.59, 35.56],
  executive: [18.41, 26.67],
};

const isPaperName = (name: string): name is PaperName => (PAPER_NAMES as readonly string[]).includes(name);

/** Options that set the paper: `a4paper`, KOMA's `paper=a4`, geometry's `paperwidth=…`. */
const isPaperKey = (key: string) => /^(?:paper|papername|papersize|paperwidth|paperheight|[a-z0-9]+paper)$/.test(key);

const CM_PER: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72 };

/** The preamble with comments blanked out, so offsets stay those of the source. */
function maskedHead(source: string): string {
  return maskComments(headOf(source));
}

function keyOf(option: string): string {
  return option.split("=")[0].trim();
}

function valueOf(option: string): string {
  const at = option.indexOf("=");
  return at < 0 ? "" : option.slice(at + 1).trim();
}

/** `2.5cm` → 2.5; `null` for what is not a plain length (`0.1\paperwidth`). */
function lengthInCm(value: string): number | null {
  const match = /^\{?\s*(\d*[.,]?\d+)\s*(cm|mm|in|pt|bp)\s*\}?$/.exec(value.trim());
  return match ? Number(match[1].replace(",", ".")) * CM_PER[match[2]] : null;
}

/** `{1cm,2cm}` → both; `1cm` → the same twice. */
function pairOf(value: string): [number | null, number | null] {
  const inner = value.trim().replace(/^\{|\}$/g, "");
  const parts = inner.split(",");
  if (parts.length === 2) return [lengthInCm(parts[0]), lengthInCm(parts[1])];
  const one = lengthInCm(inner);
  return [one, one];
}

interface GeometryLoad {
  /** Range of the whole `\usepackage…{geometry}`. */
  from: number;
  to: number;
  /** Range of the text between the brackets; `null` without them. */
  options: { from: number; to: number } | null;
  /** The line loads only geometry, so its options may be rewritten. */
  alone: boolean;
}

interface GeometryCall {
  /** Range of `\geometry{…}`. */
  from: number;
  to: number;
  options: { from: number; to: number };
}

function findGeometry(head: string): { load: GeometryLoad | null; calls: GeometryCall[] } {
  let load: GeometryLoad | null = null;
  for (const match of head.matchAll(/\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g)) {
    const names = packageNames(match);
    if (!names.includes("geometry")) continue;
    const optionsFrom = match[1] === undefined ? -1 : match.index + match[0].indexOf("[") + 1;
    load = {
      from: match.index,
      to: match.index + match[0].length,
      options: optionsFrom < 0 ? null : { from: optionsFrom, to: optionsFrom + match[1].length },
      alone: names.length === 1,
    };
  }
  const calls: GeometryCall[] = [];
  for (const match of head.matchAll(/\\geometry\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const from = match.index + match[0].indexOf("{") + 1;
    calls.push({ from: match.index, to: match.index + match[0].length, options: { from, to: from + match[1].length } });
  }
  return { load, calls };
}

function classOf(head: string): { name: string; options: string[] } | null {
  const documentClass = documentClassOf(head);
  return documentClass ? { name: documentClass.name, options: splitOptions(documentClass.options) } : null;
}

/** Whether the margins can be set here: geometry does not work with beamer, and a file without `\documentclass` has no preamble. */
export function marginsSupported(source: string): boolean {
  const documentClass = classOf(maskedHead(source));
  return !!documentClass && documentClass.name !== "beamer";
}

/** The margins and the paper the main file's preamble sets. */
export function pageLayoutOf(source: string): PageLayout {
  const head = maskedHead(source);
  const documentClass = classOf(head);
  const { load, calls } = findGeometry(head);
  const groups = [
    ...(load?.options ? [head.slice(load.options.from, load.options.to)] : []),
    ...calls.map((c) => head.slice(c.options.from, c.options.to)),
  ];
  const options = groups.flatMap(splitOptions);

  const margins: PageLayout["margins"] = { top: null, bottom: null, left: null, right: null };
  // Later options win, as in geometry.
  for (const option of options) {
    const key = keyOf(option);
    const value = valueOf(option);
    if (key === "margin") {
      const one = lengthInCm(value);
      margins.top = margins.bottom = margins.left = margins.right = one;
    } else if (key === "hmargin") [margins.left, margins.right] = pairOf(value);
    else if (key === "vmargin") [margins.top, margins.bottom] = pairOf(value);
    else if (["left", "lmargin", "inner"].includes(key)) margins.left = lengthInCm(value);
    else if (["right", "rmargin", "outer"].includes(key)) margins.right = lengthInCm(value);
    else if (["top", "tmargin"].includes(key)) margins.top = lengthInCm(value);
    else if (["bottom", "bmargin"].includes(key)) margins.bottom = lengthInCm(value);
  }

  // Standard classes default to US letter, KOMA-Script's to A4.
  const all = [...(documentClass?.options ?? []), ...options];
  let paperName: PaperName | null = documentClass?.name.startsWith("scr") ? "a4" : "letter";
  let paper = PAPERS[paperName];
  let landscape = false;
  for (const option of all) {
    const key = keyOf(option);
    if (isPaperKey(key)) {
      const named = key === "paper" ? valueOf(option).replace(/paper$/, "") : key.replace(/paper$/, "");
      paperName = isPaperName(named) ? named : null;
      if (paperName) paper = PAPERS[paperName];
    }
    if (key === "landscape") landscape = true;
    if (key === "portrait") landscape = false;
  }
  const [width, height] = landscape ? [paper[1], paper[0]] : paper;

  const className = documentClass?.name ?? "";
  const classOptions = documentClass?.options ?? [];
  const twoSided =
    classOptions.includes("twoside") || (["book", "scrbook", "memoir"].includes(className) && !classOptions.includes("oneside"));

  return { margins, paper: { width, height }, twoSided, landscape, paperName };
}

function marginOptions(m: Margins, unit: Unit): string[] {
  const length = (value: number) => `${Math.round(value * 100) / 100}${unit}`;
  if (m.top === m.bottom && m.top === m.left && m.top === m.right) return [`margin=${length(m.top)}`];
  return [`top=${length(m.top)}`, `bottom=${length(m.bottom)}`, `left=${length(m.left)}`, `right=${length(m.right)}`];
}

/**
 * Puts `wanted` into the options of `\usepackage{geometry}` in the main file,
 * in place of the options `own` names; geometry is added where it is missing
 * (after the last `\usepackage`, or after `\documentclass`). Those options
 * elsewhere (`\geometry{…}`) are taken out, as they would win. The edits come
 * last first, so each can be applied as is.
 */
function geometryEdits(source: string, own: (key: string) => boolean, wanted: string[]): TextEdit[] {
  const head = maskedHead(source);
  const { load, calls } = findGeometry(head);
  const edits: TextEdit[] = [];
  const kept = (options: string) => splitOptions(options).filter((o) => !own(keyOf(o)));

  for (const call of calls) {
    const all = splitOptions(head.slice(call.options.from, call.options.to));
    const rest = kept(head.slice(call.options.from, call.options.to));
    if (rest.length === all.length) continue;
    if (rest.length) edits.push({ ...call.options, insert: rest.join(", ") });
    else edits.push(lineRemoval(source, call.from, call.to));
  }

  if (load?.alone) {
    if (load.options) {
      const options = [...kept(head.slice(load.options.from, load.options.to)), ...wanted];
      // Without options left, the brackets go too.
      if (options.length) edits.push({ ...load.options, insert: options.join(", ") });
      else edits.push({ from: load.options.from - 1, to: load.options.to + 1, insert: "" });
    } else if (wanted.length) {
      const at = load.from + head.slice(load.from, load.to).indexOf("{");
      edits.push({ from: at, to: at, insert: `[${wanted.join(", ")}]` });
    }
  } else if (load) {
    // Loaded together with other packages, whose options must stay as they are.
    if (wanted.length)
      edits.push({ from: lineEnd(source, load.to), to: lineEnd(source, load.to), insert: `\n\\geometry{${wanted.join(", ")}}` });
  } else if (wanted.length) {
    const at = afterPackages(source);
    if (at < 0) return [];
    edits.push({ from: at, to: at, insert: `\n\\usepackage[${wanted.join(", ")}]{geometry}` });
  }
  return edits.sort((a, b) => b.from - a.from);
}

/** Sets `margins`, given in `unit`, in the main file, in geometry's options (see `geometryEdits`). */
export const marginsEdits = (source: string, margins: Margins, unit: Unit): TextEdit[] =>
  geometryEdits(source, (key) => MARGIN_KEYS.has(key), marginOptions(margins, unit));

export type Orientation = "portrait" | "landscape";
const ORIENTATION_KEYS = new Set(["portrait", "landscape"]);

/**
 * `wanted` in geometry's options in place of those `own` names (see
 * `geometryEdits`); the class's options of that kind go, so the page is set
 * in one place only. The edits come last first.
 */
function pageEdits(source: string, own: (key: string) => boolean, wanted: string[]): TextEdit[] {
  const edits = geometryEdits(source, own, wanted);
  const documentClass = DOCUMENT_CLASS.exec(maskedHead(source));
  if (documentClass?.[1] !== undefined) {
    const from = documentClass.index + documentClass[0].indexOf("[") + 1;
    const to = from + documentClass[1].length;
    const all = splitOptions(documentClass[1]);
    const rest = all.filter((option) => !own(keyOf(option)));
    if (rest.length < all.length)
      edits.push(rest.length ? { from, to, insert: rest.join(", ") } : { from: from - 1, to: to + 1, insert: "" });
  }
  return edits.sort((a, b) => b.from - a.from);
}

/** The whole document in `orientation`: geometry's `landscape`, or none for portrait, its default (see `pageEdits`). */
export const orientationEdits = (source: string, orientation: Orientation): TextEdit[] =>
  pageEdits(source, (key) => ORIENTATION_KEYS.has(key), orientation === "landscape" ? ["landscape"] : []);

/** The whole document on paper `name`, geometry's `a4paper` and its kin (see `pageEdits`). */
export const paperEdits = (source: string, name: PaperName): TextEdit[] => pageEdits(source, isPaperKey, [`${name}paper`]);

/** Removes `from…to`, and its whole line where nothing else is on it. */
function lineRemoval(source: string, from: number, to: number): TextEdit {
  const start = source.lastIndexOf("\n", from - 1) + 1;
  const end = lineEnd(source, to);
  if (source.slice(start, from).trim() === "" && source.slice(to, end).trim() === "") {
    return { from: Math.max(0, start - 1), to: end, insert: "" };
  }
  return { from, to, insert: "" };
}
