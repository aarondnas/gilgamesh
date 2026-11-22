// Moving a heading in the outline by drag and drop. Only a heading that stands
// alone in a .tex file of its own (with what lies below it) can move: the line
// that reads the file in (`\input`, `\include`, `\subfile`) moves, so no text is
// cut apart. Kept free of editor dependencies so it can be tested on its own.

import type { ProjectScan } from "$lib/api";
import { BEGIN_DOCUMENT, indentOf, stripComment as code } from "./syntax";

type Heading = ProjectScan["outline"][number];
type Inclusion = ProjectScan["inclusions"][number];

export type OutlineMoveErrorCode =
  /** The heading shares its file with other headings or text, or lies in the main file. */
  | "shared"
  /** The line reading the file in holds more than the command. */
  | "line"
  /** The file is read in more than once. */
  | "twice"
  /** An `\include`d file would go into a file that is `\include`d itself, which LaTeX forbids. */
  | "nested-include"
  /** No line to put it before or after (e.g. behind the last heading in the main file). */
  | "position"
  /** The files no longer match the outline. */
  | "changed"
  /** The heading shares its line with other code, so it cannot be put into a file of its own. */
  | "extract";

export class OutlineMoveError extends Error {
  readonly code: OutlineMoveErrorCode;
  /** The file the error is about. */
  readonly file: string;

  constructor(code: OutlineMoveErrorCode, file: string) {
    super(code);
    this.code = code;
    this.file = file;
  }
}

const LEVELS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph"];
const INCLUDE_LINE = /^\s*\\(input|include|subfile)\s*\{([^}]+)\}\s*$/;
/** A line that switches the numbering between the parts of a document. */
const MATTER = /^\\(appendix|frontmatter|mainmatter|backmatter)\s*$/;

/** The end (exclusive) of the headings `i` covers: itself and those below it. */
export function spanOf(outline: Heading[], i: number): number {
  let end = i + 1;
  while (end < outline.length && outline[end].level > outline[i].level) end++;
  return end;
}

type Appendix = NonNullable<ProjectScan["appendix"]>;

/** The main part of the document, before `\appendix`, or the appendix. */
export type Part = "main" | "appendix";

/** The part heading `i` lies in. */
export function partOf(appendix: Appendix | null, i: number): Part {
  return appendix && i >= appendix.index ? "appendix" : "main";
}

/**
 * Whether heading `i` may go before heading `target` (`outline.length`: behind
 * the last): not into itself, not where it is, and not before a deeper heading,
 * which would make that heading's followers its own. Where the appendix
 * begins, `part` tells the end of the main part from the start of the appendix.
 */
export function canDrop(outline: Heading[], i: number, target: number, appendix: Appendix | null = null, part?: Part): boolean {
  if (i < 0 || i >= outline.length || target < 0 || target > outline.length) return false;
  const crosses = appendix !== null && target === appendix.index && part !== undefined && part !== partOf(appendix, i);
  if (target >= i && target <= spanOf(outline, i) && !crosses) return false;
  return target === outline.length || outline[target].level <= outline[i].level;
}

export interface MoveSource {
  outline: Heading[];
  inclusions: Inclusion[];
  /** Where the appendix begins, if there is one. */
  appendix: Appendix | null;
  main: string;
  read: (path: string) => Promise<string>;
}

/** What ends the main part before the appendix: the lists after the text, the back matter. */
const MAIN_END =
  /^\\(?:printbibliography|bibliography|printindex|printglossar(?:y|ies)|printnoidxglossar(?:y|ies)|printacronyms|backmatter)\b/;
/** Lines that lead into what follows them: a list's page break, page style and contents entry. */
const LEAD_IN = /^\s*($|%|\\(?:clearpage|cleardoublepage|newpage|pagestyle|thispagestyle|pagenumbering|phantomsection|addcontentsline)\b)/;
/** Lines after `\appendix` that set it up, before its first part. */
const APPENDIX_SETUP =
  /^\s*($|%|\\(?:crefname|Crefname|renewcommand|setcounter|addtocontents|addcontentsline|phantomsection|pagenumbering|pagestyle|clearpage|cleardoublepage)\b)/;

/** One replacement per file changed. */
export interface FileEdit {
  file: string;
  from: number;
  to: number;
  insert: string;
}

/** Line `line` (1-based) of `text`: where it starts, ends (before the line break) and the next one starts. */
function lineAt(text: string, line: number) {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const br = text.indexOf("\n", start);
    if (br < 0) return null;
    start = br + 1;
  }
  const br = text.indexOf("\n", start);
  const end = br < 0 ? text.length : br;
  return { start, end: end > start && text[end - 1] === "\r" ? end - 1 : end, next: br < 0 ? text.length : br + 1 };
}

/** Whether nothing but blank lines and comments comes before line `line`. */
function emptyBefore(text: string, line: number): boolean {
  return text
    .split("\n")
    .slice(0, line - 1)
    .every((l) => !code(l).trim());
}

/**
 * The edits that move heading `i` before heading `target` (`outline.length`:
 * behind the last). Where the appendix begins, `part` chooses between the end
 * of the main part (before the bibliography and `\appendix`) and the start of
 * the appendix (after `\appendix` and what sets it up). Throws
 * `OutlineMoveError` where that is not possible or the files no longer match the outline.
 */
export async function planMove(source: MoveSource, i: number, target: number, part?: Part): Promise<FileEdit[]> {
  const { outline, inclusions, main, appendix } = source;
  const heading = outline[i];
  if (!canDrop(outline, i, target, appendix, part)) throw new OutlineMoveError("position", heading.file);
  const texts = new Map<string, string>();
  const read = async (path: string) => {
    if (!texts.has(path)) texts.set(path, await source.read(path));
    return texts.get(path)!;
  };
  const inclusionsOf = (file: string) => inclusions.filter((inc) => inc.file === file);

  // The heading's file and those it reads in hold exactly the heading and what lies below it.
  const file = heading.file;
  if (file === main) throw new OutlineMoveError("shared", file);
  const below = new Set([file]);
  for (let grew = true; grew;) {
    grew = false;
    for (const inc of inclusions) {
      if (below.has(inc.parent) && !below.has(inc.file)) {
        below.add(inc.file);
        grew = true;
      }
    }
  }
  const end = spanOf(outline, i);
  const own = outline.every((h, k) => below.has(h.file) === (k >= i && k < end));
  const text = await read(file);
  if (!own || !emptyBefore(text, heading.line)) throw new OutlineMoveError("shared", file);
  await verifyHeading(read, heading);

  // The line that reads it in, alone in its line.
  const reads = inclusionsOf(file);
  if (reads.length !== 1) throw new OutlineMoveError("twice", file);
  const inclusion = reads[0];
  const parentText = await read(inclusion.parent);
  const from = lineAt(parentText, inclusion.line);
  if (!from) throw new OutlineMoveError("changed", inclusion.parent);
  const lineText = parentText.slice(from.start, from.end);
  const command = INCLUDE_LINE.exec(code(lineText));
  if (!command) {
    if (!/\\(input|include|subfile)\s*\{/.test(lineText)) throw new OutlineMoveError("changed", inclusion.parent);
    throw new OutlineMoveError("line", file);
  }

  // Where it goes: before the target heading, or the line reading in its file
  // (and so on upwards) where the file begins with it; behind the last heading's file.
  /** The line in `file` that reads in the file holding heading `k` (or holds it), `null` if none does. */
  const lineIn = (file: string, k: number): number | null => {
    let at = { file: outline[k].file, line: outline[k].line };
    while (at.file !== file) {
      const reads = inclusionsOf(at.file);
      if (reads.length !== 1) return null;
      at = { file: reads[0].parent, line: reads[0].line };
    }
    return at.line;
  };

  let to: { file: string; offset: number; indent: string };
  if (appendix && target === appendix.index && part) {
    const lines = (await read(appendix.file)).split("\n");
    let line: number;
    if (part === "main") {
      // Behind the last heading of the main part, before the lists after the text and their page breaks.
      const last = appendix.index > 0 ? lineIn(appendix.file, appendix.index - 1) : null;
      const floor = last !== null && last < appendix.line ? last : lines.findIndex((l) => BEGIN_DOCUMENT.test(code(l))) + 1;
      line = appendix.line;
      for (let l = floor + 1; l < appendix.line; l++) {
        if (MAIN_END.test(code(lines[l - 1]).trim())) {
          line = l;
          break;
        }
      }
      while (line - 1 > floor && LEAD_IN.test(lines[line - 2])) line--;
    } else {
      // Before the first part of the appendix (and comments right above it), else behind what sets it up.
      const first = appendix.index < outline.length ? lineIn(appendix.file, appendix.index) : null;
      if (first !== null && first > appendix.line) {
        line = first;
        while (line - 1 > appendix.line && /^\s*%/.test(lines[line - 2])) line--;
      } else {
        line = appendix.line + 1;
        while (line <= lines.length && APPENDIX_SETUP.test(lines[line - 1])) line++;
      }
    }
    const text = await read(appendix.file);
    const at = lineAt(text, line);
    if (!at) throw new OutlineMoveError("position", appendix.file);
    const indent = indentOf(lines[appendix.line - 1] ?? "");
    to = { file: appendix.file, offset: at.start, indent };
  } else if (target < outline.length) {
    const next = outline[target];
    await verifyHeading(read, next);
    let at = { file: next.file, line: next.line };
    while (at.file !== main && inclusionsOf(at.file).length === 1 && emptyBefore(await read(at.file), at.line)) {
      const inc = inclusionsOf(at.file)[0];
      at = { file: inc.parent, line: inc.line };
    }
    const atText = await read(at.file);
    // Dropped between the main part and the appendix (or book matter): stays where it came from, before the switch.
    const lines = atText.split("\n");
    for (let l = at.line - 1; l >= 1; l--) {
      const before = code(lines[l - 1]).trim();
      if (MATTER.test(before)) at = { ...at, line: l };
      else if (before) break;
    }
    const line = lineAt(atText, at.line);
    if (!line) throw new OutlineMoveError("changed", at.file);
    to = { file: at.file, offset: line.start, indent: indentOf(atText.slice(line.start)) };
  } else {
    let path = outline[outline.length - 1].file;
    let last: Inclusion | null = null;
    while (path !== main) {
      const reads = inclusionsOf(path);
      if (reads.length !== 1) throw new OutlineMoveError("position", path);
      last = reads[0];
      path = last.parent;
    }
    if (!last) throw new OutlineMoveError("position", main);
    const mainText = await read(main);
    const line = lineAt(mainText, last.line);
    if (!line) throw new OutlineMoveError("changed", main);
    to = { file: main, offset: line.next, indent: indentOf(mainText.slice(line.start)) };
  }

  // `\include` cannot be nested: the new place must not lie in an `\include`d file.
  if (command[1] === "include") {
    for (let path = to.file; path !== main;) {
      const inc = inclusionsOf(path)[0];
      if (!inc) break;
      if (inc.command === "include") throw new OutlineMoveError("nested-include", file);
      path = inc.parent;
    }
  }

  const toText = await read(to.file);
  // Behind a last line without a line break, the new line needs one before it.
  const eol = toText.includes("\r\n") ? "\r\n" : "\n";
  const lead = to.offset === toText.length && toText.length > 0 && !toText.endsWith("\n") ? eol : "";
  const moved = `${lead}${to.indent}${lineText.trimStart()}${lead ? "" : eol}`;
  const remove = { from: from.start, to: from.next };
  if (to.file !== inclusion.parent) {
    return [
      { file: inclusion.parent, from: remove.from, to: remove.to, insert: "" },
      { file: to.file, from: to.offset, to: to.offset, insert: moved },
    ];
  }
  // In the same file: one replacement over both places.
  if (to.offset >= remove.to) {
    return [{ file: to.file, from: remove.from, to: to.offset, insert: parentText.slice(remove.to, to.offset) + moved }];
  }
  if (to.offset <= remove.from) {
    return [{ file: to.file, from: to.offset, to: remove.to, insert: moved + parentText.slice(to.offset, remove.from) }];
  }
  throw new OutlineMoveError("position", file);
}

/** Where what follows a heading ends at the latest: switches between the parts of a document, and its lists. */
const STOP =
  /^\\(?:(?:appendix|frontmatter|mainmatter|backmatter|printbibliography|bibliography|printindex|printglossar(?:y|ies))\b|end\s*\{document\})/;

export interface Extraction {
  /** The file the heading is cut out of, and the replacement there: the line reading the new file in. */
  file: string;
  from: number;
  to: number;
  insert: string;
  /** The new file and its text. */
  content: string;
}

/**
 * Puts heading `i` and what lies below it in its file into `newFile` (project
 * relative), read in with `\input` where it stood; `inputPath` is how
 * `\input` names it (relative to the main file's folder). Ends before the next
 * heading of its level or above, before `\appendix`, the bibliography and the
 * like, and before comments right above those, which belong to what follows.
 */
export async function planExtract(source: MoveSource, i: number, inputPath: string): Promise<Extraction> {
  const { outline, inclusions } = source;
  const heading = outline[i];
  const file = heading.file;
  const text = await source.read(file);
  await verifyHeading(source.read, heading);
  const line = lineAt(text, heading.line);
  if (!line) throw new OutlineMoveError("changed", file);
  const before = code(text.slice(line.start, line.end)).search(/\\(part|chapter|section|subsection|subsubsection|paragraph)\b/);
  if (text.slice(line.start, line.start + before).trim()) throw new OutlineMoveError("extract", file);

  const lines = text.split("\n");
  let stop = lines.length + 1;
  // The next heading of its level or above, or the line in this file that reads in the file holding it.
  const end = spanOf(outline, i);
  if (end < outline.length) {
    let at = { file: outline[end].file, line: outline[end].line };
    while (at.file !== file) {
      const reads = inclusions.filter((inc) => inc.file === at.file);
      if (reads.length !== 1) break;
      at = { file: reads[0].parent, line: reads[0].line };
    }
    if (at.file === file && at.line > heading.line) stop = at.line;
  }
  for (let l = heading.line + 1; l < stop; l++) {
    if (STOP.test(code(lines[l - 1]).trim())) stop = l;
  }
  while (stop <= lines.length && stop - 1 > heading.line && /^\s*%/.test(lines[stop - 2])) stop--;

  const from = line.start;
  const to = stop > lines.length ? text.length : lineAt(text, stop)!.start;
  const range = text.slice(from, to);
  const body = range.trimEnd();
  const indent = indentOf(range);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const content =
    body
      .split("\n")
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
      .join("\n") + eol;
  return { file, from, to, insert: `${indent}\\input{${inputPath}}${range.slice(body.length) || ""}`, content };
}

/** Checks that the heading's line still holds a heading of its level. */
async function verifyHeading(read: (path: string) => Promise<string>, heading: Heading) {
  const text = await read(heading.file);
  const line = lineAt(text, heading.line);
  const name = LEVELS[heading.level];
  if (!line || !new RegExp(`\\\\${name}\\*?\\s*(\\[[^\\]]*\\])?\\s*\\{`).test(code(text.slice(line.start, line.end)))) {
    throw new OutlineMoveError("changed", heading.file);
  }
}
