// LaTeX's messages in plain words: what a build's error or warning means,
// and the fix Gilgamesh can make for it at a click where there is one (load
// the package a command comes from, escape a special character, compile
// again, switch to an engine that can set a character).

/** What a fix does; the caller makes it (see `build.fixProblem`). */
export type Fix =
  | { kind: "package"; name: string }
  /** Writes the character as a command (`\&`) on the message's line. */
  | { kind: "escape"; char: "&" | "_" | "#" }
  | { kind: "engine"; engine: "lualatex" }
  | { kind: "compile" }
  /** Opens the dialog for adding a source. */
  | { kind: "source" };

export type ExplanationId =
  | "undefined_command"
  | "undefined_command_package"
  | "undefined_environment"
  | "undefined_environment_package"
  | "missing_dollar"
  | "alignment_tab"
  | "braces"
  | "extra_alignment"
  | "no_line"
  | "lonely_item"
  | "file_not_found"
  | "citation_undefined"
  | "empty_bibliography"
  | "reference_undefined"
  | "rerun"
  | "unicode"
  | "overfull"
  | "underfull"
  | "float_too_large"
  | "option_clash"
  | "missing_number"
  | "missing_begin_document"
  | "environment_mismatch"
  | "emergency_stop"
  | "bib_file_missing"
  | "notes_margin";

export interface Explanation {
  id: ExplanationId;
  /** For the message's placeholders: `{command}`, `{package}`, … */
  params: Record<string, string>;
  fix: Fix | null;
}

/** Commands of packages users load most, by the package. */
const COMMAND_PACKAGES: Record<string, string> = Object.fromEntries(
  Object.entries({
    graphicx: ["includegraphics", "rotatebox", "scalebox", "resizebox", "graphicspath"],
    booktabs: ["toprule", "midrule", "bottomrule", "cmidrule", "addlinespace"],
    hyperref: ["href", "hypersetup", "autoref", "phantomsection"],
    url: ["url"],
    xcolor: ["textcolor", "color", "colorbox", "fcolorbox", "definecolor", "pagecolor"],
    amssymb: ["mathbb", "mathfrak", "checkmark", "leqslant", "geqslant", "therefore", "because", "varnothing", "nexists"],
    amsmath: [
      "text",
      "eqref",
      "boldsymbol",
      "operatorname",
      "DeclareMathOperator",
      "tfrac",
      "dfrac",
      "binom",
      "xrightarrow",
      "xleftarrow",
      "intertext",
      "numberwithin",
      "tag",
      "iint",
      "iiint",
    ],
    mathtools: ["coloneqq", "eqqcolon", "mathclap", "prescript"],
    siunitx: ["SI", "si", "num", "qty", "unit", "ang", "sisetup", "SIrange", "numrange"],
    csquotes: ["enquote", "textquote", "blockquote"],
    todonotes: ["todo", "listoftodos", "missingfigure"],
    multirow: ["multirow"],
    makecell: ["makecell", "thead"],
    mhchem: ["ce", "pu"],
    lipsum: ["lipsum"],
    blindtext: ["blindtext", "Blindtext"],
    ulem: ["sout", "uline", "uuline", "uwave", "xout"],
    soul: ["hl", "so", "st", "ul"],
    cleveref: ["cref", "Cref", "crefrange", "Crefrange"],
    placeins: ["FloatBarrier"],
    caption: ["captionof", "captionsetup"],
    subcaption: ["subcaptionbox", "subref"],
    eurosym: ["euro"],
    gensymb: ["degree", "celsius", "micro", "ohm", "perthousand"],
    listings: ["lstinline", "lstset", "lstinputlisting", "lstlistoflistings"],
    biblatex: [
      "printbibliography",
      "addbibresource",
      "parencite",
      "textcite",
      "autocite",
      "footcite",
      "fullcite",
      "citeauthor",
      "citeyear",
    ],
    natbib: ["citep", "citet", "citealp", "citealt"],
    pifont: ["ding"],
    xspace: ["xspace"],
    ifthen: ["ifthenelse", "equal", "boolean"],
    setspace: ["setstretch", "onehalfspacing", "doublespacing", "singlespacing"],
    geometry: ["geometry", "newgeometry", "restoregeometry"],
    fancyhdr: ["fancyhead", "fancyfoot", "fancyhf", "lhead", "chead", "rhead", "lfoot", "cfoot", "rfoot", "fancypagestyle"],
    mathrsfs: ["mathscr"],
    bm: ["bm"],
    adjustbox: ["adjustbox"],
    tikz: ["tikz", "usetikzlibrary", "draw", "node", "fill"],
    qrcode: ["qrcode"],
    float: ["floatstyle", "restylefloat"],
    enumitem: ["setlist", "newlist"],
    acronym: ["ac", "acs", "acl", "acf", "acp"],
    glossaries: ["gls", "Gls", "glspl", "newglossaryentry", "printglossary", "makeglossaries", "newacronym"],
    amsthm: ["newtheorem", "theoremstyle", "qedhere"],
    titlesec: ["titleformat", "titlespacing"],
    tocloft: ["cftsetindents"],
    microtype: ["microtypesetup"],
    babel: ["selectlanguage", "foreignlanguage"],
  }).flatMap(([pkg, commands]) => commands.map((c) => [c, pkg])),
);

const ENVIRONMENT_PACKAGES: Record<string, string> = Object.fromEntries(
  Object.entries({
    amsmath: [
      "align",
      "align*",
      "equation*",
      "gather",
      "gather*",
      "multline",
      "multline*",
      "cases",
      "pmatrix",
      "bmatrix",
      "vmatrix",
      "Bmatrix",
      "matrix",
      "split",
      "aligned",
      "alignat",
    ],
    tabularx: ["tabularx"],
    longtable: ["longtable"],
    multicol: ["multicols", "multicols*"],
    listings: ["lstlisting"],
    minted: ["minted"],
    tikz: ["tikzpicture"],
    pgfplots: ["axis"],
    subcaption: ["subfigure", "subtable"],
    algorithm: ["algorithm"],
    algpseudocode: ["algorithmic"],
    setspace: ["spacing", "onehalfspace", "doublespace", "singlespace"],
    pdflscape: ["landscape"],
    amsthm: ["proof"],
    acronym: ["acronym"],
    comment: ["comment"],
    wrapfig: ["wrapfigure", "wraptable"],
    tcolorbox: ["tcolorbox"],
    mdframed: ["mdframed"],
    csquotes: ["displayquote"],
    ragged2e: ["FlushLeft", "FlushRight", "Center", "justify"],
  }).flatMap(([pkg, environments]) => environments.map((e) => [e, pkg])),
);

/** Each message LaTeX writes, what it means, and the fix that goes with it. */
const RULES: [RegExp, (match: RegExpExecArray, line: string | null) => Explanation | null][] = [
  [
    /^Undefined control sequence(?:: \\([a-zA-Z@]+))?/,
    (m): Explanation => {
      const name = m[1];
      const pkg = name ? COMMAND_PACKAGES[name] : undefined;
      return pkg
        ? { id: "undefined_command_package", params: { command: `\\${name}`, package: pkg }, fix: { kind: "package", name: pkg } }
        : { id: "undefined_command", params: { command: name ? `\\${name}` : "…" }, fix: null };
    },
  ],
  [
    /LaTeX Error: Environment (\S+) undefined/,
    (m): Explanation => {
      const pkg = ENVIRONMENT_PACKAGES[m[1]];
      return pkg
        ? { id: "undefined_environment_package", params: { environment: m[1], package: pkg }, fix: { kind: "package", name: pkg } }
        : { id: "undefined_environment", params: { environment: m[1] }, fix: null };
    },
  ],
  [
    /^Missing \$ inserted/,
    (_, line) => ({
      id: "missing_dollar",
      params: {},
      // An underscore in running text (a file name, `x_1` without `$`): written as `\_`.
      fix: line !== null && /(?<!\\)_/.test(line) && !line.includes("$") ? { kind: "escape", char: "_" } : null,
    }),
  ],
  [/^Misplaced alignment tab character &/, () => ({ id: "alignment_tab", params: {}, fix: { kind: "escape", char: "&" } })],
  [/^You can't use `macro parameter character #'/, () => ({ id: "alignment_tab", params: {}, fix: { kind: "escape", char: "#" } })],
  [
    /^(?:Missing \} inserted|Extra \}, or forgotten|Too many \}'s|Paragraph ended before .+ was complete|File ended while scanning use of|Missing \{ inserted)/,
    () => ({ id: "braces", params: {}, fix: null }),
  ],
  [/^Extra alignment tab has been changed to \\cr/, () => ({ id: "extra_alignment", params: {}, fix: null })],
  [/There's no line here to end/, () => ({ id: "no_line", params: {}, fix: null })],
  [/Lonely \\item/, () => ({ id: "lonely_item", params: {}, fix: null })],
  // Not a package's files: the list of missing files offers to install those.
  [
    /^(?:LaTeX Error: )?File `([^']+)' not found/,
    (m) => (/\.(?:sty|cls|def|ldf|fd|cfg|bbx|cbx|lbx)$/.test(m[1]) ? null : { id: "file_not_found", params: { file: m[1] }, fix: null }),
  ],
  [/^Citation [`']([^']+)'.*undefined/, (m) => ({ id: "citation_undefined", params: { key: m[1] }, fix: { kind: "source" } })],
  [
    /^Biber: .*could not be found in the database: (\S+)/,
    (m) => ({ id: "citation_undefined", params: { key: m[1] }, fix: { kind: "source" } }),
  ],
  [/^Empty bibliography/, () => ({ id: "empty_bibliography", params: {}, fix: { kind: "source" } })],
  [/^Reference `([^']+)' on page \d+ undefined/, (m) => ({ id: "reference_undefined", params: { key: m[1] }, fix: { kind: "compile" } })],
  [/Label\(s\) may have changed|Please \(re\)run Biber|Rerun to get/, () => ({ id: "rerun", params: {}, fix: { kind: "compile" } })],
  [
    /Unicode character (.+?) \(U\+([0-9A-F]+)\)/,
    (m) => ({ id: "unicode", params: { character: m[1] }, fix: { kind: "engine", engine: "lualatex" } }),
  ],
  [/^Overfull \\hbox \(([\d.]+)pt too wide\)/, (m) => ({ id: "overfull", params: { width: String(Math.round(Number(m[1]))) }, fix: null })],
  [/^Underfull \\[hv]box/, () => ({ id: "underfull", params: {}, fix: null })],
  [/Float too large for page/, () => ({ id: "float_too_large", params: {}, fix: null })],
  [/Option clash for package (\S+?)\.?$/, (m) => ({ id: "option_clash", params: { package: m[1] }, fix: null })],
  [/The length marginparwidth is less than 2cm/, () => ({ id: "notes_margin", params: {}, fix: null })],
  [/^Missing number, treated as zero|^Illegal unit of measure/, () => ({ id: "missing_number", params: {}, fix: null })],
  [/Missing \\begin\{document\}/, () => ({ id: "missing_begin_document", params: {}, fix: null })],
  [
    /\\begin\{([^}]+)\} on input line \d+ ended by \\end\{([^}]+)\}/,
    (m) => ({ id: "environment_mismatch", params: { begin: m[1], end: m[2] }, fix: null }),
  ],
  [/^Emergency stop|^==> Fatal error/, () => ({ id: "emergency_stop", params: {}, fix: null })],
  [/^Biber: Cannot find '([^']+)'/, (m) => ({ id: "bib_file_missing", params: { file: m[1] }, fix: null })],
];

/**
 * What `message` means, with the fix that goes with it; `line` is the text of
 * the line it names, for fixes that depend on it. `null` for messages
 * without an explanation of their own.
 */
export function explain(message: string, line: string | null): Explanation | null {
  // Messages by packages say so first ("Package biblatex Warning: …" is shortened to the warning by the log reader).
  const text = message.replace(/^(?:Package|Class) \S+ (?:Error|Warning): /, "").replace(/^LaTeX Warning: /, "");
  for (const [pattern, explanation] of RULES) {
    const match = pattern.exec(text);
    if (match) return explanation(match, line);
  }
  return null;
}

/**
 * Warnings a package gives as soon as it is loaded, though they only matter
 * once its elements are used, each with what uses them: todonotes warns about
 * the margin's width even without a single note in the document.
 */
const UNTIL_USED: [RegExp, RegExp][] = [[/The length marginparwidth is less than 2cm/, /\\(?:todo|missingfigure)(?![a-zA-Z])/]];

/** What uses the package `message` warns about, if it is such a warning (see `UNTIL_USED`). */
export function usedBy(message: string): RegExp | null {
  return UNTIL_USED.find(([warning]) => warning.test(message))?.[1] ?? null;
}

/**
 * How an ignored warning is remembered: its file and text, not its line,
 * so it stays ignored while the text around it changes.
 */
export const warningKey = (d: { file: string | null; message: string }) => `${d.file ?? ""}: ${d.message}`;

/** `line` with every unescaped `char` written as its command (`&` → `\&`), outside comments. */
export function escapeLine(line: string, char: "&" | "_" | "#"): string {
  const comment = /(?<!\\)%/.exec(line);
  const end = comment ? comment.index : line.length;
  const code = line.slice(0, end).replace(new RegExp(`(?<!\\\\)\\${char}`, "g"), `\\${char}`);
  return code + line.slice(end);
}
