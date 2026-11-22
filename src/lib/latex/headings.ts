// Headings as Word's styles: the paragraph at the cursor made a heading of a
// level ("Heading 1" is `\chapter` where the class has chapters, else
// `\section`), a heading made another level, numbered or not (as the
// document numbers it: by its star and the preamble's `secnumdepth`), or
// plain text.

import type { FormatEdit } from "./format";
import { paragraphRange } from "./align";
import { BEGIN_DOCUMENT, indentOf, maskComments } from "./syntax";

/** `normal`: plain text; 1 … 3 the heading levels Word offers first. */
export type HeadingStyle = "normal" | 1 | 2 | 3;
export const HEADING_STYLES: HeadingStyle[] = ["normal", 1, 2, 3];

const COMMANDS: Record<"chapters" | "sections", string[]> = {
  chapters: ["chapter", "section", "subsection"],
  sections: ["section", "subsection", "subsubsection"],
};

/** `\section*[short]{`: group 1 the indent, 2 the command, 3 the star. */
const HEADING = /^([ \t]*)\\(part|chapter|section|subsection|subsubsection|paragraph|addchap|addsec)(\*?)\s*(?:\[[^\]]*\])?\s*\{/;

export interface HeadingLine {
  /** The line, in offsets of the text. */
  from: number;
  to: number;
  indent: string;
  command: string;
  starred: boolean;
  /** The title between the braces, and what follows them on the line (`\label{…}`). */
  title: string;
  rest: string;
  /** Where the command's name is. */
  commandFrom: number;
}

/** The heading on the line of `at`; `null` where the line is none. */
function headingAt(text: string, at: number): HeadingLine | null {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  const to = end < 0 ? text.length : end;
  const line = text.slice(from, to);
  const match = HEADING.exec(line);
  if (!match) return null;
  // The title's closing brace, past braces inside it.
  let depth = 1;
  let i = match[0].length;
  for (; i < line.length && depth > 0; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "{") depth++;
    else if (line[i] === "}") depth--;
  }
  if (depth > 0) return null;
  return {
    from,
    to,
    indent: match[1],
    command: match[2],
    starred: match[3] === "*",
    title: line.slice(match[0].length, i - 1),
    rest: line.slice(i),
    commandFrom: from + match[1].length + 1,
  };
}

/** The style of the line before the cursor (the text up to it), for the ribbon to mark. */
export function headingStyleAt(before: string, chapters: boolean): HeadingStyle | null {
  // The title may go on past the cursor: the line's start is enough.
  const heading = HEADING.exec(before.slice(before.lastIndexOf("\n") + 1));
  if (!heading) return "normal";
  const level = COMMANDS[chapters ? "chapters" : "sections"].indexOf(heading[2]);
  return level < 0 ? null : ((level + 1) as HeadingStyle);
}

/**
 * The paragraph at `from`…`to` in `style`: a heading's command changes (its
 * star stays), plain text becomes the title of a new heading on its line, a
 * heading becomes plain text. On an empty line an empty heading comes, with
 * the cursor in it. `null` where nothing changes.
 */
export function headingEdit(text: string, from: number, to: number, style: HeadingStyle, chapters: boolean): FormatEdit | null {
  const command = style === "normal" ? null : COMMANDS[chapters ? "chapters" : "sections"][style - 1];
  const heading = headingAt(text, from);
  if (heading) {
    if (!command) {
      const insert = heading.indent + heading.title + heading.rest;
      return {
        from: heading.from,
        to: heading.to,
        insert,
        select: { anchor: heading.indent.length, head: heading.indent.length + heading.title.length },
      };
    }
    if (command === heading.command) return null;
    const at = heading.commandFrom - heading.from;
    const insert =
      text.slice(heading.from, heading.commandFrom) + command + text.slice(heading.commandFrom + heading.command.length, heading.to);
    const start = at + command.length + (heading.starred ? 1 : 0) + 1;
    return { from: heading.from, to: heading.to, insert, select: { anchor: start, head: start + heading.title.length } };
  }
  if (!command) return null;
  const range = paragraphRange(text, from, to);
  if (!range) {
    const insert = `\\${command}{}`;
    return { from, to, insert, select: { anchor: insert.length - 1, head: insert.length - 1 } };
  }
  const paragraph = text.slice(range.from, range.to);
  const indent = indentOf(paragraph);
  const title = paragraph
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  const insert = `${indent}\\${command}{${title}}`;
  const start = indent.length + command.length + 2;
  return { from: range.from, to: range.to, insert, select: { anchor: start, head: start + title.length } };
}

// ---------------------------------------------------------------------------
// Numbering. A heading gets a number where it has no star, is no KOMA
// `\addchap`/`\addsec` (always without), and its level is within the
// document's `secnumdepth`: what the ribbon's toggle shows pressed. Down to
// which level headings are numbered, and listed in the table of contents
// (`tocdepth`), the ribbon also sets for the whole document, in the preamble.

/** LaTeX's levels of the headings (`\section` is 1); `\part` is -1 in classes with chapters, else 0. */
const LEVEL: Record<string, number> = {
  chapter: 0,
  addchap: 0,
  section: 1,
  addsec: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};
const levelOf = (command: string, chapters: boolean) => (command === "part" ? (chapters ? -1 : 0) : LEVEL[command]);

/** The counters for how deep headings are numbered and listed in the table of contents. */
export type DepthCounter = "secnumdepth" | "tocdepth";

/** `\setcounter{tocdepth}{2}`, or with KOMA's names of the levels (`{\subsectiontocdepth}`): group 1 the counter, 2 the depth. */
const DEPTH_SETTING = /\\setcounter\s*\{(secnumdepth|tocdepth)\}\s*\{\s*(-?\d+|\\[a-z]+(?:num|toc)depth)\s*\}/g;

/** The preamble of the main file `main` (up to `\begin{document}`), with comments masked; all of it without one. */
function preambleCode(main: string): string {
  const code = maskComments(main);
  const begin = BEGIN_DOCUMENT.exec(code);
  return begin ? code.slice(0, begin.index) : code;
}

/** The last setting of `counter` in the preamble of `main`, with where it is. */
function lastSetting(main: string, counter: DepthCounter) {
  return [...preambleCode(main).matchAll(DEPTH_SETTING)].filter((set) => set[1] === counter).at(-1);
}

/**
 * The deepest level the main file `main` numbers (`secnumdepth`) or lists in
 * the table of contents (`tocdepth`): as its preamble sets it, else as its
 * class does (2 with chapters, else 3).
 */
export function depthOf(main: string, counter: DepthCounter, chapters: boolean): number {
  const set = lastSetting(main, counter);
  if (set) {
    const named = /^\\([a-z]+?)(?:num|toc)depth$/.exec(set[2]);
    const value = named ? levelOf(named[1], chapters) : Number(set[2]);
    if (value !== undefined && !Number.isNaN(value)) return value;
  }
  return chapters ? 2 : 3;
}

/** The deepest level the main file `main` numbers (see `depthOf`). */
export const secnumdepthOf = (main: string, chapters: boolean) => depthOf(main, "secnumdepth", chapters);

/**
 * The main file `main` with `counter` at `value`: its preamble's last
 * `\setcounter` of it changed (a comment after it stays), or one put in before
 * `\begin{document}`. `null` where it is so already, or without `\begin{document}`.
 */
export function depthEdit(
  main: string,
  counter: DepthCounter,
  value: number,
  chapters: boolean,
): { from: number; to: number; insert: string } | null {
  if (depthOf(main, counter, chapters) === value) return null;
  const begin = BEGIN_DOCUMENT.exec(maskComments(main));
  if (!begin) return null;
  const line = `\\setcounter{${counter}}{${value}}`;
  const set = lastSetting(main, counter);
  if (set) return { from: set.index!, to: set.index! + set[0].length, insert: line };
  // Beside the other one where there is one, else right before the document.
  const other = lastSetting(main, counter === "secnumdepth" ? "tocdepth" : "secnumdepth");
  const at = other ? main.indexOf("\n", other.index!) + 1 || main.length : main.lastIndexOf("\n", begin.index) + 1;
  return { from: at, to: at, insert: `${line}\n` };
}

/** The level "Heading `n`" has (1 … 3; 0 for none of them): `\chapter` is 0 where the class has chapters, else `\section` is 1. */
export const headingLevel = (n: number, chapters: boolean) => n - (chapters ? 1 : 0);

/** Whether the heading on the line before the cursor (`before`, the text up to it) gets a number; `false` off a heading. */
export function headingNumberedAt(before: string, depth: number, chapters: boolean): boolean {
  const heading = HEADING.exec(before.slice(before.lastIndexOf("\n") + 1));
  if (!heading || heading[3] === "*" || heading[2].startsWith("add")) return false;
  const level = levelOf(heading[2], chapters);
  return level !== undefined && level <= depth;
}

/**
 * The heading at `at` without its number: a star after its command; `null`
 * off a heading and for one already starred or a KOMA `\addchap`/`\addsec`.
 */
export function unnumberHeading(text: string, at: number): FormatEdit | null {
  const heading = headingAt(text, at);
  if (!heading || heading.starred || heading.command.startsWith("add")) return null;
  const nameEnd = heading.commandFrom + heading.command.length;
  return lineEdit(text, heading, at, nameEnd, nameEnd, "*");
}

/**
 * The heading at `at` numbered: without its star, and `\addchap`/`\addsec` as
 * `\chapter`/`\section`; `level` the level it then has (for `secnumdepth`).
 * `null` off a heading; `edit` `null` where its line stays as it is.
 */
export function numberHeading(text: string, at: number, chapters: boolean): { edit: FormatEdit | null; level: number } | null {
  const heading = headingAt(text, at);
  if (!heading) return null;
  const level = levelOf(heading.command, chapters) ?? 0;
  const nameEnd = heading.commandFrom + heading.command.length;
  const end = nameEnd + (heading.starred ? 1 : 0);
  if (heading.command.startsWith("add")) {
    return { edit: lineEdit(text, heading, at, heading.commandFrom, end, heading.command === "addchap" ? "chapter" : "section"), level };
  }
  return { edit: heading.starred ? lineEdit(text, heading, at, nameEnd, end, "") : null, level };
}

/** Its line with `from`…`to` replaced by `insert`, the cursor (at `at`) where it was in the text. */
function lineEdit(text: string, heading: HeadingLine, at: number, from: number, to: number, insert: string): FormatEdit {
  const line = text.slice(heading.from, from) + insert + text.slice(to, heading.to);
  const cursor = at <= from ? at : at >= to ? at + insert.length - (to - from) : from + insert.length;
  return { from: heading.from, to: heading.to, insert: line, select: { anchor: cursor - heading.from, head: cursor - heading.from } };
}

/** The main file `main` numbering headings down to `level` at least (see `depthEdit`); `null` where it does already. */
export const secnumdepthEdit = (main: string, level: number, chapters: boolean) =>
  secnumdepthOf(main, chapters) >= level ? null : depthEdit(main, "secnumdepth", level, chapters);

/**
 * An empty `\footnote{}` at the cursor, or after the selection, which it
 * belongs to, as Word puts the mark; the cursor in it. Right after the word:
 * a space before it would show in the text.
 */
export function footnoteEdit(text: string, from: number, to: number): FormatEdit {
  let at = to;
  // Spaces between words stay.
  if (to === text.length || /\s/.test(text[to])) while (at > 0 && text[at - 1] === " ") at--;
  return { from: at, to, insert: "\\footnote{}", select: { anchor: 10, head: 10 } };
}
