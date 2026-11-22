// Text in columns: the whole document by the class option `twocolumn`, a
// part of it by multicol's `multicols` environment (two or three columns,
// balanced at its end), as Word sets columns for a section.

import { paragraphRange } from "./align";
import type { FormatEdit } from "./format";
import { documentClassOf, indentOf, maskComments, splitOptions, type TextEdit } from "./syntax";

/** How many columns the class sets the document in. */
export function documentColumns(main: string): 1 | 2 {
  const documentClass = documentClassOf(maskComments(main));
  return documentClass && splitOptions(documentClass.options).includes("twocolumn") ? 2 : 1;
}

/** The whole document in one or two columns, by the class option; the edit comes alone. */
export function documentColumnsEdits(main: string, columns: 1 | 2): TextEdit[] {
  const documentClass = documentClassOf(maskComments(main));
  if (!documentClass) return [];
  const options = splitOptions(documentClass.options).filter((o) => o !== "twocolumn" && o !== "onecolumn");
  if (columns === 2) options.push("twocolumn");
  const insert = `\\documentclass${options.length ? `[${options.join(", ")}]` : ""}{${documentClass.name}}`;
  return insert === main.slice(documentClass.from, documentClass.to) ? [] : [{ from: documentClass.from, to: documentClass.to, insert }];
}

const BEGIN = /\\begin\s*\{multicols\*?\}\s*\{\s*(\d+)\s*\}/g;
const END = /\\end\s*\{multicols\*?\}/g;

/** The `multicols` environment around `at`: where it begins, and its column count's place; `null` outside one. */
function multicolsAt(text: string, at: number): { begin: number; from: number; to: number; count: number } | null {
  const code = maskComments(text);
  let found: { begin: number; from: number; to: number; count: number } | null = null;
  for (const begin of code.slice(0, at).matchAll(BEGIN)) {
    const end = new RegExp(END.source, "g");
    end.lastIndex = begin.index! + begin[0].length;
    const close = end.exec(code);
    if (!close || close.index >= at) {
      const digits = begin.index! + begin[0].lastIndexOf(begin[1]);
      found = { begin: begin.index!, from: digits, to: digits + begin[1].length, count: Number(begin[1]) };
    }
  }
  return found;
}

/**
 * The selected paragraphs (or the one at the cursor) in `columns` columns:
 * a `multicols` around them, or the count of the one they are in changed;
 * `columns` 1 takes that environment away. `null` where nothing changes.
 */
export function columnsEdit(text: string, from: number, to: number, columns: 1 | 2 | 3): FormatEdit | null {
  const around = multicolsAt(text, from);
  if (around) {
    const code = maskComments(text);
    if (columns === 1) {
      // The environment goes, its text stays.
      const end = new RegExp(END.source, "g");
      end.lastIndex = around.to;
      const close = end.exec(code)!;
      const lineOf = (offset: number) => {
        const start = text.lastIndexOf("\n", offset - 1) + 1;
        const stop = text.indexOf("\n", offset);
        return { start, stop: stop < 0 ? text.length : stop };
      };
      const first = lineOf(around.begin);
      const last = lineOf(close.index);
      const inner = text.slice(first.stop + 1, last.start - 1);
      return { from: first.start, to: last.stop, insert: inner, select: { anchor: 0, head: inner.length } };
    }
    if (around.count === columns) return null;
    const insert = String(columns);
    return { from: around.from, to: around.to, insert, select: { anchor: 1, head: 1 } };
  }
  if (columns === 1) return null;
  const range = paragraphRange(text, from, to);
  if (!range) {
    const insert = `\\begin{multicols}{${columns}}\n\n\\end{multicols}`;
    const cursor = insert.indexOf("\n") + 1;
    return { from, to, insert, select: { anchor: cursor, head: cursor } };
  }
  const indent = indentOf(text.slice(range.from));
  const body = text.slice(range.from, range.to);
  const insert = `${indent}\\begin{multicols}{${columns}}\n${body}\n${indent}\\end{multicols}`;
  const start = insert.indexOf("\n") + 1;
  return { from: range.from, to: range.to, insert, select: { anchor: start, head: start + body.length } };
}

/** The number of columns at the cursor (the text before it): of a `multicols` around it, else `null`. */
export function columnsAt(before: string): number | null {
  return multicolsAt(before, before.length)?.count ?? null;
}
