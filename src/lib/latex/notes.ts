// Notes for revising, with todonotes: in the margin or in the text, and all
// of them hidden at once for handing the work in (the package's `disable`).

import type { FormatEdit } from "./format";
import { headOf, indentOf, lineEnd, maskComments, packageNames, splitOptions, USEPACKAGE, type TextEdit } from "./syntax";

/** `\todo{…}`, `\todo[inline]{…}`. */
export const NOTE = /\\todo\s*(?:\[[^\]]*\])?\s*\{/;

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (char: string | undefined) => !!char && WORD.test(char);
/** Blanks within a line, which the note's own spacing replaces. */
const isBlank = (char: string | undefined) => char === " " || char === "\t";
/** No space between these and a margin note: "(\todo{} Wort", "Wort \todo{}." */
const OPENING = "([{";
const CLOSING = ".,;:!?)]}";

/**
 * Where a note goes: after the selection (it is about it), else at the
 * cursor. Never inside a word: at the cursor before the word (a command
 * with its backslash), after a selection behind the word it ends in.
 */
function notePlace(text: string, from: number, to: number): number {
  let at = to;
  if (!isWord(text[at - 1]) || !isWord(text[at])) return at;
  if (from < to) {
    while (isWord(text[at])) at++;
    return at;
  }
  while (isWord(text[at - 1])) at--;
  if (text[at - 1] === "\\") at--;
  return at;
}

/**
 * An empty note, the cursor in it (see `notePlace` for where). In the margin
 * it stands in the line with exactly one space to the words before and after
 * it; in the text it stands on a line of its own, as a paragraph would, with
 * its line's indentation.
 */
export function noteEdit(text: string, from: number, to: number, inline: boolean): FormatEdit {
  let at = notePlace(text, from, to);
  // A line of its own never starts with the punctuation that ends the words before it.
  if (inline && isWord(text[at - 1])) while (text[at] && CLOSING.includes(text[at])) at++;
  // The blanks around the place go, the note brings its own spacing; at a
  // line's start its indentation stays.
  let start = at;
  while (isBlank(text[start - 1])) start--;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const textBefore = start > lineStart;
  if (!textBefore) start = at;
  let end = at;
  while (isBlank(text[end])) end++;
  const textAfter = end < text.length && text[end] !== "\n";

  let note: string;
  let before = "";
  let after = "";
  if (inline) {
    note = "\\todo[inline]{}";
    const indent = indentOf(text.slice(lineStart));
    if (textBefore) before = `\n${indent}`;
    if (textAfter) after = `\n${indent}`;
  } else {
    note = "\\todo{}";
    if (textBefore && !OPENING.includes(text[start - 1])) before = " ";
    if (textAfter && !CLOSING.includes(text[end])) after = " ";
  }
  const code = before + note + after;
  const cursor = before.length + note.length - 1;
  return { from: start, to: end, insert: code, select: { anchor: cursor, head: cursor } };
}

function todonotesLoad(main: string) {
  for (const match of maskComments(headOf(main)).matchAll(USEPACKAGE)) {
    const names = packageNames(match);
    if (!names.includes("todonotes")) continue;
    return { match, alone: names.length === 1, options: splitOptions(match[1] ?? "") };
  }
  return null;
}

/**
 * How the notes look, in the margin and in the text: pale, without a frame,
 * the line to a margin note a little stronger so it can be followed. A colour
 * given to a single note still wins.
 */
const NOTES_STYLE = [
  "% Notes: quiet, without a frame",
  String.raw`\setuptodonotes{color=orange!22, bordercolor=orange!22, linecolor=orange!70, textcolor=black!85}`,
].join("\n");

/** Colours already set by the document's own: given to the package, or with `\setuptodonotes`. */
const OWN_STYLE = /\\setuptodonotes|\\define@key\s*\{todonotes\}/;
const COLOUR_OPTION = /^(?:color|backgroundcolor|bordercolor|linecolor|textcolor)\s*=/;

/** The note style (see `NOTES_STYLE`) right after todonotes is loaded, where the document has no colours of its own. */
export function notesStyleEdits(main: string): TextEdit[] {
  const load = todonotesLoad(main);
  if (!load || OWN_STYLE.test(maskComments(headOf(main))) || load.options.some((o) => COLOUR_OPTION.test(o))) return [];
  const at = lineEnd(main, load.match.index! + load.match[0].length);
  return [{ from: at, to: at, insert: `\n${NOTES_STYLE}` }];
}

/** Whether the notes are hidden: todonotes loaded with `disable`. */
export function notesHidden(main: string): boolean {
  return todonotesLoad(main)?.options.includes("disable") ?? false;
}

/** todonotes with `disable` or without; nothing where it is loaded with other packages. The edit comes alone. */
export function notesHiddenEdits(main: string, hidden: boolean): TextEdit[] {
  const load = todonotesLoad(main);
  if (!load?.alone) return [];
  const options = load.options.filter((o) => o !== "disable");
  if (hidden) options.push("disable");
  const from = load.match.index!;
  const insert = `\\usepackage${options.length ? `[${options.join(", ")}]` : ""}{todonotes}`;
  return [{ from, to: from + load.match[0].length, insert }];
}
