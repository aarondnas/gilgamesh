// The document's title, subtitle, authors and date as the main file's
// preamble sets them (`\title{…}` and its kin), read and written for the
// title dialog, and whether the body sets them (`\maketitle`).

import { preambleOf } from "./preamble";
import { afterPackages, BEGIN_DOCUMENT, documentClassOf, headOf, lineEnd, maskComments, splitOptions, type TextEdit } from "./syntax";

export interface TitleData {
  title: string;
  /** KOMA-Script's `\subtitle`; other classes have none. */
  subtitle: string;
  /** Each author on their own, as `\and` separates them. */
  authors: string[];
  /** `null`: today's date (`\date` unset or `\today`); "" no date at all. */
  date: string | null;
}

export type TitleField = "title" | "subtitle" | "author" | "date";

/** The braced argument starting at `open` (an opening brace), its end after the closing one; `null` unbalanced. */
function braced(text: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** `\title{…}` in the preamble: the last one, as the last one wins. */
function commandOf(head: string, name: TitleField): { from: number; to: number; inner: string } | null {
  let found: { from: number; to: number; inner: string } | null = null;
  for (const match of head.matchAll(new RegExp(`\\\\${name}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g"))) {
    const arg = braced(head, match.index! + match[0].length - 1);
    if (arg) found = { from: match.index!, to: arg.end, inner: arg.inner };
  }
  return found;
}

/** LaTeX as plain text, for a header: `About \emph{new}\\ ideas` → "About new ideas". */
export function plainText(code: string): string {
  return code
    .replace(/\\\\(\[[^\]]*\])?/g, " ")
    .replace(/\\(?:thanks|footnote)\s*\{[^{}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\*?\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleDataOf(main: string): TitleData {
  const head = maskComments(headOf(main));
  const source = headOf(main);
  const value = (name: TitleField) => {
    const command = commandOf(head, name);
    return command ? source.slice(command.to - command.inner.length - 1, command.to - 1) : null;
  };
  const date = value("date");
  return {
    title: value("title") ?? "",
    subtitle: value("subtitle") ?? "",
    authors: (value("author") ?? "")
      .split(/\s*\\and\s*/)
      .map((a) => a.trim())
      .filter(Boolean),
    date: date === null || date.trim() === "\\today" ? null : date.trim(),
  };
}

/** Whether the class has `\subtitle` (KOMA-Script's). */
export const hasSubtitle = (main: string) => /^scr/.test(preambleOf(main).className);

/** Classes that set the title on a page of its own unless told otherwise. */
const OWN_PAGE = new Set(["report", "book", "scrreprt", "scrbook", "memoir"]);

/** Whether the title gets a page of its own: by the class option `titlepage`/`notitlepage`, else the class's habit. */
export function titlePageOf(main: string): boolean {
  const documentClass = documentClassOf(maskComments(main));
  if (!documentClass) return false;
  const options = splitOptions(documentClass.options);
  if (options.some((o) => /^titlepage(\s*=\s*(true|on|yes))?$/.test(o))) return true;
  if (options.some((o) => /^notitlepage$|^titlepage\s*=\s*(false|off|no)$/.test(o))) return false;
  return OWN_PAGE.has(documentClass.name);
}

/** The class option that gives the title a page of its own or not, where that differs from the class's habit; the edit comes alone. */
export function titlePageEdits(main: string, own: boolean): TextEdit[] {
  const documentClass = documentClassOf(maskComments(main));
  if (!documentClass) return [];
  const options = splitOptions(documentClass.options).filter((o) => !/^(?:no)?titlepage\b/.test(o));
  if (OWN_PAGE.has(documentClass.name) !== own) options.push(own ? "titlepage" : "notitlepage");
  const insert = `\\documentclass${options.length ? `[${options.join(", ")}]` : ""}{${documentClass.name}}`;
  const current = main.slice(documentClass.from, documentClass.to);
  return insert === current ? [] : [{ from: documentClass.from, to: documentClass.to, insert }];
}

/** Whether the body sets the title (`\maketitle`). */
export function setsTitle(main: string): boolean {
  const code = maskComments(main);
  const begin = BEGIN_DOCUMENT.exec(code);
  return !!begin && /\\maketitle(?![a-zA-Z])/.test(code.slice(begin.index));
}

/**
 * Writes `data` into the preamble of `main`: each command in place of the
 * one there, else after the last `\usepackage` (or `\documentclass`); a
 * subtitle only where the class has one, an empty one goes. With `make`,
 * `\maketitle` comes right after `\begin{document}` where the body lacks it.
 * The edits come last first.
 */
export function titleEdits(main: string, data: TitleData, make: boolean): TextEdit[] {
  const head = maskComments(headOf(main));
  let at = afterPackages(main);
  if (at < 0) return [];
  // New ones beside those there: after the line of the last.
  for (const name of ["title", "subtitle", "author", "date"] as TitleField[]) {
    const command = commandOf(head, name);
    if (command) at = Math.max(at, lineEnd(main, command.to));
  }
  const wanted: [TitleField, string | null][] = [
    ["title", data.title],
    ["subtitle", hasSubtitle(main) && data.subtitle.trim() ? data.subtitle : null],
    [
      "author",
      data.authors
        .map((a) => a.trim())
        .filter(Boolean)
        .join(" \\and "),
    ],
    ["date", data.date === null ? "\\today" : data.date],
  ];
  const edits: TextEdit[] = [];
  const added: string[] = [];
  for (const [name, text] of wanted) {
    const command = commandOf(head, name);
    if (command) {
      const line = main.lastIndexOf("\n", command.from - 1) + 1;
      const end = main.indexOf("\n", command.to);
      const alone = main.slice(line, command.from).trim() === "" && main.slice(command.to, end < 0 ? main.length : end).trim() === "";
      if (text === null)
        edits.push(
          alone
            ? { from: Math.max(0, line - 1), to: end < 0 ? main.length : end, insert: "" }
            : { from: command.from, to: command.to, insert: "" },
        );
      else edits.push({ from: command.from, to: command.to, insert: `\\${name}{${text}}` });
    } else if (text !== null) added.push(`\\${name}{${text}}`);
  }
  if (added.length) edits.push({ from: at, to: at, insert: `\n${added.join("\n")}` });
  if (make && !setsTitle(main)) {
    const begin = BEGIN_DOCUMENT.exec(maskComments(main));
    if (begin) {
      const end = begin.index + begin[0].length;
      edits.push({ from: end, to: end, insert: "\n\\maketitle" });
    }
  }
  return edits.sort((a, b) => b.from - a.from);
}
