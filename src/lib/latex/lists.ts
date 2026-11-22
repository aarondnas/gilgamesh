// The lists behind the ribbon's "Insert" tab (table of contents, list of
// figures, bibliography, …). Each goes into a file of its own that prints it
// under the chosen heading; the main file reads it with `\input` at the
// chosen place and gets whatever its preamble lacks for it.
//
// What a list needs depends on the packages the document already uses: it
// goes through those (glossaries or acronym, biblatex or BibTeX, …) and only
// adds a package where there is none. Headings and page breaks stay the
// document class's, so the list looks like the rest of the document.

import { parentDir, relativePath, resolveInclude } from "$lib/util/paths";
import { slugOf } from "./preamble";
import {
  BEGIN_DOCUMENT,
  documentClassOf,
  indentOf,
  packageNames,
  stripComment as code,
  stripComments as codeOf,
  USEPACKAGE,
} from "./syntax";

/** In the order lists usually appear; only used to suggest a place. */
export const LIST_KINDS = [
  "contents",
  "figures",
  "tables",
  "listings",
  "equations",
  "abbreviations",
  "symbols",
  "glossary",
  "bibliography",
  "index",
] as const;

export type ListKind = (typeof LIST_KINDS)[number];

/** Lists usually after the text; all others before it. */
const BACK: readonly ListKind[] = ["bibliography", "index"];

/** What prints a list, in the main file or in a file it reads. Checked in `LIST_KINDS` order. */
const PRINTS: Record<ListKind, RegExp> = {
  contents: /\\tableofcontents\b/,
  figures: /\\listoffigures\b/,
  tables: /\\listoftables\b/,
  listings: /\\lstlistoflistings\b|\\listoflistings\b/,
  equations: /\\listof(formel|equations?|formulas)\b/,
  abbreviations: /\\print(acronyms|abbreviations)\b|type\s*=\s*(\\acronymtype|\{?abbreviations)|\\abkuerzungen\b|\\begin\{acronym\}/,
  symbols: /type\s*=\s*\{?symbols|\\printsymbols\b|\\printnomenclature\b/,
  glossary: /\\print\w*glossar(y|ies)\b|\\glossar\b/,
  bibliography: /\\printbibliography\b|\\bibliography\s*\{/,
  index: /\\printindex\b/,
};

/** Lists a presentation has no use for: beamer defines no commands for them. */
const NOT_IN_BEAMER: readonly ListKind[] = ["figures", "tables", "listings", "equations"];

const INPUT = /\\(input|include)\s*\{([^}]+)\}/;
/** Where the text starts, before which the lists in front are suggested if there are none yet. */
const TEXT_START = /\\(part|chapter|section|addpart|addchap|addsec|mainmatter)\b|\\include\s*\{/;
const HEADING = /\\(part|chapter|section|addpart|addchap|addsec)\b/;
/** Belongs to the text that follows, so a list is suggested above it. */
const LEAD_IN = /^\s*(%.*|\\(pagenumbering|pagestyle|thispagestyle|mainmatter)\b.*|\\setcounter\s*\{page\}.*)$/;
/** Ends the list above; a new list is suggested below it. */
const PAGE_BREAK = /^\s*\\(clearpage|cleardoublepage|newpage)\s*$/;
/** Belongs to the list below; a new list is suggested above it. */
const TOC_ENTRY = /^\s*\\(phantomsection|addcontentsline)\b/;

export type ListErrorCode = "no-document" | "beamer" | "bibtex-exists" | "changed";

export class ListError extends Error {
  readonly code: ListErrorCode;

  constructor(code: ListErrorCode) {
    super(code);
    this.code = code;
  }
}

/** A place in the document body for the `\input`: before line `number`, which `line` describes. */
export interface ListPosition {
  at: number;
  place: "start" | "before" | "end";
  line: string;
  number: number;
}

export interface ListSource {
  kind: ListKind;
  /** Project path of the main file, with forward slashes. */
  main: string;
  /** Text of the main file. */
  source: string;
  /** Text of a project file, "" if there is none. */
  read: (path: string) => Promise<string>;
}

export interface ListContext {
  positions: ListPosition[];
  /** The lists the main file prints already (also through files it reads), by line, in order. */
  lists: { line: number; kind: ListKind }[];
  /** The place (its `at`, one of `positions`) a list of this kind usually has, among the lists already there. */
  suggested: number;
  /** The main file prints such a list already. */
  exists: boolean;
  /** Whether the list can be put into the table of contents (not the table itself, not in slides). */
  tocChoice: boolean;
  /** Suggested: no entry where the document has its lists put there anyway (tocbibind, KOMA options). */
  tocDefault: boolean;
}

export interface ListRequest extends ListSource {
  heading: string;
  /** The new file, with `.tex`. */
  file: string;
  /** One of the context's positions. */
  at: number;
  toc: boolean;
  /** The project's `.bib` files. */
  bibFiles: string[];
  /** Where a bibliography file goes if the project has none. */
  newBib: string;
}

export interface ListPlan {
  /** Text of the new file. */
  text: string;
  /** Replaces `from`…`to` of the main file with `insert`. */
  edit: { from: number; to: number; insert: string };
  /** An empty bibliography file to create, `null` if the project has one. */
  createBib: string | null;
}

interface Line {
  from: number;
  to: number;
  text: string;
}

interface Package {
  from: number;
  to: number;
  options: string[];
  names: string[];
}

interface BodyLine {
  line: Line;
  kind: ListKind | null;
  start: boolean;
  /** Not inside an environment: a place a list can go before. */
  topLevel: boolean;
  /** The project file the line reads in. */
  file: string | null;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const line of text.split("\n")) {
    lines.push({ from, to: from + line.length, text: line });
    from += line.length + 1;
  }
  return lines;
}

function kindOf(text: string): ListKind | null {
  return LIST_KINDS.find((kind) => PRINTS[kind].test(text)) ?? null;
}

/** The main file taken apart: preamble, packages and what each line of the body prints. */
async function analyze({ main, source, read }: Omit<ListSource, "kind">) {
  const lines = splitLines(source);
  const begin = lines.findIndex((l) => BEGIN_DOCUMENT.test(code(l.text)));
  const end = lines.findIndex((l, i) => i > begin && /\\end\s*\{document\}/.test(code(l.text)));
  if (begin < 0 || end < 0) throw new ListError("no-document");

  const base = parentDir(main);
  const preamble = lines.slice(0, begin);
  const preambleCode = codeOf(source.slice(0, lines[begin].from));
  const documentClass = documentClassOf(preambleCode);
  const classOptions = documentClass?.options ?? "";
  const className = documentClass?.name ?? "";
  const beamer = className === "beamer";

  const body: BodyLine[] = [];
  let depth = 0;
  for (const line of lines.slice(begin + 1, end)) {
    const text = code(line.text);
    let kind = kindOf(text);
    let start = !kind && TEXT_START.test(text);
    const input = INPUT.exec(text);
    const file = input ? resolveInclude(base, input[2]) : null;
    if (!kind && file) {
      const content = codeOf(await read(file));
      kind = kindOf(content);
      start = !kind && (start || HEADING.test(content));
    }
    body.push({ line, kind, start, topLevel: depth === 0 && text.trim().startsWith("\\"), file });
    depth += (text.match(/\\begin\s*\{/g)?.length ?? 0) - (text.match(/\\end\s*\{/g)?.length ?? 0);
    depth = Math.max(0, depth);
  }

  function findPackage(name: string): Package | null {
    for (const line of preamble) {
      for (const match of code(line.text).matchAll(USEPACKAGE)) {
        const names = packageNames(match);
        if (!names.includes(name)) continue;
        const options = (match[1] ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        return { from: line.from + match.index, to: line.from + match.index + match[0].length, options, names };
      }
    }
    return null;
  }

  return { lines, begin, end, base, preamble, preambleCode, className, classOptions, beamer, body, findPackage };
}

type Analysis = Awaited<ReturnType<typeof analyze>>;

/** Which bibliography tool the document uses: biblatex, BibTeX (with or without natbib), or none yet. */
function bibliographyTool(a: Analysis, source: string): "biblatex" | "bibtex" | null {
  if (a.findPackage("biblatex")) return "biblatex";
  if (a.findPackage("natbib") || /\\bibliographystyle\b|\\bibliography\s*\{/.test(codeOf(source))) return "bibtex";
  return null;
}

/** Whether the document puts lists of this kind into the table of contents by itself. */
function listedAnyway(kind: ListKind, a: Analysis, source: string): boolean {
  const tocbibind = a.findPackage("tocbibind");
  const not = (option: string) => !tocbibind?.options.includes(option);
  // memoir lists its lists and bibliography by default; KOMA's listof=totoc covers listings too.
  const memoir = a.className === "memoir";
  const komaLists = /listof\s*=\s*(totoc|numbered)|toc\s*=\s*listof/.test(a.classOptions);
  if (kind === "figures") return memoir || komaLists || (!!tocbibind && not("nolof"));
  if (kind === "tables") return memoir || komaLists || (!!tocbibind && not("nolot"));
  if (kind === "listings") return memoir || komaLists;
  if (kind === "bibliography" && bibliographyTool(a, source) === "bibtex") {
    return memoir || (!!tocbibind && not("notbib")) || /bibliography\s*=\s*(totoc|numbered)|toc\s*=\s*bib/.test(a.classOptions);
  }
  return false;
}

/** Where a list of `kind` usually goes, among the lists already there; a line start. */
function suggest(kind: ListKind, a: Analysis): number {
  const { body } = a;
  const back = BACK.includes(kind);
  const rank = LIST_KINDS.indexOf(kind);
  const peers = body.map((b, i) => ({ ...b, i })).filter((b) => b.kind && BACK.includes(b.kind) === back);
  // The index comes last, after an appendix too.
  const earlier = kind === "index" ? undefined : peers.filter((b) => LIST_KINDS.indexOf(b.kind!) <= rank).at(-1);
  const later = peers.find((b) => LIST_KINDS.indexOf(b.kind!) > rank);
  if (earlier) {
    let i = earlier.i;
    while (i + 1 < body.length && PAGE_BREAK.test(code(body[i + 1].line.text))) i++;
    // Lists set apart by blank lines stay so.
    if (i + 1 < body.length && !body[i + 1].line.text.trim()) i++;
    return body[i].line.to + 1;
  }
  if (later) {
    let i = later.i;
    while (i > 0 && TOC_ENTRY.test(code(body[i - 1].line.text))) i--;
    return body[i].line.from;
  }
  let i = back
    ? kind === "bibliography"
      ? body.findIndex((b) => /\\appendix\b/.test(code(b.line.text)))
      : -1
    : body.findIndex((b) => b.start);
  if (i < 0) return a.lines[a.end].from;
  while (i > 0 && LEAD_IN.test(body[i - 1].line.text)) i--;
  return body[i].line.from;
}

const short = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > 70 ? `${trimmed.slice(0, 69)}…` : trimmed;
};

/** The places the list can go, with the suggested one; the line each lies before, shortened. */
function positionsOf(a: Analysis, suggested: number): ListPosition[] {
  const endAt = a.lines[a.end].from;
  const positions: ListPosition[] = [{ at: a.lines[a.begin].to + 1, place: "start", line: "", number: 0 }];
  const add = (at: number) => {
    if (positions.some((p) => p.at === at)) return;
    const index = a.body.findIndex((b) => b.line.from >= at && b.line.text.trim());
    if (at >= endAt || index < 0) {
      positions.push({ at: endAt, place: "end", line: "", number: 0 });
      return;
    }
    // A table of contents entry says less than the list it belongs to.
    let shown = index;
    while (shown + 1 < a.body.length && TOC_ENTRY.test(code(a.body[shown].line.text))) shown++;
    const number = a.lines.indexOf(a.body[index].line) + 1;
    positions.push({ at, place: "before", line: short(a.body[shown].line.text), number });
  };
  for (const b of a.body) if (b.topLevel) add(b.line.from);
  add(suggested);
  add(endAt);
  return positions.sort((x, y) => x.at - y.at);
}

/** What the dialog offers for a list of `kind` in this main file. */
export async function listContext(request: ListSource): Promise<ListContext> {
  const a = await analyze(request);
  if (a.beamer && NOT_IN_BEAMER.includes(request.kind)) throw new ListError("beamer");
  const suggested = suggest(request.kind, a);
  return {
    positions: positionsOf(a, suggested),
    lists: listsOf(a),
    suggested,
    exists: a.body.some((b) => b.kind === request.kind),
    tocChoice: request.kind !== "contents" && !a.beamer,
    tocDefault: !listedAnyway(request.kind, a, request.source),
  };
}

/** A change to the main file at an offset of its text. */
interface Edit {
  at: number;
  remove: number;
  insert: string;
}

/** A line right after the package's `\usepackage` line. */
function afterPackage(a: Analysis, pkg: Package, text: string): Edit {
  const line = a.preamble.find((l) => l.from <= pkg.from && pkg.from <= l.to)!;
  return { at: line.to, remove: 0, insert: `\n${text}` };
}

/** `preambleCode` drops comments but keeps every line's start, so offsets map line by line. */
function sourceOffset(a: Analysis, index: number): number {
  const lineIndex = a.preambleCode.slice(0, index).split("\n").length - 1;
  const column = index - (a.preambleCode.lastIndexOf("\n", index - 1) + 1);
  return a.lines[lineIndex].from + column;
}

/**
 * What the preamble needs for an index, in the table of contents (`toc`) or
 * not: imakeidx puts it there itself (intoc) and replaces makeidx, which
 * cannot. `added` goes in front of `\begin{document}`.
 */
function indexSetup(a: Analysis, toc: boolean): { edits: Edit[]; added: string[] } {
  const edits: Edit[] = [];
  const added: string[] = [];
  const imakeidx = a.findPackage("imakeidx");
  const makeidx = a.findPackage("makeidx");
  const makeindex = /\\makeindex[ \t]*(\[([^\]]*)\])?/.exec(a.preambleCode);

  /** Brings imakeidx's \makeindex in line with the choice. */
  function setIntoc(pkg: Package) {
    if (!makeindex) {
      edits.push(afterPackage(a, pkg, `\\makeindex${toc ? "[intoc]" : ""}`));
      return;
    }
    const options = (makeindex[2] ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (options.includes("intoc") === toc) return;
    const next = toc ? [...options, "intoc"] : options.filter((o) => o !== "intoc");
    edits.push({
      at: sourceOffset(a, makeindex.index),
      remove: makeindex[0].length,
      insert: `\\makeindex${next.length ? `[${next.join(",")}]` : ""}`,
    });
  }

  if (!imakeidx && !makeidx) {
    added.push("\\usepackage{imakeidx}", `\\makeindex${toc ? "[intoc]" : ""}`);
  } else if (!imakeidx && makeidx && toc) {
    const rest = makeidx.names.filter((n) => n !== "makeidx");
    const replacement = rest.length
      ? `\\usepackage${makeidx.options.length ? `[${makeidx.options.join(",")}]` : ""}{${rest.join(",")}}\n\\usepackage{imakeidx}`
      : "\\usepackage{imakeidx}";
    edits.push({ at: makeidx.from, remove: makeidx.to - makeidx.from, insert: replacement });
    setIntoc(makeidx);
  } else if (imakeidx) {
    setIntoc(imakeidx);
  } else if (!makeindex) {
    edits.push(afterPackage(a, makeidx!, "\\makeindex"));
  }
  return { edits, added };
}

/**
 * The entry before a list's heading: with chapters that starts a page (a
 * right-hand one in two-sided documents), so the page break comes first and
 * the entry lands on its page.
 */
function tocBlock(heading: string): string[] {
  return [
    "\\ifdefined\\chapter",
    "  \\cleardoublepage",
    "  \\csname phantomsection\\endcsname",
    `  \\addcontentsline{toc}{chapter}{${heading}}`,
    "\\else",
    "  \\csname phantomsection\\endcsname",
    `  \\addcontentsline{toc}{section}{${heading}}`,
    "\\fi",
  ];
}

/** `tocBlock` as written, also indented. */
const TOC_BLOCK = String.raw`[ \t]*\\ifdefined\\chapter[ \t]*\n[ \t]*\\cleardoublepage[ \t]*\n[ \t]*\\csname phantomsection\\endcsname[ \t]*\n[ \t]*\\addcontentsline\{toc\}\{chapter\}\{.*\}[ \t]*\n[ \t]*\\else[ \t]*\n[ \t]*\\csname phantomsection\\endcsname[ \t]*\n[ \t]*\\addcontentsline\{toc\}\{section\}\{.*\}[ \t]*\n[ \t]*\\fi[ \t]*\n`;

/** `edits` (at offsets of `source`) as one change from the first to the last: one undo step. */
function combine(source: string, edits: Edit[]): { from: number; to: number; insert: string } {
  edits.sort((x, y) => y.at - x.at);
  let text = source;
  for (const e of edits) text = text.slice(0, e.at) + e.insert + text.slice(e.at + e.remove);
  let from = 0;
  while (from < source.length && from < text.length && source[from] === text[from]) from++;
  let tail = 0;
  while (tail < source.length - from && tail < text.length - from && source[source.length - 1 - tail] === text[text.length - 1 - tail]) {
    tail++;
  }
  return { from, to: source.length - tail, insert: text.slice(from, text.length - tail) };
}

/** The new file and the change to the main file for a list of `kind` at `at`. */
export async function planList(request: ListRequest): Promise<ListPlan> {
  const { kind, heading, source } = request;
  const a = await analyze(request);
  const { lines, begin, end, base, preambleCode, beamer, findPackage } = a;
  if (beamer && NOT_IN_BEAMER.includes(kind)) throw new ListError("beamer");
  // The main file changed since the dialog read it: the place may be another one.
  const at = request.at;
  if (at < lines[begin].to + 1 || at > lines[end].from || (at > 0 && source[at - 1] !== "\n")) {
    throw new ListError("changed");
  }
  const toc = request.toc && kind !== "contents" && !beamer;

  // Changes to the main file, applied from the end so earlier offsets stay right.
  const edits: { at: number; remove: number; insert: string }[] = [];
  const added: string[] = [];

  function addOption(pkg: Package, option: string) {
    const insert = `\\usepackage[${[...pkg.options, option].join(",")}]{${pkg.names.join(",")}}`;
    edits.push({ at: pkg.from, remove: pkg.to - pkg.from, insert });
  }

  const addAfter = (pkg: Package, text: string) => edits.push(afterPackage(a, pkg, text));

  /** A heading as the class sets lists: a chapter where there are chapters, else a section. */
  const ownHeading = `\\ifdefined\\chapter\\chapter*{${heading}}\\else\\section*{${heading}}\\fi`;
  const print: string[] = [];
  /** Set where the list's package makes the table of contents entry itself, at the right page. */
  let tocDone = !toc;

  switch (kind) {
    case "contents":
      print.push(`\\renewcommand{\\contentsname}{${heading}}`, "\\tableofcontents");
      break;
    case "figures":
      print.push(`\\renewcommand{\\listfigurename}{${heading}}`, "\\listoffigures");
      break;
    case "tables":
      print.push(`\\renewcommand{\\listtablename}{${heading}}`, "\\listoftables");
      break;
    case "listings":
      if (findPackage("minted")) {
        print.push(`\\renewcommand{\\listoflistingscaption}{${heading}}`, "\\listoflistings");
      } else {
        if (!findPackage("listings")) added.push("\\usepackage{listings}");
        print.push(`\\renewcommand{\\lstlistlistingname}{${heading}}`, "\\lstlistoflistings");
      }
      break;
    case "equations": {
      // A list the document defines already (tocloft's \newlistof, e.g.), else one of LaTeX's own means.
      const tocloft = /\\newlistof\s*(?:\[[^\]]*\])?\s*\{(\w+)\}\s*\{(\w+)\}/.exec(preambleCode);
      if (tocloft) {
        print.push(`\\renewcommand{\\cft${tocloft[2]}titlename}{${heading}}`, `\\listof${tocloft[1]}`);
      } else if (/\\listofequations\b/.test(preambleCode)) {
        print.push("\\listofequations");
      } else {
        added.push(
          "% \\equationentry{...} inside an equation adds it to the list of equations",
          "\\makeatletter",
          `\\newcommand{\\listequationsname}{${heading}}`,
          "\\newcommand{\\listofequations}{\\ifdefined\\chapter\\chapter*{\\listequationsname}\\else\\section*{\\listequationsname}\\fi\\@starttoc{loe}}",
          "\\newcommand{\\equationentry}[1]{\\addcontentsline{loe}{equation}{\\protect\\numberline{\\theequation}#1}}",
          "\\providecommand*{\\l@equation}{\\l@figure}",
          "\\makeatother",
        );
        print.push(`\\renewcommand{\\listequationsname}{${heading}}`, "\\listofequations");
      }
      break;
    }
    case "abbreviations":
    case "symbols":
    case "glossary": {
      // Packages for one kind of list that have their own commands.
      if (kind === "abbreviations" && findPackage("acronym")) {
        print.push(ownHeading, "\\begin{acronym}", "% \\acro{PDF}{Portable Document Format}", "\\end{acronym}");
        break;
      }
      if (kind === "abbreviations" && findPackage("acro")) {
        print.push(`\\printacronyms[name={${heading}}]`);
        break;
      }
      if (kind === "symbols" && findPackage("nomencl")) {
        if (!/\\makenomenclature\b/.test(preambleCode)) addAfter(findPackage("nomencl")!, "\\makenomenclature");
        print.push(`\\renewcommand{\\nomname}{${heading}}`, "\\printnomenclature");
        break;
      }
      const extra = findPackage("glossaries-extra");
      const plain = findPackage("glossaries");
      const pkg = extra ?? plain;
      const has = (...options: string[]) => options.some((o) => pkg?.options.includes(o));
      let type: string | null = null;
      let option: string | null = null;
      let example: string;
      if (kind === "abbreviations" && extra && has("abbreviations")) {
        type = "abbreviations";
        example = "% \\newabbreviation{pdf}{PDF}{Portable Document Format}";
      } else if (kind === "abbreviations") {
        type = "\\acronymtype";
        if (!has("acronym", "acronyms")) option = "acronym";
        example = "% \\newacronym{pdf}{PDF}{Portable Document Format}";
      } else if (kind === "symbols") {
        type = "symbols";
        if (!has("symbols")) option = "symbols";
        example = "% \\newglossaryentry{pi}{type=symbols, name={\\ensuremath{\\pi}}, description={...}}";
      } else {
        example = "% \\newglossaryentry{latex}{name={LaTeX}, description={...}}";
      }
      // glossaries-extra lists every defined entry without an extra tool.
      let command = "\\printunsrtglossary";
      if (!pkg) {
        added.push(`\\usepackage${option ? `[${option}]` : ""}{glossaries-extra}`, example);
      } else {
        if (option) addOption(pkg, option);
        if (!extra) {
          if (/\\makenoidxglossaries\b/.test(preambleCode)) command = "\\printnoidxglossary";
          else {
            command = "\\printglossary";
            if (!/\\makeglossaries\b/.test(preambleCode)) addAfter(pkg, "\\makeglossaries");
          }
        }
      }
      // The packages' own switch, for this list only: the entry lands on the heading's page.
      const glossary = `${command}[${type ? `type=${type}, ` : ""}title={${heading}}]`;
      print.push(beamer ? glossary : `{\\glstoc${request.toc ? "true" : "false"}${glossary}}`);
      tocDone = true;
      break;
    }
    case "bibliography": {
      const tool = bibliographyTool(a, source);
      const bibs = request.bibFiles.length ? request.bibFiles : [request.newBib];
      if (tool === "bibtex") {
        // BibTeX reads one \bibliography per document.
        if (a.body.some((b) => b.kind === "bibliography") || /\\bibliography\s*\{/.test(preambleCode)) {
          throw new ListError("bibtex-exists");
        }
        print.push(
          `\\ifdefined\\bibname\\renewcommand{\\bibname}{${heading}}\\fi`,
          `\\ifdefined\\refname\\renewcommand{\\refname}{${heading}}\\fi`,
        );
        if (!/\\bibliographystyle\b/.test(codeOf(source))) {
          print.push(`\\bibliographystyle{${findPackage("natbib") ? "plainnat" : "plain"}}`);
        }
        print.push(`\\bibliography{${bibs.map((b) => relativePath(base, b).replace(/\.bib$/, "")).join(",")}}`);
      } else {
        if (!tool) added.push("\\usepackage[backend=biber]{biblatex}");
        if (!/\\addbibresource\b|\\bibliography\s*\{/.test(preambleCode)) {
          added.push(...bibs.map((b) => `\\addbibresource{${relativePath(base, b)}}`));
        }
        const bibHeading = beamer ? "none" : request.toc ? "bibintoc" : "bibliography";
        print.push(`\\printbibliography[heading=${bibHeading}, title={${heading}}]`);
        tocDone = true;
      }
      break;
    }
    case "index": {
      const setup = indexSetup(a, request.toc);
      edits.push(...setup.edits);
      added.push(...setup.added);
      tocDone = true;
      print.push(`\\renewcommand{\\indexname}{${heading}}`, "\\printindex");
      break;
    }
  }

  if (added.length) edits.push({ at: lines[begin].from, remove: 0, insert: `${added.join("\n")}\n\n` });

  // The \input, indented like the line it goes before, set apart like it.
  const next = lines.find((l, i) => i > begin && i <= end && l.from >= at && l.text.trim());
  const previous = lines.findLast((l) => l.to < at);
  const indent = next && next !== lines[end] ? indentOf(next.text) : indentOf(previous?.text ?? "");
  const atLine = lines.find((l) => l.from === at);
  const gap = previous && !previous.text.trim() && atLine?.text.trim() ? "\n" : "";
  const target = relativePath(base, request.file).replace(/\.tex$/, "");
  edits.push({ at, remove: 0, insert: `${indent}\\input{${target}}\n${gap}` });

  // In slides a list is a frame, titled with the heading; long ones go on over several.
  const file = beamer
    ? [
        `\\begin{frame}${kind === "contents" ? "" : "[allowframebreaks]"}{${heading}}`,
        ...print.filter((l) => !l.startsWith("\\renewcommand")),
        "\\end{frame}",
      ]
    : [...(tocDone ? [] : tocBlock(heading)), ...print];

  return {
    text: `${file.join("\n")}\n`,
    edit: combine(source, edits),
    createBib:
      kind === "bibliography" && !request.bibFiles.length && !/\\addbibresource\b|\\bibliography\s*\{/.test(preambleCode)
        ? request.newBib
        : null,
  };
}

// Lists already in the document, as the ribbon's "Edit" changes them: their
// place, heading and table of contents entry, or takes them out. What a list
// does is read from its text (its own file, or its lines in the main file), so
// this works for lists the dialog did not make too, such as the templates'.

/** A list the main file prints already. */
export interface ListEntry {
  kind: ListKind;
  /** The main file's line (from 1) that prints it or reads it in. */
  line: number;
  /** The file that prints it, read in at `line`; `null` where the main file prints it itself. */
  file: string | null;
  /** Its heading as its text names it (or its table of contents entry); `null` where the class's name stands. */
  heading: string | null;
  headingChoice: boolean;
  /** Whether it is in the table of contents. */
  toc: boolean;
  tocChoice: boolean;
  /** It stands on lines of its own at the top level, so it can move and be taken out. */
  movable: boolean;
}

export interface ListEditContext extends ListContext {
  entry: ListEntry;
}

export interface ListEditRequest extends ListSource {
  /** The entry's `line`. */
  line: number;
  /** One of the context's places; its `suggested` one is where the list is now. */
  at: number;
  /** The new heading; `null` keeps it. */
  heading: string | null;
  toc: boolean;
}

export interface ListEditPlan {
  /** The change to the file that prints the list; `null` if it stays as it is. */
  file: { path: string; edit: { from: number; to: number; insert: string } } | null;
  /** The change to the main file; `null` if there is none. */
  edit: { from: number; to: number; insert: string } | null;
}

/**
 * Where a list's text names its heading (group 3): `\renewcommand{\…name}`,
 * `title=` and `name=` options, a starred heading, a frame title, or its
 * table of contents entry (group 2 set).
 */
const HEADING_AT =
  /(\\renewcommand\s*\{?\\\w*(?:name|caption)\}?\s*|\b(?:title|name)\s*=\s*|\\(?:chapter|section)\*\s*|\\begin\s*\{frame\}\s*(?:\[[^\]]*\]\s*)?|(\\addcontentsline\s*\{toc\}\s*\{\w+\}\s*))\{([^{}]*)\}/g;
/** A line of nothing but a table of contents entry and what goes with it. */
const ENTRY_LINE =
  /^\s*(?:(?:\\(?:cleardoublepage|clearpage|phantomsection)\b|\\csname\s*phantomsection\\endcsname)\s*)*(?:\\addcontentsline\s*\{toc\}.*)?$/;
/** A line that names the list below: `\renewcommand{\listfigurename}{…}`, also inside `\ifdefined … \fi`. */
const NAME_LINE = /^\s*(?:\\ifdefined\\\w+\s*)?\\renewcommand\s*\{?\\\w*(?:name|caption)\}?\s*\{[^{}]*\}\s*(?:\\fi)?\s*$/;
const GLOSSARY_PRINT = String.raw`print\w*glossar(?:y|ies)`;

const isEntryLine = (text: string) => /\\addcontentsline\s*\{toc\}|phantomsection/.test(text) && ENTRY_LINE.test(text);
const hasEntry = (text: string) => isEntryLine(text) && /\\addcontentsline/.test(text);

/** `pattern`'s (global) matches in `text` outside comments, at offsets of `text`. */
function codeMatches(text: string, pattern: RegExp): { at: number; match: RegExpMatchArray }[] {
  return splitLines(text).flatMap((line) =>
    [...code(line.text).matchAll(pattern)].map((match) => ({ at: line.from + match.index!, match })),
  );
}

/** The options of the first `\command` (a regex source) in `text`, "" without any; `null` where there is none. */
function optionsOf(text: string, command: string): string | null {
  const found = codeMatches(text, new RegExp(String.raw`\\(?:${command})\b(\s*\[([^\]]*)\])?`, "g"))[0];
  return found ? (found.match[2] ?? "") : null;
}

/** A key's value in `options`: "" for the key alone, `null` where it is not set. */
function keyOf(options: string, key: string): string | null {
  const found = new RegExp(String.raw`(?:^|,)\s*${key}\s*(?:=\s*(\{[^{}]*\}|[^,]*))?(?=,|$)`).exec(options);
  return found ? (found[1] ?? "").trim() : null;
}

/** `text` with `key` set to `value` in the options of its first `\command` (a regex source); `null` where there is none. */
function setOption(text: string, command: string, key: string, value: string): string | null {
  const found = codeMatches(text, new RegExp(String.raw`\\(?:${command})\b(\s*\[([^\]]*)\])?`, "g"))[0];
  if (!found) return null;
  const end = found.at + found.match[0].length;
  if (found.match[1] === undefined) return `${text.slice(0, end)}[${key}=${value}]${text.slice(end)}`;
  const options = found.match[2];
  const existing = new RegExp(String.raw`(^|,)(\s*)${key}\s*(?:=\s*(?:\{[^{}]*\}|[^,]*))?(?=,|$)`).exec(options);
  const next = existing
    ? `${options.slice(0, existing.index)}${existing[1]}${existing[2]}${key}=${value}${options.slice(existing.index + existing[0].length)}`
    : `${options.trim() ? `${options}, ` : ""}${key}=${value}`;
  return `${text.slice(0, end - 1 - options.length)}${next}${text.slice(end - 1)}`;
}

/** TeX for the name the class gives a list whose text sets none, for its table of contents entry. */
function nameOf(kind: ListKind, own: string): string | null {
  const c = codeOf(own);
  switch (kind) {
    case "contents":
      return "\\contentsname";
    case "figures":
      return "\\listfigurename";
    case "tables":
      return "\\listtablename";
    case "index":
      return /\\printindex\b/.test(c) ? "\\indexname" : null;
    case "listings":
      return /\\lstlistoflistings\b/.test(c) ? "\\lstlistlistingname" : /\\listoflistings\b/.test(c) ? "\\listoflistingscaption" : null;
    case "symbols":
      return /\\printnomenclature\b/.test(c) ? "\\nomname" : null;
    case "bibliography":
      return /\\bibliography\s*\{/.test(c) ? "\\ifdefined\\bibname\\bibname\\else\\refname\\fi" : null;
    default:
      return null;
  }
}

/** `lines` in front of the line of `own` that prints the list, indented like it. */
function beforePrint(kind: ListKind, own: string, lines: string[]): string {
  const print = splitLines(own).find((l) => PRINTS[kind].test(code(l.text)));
  if (!print) return own;
  const indent = indentOf(print.text);
  return own.slice(0, print.from) + lines.map((l) => `${indent}${l}\n`).join("") + own.slice(print.from);
}

/** `own` with what names the list `heading` where it names none yet; `null` where there is no way to. */
function withNewHeading(kind: ListKind, own: string, heading: string): string | null {
  const c = codeOf(own);
  if (/\\printbibliography\b/.test(c)) return setOption(own, "printbibliography", "title", `{${heading}}`);
  if (new RegExp(String.raw`\\${GLOSSARY_PRINT}\b`).test(c)) return setOption(own, GLOSSARY_PRINT, "title", `{${heading}}`);
  if (/\\printacronyms\b/.test(c)) return setOption(own, "printacronyms", "name", `{${heading}}`);
  const name = nameOf(kind, own);
  if (!name) return null;
  return beforePrint(
    kind,
    own,
    kind === "bibliography"
      ? [`\\ifdefined\\bibname\\renewcommand{\\bibname}{${heading}}\\fi`, `\\ifdefined\\refname\\renewcommand{\\refname}{${heading}}\\fi`]
      : [`\\renewcommand{${name}}{${heading}}`],
  );
}

/** `own` with the heading `old` (also in its table of contents entry) changed to `heading`; set anew where only the entry named it. */
function withHeading(kind: ListKind, own: string, old: string | null, named: boolean, heading: string): string {
  let text = own;
  if (old !== null) {
    for (const { at, match } of codeMatches(own, HEADING_AT).reverse()) {
      if (match[3] !== old) continue;
      const start = at + match[1].length + 1;
      text = text.slice(0, start) + heading + text.slice(start + old.length);
    }
  }
  return named ? text : (withNewHeading(kind, text, heading) ?? text);
}

/** Whether the list is in the table of contents, and whether that can be changed; `named`: an entry of its own would have a text. */
function tocOf(kind: ListKind, own: string, a: Analysis, source: string, named: boolean): { on: boolean; choice: boolean } {
  if (kind === "contents" || a.beamer) return { on: false, choice: false };
  const glstoc = codeMatches(own, /\\glstoc(true|false)\b/g)[0];
  if (glstoc) return { on: glstoc.match[1] === "true", choice: true };
  const bib = optionsOf(own, "printbibliography");
  if (bib !== null) return { on: /^(sub)?bib(intoc|numbered)$/.test(keyOf(bib, "heading") ?? ""), choice: true };
  const glossary = optionsOf(own, GLOSSARY_PRINT);
  if (glossary !== null) {
    const toc = keyOf(glossary, "toc");
    const pkg = a.findPackage("glossaries-extra") ?? a.findPackage("glossaries");
    return { on: toc === null ? !!pkg?.options.includes("toc") : toc !== "false", choice: true };
  }
  const imakeidx = a.findPackage("imakeidx");
  if (kind === "index" && (imakeidx || a.findPackage("makeidx"))) {
    const options = /\\makeindex[ \t]*\[([^\]]*)\]/.exec(a.preambleCode)?.[1] ?? "";
    return { on: !!imakeidx && keyOf(options, "intoc") !== null, choice: true };
  }
  if (new RegExp(`^${TOC_BLOCK}`, "m").test(own) || splitLines(own).some((l) => hasEntry(code(l.text)))) {
    return { on: true, choice: true };
  }
  if (listedAnyway(kind, a, source)) return { on: true, choice: false };
  return { on: false, choice: named };
}

/** `own` (and the preamble) putting the list into the table of contents or taking it out, by the means it uses. */
function withToc(
  kind: ListKind,
  own: string,
  a: Analysis,
  on: boolean,
  name: string,
  inMain: boolean,
): { own: string; edits: Edit[]; added: string[] } {
  const none = { edits: [], added: [] };
  const glstoc = codeMatches(own, /\\glstoc(true|false)\b/g)[0];
  if (glstoc) return { own: `${own.slice(0, glstoc.at)}\\glstoc${on}${own.slice(glstoc.at + glstoc.match[0].length)}`, ...none };
  const bib = setOption(own, "printbibliography", "heading", on ? "bibintoc" : "bibliography");
  if (bib !== null) return { own: bib, ...none };
  const glossary = setOption(own, GLOSSARY_PRINT, "toc", String(on));
  if (glossary !== null) return { own: glossary, ...none };
  if (kind === "index" && (a.findPackage("imakeidx") || a.findPackage("makeidx"))) return { own, ...indexSetup(a, on) };
  if (on) return { own: inMain ? beforePrint(kind, own, tocBlock(name)) : `${tocBlock(name).join("\n")}\n${own}`, ...none };
  const lines = own.replace(new RegExp(`^${TOC_BLOCK}`, "m"), "").split("\n");
  return { own: lines.filter((l) => !isEntryLine(code(l))).join("\n"), ...none };
}

/** A list the main file prints at `line`, itself or through `file` (`null` for the former). */
export interface PrintedList {
  line: number;
  kind: ListKind;
  file: string | null;
}

const listsOf = (a: Analysis): PrintedList[] =>
  a.body.flatMap((b) =>
    b.kind ? [{ line: a.lines.indexOf(b.line) + 1, kind: b.kind, file: kindOf(code(b.line.text)) ? null : b.file }] : [],
  );

/** The lists the main file prints (also through files it reads), by line, in order. */
export async function printedLists(request: Omit<ListSource, "kind">): Promise<PrintedList[]> {
  return listsOf(await analyze(request));
}

/**
 * The list at the request's line with the main file's lines that belong to
 * it (`first` to `last`, `from` to `to`): its table of contents entry and the
 * naming above it, a page break below it. `own` is its text: its file's, or
 * those lines.
 */
async function entryOf(a: Analysis, request: ListSource & { line: number }) {
  const { lines, body, begin, end } = a;
  const index = request.line - 1;
  const b = body.find((x) => x.line === lines[index]);
  if (!b || b.kind !== request.kind) throw new ListError("changed");
  const text = code(b.line.text);
  const file = kindOf(text) ? null : b.file;
  const block = new RegExp(`^${TOC_BLOCK}$`);
  let first = index;
  for (;;) {
    const above = first - 1 > begin ? code(lines[first - 1].text) : null;
    if (above !== null && (isEntryLine(above) || (!file && NAME_LINE.test(above)))) first--;
    else if (first - 8 > begin && block.test(request.source.slice(lines[first - 8].from, lines[first].from))) first -= 8;
    else break;
  }
  let last = index;
  if (last + 1 < end && PAGE_BREAK.test(code(lines[last + 1].text))) last++;
  const chunk = { first, last, from: lines[first].from, to: lines[last].to + 1 };
  const own = file ? await request.read(file) : request.source.slice(chunk.from, chunk.to);

  const headings = codeMatches(own, HEADING_AT);
  const named = headings.some((h) => h.match[2] === undefined);
  const heading = (headings.find((h) => h.match[2] === undefined) ?? headings[0])?.match[3] ?? null;
  const toc = tocOf(request.kind, own, a, request.source, (heading ?? nameOf(request.kind, own)) !== null);
  const depth = (text.match(/\\begin\s*\{/g)?.length ?? 0) - (text.match(/\\end\s*\{/g)?.length ?? 0);
  const entry: ListEntry = {
    kind: request.kind,
    line: request.line,
    file,
    heading,
    headingChoice: named || withNewHeading(request.kind, own, "") !== null,
    toc: toc.on,
    tocChoice: toc.choice,
    movable: b.topLevel && depth === 0,
  };
  return { entry, chunk, own, named };
}

type Chunk = Awaited<ReturnType<typeof entryOf>>["chunk"];

/** Takes the list's lines out; where blank lines stood on both sides, one of them goes too. */
function takeOut(a: Analysis, chunk: Chunk): Edit {
  const above = a.lines[chunk.first - 1];
  const below = a.lines[chunk.last + 1];
  const both = chunk.last + 1 < a.end && !above.text.trim() && !below.text.trim();
  return { at: chunk.from, remove: (both ? below.to + 1 : chunk.to) - chunk.from, insert: "" };
}

/** The list's lines for the place `at`, indented like the line they go before, set apart like it. */
function putIn(a: Analysis, chunk: Chunk, text: string, at: number): string {
  const { lines, begin, end } = a;
  const outside = (l: Line) => l.from < chunk.from || l.from >= chunk.to;
  const next = lines.find((l, i) => i > begin && i <= end && l.from >= at && l.text.trim() && outside(l));
  const previous = lines.findLast((l) => l.to < at && outside(l));
  const indent = next && next !== lines[end] ? indentOf(next.text) : indentOf(previous?.text ?? "");
  const gap = previous && !previous.text.trim() && lines.find((l) => l.from === at)?.text.trim() ? "\n" : "";
  const rows = text.replace(/\n$/, "").split("\n");
  const common = Math.min(...rows.filter((r) => r.trim()).map((r) => indentOf(r).length));
  return `${rows.map((r) => (r.trim() ? indent + r.slice(common) : "")).join("\n")}\n${gap}`;
}

/** What the edit dialog offers for the list at the request's line: its places (`suggested` is its own), heading and entry. */
export async function listEditContext(request: ListSource & { line: number }): Promise<ListEditContext> {
  const a = await analyze(request);
  const { entry, chunk } = await entryOf(a, request);
  return {
    positions: positionsOf(a, chunk.from),
    lists: listsOf(a),
    suggested: chunk.from,
    exists: false,
    tocChoice: entry.tocChoice,
    tocDefault: entry.toc,
    entry,
  };
}

/** The changes for a list moved, renamed or put into (or out of) the table of contents. */
export async function planListEdit(request: ListEditRequest): Promise<ListEditPlan> {
  const { kind, source, at } = request;
  const a = await analyze(request);
  const { lines, begin, end } = a;
  const { entry, chunk, own, named } = await entryOf(a, request);
  const edits: Edit[] = [];

  let text = own;
  const heading = request.heading?.trim() || null;
  if (heading !== null && heading !== entry.heading && entry.headingChoice) {
    text = withHeading(kind, text, entry.heading, named, heading);
  }
  if (entry.tocChoice && request.toc !== entry.toc) {
    const name = heading ?? entry.heading ?? nameOf(kind, text) ?? "";
    const toc = withToc(kind, text, a, request.toc, name, !entry.file);
    text = toc.own;
    edits.push(...toc.edits);
    if (toc.added.length) edits.push({ at: lines[begin].from, remove: 0, insert: `${toc.added.join("\n")}\n\n` });
  }

  if (at < chunk.from || at > chunk.to) {
    // The main file changed since the dialog read it: the place may be another one.
    if (!entry.movable || at < lines[begin].to + 1 || at > lines[end].from || source[at - 1] !== "\n") {
      throw new ListError("changed");
    }
    edits.push(takeOut(a, chunk), { at, remove: 0, insert: putIn(a, chunk, entry.file ? source.slice(chunk.from, chunk.to) : text, at) });
  } else if (!entry.file && text !== own) {
    edits.push({ at: chunk.from, remove: chunk.to - chunk.from, insert: text });
  }

  return {
    file: entry.file && text !== own ? { path: entry.file, edit: combine(own, [{ at: 0, remove: own.length, insert: text }]) } : null,
    edit: edits.length ? combine(source, edits) : null,
  };
}

/** The change that takes the list at the request's line out of the main file, and the file that printed it. */
export async function planListRemoval(
  request: ListSource & { line: number },
): Promise<{ edit: { from: number; to: number; insert: string }; file: string | null }> {
  const a = await analyze(request);
  const { entry, chunk } = await entryOf(a, request);
  if (!entry.movable) throw new ListError("changed");
  return { edit: combine(request.source, [takeOut(a, chunk)]), file: entry.file };
}

/**
 * A file name from a heading: "List of Figures" → "list-of-figures". German
 * umlauts are written out ("Größe" → "groesse"), as German file names have them.
 */
export function fileNameFor(heading: string, kind: ListKind): string {
  const spelled = heading.toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" })[c]!);
  return slugOf(spelled) || kind;
}
