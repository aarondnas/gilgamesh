// What the ribbon's font buttons act on, as the lists beside them choose: the
// word at the cursor, the paragraph, the section or the whole document. Pure
// text in, one change out, as in format.ts.

import { bodyDeclarations, declareInBody, environmentAround } from "./align";
import { closingBrace, groupHead, setGroup, toggleEmphasis, type Declarations, type Emphasis, type FormatEdit } from "./format";
import { indentOf } from "./syntax";

/** What a click on a font button acts on. */
export type Scope = "word" | "paragraph" | "section" | "document";
export const SCOPES: readonly Scope[] = ["word", "paragraph", "section", "document"];

/** The scopes an emphasis can act on: underlining and striking out have no declaration for the whole document. */
export const emphasisScopes = (command: Emphasis): readonly Scope[] =>
  command === "underline" || command === "sout" ? SCOPES.filter((scope) => scope !== "document") : SCOPES;

type Range = { from: number; to: number };
type Selection = { anchor: number; head: number };

// ---------------------------------------------------------------------------
// The word at the cursor.

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The word the cursor `at` is inside of (not at its start or end, where Word formats what is typed next); not a command's name. */
function wordAt(text: string, at: number): Range | null {
  let from = at;
  let to = at;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from--;
  while (to < text.length && WORD_CHAR.test(text[to])) to++;
  if (from === at || to === at) return null;
  if (text[from - 1] === "\\" && text[from - 2] !== "\\") return null;
  return { from, to };
}

/** `edit` on the selection; without one on the word at the cursor, which keeps its place in it; else at the cursor. */
export function atWord(text: string, from: number, to: number, edit: (from: number, to: number) => FormatEdit): FormatEdit {
  const word = from === to ? wordAt(text, from) : null;
  if (!word) return edit(from, to);
  const result = edit(word.from, word.to);
  // The word's text starts at `select.anchor` after the change, wrapped or unwrapped.
  const cursor = result.select.anchor + from - word.from;
  return { ...result, select: { anchor: cursor, head: cursor } };
}

/** Bold, italic, underlined or struck out: the selection, the word at the cursor, or what is typed next. */
export const emphasizeWord = (text: string, from: number, to: number, command: Emphasis): FormatEdit =>
  atWord(text, from, to, (a, b) => toggleEmphasis(text, a, b, command));

/** The selection, the word at the cursor, or what is typed next in `name` of `declarations` (see `setGroup`); `null` is the default. */
export const declareWord = (text: string, from: number, to: number, declarations: Declarations, name: string | null): FormatEdit =>
  atWord(text, from, to, (a, b) => setGroup(text, a, b, declarations, name));

// ---------------------------------------------------------------------------
// Several places changed at once.

export interface Change extends Range {
  insert: string;
  /** Where a cursor right at an insertion ends up: after it (1) or before it (-1). */
  assoc: 1 | -1;
}

/** `changes` (in order, apart) as one edit; the selection stays on the same text. `at` is where an edit without changes goes. */
export function combine(text: string, changes: Change[], select: Selection, at: number): FormatEdit {
  const from = changes.length ? changes[0].from : at;
  const to = changes.length ? changes[changes.length - 1].to : at;
  let insert = "";
  let pos = from;
  for (const change of changes) {
    insert += text.slice(pos, change.from) + change.insert;
    pos = change.to;
  }
  insert += text.slice(pos, to);
  const place = (offset: number) => {
    let shift = 0;
    for (const change of changes) {
      if (offset < change.from || (offset === change.to && change.from === change.to && change.assoc < 0)) break;
      if (offset < change.to) return change.from + shift + (change.assoc > 0 ? change.insert.length : 0) - from;
      shift += change.insert.length - (change.to - change.from);
    }
    return offset + shift - from;
  };
  return { from, to, insert, select: { anchor: place(select.anchor), head: place(select.head) } };
}

// ---------------------------------------------------------------------------
// Paragraphs and sections.

/** The command put around a whole paragraph; ulem's `\uline` breaks lines, `\underline` does not. */
const PARAGRAPH_COMMAND: Record<Emphasis, string> = { textbf: "textbf", textit: "textit", underline: "uline", sout: "sout" };
/** The commands that count as the emphasis around a paragraph already. */
const SAME_COMMANDS: Record<Emphasis, string[]> = {
  textbf: ["textbf"],
  textit: ["textit"],
  underline: ["uline", "underline"],
  sout: ["sout"],
};

/** The packages an emphasis needs: ulem for `\uline` around paragraphs and for striking out (`\sout`), which LaTeX has no command of its own for. */
export const emphasisPackages = (edit: FormatEdit): string[] =>
  edit.insert.includes("\\uline{") || edit.insert.includes("\\sout{") ? ["ulem"] : [];

/**
 * Puts `\textbf{…}` around each of `paragraphs` (see `textParagraphs`), or,
 * where every one has it already, takes it away from all, as Word does.
 * Underlining is ulem's `\uline`, which breaks lines, as does its `\sout`. `null` without paragraphs.
 */
export function emphasizeParagraphs(text: string, paragraphs: Range[], command: Emphasis, select: Selection): FormatEdit | null {
  if (!paragraphs.length) return null;
  /** The length of the command's opening where it is around `paragraph`, else 0. */
  const opening = (paragraph: Range) => {
    for (const name of SAME_COMMANDS[command]) {
      const open = `\\${name}{`;
      if (text.startsWith(open, paragraph.from) && closingBrace(text, paragraph.from + open.length - 1) === paragraph.to - 1) {
        return open.length;
      }
    }
    return 0;
  };
  const remove = paragraphs.every((paragraph) => opening(paragraph) > 0);
  const changes: Change[] = [];
  for (const paragraph of paragraphs) {
    const length = opening(paragraph);
    if (remove) {
      changes.push({ from: paragraph.from, to: paragraph.from + length, insert: "", assoc: 1 });
      changes.push({ from: paragraph.to - 1, to: paragraph.to, insert: "", assoc: -1 });
    } else if (!length) {
      changes.push({ from: paragraph.from, to: paragraph.from, insert: `\\${PARAGRAPH_COMMAND[command]}{`, assoc: 1 });
      changes.push({ from: paragraph.to, to: paragraph.to, insert: "}", assoc: -1 });
    }
  }
  return combine(text, changes, select, paragraphs[0].from);
}

/**
 * Sets each of `paragraphs` in `name` of `declarations`: `{\large …\par}`,
 * with `\par` where the family asks for it (a size, so its lines are spaced
 * for it too). A group of the family around it already gets the new one;
 * `null` (the default) takes it away. `null` without paragraphs.
 */
export function declareParagraphs(
  text: string,
  paragraphs: Range[],
  declarations: Declarations,
  name: string | null,
  select: Selection,
): FormatEdit | null {
  if (!paragraphs.length) return null;
  const head = groupHead(declarations);
  const close = declarations.par ? "\\par}" : "}";
  const changes: Change[] = [];
  for (const paragraph of paragraphs) {
    const body = text.slice(paragraph.from, paragraph.to);
    const own = head.exec(body);
    if (own && closingBrace(text, paragraph.from) === paragraph.to - 1) {
      const tail = body.endsWith("\\par}") ? "\\par}".length : 1;
      changes.push({ from: paragraph.from, to: paragraph.from + own[0].length, insert: name ? `{\\${name} ` : "", assoc: 1 });
      changes.push({ from: paragraph.to - tail, to: paragraph.to, insert: name ? close : "", assoc: -1 });
    } else if (name) {
      changes.push({ from: paragraph.from, to: paragraph.from, insert: `{\\${name} `, assoc: 1 });
      changes.push({ from: paragraph.to, to: paragraph.to, insert: close, assoc: -1 });
    }
  }
  return combine(text, changes, select, paragraphs[0].from);
}

/**
 * Sets `range` (whole lines, see `sectionRange`) in `name` of `declarations`:
 * the declaration as an environment around it, `\begin{large} … \end{large}`,
 * with a blank line before its end, which ends the last paragraph inside (a
 * size spaces its lines by its own measure); also after a comment. One of the
 * family around it already gets the new name; `null` takes it away.
 */
export function declareRange(text: string, range: Range, declarations: Declarations, name: string | null, select: Selection): FormatEdit {
  const environments = Object.fromEntries(declarations.names.map((n) => [n, n]));
  const own = environmentAround(text, range.from, range.to, environments);
  const from = own?.from ?? range.from;
  const to = own?.to ?? range.to;
  const innerFrom = own?.innerFrom ?? from;
  let innerTo = own?.innerTo ?? to;
  // The blank line (or `\par`) before `\end`, which a new one replaces.
  if (own) innerTo = innerFrom + text.slice(innerFrom, innerTo).replace(/(?:\\par)?\s*$/, "").length;
  let prefix = "";
  let suffix = "";
  if (name) {
    const indent = indentOf(text.slice(from, to));
    prefix = `${indent}\\begin{${name}}\n`;
    suffix = `\n\n${indent}\\end{${name}}`;
  }
  const insert = `${prefix}${text.slice(innerFrom, innerTo)}${suffix}`;
  const place = (at: number) => prefix.length + Math.min(Math.max(at, innerFrom), innerTo) - innerFrom;
  return { from, to, insert, select: { anchor: place(select.anchor), head: place(select.head) } };
}

// ---------------------------------------------------------------------------
// The whole document: declarations after `\begin{document}` (see `declareInBody`).

const DOCUMENT_DECLARATION: Partial<Record<Emphasis, string>> = { textbf: "bfseries", textit: "itshape" };

/** Bold or italic for the whole document, in the main file `main`; again takes it away. `null` without `\begin{document}`. */
export function emphasizeDocument(main: string, command: Emphasis): FormatEdit | null {
  const name = DOCUMENT_DECLARATION[command];
  const body = bodyDeclarations(main);
  if (!name || !body) return null;
  return declareInBody(main, [name], body.lines.some((line) => line.name === name) ? null : name);
}

/** The whole document in `name` of `declarations`, in the main file `main`; `null` takes the declaration away. `null` without `\begin{document}`. */
export const declareDocument = (main: string, declarations: Declarations, name: string | null): FormatEdit | null =>
  declareInBody(main, declarations.names, name);
