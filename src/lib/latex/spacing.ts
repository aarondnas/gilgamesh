// Line and paragraph spacing, as the ribbon's spacing button sets them. Pure
// text in, changes out, as in format.ts.
//
// Line spacing is setspace's: a factor of LaTeX's normal spacing, which is
// close to Word's of the same number (Word's single spacing is about 1.2 times
// the font size, as LaTeX's is). For paragraphs and sections the
// `spacing` environment around them, `\begin{spacing}{1.5} … \end{spacing}`; for
// the whole document `\setstretch{1.5}` in the preamble.
//
// The space between paragraphs is a matter of the whole document in LaTeX: an
// indent (LaTeX's default) or a blank line's worth instead, by KOMA-Script's
// `parskip` class option or else the parskip package.

import type { FormatEdit } from "./format";
import {
  afterPackages,
  BEGIN_DOCUMENT,
  DOCUMENT_CLASS,
  indentOf,
  loadedPackages,
  maskComments,
  packageNames,
  splitOptions,
  USEPACKAGE,
  type TextEdit,
} from "./syntax";

/** Word's line spacings. */
export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3] as const;

/** No space between paragraphs but an indent, half a line or a whole line. */
export type ParagraphSpacing = "indent" | "half" | "full";
export const PARAGRAPH_SPACINGS: readonly ParagraphSpacing[] = ["indent", "half", "full"];

type Range = { from: number; to: number };
type Selection = { anchor: number; head: number };

const BEGIN_SPACING = /^([ \t]*)\\begin\s*\{spacing\}\s*\{([^}]*)\}[ \t]*$/;
const END_SPACING = /^[ \t]*\\end\s*\{spacing\}[ \t]*$/;

/** `1.15`, as setspace reads it. */
const factor = (stretch: number) => String(Math.round(stretch * 100) / 100);

const numberOf = (text: string) => {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** The line `offset` is on. */
function lineAround(text: string, offset: number): Range {
  const from = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return { from, to: end < 0 ? text.length : end };
}

// ---------------------------------------------------------------------------
// Line spacing.

/** The stretch the preamble of the main file `main` sets for the whole document; 1 without one. */
export function documentStretchOf(main: string): number {
  let stretch = 1;
  for (const line of stretchLines(main)) stretch = line.stretch;
  return stretch;
}

/** `\setstretch{1.5}`, setspace's `\onehalfspacing` and their kin in the preamble, with the stretch they set. */
function stretchLines(main: string): (Range & { stretch: number })[] {
  const masked = maskComments(main);
  const begin = BEGIN_DOCUMENT.exec(masked);
  const head = masked.slice(0, begin ? begin.index : masked.length);
  const lines: (Range & { stretch: number })[] = [];
  const pattern = /^[ \t]*\\(setstretch|linespread|onehalfspacing|doublespacing|singlespacing)\b[ \t]*(?:\{([^}]*)\})?[ \t]*$/gm;
  for (const match of head.matchAll(pattern)) {
    const named = { onehalfspacing: 1.5, doublespacing: 2, singlespacing: 1 }[match[1]];
    const stretch = named ?? numberOf(match[2] ?? "");
    if (stretch !== null) lines.push({ from: match.index, to: match.index + match[0].length, stretch });
  }
  return lines;
}

/** The stretch at the end of `before` (the text up to the cursor): of the innermost `spacing` environment around it; `null` outside one. */
export function stretchAt(before: string): number | null {
  const open: number[] = [];
  for (const match of maskComments(before).matchAll(/\\(begin|end)\s*\{spacing\}(?:\s*\{([^}]*)\})?/g)) {
    if (match[1] === "begin") open.push(numberOf(match[2] ?? "") ?? 1);
    else open.pop();
  }
  return open.at(-1) ?? null;
}

/**
 * Sets `range` (whole lines, see `paragraphRange` and `sectionRange`) in line
 * spacing `stretch`: a `spacing` environment around it, or the one around it
 * already gets the new factor. Where `stretch` is the document's own, the
 * environment goes. The selection stays on the same text.
 */
export function spacingRange(text: string, range: Range, stretch: number, documentStretch: number, select: Selection): FormatEdit {
  const before = range.from > 0 ? lineAround(text, range.from - 1) : null;
  const after = range.to < text.length ? lineAround(text, range.to + 1) : null;
  const begin = before ? BEGIN_SPACING.exec(text.slice(before.from, before.to)) : null;
  const own = !!begin && !!after && END_SPACING.test(text.slice(after.from, after.to));
  const from = own ? before!.from : range.from;
  const to = own ? after!.to : range.to;
  const inner = text.slice(range.from, range.to);
  let prefix = "";
  let suffix = "";
  if (stretch !== documentStretch) {
    const indent = begin?.[1] ?? indentOf(inner);
    prefix = `${indent}\\begin{spacing}{${factor(stretch)}}\n`;
    suffix = `\n${indent}\\end{spacing}`;
  }
  const place = (at: number) => prefix.length + Math.min(Math.max(at, range.from), range.to) - range.from;
  return { from, to, insert: `${prefix}${inner}${suffix}`, select: { anchor: place(select.anchor), head: place(select.head) } };
}

/** Whether the main file `main` loads `name`. */
const loads = (main: string, name: string) => loadedPackages(main).has(name);

/** Removes the line `range`, with its line break. */
const lineRemoval = (main: string, range: Range): TextEdit => ({
  from: range.from,
  to: Math.min(range.to + 1, main.length),
  insert: "",
});

/**
 * The whole document in line spacing `stretch`, in the preamble of the main
 * file `main`: what set it before goes, `\setstretch{…}` comes after the last
 * package (setspace, which must be loaded first); none for single spacing.
 * The edits come last first, so each can be applied as is.
 */
export function spacingDocumentEdits(main: string, stretch: number): TextEdit[] {
  const edits: TextEdit[] = stretchLines(main).map((line) => lineRemoval(main, line));
  if (stretch !== 1) {
    const at = afterPackages(main);
    if (at < 0) return [];
    edits.push({ from: at, to: at, insert: `\n\\setstretch{${factor(stretch)}}` });
  }
  return edits.sort((a, b) => b.from - a.from);
}

/** What line spacing needs loaded: setspace, unless the main file loads it already. */
export const spacingPackages = (main: string): string[] => (loads(main, "setspace") ? [] : ["setspace"]);

// ---------------------------------------------------------------------------
// Space between paragraphs.

/** KOMA-Script's classes, which set it by their own `parskip` option. */
const isKoma = (name: string) => /^scr(?:artcl|reprt|book|lttr2)$/.test(name);

/** The space between paragraphs the main file `main` sets for the whole document. */
export function paragraphSpacingOf(main: string): ParagraphSpacing {
  const masked = maskComments(main);
  const documentClass = DOCUMENT_CLASS.exec(masked);
  if (documentClass && isKoma(documentClass[2].trim())) {
    const option = splitOptions(documentClass[1] ?? "").find((o) => o.split("=")[0].trim() === "parskip");
    const value = option?.split("=")[1]?.trim() ?? "";
    if (!option || /^(?:false|off|no|absent)/.test(value)) return "indent";
    return /^full/.test(value) ? "full" : "half";
  }
  for (const use of masked.matchAll(USEPACKAGE)) {
    if (!packageNames(use).includes("parskip")) continue;
    // parskip's own default is half a line.
    return /skip\s*=\s*\\baselineskip/.test(use[1] ?? "") ? "full" : "half";
  }
  return "indent";
}

/**
 * The whole document with `spacing` between paragraphs, in the preamble of
 * the main file `main`: KOMA-Script's class option `parskip=half` or
 * `parskip=full`; for other classes the parskip package, a line of its own
 * after the last package. An indent is LaTeX's default: what set another goes.
 * The edits come last first.
 */
export function paragraphSpacingEdits(main: string, spacing: ParagraphSpacing): TextEdit[] {
  const masked = maskComments(main);
  const documentClass = DOCUMENT_CLASS.exec(masked);
  if (!documentClass) return [];
  const edits: TextEdit[] = [];
  if (isKoma(documentClass[2].trim())) {
    const options = splitOptions(documentClass[1] ?? "").filter((o) => o.split("=")[0].trim() !== "parskip");
    if (spacing !== "indent") options.push(`parskip=${spacing}`);
    const head = documentClass.index + "\\documentclass".length;
    const name = documentClass[0].lastIndexOf("{");
    edits.push({
      from: head,
      to: documentClass.index + name,
      insert: options.length ? `[${options.join(",")}]` : "",
    });
    return edits;
  }
  for (const use of masked.matchAll(USEPACKAGE)) {
    const names = packageNames(use);
    if (!names.includes("parskip")) continue;
    const line = lineAround(main, use.index);
    // A line of parskip's own goes; parskip among others is taken out of the list.
    if (
      names.length === 1 &&
      main.slice(line.from, use.index).trim() === "" &&
      main.slice(use.index + use[0].length, line.to).trim() === ""
    ) {
      edits.push(lineRemoval(main, line));
    } else {
      const listFrom = use.index + use[0].lastIndexOf("{") + 1;
      edits.push({ from: listFrom, to: listFrom + use[2].length, insert: names.filter((n) => n !== "parskip").join(",") });
    }
  }
  if (spacing !== "indent") {
    const at = afterPackages(main);
    if (at < 0) return [];
    const options = spacing === "full" ? "[skip=\\baselineskip plus 2pt]" : "";
    edits.push({ from: at, to: at, insert: `\n\\usepackage${options}{parskip}` });
  }
  return edits.sort((a, b) => b.from - a.from);
}
