// Reading LaTeX source the way TeX does in the simple cases the editor's
// features need: comments, the preamble, `\documentclass` and `\usepackage`.

/** `\documentclass[options]{name}`: group 1 the options (if any), group 2 the class. */
export const DOCUMENT_CLASS = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/;

/** `\usepackage[options]{names}`, to use with `matchAll`: group 1 the options, group 2 the packages. */
export const USEPACKAGE = /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;

/** Where the body begins. */
export const BEGIN_DOCUMENT = /\\begin\s*\{document\}/;

/** Classes with chapters, which number sections, figures and tables per chapter (`2.1`). */
const CHAPTER_CLASSES = new Set(["book", "report", "scrbook", "scrreprt", "memoir"]);

/** A change to a text: `from…to` replaced by `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** The end of the line `offset` is on (before its line break). */
export function lineEnd(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end < 0 ? text.length : end;
}

/** The spaces and tabs a line starts with. */
export const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** The packages a `USEPACKAGE` match loads: `\usepackage{a, b}` → `["a", "b"]`. */
export const packageNames = (use: RegExpMatchArray): string[] => use[2].split(",").map((name) => name.trim());

/** The packages the preamble of `source` loads, comments aside. */
export function loadedPackages(source: string): Set<string> {
  const loaded = new Set<string>();
  for (const use of headOf(maskComments(source)).matchAll(USEPACKAGE)) {
    for (const name of packageNames(use)) loaded.add(name);
  }
  return loaded;
}

/**
 * Where a new line for the preamble goes: the end of the line of the last
 * `\usepackage`, else of `\documentclass`; -1 without either.
 */
export function afterPackages(source: string): number {
  const head = headOf(maskComments(source));
  let at = -1;
  for (const use of head.matchAll(USEPACKAGE)) at = use.index + use[0].length;
  if (at < 0) {
    const documentClass = documentClassOf(head);
    if (!documentClass) return -1;
    at = documentClass.to;
  }
  return lineEnd(head, at);
}

/** A line without its comment; `\%` is a percent sign, not a comment. */
export function stripComment(line: string): string {
  return line.replace(/(?<!\\)%.*$/, "");
}

/** Every line without its comment; the line breaks stay, so offsets keep their lines. */
export function stripComments(text: string): string {
  return text.replace(/(?<!\\)%.*$/gm, "");
}

/** Comments blanked out with spaces, so offsets stay those of the source. */
export function maskComments(text: string): string {
  return text.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
}

/** The source up to `\begin{document}`, all of it without one. */
export function headOf(source: string): string {
  const begin = source.search(BEGIN_DOCUMENT);
  return begin < 0 ? source : source.slice(0, begin);
}

/** `a=1, b={2,3}` → `["a=1", "b={2,3}"]`: split at commas outside braces. */
export function splitOptions(options: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < options.length; i++) {
    const c = options[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(options.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(options.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

export interface DocumentClass {
  name: string;
  /** As written between the brackets, unsplit; "" without any. */
  options: string;
  /** Offsets of the whole command in the text searched. */
  from: number;
  to: number;
}

/** The first `\documentclass` of `text`; pass text without comments (see `stripComments`). */
export function documentClassOf(text: string): DocumentClass | null {
  const match = DOCUMENT_CLASS.exec(text);
  if (!match) return null;
  return { name: match[2].trim(), options: match[1] ?? "", from: match.index, to: match.index + match[0].length };
}

/** Whether the class `name` has chapters. */
export function hasChapters(name: string): boolean {
  return CHAPTER_CLASSES.has(name);
}
