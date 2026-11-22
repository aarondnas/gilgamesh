// What the main file's preamble loads, and where a missing package goes, for
// the ribbon's insert buttons (images, tables).

import { afterPackages, documentClassOf, headOf, loadedPackages, maskComments, packageNames, stripComment, USEPACKAGE } from "./syntax";

export interface Preamble {
  packages: Set<string>;
  /** "" without `\documentclass`. */
  className: string;
}

export function preambleOf(source: string): Preamble {
  return {
    packages: loadedPackages(source),
    className: documentClassOf(headOf(maskComments(source)))?.name ?? "",
  };
}

/** Packages that others or a class load already. */
const PROVIDED: Record<string, (p: Preamble) => boolean> = {
  graphicx: (p) => p.packages.has("graphics") || p.className === "beamer",
  hyperref: (p) => p.className === "beamer",
  xcolor: (p) => p.className === "beamer" || ["tikz", "pgfplots", "pgf"].some((name) => p.packages.has(name)),
};

/** Options a package is loaded with: links without coloured boxes, as in the templates. */
const OPTIONS: Record<string, string> = { hyperref: "hidelinks", ulem: "normalem" };

/** Packages that must be loaded before those listed (cleveref after hyperref). */
const BEFORE: Record<string, string[]> = { hyperref: ["cleveref"] };

/**
 * Loads those of `names` the main file lacks: after its last `\usepackage`,
 * or after `\documentclass`; before the line of a package that must follow
 * it. `null` if nothing is missing.
 */
export function packagesEdit(source: string, names: string[]): { at: number; insert: string } | null {
  const preamble = preambleOf(source);
  const missing = names.filter((name) => !preamble.packages.has(name) && !PROVIDED[name]?.(preamble));
  let at = afterPackages(source);
  if (!missing.length || at < 0) return null;
  for (const name of missing) {
    for (const later of BEFORE[name] ?? []) {
      const line = packageLineStart(source, later);
      // Behind the end of the line before it, as every other package goes behind a line end.
      if (line > 0 && line - 1 < at) at = line - 1;
    }
  }
  const usepackage = (name: string) => `\n\\usepackage${OPTIONS[name] ? `[${OPTIONS[name]}]` : ""}{${name}}`;
  return { at, insert: missing.map(usepackage).join("") };
}

/** Offset of the start of the preamble line that loads `name`, -1 without one. */
function packageLineStart(source: string, name: string): number {
  let offset = 0;
  for (const line of headOf(source).split("\n")) {
    for (const match of stripComment(line).matchAll(USEPACKAGE)) {
      if (packageNames(match).includes(name)) return offset;
    }
    offset += line.length + 1;
  }
  return -1;
}

/**
 * Where floats go: `[H]` where the float package is loaded (the thesis template
 * does), so they stay where they were inserted; otherwise LaTeX's usual placement.
 */
export function placementOf(source: string): string {
  return preambleOf(source).packages.has("float") ? "H" : "htbp";
}

/**
 * `label`, or with a number where the project uses it already (`tab:table-2`).
 * `numbered` starts at 1 even when the bare label is free, for labels made of a
 * generic word ("Table") rather than the user's own caption.
 */
export function uniqueLabel(label: string, taken: Iterable<string>, numbered = false): string {
  const used = new Set(taken);
  if (!numbered && !used.has(label)) return label;
  let n = 1;
  while (used.has(`${label}-${n}`)) n++;
  return `${label}-${n}`;
}

/** `tab:results-2024` for "Results 2024": a label from a caption or file name. */
export function labelFrom(prefix: string, text: string, fallback: string): string {
  return `${prefix}:${slugOf(text) || fallback}`;
}

/** `cafe-results-2024` for "Café results 2024": lower case ASCII letters and digits, joined by dashes. */
export function slugOf(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
