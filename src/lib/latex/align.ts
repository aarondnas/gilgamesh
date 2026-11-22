// Paragraph alignment as the ribbon shows and sets it: what is in effect at
// the cursor, and the LaTeX that sets it for a paragraph, a section or the
// whole document. Pure text in, one change out, as in format.ts.

import { closingBrace, RELATIVE_SIZES, selectAll, type FormatEdit } from "./format";
import { escapeRegExp } from "$lib/util/regex";
import { BEGIN_DOCUMENT, headOf, indentOf, maskComments, packageNames, USEPACKAGE } from "./syntax";

/** `justify` is LaTeX's own: what text has without any other alignment. */
export type Alignment = "justify" | "left" | "center" | "right";
export const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right", "justify"];

/** What a click on an alignment button sets. */
export type AlignScope = "paragraph" | "section" | "document";
export const ALIGN_SCOPES: readonly AlignScope[] = ["paragraph", "section", "document"];

/** The environment set around a paragraph or section; `justify` comes from ragged2e. */
const ENVIRONMENT: Record<Alignment, string> = { justify: "justify", left: "flushleft", center: "center", right: "flushright" };
/** The declaration for the whole document and for list items; `\justifying` comes from ragged2e. */
const DECLARATION: Record<Alignment, string> = {
  justify: "\\justifying",
  left: "\\raggedright",
  center: "\\centering",
  right: "\\raggedleft",
};

/** Environments that align, with ragged2e's (`FlushLeft`, …) read as well. */
const ENVIRONMENTS: Record<string, Alignment> = {
  flushleft: "left",
  FlushLeft: "left",
  center: "center",
  Center: "center",
  flushright: "right",
  FlushRight: "right",
  justify: "justify",
};
/** Declarations that align, with ragged2e's read as well. */
const DECLARATIONS: Record<string, Alignment> = {
  raggedright: "left",
  RaggedRight: "left",
  centering: "center",
  Centering: "center",
  raggedleft: "right",
  RaggedLeft: "right",
  justifying: "justify",
};

/**
 * Boxes that set their text justified again whatever is around them
 * (LaTeX's `\@parboxrestore`): what is in them has its own alignment.
 */
const RESETTING_ENVIRONMENTS = new Set(["minipage", "figure", "figure*", "table", "table*", "wrapfigure", "wraptable"]);
const RESETTING_COMMAND = /\\(?:footnote|footnotetext|marginpar)\s*(?:\[[^\]]*\])?\s*$|\\parbox\s*(?:\[[^\]]*\]\s*){0,3}\{[^{}]*\}\s*$/;

const DECLARATION_AT = new RegExp(`\\\\(${Object.keys(DECLARATIONS).join("|")})(?![a-zA-Z])`, "y");

/** The packages an alignment needs. */
export const alignmentPackages = (alignment: Alignment): string[] => (alignment === "justify" ? ["ragged2e"] : []);

/**
 * The alignment in effect at the end of `before` (the text up to the cursor):
 * the alignment environment or group the cursor is in, or the last declaration
 * before it in that group or one around it. `outside` is what the text starts
 * in: for an included file, what the main file has where it includes it.
 */
export function alignmentAt(before: string, outside: Alignment = "justify"): Alignment {
  const text = maskComments(before);
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
        else if (name === "document") return preambleAlignment(text.slice(0, i));
        else if (name in ENVIRONMENTS) return ENVIRONMENTS[name];
        else if (RESETTING_ENVIRONMENTS.has(name)) return "justify";
      }
    } else if (c === "{" && text[i - 1] !== "\\") {
      // An open group around the cursor: its declarations, and those before it, still count.
      if (depth > 0) depth--;
      else if (RESETTING_COMMAND.test(text.slice(Math.max(0, i - 80), i))) return "justify";
    } else if (c === "\\" && depth === 0 && text[i - 1] !== "\\") {
      DECLARATION_AT.lastIndex = i;
      const declaration = DECLARATION_AT.exec(text);
      if (declaration) return DECLARATIONS[declaration[1]];
    }
  }
  return outside;
}

/** What the preamble sets for the whole document: ragged2e's `document` option, or a declaration. */
function preambleAlignment(head: string): Alignment {
  let base: Alignment = "justify";
  for (const use of head.matchAll(USEPACKAGE)) {
    const names = packageNames(use);
    if (names.includes("ragged2e") && /(?:^|,)\s*document\s*(?:,|$)/.test(use[1] ?? "")) base = "left";
  }
  return alignmentAt(
    head.replace(USEPACKAGE, (u) => " ".repeat(u.length)),
    base,
  );
}

/**
 * The alignment the main file sets at the start of its body, which every
 * included file starts in; `included` (the argument of its `\input` or
 * `\include`, as `chapters/intro`) where the main file includes that one.
 */
export function documentAlignment(main: string, included?: string): Alignment {
  const body = BEGIN_DOCUMENT.exec(main);
  if (!body) return "justify";
  const masked = maskComments(main);
  let at = -1;
  if (included) {
    const name = escapeRegExp(included);
    const inclusion = new RegExp(String.raw`\\(?:input|include|subfile)\s*\{\s*(?:\./)?${name}(?:\.tex)?\s*\}`);
    at = masked.slice(body.index).search(inclusion);
  }
  // Else where the first file is included, or at the end of what the body declares first.
  if (at < 0) at = masked.slice(body.index).search(/\\(?:input|include|subfile)\s*\{/);
  if (at < 0) at = masked.slice(body.index).search(/\\end\s*\{document\}/);
  return alignmentAt(main.slice(0, at < 0 ? main.length : body.index + at));
}

// ---------------------------------------------------------------------------
// Ranges: the paragraph and the section the cursor is in.

const BLANK = /^\s*$/;
/** `\begin{…}` or `\end{…}` alone, also with the environment's arguments: `\begin{spacing}{1.5}`, `\begin{minipage}[t]{5cm}`. */
const ENVIRONMENT_LINE = /^\s*\\(?:begin|end)\s*\{[^}]*\}(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*\s*(?:%.*)?$/;
const HEADING_LINE = /^\s*\\(part|addpart|chapter|addchap|section|addsec|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const ITEM = /^\s*\\item\b(?:\s*\[[^\]]*\])?\s*/;
const END_DOCUMENT_LINE = /^\s*\\end\s*\{document\}/;

const LEVELS: Record<string, number> = {
  part: 0,
  addpart: 0,
  chapter: 1,
  addchap: 1,
  section: 2,
  addsec: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

interface Line {
  from: number;
  to: number;
  text: string;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const line of text.split("\n")) {
    lines.push({ from, to: from + line.length, text: line });
    from += line.length + 1;
  }
  return lines;
}

const lineIndex = (lines: Line[], at: number) => {
  let index = 0;
  while (index < lines.length - 1 && lines[index + 1].from <= at) index++;
  return index;
};

/** Lines that are no part of a paragraph: blank ones, `\begin{…}` / `\end{…}` alone, headings. */
const separates = (line: string) => BLANK.test(line) || ENVIRONMENT_LINE.test(line) || HEADING_LINE.test(line);

/**
 * The paragraphs `from`…`to` touch, as whole lines: up to blank lines, lines
 * that only begin or end an environment, headings and list items (each item
 * is a paragraph of its own, as in Word). `null` on a blank line.
 */
export function paragraphRange(text: string, from: number, to: number): { from: number; to: number } | null {
  const lines = linesOf(text);
  let first = lineIndex(lines, from);
  // A selection of whole lines ends at the start of the next one, which it does not mean.
  let last = lineIndex(lines, to > from && text[to - 1] === "\n" ? to - 1 : to);
  if (first === last && BLANK.test(lines[first].text)) return null;
  // A heading is set as a paragraph of its own.
  if (first === last && HEADING_LINE.test(lines[first].text)) return { from: lines[first].from, to: lines[first].to };
  while (first > 0 && !ITEM.test(lines[first].text) && !separates(lines[first - 1].text)) first--;
  while (last < lines.length - 1 && !separates(lines[last + 1].text) && !ITEM.test(lines[last + 1].text)) last++;
  return { from: lines[first].from, to: lines[last].to };
}

/**
 * What belongs to the heading the cursor is under: the lines after it, up to
 * the next heading of the same level or above, `\end{document}` or the end of
 * the file; blank lines at both ends left out. `null` without a heading before the cursor.
 */
export function sectionRange(text: string, at: number): { from: number; to: number } | null {
  const lines = linesOf(maskComments(text));
  let heading = lineIndex(lines, at);
  let level = -1;
  for (; heading >= 0; heading--) {
    const match = HEADING_LINE.exec(lines[heading].text);
    if (match) {
      level = LEVELS[match[1]];
      break;
    }
  }
  if (heading < 0) return null;
  let first = heading + 1;
  let last = first;
  while (last < lines.length) {
    const match = HEADING_LINE.exec(lines[last].text);
    if ((match && LEVELS[match[1]] <= level) || END_DOCUMENT_LINE.test(lines[last].text)) break;
    last++;
  }
  last--;
  while (first <= last && BLANK.test(lines[first].text)) first++;
  while (last >= first && BLANK.test(lines[last].text)) last--;
  if (first > last) return null;
  return { from: lines[first].from, to: lines[last].to };
}

/** How a paragraph of text starts: not with a command, unless one within text (`\textbf`, `\cite`, …). */
const TEXT_START =
  /^(?:[^\\]|\\(?:text(?:bf|it|sl|sc|sf|tt|rm|up|md|color)|emph|underline|uline|sout|noindent|enquote|foreignlanguage|href|url|ref|eqref|autoref|[cC]ref|cite[a-zA-Z]*|LaTeX|TeX|ldots|dots)(?![a-zA-Z])|\\[^a-zA-Z])/;

/**
 * The text of each paragraph in `range` (whole lines, see `paragraphRange` and
 * `sectionRange`): from its first character, after `\item` and the
 * indentation, to its last, before a comment at the end of its last line.
 * Only paragraphs of text, not those of commands such as `\centering` and
 * `\includegraphics` in a figure.
 */
export function textParagraphs(text: string, range: { from: number; to: number }): { from: number; to: number }[] {
  const lines = linesOf(maskComments(text)).filter((line) => line.from >= range.from && line.to <= range.to);
  const paragraphs: { from: number; to: number }[] = [];
  let first: Line | null = null;
  let last: Line | null = null;
  const close = () => {
    if (first && last) {
      const from = first.from + (ITEM.exec(first.text) ?? /^\s*/.exec(first.text)!)[0].length;
      const to = last.from + last.text.trimEnd().length;
      if (from < to && TEXT_START.test(text.slice(from, to))) paragraphs.push({ from, to });
    }
    first = last = null;
  };
  for (const line of lines) {
    if (separates(line.text)) {
      close();
      continue;
    }
    if (ITEM.test(line.text)) close();
    first ??= line;
    last = line;
  }
  close();
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Setting the alignment of a range.

/** What is set around a range (an alignment, a size), and what of the text it takes up. */
export interface Wrapper<T = Alignment> {
  kind: T;
  /** The whole of it, from its opening to its end. */
  from: number;
  to: number;
  /** What it is around, which stays when it changes or goes. */
  innerFrom: number;
  innerTo: number;
}

/** Whether `\begin{name}` at the start of `text` is closed by the `\end{name}` at its end, not before. */
function balanced(text: string, name: string): boolean {
  const pattern = new RegExp(String.raw`\\(begin|end)\s*\{${name.replace("*", "\\*")}\}`, "g");
  let depth = 0;
  for (const match of text.matchAll(pattern)) {
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return match.index + match[0].length === text.trimEnd().length;
  }
  return false;
}

/** An environment of `names` (by what each sets) around `from`…`to` (whole lines), or selected along with it. */
export function environmentAround<T>(text: string, from: number, to: number, names: Record<string, T>): Wrapper<T> | null {
  const lines = linesOf(text);
  const first = lineIndex(lines, from);
  const last = lineIndex(lines, to);
  const begin = (line: Line) => /^\s*\\begin\s*\{([^}]*)\}\s*$/.exec(line.text)?.[1];
  const end = (line: Line) => /^\s*\\end\s*\{([^}]*)\}\s*$/.exec(line.text)?.[1];
  const candidates: [number, number][] = [
    [first, last],
    [first - 1, last + 1],
  ];
  for (const [open, close] of candidates) {
    if (open < 0 || close >= lines.length || close - open < 1) continue;
    const name = begin(lines[open]);
    if (!name || !Object.hasOwn(names, name) || end(lines[close]) !== name) continue;
    if (!balanced(text.slice(lines[open].from, lines[close].to), name)) continue;
    // The text between, without the line break after `\begin` and before `\end`.
    const innerFrom = lines[open].to + 1;
    const innerTo = Math.max(innerFrom, lines[close].from - 1);
    return { kind: names[name], from: lines[open].from, to: lines[close].to, innerFrom, innerTo };
  }
  return null;
}

const GROUP_START = new RegExp(`^\\{\\\\(${Object.keys(DECLARATIONS).join("|")})(?![a-zA-Z])\\s?`);

/** `{\raggedleft …\par}` after the `\item` that starts `from`…`to`. */
function groupAround(text: string, from: number, to: number): Wrapper | null {
  const start = from + ITEM.exec(text.slice(from, to))![0].length;
  const head = GROUP_START.exec(text.slice(start, to));
  if (!head || closingBrace(text, start) !== to - 1 || !text.slice(start, to).endsWith("\\par}")) return null;
  const innerFrom = start + head[0].length;
  return { kind: DECLARATIONS[head[1]], from: start, to, innerFrom, innerTo: to - "\\par}".length };
}

/**
 * Sets `range` (whole lines, see `paragraphRange` and `sectionRange`) in
 * `alignment`, as Word does: an alignment it has already, its own or from
 * around it, goes back to justified text, and where it would have the same
 * alignment from around it, it needs none of its own. Its own is an
 * environment around it; for a list item, `{\raggedleft …\par}` after `\item`.
 * `outside` is what the file starts in (see `alignmentAt`). The selection
 * `select` (offsets in `text`) stays on the same text.
 */
export function alignRange(
  text: string,
  range: { from: number; to: number },
  alignment: Alignment,
  outside: Alignment,
  select: { anchor: number; head: number },
): FormatEdit {
  const item = ITEM.exec(text.slice(range.from, range.to));
  const own = item ? groupAround(text, range.from, range.to) : environmentAround(text, range.from, range.to, ENVIRONMENTS);
  const inherited = alignmentAt(text.slice(0, own?.from ?? range.from), outside);
  const target: Alignment = (own?.kind ?? inherited) === alignment ? "justify" : alignment;

  // What is replaced, and the text in it that stays.
  const from = own?.from ?? (item ? range.from + item[0].length : range.from);
  const to = own?.to ?? range.to;
  const innerFrom = own?.innerFrom ?? from;
  const innerTo = own?.innerTo ?? to;
  let prefix = "";
  let suffix = "";
  if (target !== inherited && item) {
    prefix = `{${DECLARATION[target]} `;
    suffix = "\\par}";
  } else if (target !== inherited) {
    const indent = indentOf(text.slice(from, to));
    prefix = `${indent}\\begin{${ENVIRONMENT[target]}}\n`;
    suffix = `\n${indent}\\end{${ENVIRONMENT[target]}}`;
  }
  const insert = `${prefix}${text.slice(innerFrom, innerTo)}${suffix}`;
  const place = (at: number) => prefix.length + Math.min(Math.max(at, innerFrom), innerTo) - innerFrom;
  return { from, to, insert, select: { anchor: place(select.anchor), head: place(select.head) } };
}

/** Declarations put on lines of their own right after `\begin{document}`, for the whole document: alignments, sizes, bold, italic and the text colour (`\color{red}`, the one with an argument). */
const BODY_DECLARATIONS = new Set<string>([...Object.keys(DECLARATIONS), ...RELATIVE_SIZES, "bfseries", "itshape", "color"]);
/** The sizes the ribbon declares in the preamble (`\sizeFourteen`, see format.ts) count too. */
const isBodyDeclaration = (name: string) => BODY_DECLARATIONS.has(name) || /^size[A-Z]/.test(name);

/**
 * The end of the line with `\begin{document}`, the start of the next, and the
 * lines from there on that are each one of `BODY_DECLARATIONS` alone, as
 * `declareInBody` puts them. `null` without `\begin{document}`.
 */
export function bodyDeclarations(text: string) {
  const begin = /^[^%\n]*\\begin\{document\}[^\n]*/m.exec(text);
  if (!begin) return null;
  const end = begin.index + begin[0].length;
  const next = Math.min(end + 1, text.length);
  const lines: { from: number; to: number; name: string }[] = [];
  for (let from = next; from < text.length;) {
    const to = text.indexOf("\n", from) < 0 ? text.length : text.indexOf("\n", from);
    const [, name, argument] = /^\s*\\([a-zA-Z]+)((?:\[[^\]]*\])?\{[^{}]*\})?\s*$/.exec(text.slice(from, to)) ?? [];
    if (!name || !isBodyDeclaration(name) || (argument !== undefined) !== (name === "color")) break;
    lines.push({ from, to, name });
    from = to + 1;
  }
  return { end, next, lines };
}

/**
 * Declares `\name` for the whole document on a line of its own after
 * `\begin{document}`, in place of the one of `family` declared there (see
 * `bodyDeclarations`); `null` for `name` takes that one away. The others stay,
 * so an alignment, a size and bold can be declared side by side. `null`
 * without `\begin{document}`.
 */
export function declareInBody(text: string, family: readonly string[], name: string | null): FormatEdit | null {
  const body = bodyDeclarations(text);
  if (!body) return null;
  const line = body.lines.find((l) => family.includes(l.name));
  if (line) return name ? selectAll(line.from, line.to, `\\${name}`) : selectAll(line.from, Math.min(line.to + 1, text.length), "");
  if (!name) return selectAll(body.next, body.next, "");
  return body.end >= text.length ? selectAll(body.end, body.end, `\n\\${name}`) : selectAll(body.next, body.next, `\\${name}\n`);
}

/**
 * The whole document's alignment as `alignDocument` sets it, in the main
 * file `text`: declared after `\begin{document}`, else by the preamble.
 */
export function wholeDocumentAlignment(text: string): Alignment {
  const body = bodyDeclarations(text);
  if (!body) return "justify";
  const declared = body.lines.find((line) => Object.hasOwn(DECLARATIONS, line.name));
  return declared ? DECLARATIONS[declared.name] : alignmentAt(text.slice(0, body.end));
}

/**
 * Sets the whole document in `alignment`: a declaration on the line after
 * `\begin{document}`, which reaches every included file too. As for a
 * paragraph, the alignment it has already goes back to justified text, and
 * none is declared where the preamble sets the same. `null` without `\begin{document}`.
 */
export function alignDocument(text: string, alignment: Alignment): FormatEdit | null {
  const current = wholeDocumentAlignment(text);
  const inherited = preambleAlignment(maskComments(headOf(text)));
  const target: Alignment = current === alignment ? "justify" : alignment;
  return declareInBody(text, Object.keys(DECLARATIONS), target === inherited ? null : DECLARATION[target].slice(1));
}
