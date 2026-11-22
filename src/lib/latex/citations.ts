// Citing: which bibliography tool the main file uses (biblatex, natbib or
// plain BibTeX) and in what style, the citation commands each offers, and
// the entries of `.bib` files, read, written and made unique.

import { preambleOf, slugOf } from "./preamble";
import { afterPackages, BEGIN_DOCUMENT, headOf, maskComments, packageNames, splitOptions, USEPACKAGE, type TextEdit } from "./syntax";

export type BibTool = "biblatex" | "natbib" | "bibtex" | "none";

export interface BibSetup {
  tool: BibTool;
  /** biblatex's `style`, or BibTeX's `\bibliographystyle`; `null` where none is set. */
  style: string | null;
  /** The `.bib` files the main file reads, as written there (relative to its folder). */
  files: string[];
  /** Whether the document prints its bibliography already. */
  printed: boolean;
}

const BIBLIOGRAPHY_STYLE = /\\bibliographystyle\s*\{([^}]*)\}/;
const BIBLIOGRAPHY = /\\bibliography\s*\{([^}]*)\}/g;
const ADD_RESOURCE = /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

function biblatexLoad(head: string) {
  for (const match of head.matchAll(USEPACKAGE)) {
    const names = packageNames(match);
    if (!names.includes("biblatex")) continue;
    const optionsFrom = match[1] === undefined ? -1 : match.index! + match[0].indexOf("[") + 1;
    return {
      from: match.index!,
      to: match.index! + match[0].length,
      options: match[1] === undefined ? null : { from: optionsFrom, to: optionsFrom + match[1].length, text: match[1] },
      alone: names.length === 1,
    };
  }
  return null;
}

/** The bibliography tool, style and files of the main file `main`. */
export function bibSetupOf(main: string): BibSetup {
  const code = maskComments(main);
  const head = headOf(code);
  const biblatex = biblatexLoad(head);
  if (biblatex) {
    const options = splitOptions(biblatex.options?.text ?? "");
    const style = options.map((o) => /^(?:style|citestyle)\s*=\s*(.+)$/.exec(o)?.[1].trim()).find(Boolean) ?? null;
    return {
      tool: "biblatex",
      style,
      files: [...code.matchAll(ADD_RESOURCE)].map((m) => m[1].trim()),
      printed: /\\printbibliography\b/.test(code),
    };
  }
  const files = [...code.matchAll(BIBLIOGRAPHY)].flatMap((m) => m[1].split(",").map((f) => `${f.trim().replace(/\.bib$/, "")}.bib`));
  const natbib = preambleOf(main).packages.has("natbib");
  if (!natbib && !files.length) return { tool: "none", style: null, files: [], printed: false };
  return {
    tool: natbib ? "natbib" : "bibtex",
    style: BIBLIOGRAPHY_STYLE.exec(code)?.[1].trim() ?? null,
    files,
    printed: files.length > 0,
  };
}

/** In brackets, in the sentence ("Knuth (1984)"), in a footnote, or plain `\cite`. */
export type CiteForm = "paren" | "text" | "foot" | "plain";

const COMMANDS: Record<BibTool, Partial<Record<CiteForm, string>>> = {
  biblatex: { paren: "parencite", text: "textcite", foot: "footcite", plain: "cite" },
  natbib: { paren: "citep", text: "citet", plain: "cite" },
  bibtex: { plain: "cite" },
  // Citing sets biblatex up first (see `setupEdits`).
  none: { paren: "parencite", text: "textcite", foot: "footcite", plain: "cite" },
};

export const citeForms = (tool: BibTool) => Object.keys(COMMANDS[tool]) as CiteForm[];

/**
 * The citation of `keys`: `\parencite[cf.][p.~12]{knuth1984}`. Plain BibTeX's
 * `\cite` knows no text before. Spaces after an abbreviation's dot stay
 * together with what follows (`p.~12`).
 */
export function citeCode(tool: BibTool, form: CiteForm, keys: string[], before: string, after: string): string {
  const command = COMMANDS[tool][form] ?? "cite";
  const tie = (text: string) => text.trim().replace(/\.\s+/g, ".~");
  const pre = tool === "bibtex" ? "" : tie(before);
  const post = tie(after);
  const options = pre ? `[${pre}][${post}]` : post ? `[${post}]` : "";
  return `\\${command}${options}{${keys.join(",")}}`;
}

/** biblatex's styles with their bibliography and citations, and BibTeX's (natbib's for natbib). */
export const STYLES: Record<Exclude<BibTool, "none">, string[]> = {
  biblatex: ["authoryear", "numeric", "alphabetic", "apa", "ieee", "verbose"],
  natbib: ["plainnat", "abbrvnat", "unsrtnat"],
  bibtex: ["plain", "unsrt", "alpha", "abbrv"],
};

/**
 * Sets biblatex up in a main file without a bibliography tool, reading `bib`
 * (relative to its folder): after the last `\usepackage`, with csquotes,
 * which biblatex wants beside babel. The edits come last first.
 */
export function setupEdits(main: string, bib: string, style = "authoryear"): TextEdit[] {
  const preamble = preambleOf(main);
  const at = afterPackages(main);
  if (at < 0 || !BEGIN_DOCUMENT.test(main)) return [];
  const lines = [
    ...(preamble.packages.has("csquotes") ? [] : ["\\usepackage{csquotes}"]),
    `\\usepackage[backend=biber, style=${style}]{biblatex}`,
    `\\addbibresource{${bib}}`,
  ];
  return [{ from: at, to: at, insert: `\n${lines.join("\n")}` }];
}

/**
 * The document in `style`: biblatex's `style` option (its own `bibstyle` and
 * `citestyle` go), or BibTeX's `\bibliographystyle` (one before
 * `\bibliography` where none is). The edits come last first.
 */
export function styleEdits(main: string, style: string): TextEdit[] {
  const code = maskComments(main);
  const biblatex = biblatexLoad(headOf(code));
  if (biblatex) {
    if (biblatex.options) {
      const kept = splitOptions(biblatex.options.text).filter((o) => !/^(?:style|bibstyle|citestyle)\s*=/.test(o));
      // Loaded with other packages, whose options must stay theirs: only a style of its own is changed.
      if (!biblatex.alone && kept.length === splitOptions(biblatex.options.text).length) return [];
      return [{ from: biblatex.options.from, to: biblatex.options.to, insert: [...kept, `style=${style}`].join(", ") }];
    }
    if (!biblatex.alone) return [];
    const at = biblatex.from + main.slice(biblatex.from, biblatex.to).indexOf("{");
    return [{ from: at, to: at, insert: `[style=${style}]` }];
  }
  const set = BIBLIOGRAPHY_STYLE.exec(code);
  if (set) {
    const from = set.index + set[0].indexOf("{") + 1;
    return [{ from, to: from + set[1].length, insert: style }];
  }
  const bibliography = new RegExp(BIBLIOGRAPHY.source).exec(code);
  if (!bibliography) return [];
  return [{ from: bibliography.index, to: bibliography.index, insert: `\\bibliographystyle{${style}}\n` }];
}

// ---------------------------------------------------------------------------
// Entries of `.bib` files.

export interface BibEntry {
  type: string;
  key: string;
  /** In their order; names in lower case. `bare` for a macro or number written without braces (`month = aug`). */
  fields: [name: string, value: string, bare?: boolean][];
}

/** The text up to the brace or quote that closes what starts at `from` (after the opening one). */
function closing(text: string, from: number, quote: boolean): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0 && !quote) return i;
      depth--;
    } else if (c === '"' && quote && depth === 0) return i;
  }
  return -1;
}

/** The first entry of `text` (`@article{key, title={…}, …}`), as doi.org writes them on one line; `null` for none. */
export function parseEntry(text: string): BibEntry | null {
  const head = /@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(text);
  if (!head) return null;
  const fields: BibEntry["fields"] = [];
  let i = head.index + head[0].length;
  const end = closing(text, head.index + head[0].indexOf("{") + 1, false);
  const stop = end < 0 ? text.length : end;
  const field = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
  while (i < stop) {
    field.lastIndex = i;
    const name = field.exec(text);
    if (!name) break;
    i = field.lastIndex;
    let value: string;
    let bare = false;
    if (text[i] === "{" || text[i] === '"') {
      const close = closing(text, i + 1, text[i] === '"');
      if (close < 0) break;
      value = text.slice(i + 1, close);
      i = close + 1;
    } else {
      const plain = /[^,}]*/y;
      plain.lastIndex = i;
      value = plain.exec(text)![0].trim();
      bare = true;
      i = plain.lastIndex;
    }
    fields.push([name[1].toLowerCase(), value.replace(/\s+/g, " ").trim(), bare]);
    const comma = /\s*,?/y;
    comma.lastIndex = i;
    comma.exec(text);
    i = comma.lastIndex;
  }
  return { type: head[1].toLowerCase(), key: head[2], fields };
}

/** An entry as the `.bib` file gets it: a field per line. */
export function formatEntry(entry: BibEntry): string {
  const width = Math.max(0, ...entry.fields.map(([name]) => name.length));
  const lines = entry.fields.map(([name, value, bare]) => `  ${name.padEnd(width)} = ${bare ? value.toLowerCase() : `{${value}}`}`);
  return `@${entry.type}{${entry.key},\n${lines.join(",\n")}\n}`;
}

/** `knuth1984` for Donald E. Knuth (or "Knuth, Donald") in 1984: surname and year, ASCII. */
export function entryKey(entry: BibEntry): string {
  const field = (name: string) => entry.fields.find(([n]) => n === name)?.[1] ?? "";
  const first = field("author").split(/\s+and\s+/)[0] ?? "";
  const surname = first.includes(",") ? first.split(",")[0] : (first.trim().split(/\s+/).at(-1) ?? "");
  const year = /\d{4}/.exec(field("year") || field("date"))?.[0] ?? "";
  const ascii = (text: string) => slugOf(text).replace(/-/g, "");
  return ascii(surname) + year || ascii(field("title").split(/\s+/)[0] ?? "") || "source";
}

/** `key`, or with a letter where the project has it already (`knuth1984b`). */
export function uniqueKey(key: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(key)) return key;
  for (let c = 98; c <= 122; c++) if (!used.has(`${key}${String.fromCharCode(c)}`)) return `${key}${String.fromCharCode(c)}`;
  let n = 2;
  while (used.has(`${key}-${n}`)) n++;
  return `${key}-${n}`;
}

/** The kinds of source the form offers, and their fields (BibTeX's names) beyond author, title and year. */
export const SOURCE_KINDS = {
  book: ["publisher", "address", "edition", "isbn"],
  article: ["journal", "volume", "number", "pages", "doi"],
  incollection: ["booktitle", "editor", "publisher", "address", "pages"],
  online: ["url", "urldate"],
  thesis: ["school", "type"],
  misc: ["howpublished", "url"],
} as const satisfies Record<string, readonly string[]>;
export type SourceKind = keyof typeof SOURCE_KINDS;

/** `@online` and `@thesis` are biblatex's; BibTeX knows `@misc` and `@phdthesis`. */
export function entryType(kind: SourceKind, tool: BibTool): string {
  if (tool === "biblatex" || tool === "none") return kind;
  return kind === "online" ? "misc" : kind === "thesis" ? "phdthesis" : kind;
}
