// The LaTeX code behind the ribbon's format buttons. Pure text in, one change
// out, so the same click works on the open file and on the main file unseen.

import { documentClassOf, stripComments } from "./syntax";

export type Emphasis = "textbf" | "textit" | "underline" | "sout";

/** Replaces `from`…`to` with `insert`; selects `anchor`…`head` of the new text afterwards. */
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  select: { anchor: number; head: number };
}

/** The whole new text selected: a click on another button formats it again. */
export const selectAll = (from: number, to: number, insert: string): FormatEdit => ({
  from,
  to,
  insert,
  select: { anchor: 0, head: insert.length },
});

/** Index of the `}` closing the `{` at `open`, or -1; `\{` and `\}` are text, not braces. */
export function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Puts `\command{…}` around `from`…`to`, or takes it away if it is already
 * there (around the selection, or selected with it). Without a selection it
 * inserts the empty command with the cursor between the braces, to type into.
 */
export function toggleEmphasis(text: string, from: number, to: number, command: Emphasis): FormatEdit {
  const open = `\\${command}{`;
  if (from === to) return { from, to, insert: `${open}}`, select: { anchor: open.length, head: open.length } };

  const selected = text.slice(from, to);
  if (text.slice(from - open.length, from) === open && closingBrace(text, from - 1) === to) {
    return selectAll(from - open.length, to + 1, selected);
  }
  if (selected.startsWith(open) && closingBrace(selected, open.length - 1) === selected.length - 1) {
    return selectAll(from, to, selected.slice(open.length, -1));
  }
  // The text inside selected, so a second click finds the command around it.
  return { from, to, insert: `${open}${selected}}`, select: { anchor: open.length, head: open.length + selected.length } };
}

/** The sizes the ribbon's list offers, in pt: Word's. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;

/** LaTeX's relative font sizes, smallest first: what documents may set, which the list shows by their points. */
export const RELATIVE_SIZES = [
  "tiny",
  "scriptsize",
  "footnotesize",
  "small",
  "normalsize",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
] as const;
type RelativeSize = (typeof RELATIVE_SIZES)[number];

/** Points of each size for the base sizes of the standard classes (size10.clo, size11.clo, size12.clo). */
const POINTS: Record<10 | 11 | 12, number[]> = {
  10: [5, 7, 8, 9, 10, 12, 14.4, 17.28, 20.74, 24.88],
  11: [6, 8, 9, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88],
  12: [6, 8, 10, 10.95, 12, 14.4, 17.28, 20.74, 24.88, 24.88],
};

/** The points `size` has in a document set in `base` pt (10, 11 or 12; others as the nearest); `normalsize` is `base` itself. */
function relativePoints(size: RelativeSize, base: number): number {
  if (size === "normalsize") return base;
  const nearest = base <= 10.5 ? 10 : base < 11.5 ? 11 : 12;
  return POINTS[nearest][RELATIVE_SIZES.indexOf(size)];
}

/** `\sizeFourteen`: the command for a size of the list, the number in words, as command names have no digits. */
const SIZE_WORDS: Record<number, string> = {
  8: "Eight",
  9: "Nine",
  10: "Ten",
  10.5: "TenHalf",
  11: "Eleven",
  12: "Twelve",
  14: "Fourteen",
  16: "Sixteen",
  18: "Eighteen",
  20: "Twenty",
  22: "TwentyTwo",
  24: "TwentyFour",
  26: "TwentySix",
  28: "TwentyEight",
  36: "ThirtySix",
  48: "FortyEight",
  72: "SeventyTwo",
};
export const sizeCommandName = (points: number): string => `size${SIZE_WORDS[points] ?? "Custom"}`;

/** `\newcommand*{\sizeFourteen}{\fontsize{14}{16.8}\selectfont}`: a size the ribbon set, declared in the preamble. */
const SIZE_COMMAND =
  /^[ \t]*\\newcommand\*?\s*\{?\\(size[A-Z][A-Za-z]*)\}?\s*\{\\fontsize\s*\{(\d+(?:\.\d+)?)(?:pt)?\}\s*\{[^{}]*\}\s*\\selectfont\s*\}[ \t]*(?:\n|$)/gm;

/** The line declaring `name` for `points`, its lines 1.2 times as far apart, as LaTeX's own sizes are. */
export const sizeCommandLine = (name: string, points: number): string =>
  `\\newcommand*{\\${name}}{\\fontsize{${points}}{${Math.round(points * 12) / 10}}\\selectfont}`;

/** The size commands the main file declares (see `SIZE_COMMAND`): name → points. */
export function sizeCommandsOf(main: string): Map<string, number> {
  const commands = new Map<string, number>();
  for (const line of stripComments(main).matchAll(SIZE_COMMAND)) commands.set(line[1], parseFloat(line[2]));
  return commands;
}

/** The sizes as a family of declarations (see `setGroup`): LaTeX's own and those the main file `main` declares. */
export const sizeDeclarations = (main: string): Declarations => ({
  names: [...RELATIVE_SIZES, ...sizeCommandsOf(main).keys()],
  par: true,
  reset: "normalsize",
});

/** The size in pt at the end of `before` (see `declarationAt`), in a document set in `base` pt whose main file is `main`. */
export function pointsAt(before: string, main: string, base: number): number {
  const commands = sizeCommandsOf(main);
  const name = declarationAt(before, sizeDeclarations(main));
  if (!name) return base;
  return commands.get(name) ?? relativePoints(name as RelativeSize, base);
}

/**
 * The base size of the document in pt, from the options of `\documentclass`
 * (`12pt`, KOMA's `fontsize=12pt`), else the class's default.
 */
export function baseSizeOf(mainSource: string): number {
  const documentClass = documentClassOf(stripComments(mainSource));
  const explicit = /(?:^|[,\s])(?:fontsize\s*=\s*)?(\d+(?:\.\d+)?)pt\b/.exec(documentClass?.options ?? "");
  if (explicit) return parseFloat(explicit[1]);
  const className = documentClass?.name ?? "";
  return /^scr|^beamer$/.test(className) ? 11 : 10;
}

/**
 * A family of declarations the ribbon sets in groups around text: the sizes
 * (`{\large …}`), the fonts (`{\fontPagella …}`). Each works as a command and,
 * like every declaration, as an environment (`\begin{large} … \end{large}`).
 */
export interface Declarations {
  /** The declarations' names, without the backslash. */
  names: readonly string[];
  /** Whether a group spanning paragraphs ends in `\par`: a size spaces lines by its own measure, which counts at the paragraph's end. */
  par: boolean;
  /** The declaration that sets the default where no group can be taken away (`normalsize`); none for a font. */
  reset: string | null;
}

const escapeNames = (names: readonly string[]) => names.map((name) => name.replace(/[^a-zA-Z]/g, "")).join("|");

/** `{\large ` at the start of a group of `declarations`, with the name in group 1. */
export const groupHead = (declarations: Declarations) => new RegExp(`^\\{\\\\(${escapeNames(declarations.names)})(?![a-zA-Z])\\s?`);

/**
 * The declaration of `declarations` in effect at the end of `before` (the
 * text up to the cursor): the last one of the group the cursor is in, or of a
 * group around it (`{\large …}`, `\begin{large} … \end{large}`); `null`
 * without one, also at `\begin{document}`.
 */
export function declarationAt(before: string, declarations: Declarations): string | null {
  if (!declarations.names.length) return null;
  const command = new RegExp(`\\\\(${escapeNames(declarations.names)})(?![a-zA-Z])`, "y");
  // Comments blanked out, so their braces and commands do not count; offsets stay.
  const text = before.replace(/(?<!\\)%[^\n]*/g, (c) => " ".repeat(c.length));
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === "}" && text[i - 1] !== "\\") {
      // `\begin{…}` and `\end{…}` open and close like braces, as a whole.
      const environment = /\\(begin|end)\s*\{([^{}]*)\}$/.exec(text.slice(Math.max(0, i - 60), i + 1));
      if (!environment) depth++;
      else {
        i -= environment[0].length - 1;
        const name = environment[2].trim();
        if (environment[1] === "end") depth++;
        else if (depth > 0) depth--;
        else if (name === "document") return null;
        else if (declarations.names.includes(name)) return name;
      }
    } else if (c === "{" && text[i - 1] !== "\\") {
      // An open group around the cursor: its declarations, and those before it, still count.
      if (depth > 0) depth--;
    } else if (c === "\\" && depth === 0) {
      command.lastIndex = i;
      const found = command.exec(text);
      if (found && text[i - 1] !== "\\") return found[1];
    }
  }
  return null;
}

/**
 * Sets the selection in `name` of `declarations`: `{\large …}` around it, with
 * `\par` before the closing brace where it spans paragraphs and the family
 * asks for it. A selection that is such a group already, or its text, gets the
 * new declaration instead of a second group; `null` (the default) takes the
 * group away. Without a selection it inserts the empty group with the cursor
 * inside, to type into.
 */
export function setGroup(text: string, from: number, to: number, declarations: Declarations, name: string | null): FormatEdit {
  const set = name ?? declarations.reset;
  const open = set ? `{\\${set} ` : "";
  const head = groupHead(declarations);
  if (from === to) {
    // Right inside an empty group of another one: change that one.
    const before = text.slice(Math.max(0, from - 80), from);
    const empty = /\{\\([a-zA-Z]+) $/.exec(before);
    if (empty && declarations.names.includes(empty[1]) && text[from] === "}") {
      const start = from - empty[0].length;
      if (!name) return { from: start, to: from + 1, insert: "", select: { anchor: 0, head: 0 } };
      return { from: start, to: from + 1, insert: `${open}}`, select: { anchor: open.length, head: open.length } };
    }
    if (!open) return { from, to, insert: "", select: { anchor: 0, head: 0 } };
    return { from, to, insert: `${open}}`, select: { anchor: open.length, head: open.length } };
  }

  // The group selected with its text, or only its text.
  let groupFrom = -1;
  let groupTo = -1;
  const selected = text.slice(from, to);
  const own = head.exec(selected);
  if (own && closingBrace(selected, 0) === selected.length - 1) {
    groupFrom = from;
    groupTo = to;
  } else {
    const start = text.lastIndexOf("{", from - 1);
    const outer = start >= 0 ? head.exec(text.slice(start, from)) : null;
    if (outer && outer[0].length === from - start && closingBrace(text, start) === to) {
      groupFrom = start;
      groupTo = to + 1;
    }
  }

  let inner = selected;
  if (groupFrom >= 0) {
    const group = text.slice(groupFrom, groupTo);
    inner = group.slice(head.exec(group)![0].length, -1).replace(/\\par\s*$/, "");
    if (!name) return selectAll(groupFrom, groupTo, inner);
  }
  if (!open) return selectAll(from, to, selected);
  const par = declarations.par && /\n[ \t]*\n/.test(inner.trim()) ? "\\par" : "";
  const insert = `${open}${inner}${par}}`;
  // The text inside selected, so another one finds the group around it.
  return {
    from: groupFrom >= 0 ? groupFrom : from,
    to: groupFrom >= 0 ? groupTo : to,
    insert,
    select: { anchor: open.length, head: open.length + inner.length },
  };
}
