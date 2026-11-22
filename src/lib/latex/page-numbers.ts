// Page numbers and the header and footer, as their dialogs read and write
// them: what stands where and how the number reads ("Seite 3 von 12"), by a
// block of fancyhdr setup in the main file's preamble; and how the numbers
// count through the document, by `\pagenumbering` and `\setcounter{page}`
// in the body, the way the thesis template goes from none on the title page
// to i, ii and then to 1, 2.

import type { Lang } from "$lib/config/template-texts";
import { BEGIN_DOCUMENT, headOf, indentOf, maskComments, type TextEdit } from "./syntax";

// ---------------------------------------------------------------------------
// Where they stand and how they read: the preamble.

export type NumberPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "top-outer"
  | "top-inner"
  | "bottom-outer"
  | "bottom-inner";

/** In the order the ribbon and the dialog offer them; two-sided printing has outer and inner in place of left and right. */
export const POSITIONS: Record<"oneSided" | "twoSided", NumberPosition[]> = {
  oneSided: ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"],
  twoSided: ["top-outer", "top-center", "top-inner", "bottom-outer", "bottom-center", "bottom-inner"],
};

/** `3`, `– 3 –`, `Seite 3`, `Seite 3 von 12`, `3 / 12`. */
export type NumberStyle = "number" | "dashes" | "page" | "pageOf" | "slash";
export const STYLES: NumberStyle[] = ["number", "dashes", "page", "pageOf", "slash"];

/** fancyhdr's command and fields for each position (`E`/`O`: even and odd pages). */
const FIELDS: Record<NumberPosition, [command: "fancyhead" | "fancyfoot", fields: string]> = {
  "top-left": ["fancyhead", "L"],
  "top-center": ["fancyhead", "C"],
  "top-right": ["fancyhead", "R"],
  "bottom-left": ["fancyfoot", "L"],
  "bottom-center": ["fancyfoot", "C"],
  "bottom-right": ["fancyfoot", "R"],
  "top-outer": ["fancyhead", "LE,RO"],
  "top-inner": ["fancyhead", "RE,LO"],
  "bottom-outer": ["fancyfoot", "LE,RO"],
  "bottom-inner": ["fancyfoot", "RE,LO"],
};

/** The words around the number in the document's language: `#` the page, `@` the last page. */
const WORDS: Record<Lang, { page: string; pageOf: string }> = {
  de: { page: "Seite~#", pageOf: "Seite~# von~@" },
  en: { page: "Page~#", pageOf: "Page~# of~@" },
  fr: { page: "Page~#", pageOf: "Page~# sur~@" },
  es: { page: "Página~#", pageOf: "Página~# de~@" },
  it: { page: "Pagina~#", pageOf: "Pagina~# di~@" },
  pt: { page: "Página~#", pageOf: "Página~# de~@" },
  nl: { page: "Pagina~#", pageOf: "Pagina~# van~@" },
  pl: { page: "Strona~#", pageOf: "Strona~# z~@" },
  ru: { page: "Страница~#", pageOf: "Страница~# из~@" },
  zh: { page: "第~#~页", pageOf: "第~#~页，共~@~页" },
  ja: { page: "#~ページ", pageOf: "#~/~@~ページ" },
};

const STYLE_TEXT: Record<NumberStyle, (lang: Lang) => string> = {
  number: () => "#",
  dashes: () => "--~#~--",
  page: (lang) => WORDS[lang].page,
  pageOf: (lang) => WORDS[lang].pageOf,
  slash: () => "#~/~@",
};

/** How a style reads on page 3 of 12, for the dialog's list. */
export function styleExample(style: NumberStyle, lang: Lang): string {
  return STYLE_TEXT[style](lang).replace("--", "–").replace("--", "–").replaceAll("~", " ").replace("#", "3").replace("@", "12");
}

/** Whether a style needs lastpage, for the number of the last page. */
export const needsLastPage = (style: NumberStyle) => STYLE_TEXT[style]("en").includes("@");

/**
 * What `\pagenumber` sets. Words go only around a number that shows: where
 * `\pagenumbering{gobble}` hides it (a title page), nothing is left.
 */
function numberCode(style: NumberStyle, lang: Lang): string {
  if (style === "number") return "\\thepage";
  // `{}` keeps the space after the command.
  const text = STYLE_TEXT[style](lang).replace("#", "\\thepage{}").replace("@", "\\pageref{LastPage}");
  return `{\\sbox0{\\thepage}\\ifdim\\wd0>0pt ${text}\\fi}`;
}

/** What a field of the header or footer shows: the page number, the running heads LaTeX keeps, or text of the user's. */
export type FieldContent =
  | { kind: "none" }
  | { kind: "page" }
  /** `\leftmark`: the chapter, or the section where the class has no chapters. */
  | { kind: "chapter" }
  /** `\rightmark`: the section, or the subsection. */
  | { kind: "section" }
  | { kind: "text"; text: string };

export interface HeaderFooter {
  /** What each field shows on ordinary pages; missing ones are empty. Pages that start a chapter (`plain`) show only the page number. */
  fields: Partial<Record<NumberPosition, FieldContent>>;
  style: NumberStyle;
  /** In a smaller size (`\small`), as the thesis template has them. */
  small: boolean;
  /** A line under the header. */
  rule: boolean;
}

export const EMPTY_HEADER_FOOTER: HeaderFooter = { fields: {}, style: "number", small: false, rule: false };

const MARK = "% Header and footer, as Insert > Page numbers and Header and footer set them";
const OLD_MARK = "% Page numbers, as Insert > Page numbers sets them";
const DEFINITION = /^[ \t]*\\newcommand\*?\s*\{\\pagenumber\}\s*\{(.*)\}[ \t]*$/m;
/** `\fancyhead[LE,RO]{…}`, `\fancyfoot{…}`, and the old `\lhead{…}`: group 1 the command, 2 the fields, 3 the content. */
const FIELD_LINE = /^[ \t]*\\(fancyhead|fancyfoot|[lcr]head|[lcr]foot)\s*(?:\[([^\]]*)\])?\s*\{(.*)\}[ \t]*$/;
const PLAIN_STYLE = /^[ \t]*\\fancypagestyle\s*\{plain\}\s*\{(.*)\}[ \t]*$/;
const RULE = /^[ \t]*\\renewcommand\s*\{?\\headrulewidth\}?\s*\{([^}]*)\}[ \t]*$/;
/** What else a fancyhdr setup has on lines of its own, ours or the document's. */
const SETUP_LINE =
  /^[ \t]*(?:\\fancyhf\s*\{\s*\}|\\pagestyle\s*\{(?:fancy|plain)\}|\\renewcommand\s*\{?\\footrulewidth\}?\s*\{[^}]*\})[ \t]*$/;
const SIZE = /^\\(?:small|footnotesize|scriptsize|normalsize)\b\s*/;

interface Block {
  from: number;
  to: number;
}

/** The lines of the block of ours in the preamble of `main` (see `blockLines`), up to the end of the last; `null` without one. */
function blockOf(main: string): Block | null {
  const head = headOf(main);
  const definition = DEFINITION.exec(head);
  if (!definition) return null;
  let from = definition.index;
  const before = head.lastIndexOf("\n", from - 2) + 1;
  if (from > 0 && [MARK, OLD_MARK].includes(head.slice(before, from - 1).trim())) from = before;
  let to = definition.index + definition[0].length;
  while (to < head.length) {
    const end = head.indexOf("\n", to + 1);
    const line = head.slice(to + 1, end < 0 ? head.length : end);
    if (![PLAIN_STYLE, FIELD_LINE, RULE, SETUP_LINE].some((pattern) => pattern.test(line))) break;
    to = end < 0 ? head.length : end;
  }
  return { from, to };
}

/** The positions a field line's command and fields stand for (`\fancyhead[LE,RO]` → top-outer; no fields: all three). */
function positionsOf(command: string, fields: string | undefined): NumberPosition[] {
  const top = command === "fancyhead" || command.endsWith("head");
  const old = /^[lcr]/.exec(command)?.[0];
  const wanted = (old ? old.toUpperCase() : (fields ?? "LCR")).replace(/\s/g, "").toUpperCase();
  const sorted = (f: string) => f.split(",").sort().join(",");
  const exact = (Object.keys(FIELDS) as NumberPosition[]).find(
    (p) => FIELDS[p][0] === (top ? "fancyhead" : "fancyfoot") && sorted(FIELDS[p][1]) === sorted(wanted),
  );
  if (exact) return [exact];
  // `[C]`, `[LR]` or the like: each letter one field.
  const vertical = top ? "top" : "bottom";
  const letters = new Set(wanted.replace(/[EO,]/g, ""));
  return (["L", "C", "R"] as const)
    .filter((l) => letters.has(l))
    .map((l) => `${vertical}-${{ L: "left", C: "center", R: "right" }[l]}` as NumberPosition);
}

function contentOf(code: string): { content: FieldContent; small: boolean } {
  const small = SIZE.test(code.trim());
  const rest = code.trim().replace(SIZE, "").trim();
  if (!rest) return { content: { kind: "none" }, small };
  if (rest === "\\pagenumber" || rest === "\\thepage") return { content: { kind: "page" }, small };
  if (rest === "\\leftmark") return { content: { kind: "chapter" }, small };
  if (rest === "\\rightmark") return { content: { kind: "section" }, small };
  // The page number among other text (the user's own "Seite \thepage"): the number as ours.
  if (/\\thepage\b/.test(rest) && !/\\(?:left|right)mark\b/.test(rest)) return { content: { kind: "page" }, small };
  return { content: { kind: "text", text: rest }, small };
}

function styleOf(code: string): NumberStyle {
  if (code.includes("--")) return "dashes";
  if (/\\thepage\{\}~\/~\\pageref\{LastPage\}\\fi/.test(code)) return "slash";
  if (code.includes("LastPage")) return "pageOf";
  return code === "\\thepage" ? "number" : "page";
}

/**
 * The header and footer the preamble of `main` sets: by the block of ours
 * (`ours`), else by the document's own fancyhdr lines (as the thesis
 * template has them); `null` where the class sets them.
 */
export function headerFooterOf(main: string): (HeaderFooter & { ours: boolean }) | null {
  const block = blockOf(main);
  const head = maskComments(headOf(main));
  // The document's own lines before the block: a block of ours clears what they set (`\fancyhf{}`).
  const lines = head.slice(0, block?.to ?? head.length).split("\n");
  const setup: HeaderFooter = { fields: {}, style: "number", small: false, rule: true };
  let found = false;
  let plainPage: NumberPosition[] = [];
  let sizes = 0;
  for (const line of lines) {
    const plain = PLAIN_STYLE.exec(line);
    if (plain) {
      // The page number on plain pages, for blocks written before the fields were ours.
      const field = /\\(fancyhead|fancyfoot)\s*\[([^\]]*)\]\s*\{(?:\\small\s*)?\\pagenumber\}/.exec(plain[1]);
      if (field) plainPage = positionsOf(field[1], field[2]);
      found = true;
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field) {
      found = true;
      const { content, small } = contentOf(field[3]);
      if (small) sizes++;
      for (const position of positionsOf(field[1], field[2])) setup.fields[position] = content;
      continue;
    }
    const rule = RULE.exec(line);
    if (rule) setup.rule = !/^\s*0\s*(pt)?\s*$/.test(rule[1]);
    if (/\\fancyhf\s*\{\s*\}/.test(line)) {
      setup.fields = {};
      found = true;
    }
  }
  if (!block && !found) return null;
  if (block) {
    const definition = DEFINITION.exec(main.slice(block.from, block.to));
    setup.style = styleOf(definition?.[1] ?? "\\thepage");
    if (!Object.values(setup.fields).some((c) => c?.kind !== "none")) for (const p of plainPage) setup.fields[p] = { kind: "page" };
  }
  const shown = Object.values(setup.fields).filter((c) => c && c.kind !== "none").length;
  setup.small = shown > 0 && sizes >= shown;
  return { ...setup, ours: !!block };
}

function fieldCode(content: FieldContent | undefined, small: boolean): string {
  if (!content || content.kind === "none") return "";
  const code = { page: "\\pagenumber", chapter: "\\leftmark", section: "\\rightmark", text: content.kind === "text" ? content.text : "" }[
    content.kind
  ];
  return small ? `\\small ${code}` : code;
}

/**
 * The block of ours: `\pagenumber`; pages that start a chapter (`plain`)
 * with the page number only, as LaTeX's classes have them; the others with
 * every field.
 */
function blockLines(setup: HeaderFooter, lang: Lang, bodyStyles: boolean): string[] {
  const positions = (Object.keys(setup.fields) as NumberPosition[]).filter((p) => fieldCode(setup.fields[p], false));
  const line = (p: NumberPosition) => `\\${FIELDS[p][0]}[${FIELDS[p][1]}]{${fieldCode(setup.fields[p], setup.small)}}`;
  const pages = positions.filter((p) => setup.fields[p]?.kind === "page");
  return [
    MARK,
    `\\newcommand*{\\pagenumber}{${numberCode(setup.style, lang)}}`,
    `\\fancypagestyle{plain}{\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}${pages.map(line).join("")}}`,
    "\\fancyhf{}",
    ...positions.map(line),
    `\\renewcommand{\\headrulewidth}{${setup.rule ? "0.4pt" : "0pt"}}`,
    // A body that switches styles itself (the thesis template's `\pagestyle{fancy}` for its main part) keeps doing so.
    ...(bodyStyles ? [] : ["\\pagestyle{fancy}"]),
  ];
}

/**
 * Sets the header and footer in the main file's preamble: the block of ours
 * in place of the one there, else right before `\begin{document}`, so after
 * the packages. The document's own fancyhdr lines go, as the block takes
 * over what they set (`headerFooterOf` reads them, so a dialog starts from
 * them). fancyhdr and lastpage are the caller's to load. The edits come last
 * first; none without `\begin{document}`.
 */
export function headerFooterEdits(main: string, setup: HeaderFooter, lang: Lang): TextEdit[] {
  const masked = maskComments(main);
  const begin = BEGIN_DOCUMENT.exec(masked);
  if (!begin) return [];
  const block = blockOf(main);
  const lines = blockLines(setup, lang, /\\pagestyle\s*\{/.test(masked.slice(begin.index))).join("\n");
  const edits: TextEdit[] = [];
  if (block) edits.push({ from: block.from, to: block.to, insert: lines });
  else {
    const at = main.lastIndexOf("\n", begin.index - 1) + 1;
    edits.push({ from: at, to: at, insert: `${lines}\n\n` });
  }
  let offset = 0;
  for (const line of masked.slice(0, begin.index).split("\n")) {
    const inBlock = block && offset >= block.from && offset < block.to;
    const own = FIELD_LINE.test(line) || RULE.test(line) || SETUP_LINE.test(line) || PLAIN_STYLE.test(line);
    if (!inBlock && own) edits.push({ from: Math.max(0, offset - 1), to: offset + line.length, insert: "" });
    offset += line.length + 1;
  }
  return edits.sort((a, b) => b.from - a.from);
}

// ---------------------------------------------------------------------------
// How they count: the body.

export type NumberFormat = "arabic" | "roman" | "Roman" | "alph" | "Alph" | "none";
export const FORMATS: NumberFormat[] = ["arabic", "roman", "Roman", "alph", "Alph", "none"];

/** How the numbers count from a place on: `null` keeps what was before (the format, or the count going on). */
export interface Counting {
  format: NumberFormat | null;
  start: number | null;
}

/** A line of the body, in reading order across the files read in. `from` is its offset in `file`; `line` counts from 1. */
export interface BodyLine {
  file: string;
  line: number;
  text: string;
  from: number;
}

/**
 * The body of the main file `main`, from `\begin{document}` to before
 * `\end{document}`, with the lines of each file read in (`\input`,
 * `\include`) after the line that reads it in.
 */
export function bodyLines(
  main: string,
  read: (file: string) => string | null,
  inclusions: { file: string; parent: string; line: number }[],
): BodyLine[] {
  const children = new Map<string, string[]>();
  for (const inclusion of inclusions) {
    const key = `${inclusion.parent}\n${inclusion.line}`;
    children.set(key, [...(children.get(key) ?? []), inclusion.file]);
  }
  const lines: BodyLine[] = [];
  const reading = new Set<string>();
  const walk = (file: string, inMain: boolean) => {
    const text = read(file);
    if (text === null || reading.has(file)) return;
    reading.add(file);
    const masked = maskComments(text);
    const begin = inMain ? BEGIN_DOCUMENT.exec(masked) : null;
    if (inMain && !begin) return;
    const end = inMain ? masked.search(/\\end\s*\{document\}/) : -1;
    let from = 0;
    text.split("\n").forEach((line, i) => {
      const inside = !inMain || (from + line.length >= begin!.index && (end < 0 || from <= end));
      if (inside) {
        lines.push({ file, line: i + 1, text: line, from });
        for (const child of children.get(`${file}\n${i + 1}`) ?? []) walk(child, false);
      }
      from += line.length + 1;
    });
    reading.delete(file);
  };
  walk(main, true);
  return lines;
}

/** What begins a region: the document, a heading, or a list or other part that is set on pages of its own. */
export type RegionKind =
  | "start"
  | "heading"
  | "title"
  | "abstract"
  | "contents"
  | "figures"
  | "tables"
  | "bibliography"
  | "index"
  | "glossary"
  | "appendix"
  | "end";

/** Parts set by a command; all but `\appendix` put something on the page. */
const PARTS: [RegExp, RegionKind][] = [
  [/\\maketitle(?![a-zA-Z])|\\begin\s*\{titlepage\}/, "title"],
  [/\\begin\s*\{abstract\}/, "abstract"],
  [/\\tableofcontents(?![a-zA-Z])/, "contents"],
  [/\\listoffigures(?![a-zA-Z])/, "figures"],
  [/\\listoftables(?![a-zA-Z])/, "tables"],
  [/\\(?:printbibliography|bibliography)(?![a-zA-Z])/, "bibliography"],
  [/\\printindex(?![a-zA-Z])/, "index"],
  [/\\(?:printglossary|printglossaries|printacronyms)(?![a-zA-Z])/, "glossary"],
  [/\\appendix(?![a-zA-Z])/, "appendix"],
];

/** `\pagenumbering{roman}`, `\setcounter{page}{3}`, `\renewcommand{\thepage}{\roman{page}}`. */
const SWITCH =
  /\\pagenumbering\s*\{\s*(\w+)\s*\}|\\setcounter\s*\{\s*page\s*\}\s*\{\s*(-?\d+)\s*\}|\\renewcommand\*?\s*\{?\s*\\thepage\s*\}?\s*\{\s*(?:\\(arabic|roman|Roman|alph|Alph)\s*\{\s*page\s*\})?\s*\}/g;
/** What prints nothing itself: page breaks and styles, files read in, the start of the body. */
const NEUTRAL =
  /\\(?:clearpage|cleardoublepage|newpage|(?:this)?pagestyle\s*\{[^}]*\}|(?:input|include|subfile)\s*\{[^}]*\}|begin\s*\{document\})/g;
const BREAK = /\\(?:clearpage|cleardoublepage|newpage)(?![a-zA-Z])/;

export interface Switch {
  file: string;
  /** The line it is on, and its place in the file. */
  lineFrom: number;
  lineText: string;
  from: number;
  to: number;
}

export interface PageRegion {
  kind: RegionKind;
  /** A heading's, as the outline has it; "" for the rest. */
  title: string;
  number: string | null;
  level: number | null;
  /** Where it begins, for the preview's page. */
  file: string;
  line: number;
  /** How the numbers count from here, as the switches set it. */
  counting: Counting;
  switches: Switch[];
  /** Where switches go where it has none: the start of the line it begins on (the end of `\begin{document}`'s for the start). */
  at: number;
  indent: string;
  /** No page break right before it: one goes in with the switches, so they act from the new page on. */
  needsBreak: boolean;
}

function apply(counting: Counting, match: RegExpMatchArray) {
  if (match[1] !== undefined) {
    counting.format = match[1] === "gobble" ? "none" : FORMATS.includes(match[1] as NumberFormat) ? (match[1] as NumberFormat) : "arabic";
    counting.start = 1;
  } else if (match[2] !== undefined) counting.start = Number(match[2]);
  else counting.format = (match[3] as NumberFormat | undefined) ?? "none";
}

/**
 * The regions of the body: its start, each heading of `outline` and each part
 * of `PARTS`, with the switches that act on it. A switch belongs to the
 * region before it while nothing has been set since it began (a switch right
 * after `\chapter{…}` or `\begin{document}`), else to the next one (the
 * thesis template's `\pagenumbering{roman}` before the abstract it reads in).
 */
export function regionsOf(
  lines: BodyLine[],
  outline: { level: number; number: string | null; title: string; file: string; line: number }[],
): PageRegion[] {
  if (!lines.length) return [];
  const headings = new Map(outline.map((h) => [`${h.file}\n${h.line}`, h]));
  const first = lines[0];
  const next = lines.find((l, i) => i > 0 && l.file === first.file && l.text.trim());
  const start: PageRegion = {
    kind: "start",
    title: "",
    number: null,
    level: null,
    file: first.file,
    line: first.line,
    counting: { format: null, start: null },
    switches: [],
    at: first.from + first.text.length,
    indent: next ? indentOf(next.text) : "",
    needsBreak: false,
  };
  const regions = [start];
  let current = start;
  let content = false;
  let afterBreak = true;
  let pending: [Switch, RegExpMatchArray][] = [];
  const take = (region: PageRegion, found: [Switch, RegExpMatchArray][]) => {
    for (const [s, match] of found) {
      region.switches.push(s);
      apply(region.counting, match);
    }
  };
  lines.forEach((body, i) => {
    const masked = maskComments(body.text);
    // The start of the body itself: what follows on its line is the body's.
    const text = i === 0 ? masked.replace(BEGIN_DOCUMENT, (m) => " ".repeat(m.length)) : masked;
    const switches: [Switch, RegExpMatchArray][] = [...text.matchAll(SWITCH)].map((match) => [
      {
        file: body.file,
        lineFrom: body.from,
        lineText: body.text,
        from: body.from + match.index!,
        to: body.from + match.index! + match[0].length,
      },
      match,
    ]);
    const heading = headings.get(`${body.file}\n${body.line}`);
    const part = heading ? null : PARTS.find(([pattern]) => pattern.test(text));
    const prints = !!text.replace(SWITCH, "").replace(NEUTRAL, "").trim();
    if (heading || part) {
      const region: PageRegion = {
        kind: heading ? "heading" : part![1],
        title: heading?.title ?? "",
        number: heading?.number ?? null,
        level: heading?.level ?? null,
        file: body.file,
        line: body.line,
        counting: { format: null, start: null },
        switches: [],
        at: body.from,
        indent: indentOf(body.text),
        needsBreak: !afterBreak,
      };
      take(region, [...pending, ...switches]);
      pending = [];
      regions.push(region);
      current = region;
      content = !heading && region.kind !== "appendix";
    } else {
      if (content) pending.push(...switches);
      else take(current, switches);
      if (prints) content = true;
    }
    // Switches and page styles print nothing: a break before them is still right before what follows.
    if (BREAK.test(masked)) afterBreak = true;
    else if (prints || heading || part) afterBreak = false;
  });
  if (pending.length) {
    const [[s]] = pending;
    const line = lines.find((l) => l.file === s.file && l.from === s.lineFrom)!;
    const end: PageRegion = {
      kind: "end",
      title: "",
      number: null,
      level: null,
      file: s.file,
      line: line.line,
      counting: { format: null, start: null },
      switches: [],
      at: s.lineFrom,
      indent: indentOf(s.lineText),
      needsBreak: false,
    };
    take(end, pending);
    regions.push(end);
  }
  return regions;
}

/** The switches that set `counting`, one command each. */
function countingCode(counting: Counting): string[] {
  const { format, start } = counting;
  if (format && start !== null) {
    return [`\\pagenumbering{${format === "none" ? "gobble" : format}}`, ...(start !== 1 ? [`\\setcounter{page}{${start}}`] : [])];
  }
  if (format) return [`\\renewcommand*{\\thepage}{${format === "none" ? "" : `\\${format}{page}`}}`];
  if (start !== null) return [`\\setcounter{page}{${start}}`];
  return [];
}

export const sameCounting = (a: Counting, b: Counting) => a.format === b.format && a.start === b.start;

/**
 * Sets `counting` for `region`: its switches go, the new ones come where the
 * first of them was, else where the region begins, after a page break where
 * none is right before it (`\cleardoublepage` with two-sided printing, so a
 * new count starts on a right-hand page). Edits per file.
 */
export function countingEdits(region: PageRegion, counting: Counting, twoSided: boolean): Map<string, TextEdit[]> {
  const edits = new Map<string, TextEdit[]>();
  const add = (file: string, edit: TextEdit) => edits.set(file, [...(edits.get(file) ?? []), edit]);
  const code = countingCode(counting);
  const lines = new Map<string, Switch[]>();
  for (const s of region.switches) {
    const key = `${s.file}\n${s.lineFrom}`;
    lines.set(key, [...(lines.get(key) ?? []), s]);
  }
  let placed = false;
  for (const switches of lines.values()) {
    const [{ file, lineFrom, lineText }] = switches;
    let rest = lineText;
    for (const s of [...switches].reverse()) rest = rest.slice(0, s.from - lineFrom) + rest.slice(s.to - lineFrom);
    const indent = indentOf(lineText);
    if (!maskComments(rest).trim()) {
      // A line of switches only: the new ones in its place, or it goes.
      if (!placed && code.length)
        add(file, { from: lineFrom, to: lineFrom + lineText.length, insert: code.map((c) => indent + c).join("\n") });
      else add(file, { from: Math.max(0, lineFrom - 1), to: lineFrom + lineText.length, insert: "" });
    } else {
      switches.forEach((s, i) => add(file, { from: s.from, to: s.to, insert: !placed && i === 0 ? code.join("") : "" }));
    }
    placed ||= code.length > 0;
  }
  if (!placed && code.length) {
    const lines = code.map((c) => region.indent + c);
    if (region.kind === "start") add(region.file, { from: region.at, to: region.at, insert: `\n${lines.join("\n")}` });
    else {
      if (region.needsBreak) lines.unshift(region.indent + (twoSided ? "\\cleardoublepage" : "\\clearpage"));
      add(region.file, { from: region.at, to: region.at, insert: `${lines.join("\n")}\n` });
    }
  }
  return edits;
}
