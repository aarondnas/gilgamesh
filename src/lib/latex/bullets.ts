// The ribbon's list buttons, as in Word: bullets (itemize), numbers
// (enumerate) and a list with levels (enumerate in enumerate: 1., a., i.).
// Pure text in, one change out, as in format.ts.
//
// In a list already, a click switches it to the other kind. Elsewhere a new
// list goes in at the cursor on lines of its own; with text selected, each
// selected paragraph becomes an item. A selection with headings, environments
// or items of its own is not turned into a list: what would become of it is
// not clear.

import type { FormatEdit } from "./format";
import { maskComments } from "./syntax";

export type BulletKind = "itemize" | "enumerate" | "multilevel";
export const BULLET_KINDS: readonly BulletKind[] = ["itemize", "enumerate", "multilevel"];

/** The environment a kind sets; a list with levels is numbered. */
const ENVIRONMENT: Record<BulletKind, "itemize" | "enumerate"> = {
  itemize: "itemize",
  enumerate: "enumerate",
  multilevel: "enumerate",
};

const STEP = "  ";

const LIST = /\\(begin|end)\s*\{(itemize|enumerate)\}/g;

interface Name {
  name: "itemize" | "enumerate";
  from: number;
  to: number;
}

/** Where the environment's name is in the `\begin{…}` or `\end{…}` `match` found. */
function nameOf(match: RegExpExecArray): Name {
  const from = match.index + match[0].indexOf("{") + 1;
  return { name: match[2] as Name["name"], from, to: from + match[2].length };
}

/** The lists begun before `at` in `text` and not yet ended there, the innermost last. */
function openAt(text: string, at: number): Name[] {
  const code = maskComments(text.slice(0, at));
  const pattern = new RegExp(LIST.source, "g");
  const open: Name[] = [];
  for (const match of code.matchAll(pattern)) {
    if (match[1] === "begin") open.push(nameOf(match));
    else if (open.at(-1)?.name === match[2]) open.pop();
  }
  return open;
}

/** The lists the cursor is in, the outermost first, from the text before it: what the list buttons show pressed. */
export const listsAt = (before: string): Name["name"][] => openAt(before, before.length).map((list) => list.name);

/**
 * Whether the button for `kind` shows pressed in `lists` (see `listsAt`): in
 * a single list its kind's; in a list inside another only the one for levels.
 */
export function bulletActive(kind: BulletKind, lists: readonly string[]): boolean {
  if (kind === "multilevel") return lists.length > 1;
  return lists.length === 1 && lists[0] === kind;
}

/** The innermost itemize or enumerate around `at` in `text`, with where its `\begin` and `\end` name it; `null` outside one. */
function listAround(text: string, at: number): { begin: Name; end: Name } | null {
  const begin = openAt(text, at).at(-1);
  if (!begin) return null;
  // Its `\end`, past the lists begun inside it.
  const code = maskComments(text);
  const pattern = new RegExp(LIST.source, "g");
  pattern.lastIndex = begin.to;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    if (match[1] === "begin") depth++;
    else if (depth > 0) depth--;
    else return match[2] === begin.name ? { begin, end: nameOf(match) } : null;
  }
  return null;
}

/**
 * In a list, what a click on bullets or numbers makes of it: the other kind,
 * the selection where it was; `null` outside a list, in one of that kind
 * already, and for a list with levels, which adds a level at the cursor instead.
 */
export function switchList(text: string, from: number, to: number, kind: BulletKind): FormatEdit | null {
  const list = kind === "multilevel" ? null : listAround(text, from);
  const name = ENVIRONMENT[kind];
  if (!list || list.begin.name === name) return null;
  const grow = name.length - list.begin.name.length;
  const inside = text.slice(list.begin.to, list.end.from);
  const insert = name + inside + name;
  // Offsets in the new text, which starts at the `\begin`'s name.
  const shift = (at: number) => at - list.begin.from + (at >= list.begin.to ? grow : 0);
  return { from: list.begin.from, to: list.end.to, insert, select: { anchor: shift(from), head: shift(to) } };
}

/** Whether a click on `kind` at `from` changes a list rather than putting in a new one. */
export const switchesList = (text: string, from: number, kind: BulletKind) => kind !== "multilevel" && listAround(text, from) !== null;

export class BulletError extends Error {
  constructor() {
    super("selection");
  }
}

/** What in a selection keeps it from becoming a list. */
const STRUCTURE = /\\(begin|end|item|part|chapter|section|subsection|subsubsection|paragraph|addchap|addsec)\b|\\\[|\\\]|\$\$/;

/** The items a selection makes: its paragraphs, each on one line or several; none for an empty one. */
export function itemsOf(selection: string): string[] {
  if (STRUCTURE.test(maskComments(selection))) throw new BulletError();
  return selection
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

/**
 * A new list of `kind` for lines of its own at `indent`, with `items` (from a
 * selection) or one empty item, the cursor in the first empty one. A new
 * list with levels gets a second level under its first item; one made of a
 * selection numbers its items on the first level, as in Word.
 */
export function bulletBlock(kind: BulletKind, items: string[], indent: string) {
  const name = ENVIRONMENT[kind];
  const lines: string[] = [`\\begin{${name}}`];
  const item = (text: string, depth: string) => {
    const [first, ...rest] = text.split("\n");
    lines.push(`${depth}\\item ${first}`, ...rest.map((line) => `${depth}${STEP}${line}`));
  };
  if (!items.length) {
    item("", STEP);
    if (kind === "multilevel") lines.push(`${STEP}\\begin{${name}}`, `${STEP}${STEP}\\item `, `${STEP}\\end{${name}}`);
  }
  for (const text of items) item(text, STEP);
  lines.push(`\\end{${name}}`);
  const code = lines.join(`\n${indent}`);
  // The cursor in the first empty item; behind the list where it was made of a selection.
  const empty = /\\item (?=\n|$)/.exec(code);
  const cursor = empty ? empty.index + empty[0].length : code.length;
  return { code, select: { anchor: cursor, head: cursor } };
}
