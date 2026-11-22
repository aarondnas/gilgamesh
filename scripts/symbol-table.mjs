// Builds src/lib/latex/symbol-table.ts, the characters the symbol
// dialog offers: `npm run symbols -- <TinyTeX folder>`. The candidates come
// from the distribution's own tables: the kernel's .dfu files (text), the math
// symbols of fontmath.ltx and amssymb by their glyph's name in the font (AFM,
// glyphtounicode.tex), unicode-math's table, T2A's .dfu file, and
// UnicodeData.txt for the names and for what a character is made of (⁴ is a
// raised 4, ⅓ a fraction). Left out: box drawing and blocks (U+2500–259F), and
// pictograms (U+2600–27BF) unless LaTeX has a command for them (♠, ♭, ✓).
//
// Each candidate is compiled one to a page, in the setups below: only what
// sets without an error, a missing glyph or a warning is kept. A character
// gets the code that sets it with every engine where there is one; otherwise
// one for pdfLaTeX (where the document has Cyrillic text) and one for XeLaTeX and LuaLaTeX (as it is from Latin Modern, or
// from FreeSerif through \textsymbol, which the app puts into the preamble).
//
// Use a copy of the distribution with gnu-freefont, stmaryrd, mathtools,
// cyrillic, lh and cm-super installed, as the runs write font
// caches into it. With KEEP=1 the test documents and logs stay in the
// temporary folder it prints.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "..", "src", "lib", "latex", "symbol-table.ts");

const root = process.argv[2];
if (!root) {
  console.error("usage: npm run symbols -- <TinyTeX folder>");
  process.exit(1);
}
const bin = join(root, "bin", process.platform === "win32" ? "windows" : "x86_64-linux");
const texmf = join(root, "texmf-dist");
const read = (...path) => readFileSync(join(texmf, ...path), "utf8");

/** The file `name` under `dir` of the distribution, searched for. */
function find(dir, name) {
  for (const entry of readdirSync(join(texmf, dir))) {
    const path = join(dir, entry);
    if (entry === name) return path;
    if (statSync(join(texmf, path)).isDirectory()) {
      const found = find(path, name);
      if (found) return found;
    }
  }
  return null;
}

/** `\DeclareUnicodeCharacter{XXXX}{code}` of a .dfu file, as [cp, code]. */
const declarations = (...path) =>
  [...read(...path).matchAll(/^\\DeclareUnicodeCharacter\{([0-9A-F]+)\}\{(.*)\}\s*(?:%.*)?$/gm)].map(([, hex, code]) => [
    parseInt(hex, 16),
    code,
  ]);

// --- The candidates -------------------------------------------------------

/**
 * cp → [name, general category, decomposition]. Left out: ranges ("<CJK
 * Ideograph, First>") and the characters Unicode keeps only as another's
 * double (Ω ohm, K kelvin).
 */
const unicode = new Map();
for (const line of read("tex", "generic", "unicode-data", "UnicodeData.txt").split("\n")) {
  const [hex, name, category, , , decomposition] = line.split(";");
  if (hex && !name.startsWith("<") && !/^[0-9A-F]+$/.test(decomposition ?? ""))
    unicode.set(parseInt(hex, 16), [name, category, decomposition]);
}

/** Glyph name → cp, as pdfTeX writes a PDF's text. */
const glyphs = new Map();
for (const file of [
  ["tex", "generic", "pdftex", "glyphtounicode.tex"],
  ["tex", "latex", "base", "glyphtounicode-cmex.tex"],
]) {
  for (const [, name, hex] of read(...file).matchAll(/\\pdfglyphtounicode\{([^}]+)\}\{([0-9A-F]{4,5})\}/g))
    glyphs.set(name, parseInt(hex, 16));
}
const glyphCp = (name) => glyphs.get(name) ?? (/^uni([0-9A-F]{4})$/.test(name) ? parseInt(name.slice(3), 16) : undefined);

/** Slot → glyph name of a font, from its AFM. */
function slots(font) {
  const path = find(join("fonts", "afm"), `${font}.afm`);
  return new Map(path ? [...read(path).matchAll(/^C (\d+) ;.*? N (\S+) ;/gm)].map((m) => [Number(m[1]), m[2]]) : []);
}

/** cp → text commands the kernel maps it to (for pdfLaTeX), the first file's first. */
const texts = new Map();
for (const file of ["utf8enc", "t1enc", "ts1enc", "ot1enc", "omsenc"]) {
  for (const [cp, code] of declarations("tex", "latex", "base", `${file}.dfu`)) {
    if (/^[A-Za-z]+$/.test(code)) continue;
    (texts.get(cp) ?? texts.set(cp, []).get(cp)).push(code.replace(/\\@tabacckludge/g, "\\"));
  }
}

/** Characters pdfLaTeX sets as they are in Cyrillic text (T2A). */
const cyrillic = new Set(declarations("tex", "latex", "base", "t2aenc.dfu").map(([cp]) => cp));

/** cp → math codes that set it, the names of LaTeX and amssymb before unicode-math's. */
const maths = new Map();
const addMath = (cp, code) => {
  const list = maths.get(cp) ?? maths.set(cp, []).get(cp);
  if (!list.includes(code)) list.push(code);
};
const MATH_FONTS = { operators: "cmr10", letters: "cmmi10", symbols: "cmsy10", largesymbols: "cmex10", AMSa: "msam10", AMSb: "msbm10" };
const fontSlots = Object.fromEntries(Object.entries(MATH_FONTS).map(([group, font]) => [group, slots(font)]));
for (const file of [
  ["tex", "latex", "base", "fontmath.ltx"],
  ["tex", "latex", "amsfonts", "amsfonts.sty"],
  ["tex", "latex", "amsfonts", "amssymb.sty"],
]) {
  for (const [, command, kind, group, slot] of read(...file).matchAll(
    /\\DeclareMathSymbol\{?(\\[A-Za-z]+)\}?\{?\\(math[a-z]+)\}?\{(\w+)\}\{("[0-9A-Fa-f]+|'[0-7]+|\d+)\}/g,
  )) {
    // Of the large symbols, the operators (∑, ∫); the rest are pieces of braces.
    if (group === "largesymbols" && kind !== "mathop") continue;
    if (command === "\\smallint") continue; // ∫ is \int.
    const n = slot.startsWith('"') ? parseInt(slot.slice(1), 16) : slot.startsWith("'") ? parseInt(slot.slice(1), 8) : Number(slot);
    const cp = glyphCp(fontSlots[group]?.get(n) ?? "");
    // Greek comes from unicode-math below: the glyph names mix up φ and ϕ, Δ and ∆.
    if (cp && !/^GREEK|^INCREMENT$/.test(unicode.get(cp)?.[0] ?? "")) addMath(cp, command);
  }
}
// Symbols only: accents, radicals and braces over or under take an argument.
const SYMBOL_CLASSES = new Set(["mathord", "mathalpha", "mathbin", "mathrel", "mathop", "mathpunct", "mathopen", "mathclose", "mathfence"]);
/** unicode-math's short names, for the ones LaTeX's manuals teach. */
const LONGER = { "\\ne": "\\neq", "\\le": "\\leq", "\\ge": "\\geq" };
for (const [, hex, command, kind] of read("tex", "latex", "unicode-math", "unicode-math-table.tex").matchAll(
  /^\\UnicodeMathSymbol\{"([0-9A-F]+)\}\{(\\[A-Za-z]+)\s*\}\{\\(\w+)\}/gm,
)) {
  if (!SYMBOL_CLASSES.has(kind)) continue;
  // Its upright Greek (\mupvarphi at φ) is LaTeX's letter (\varphi).
  // (\varTheta and the like are amsmath's italic capitals, not ϴ.)
  const greek = /^\\mup((?!var[A-Z])[A-Za-z]+)$/.exec(command);
  if (greek && /^GREEK/.test(unicode.get(parseInt(hex, 16))?.[0] ?? "")) addMath(parseInt(hex, 16), `\\${greek[1]}`);
  addMath(parseInt(hex, 16), LONGER[command] ?? command);
}
// The alphabets: capitals, and fraktur's small letters too.
const ALPHABETS = [
  [/^(?:MATHEMATICAL )?DOUBLE-STRUCK CAPITAL ([A-Z])$/, "\\mathbb"],
  [/^(?:MATHEMATICAL )?SCRIPT CAPITAL ([A-Z])$/, "\\mathcal"],
  [/^(?:MATHEMATICAL FRAKTUR|BLACK-LETTER) CAPITAL ([A-Z])$/, "\\mathfrak"],
  [/^MATHEMATICAL FRAKTUR SMALL ([A-Z])$/, "\\mathfrak", true],
];
for (const [cp, [name]] of unicode) {
  for (const [pattern, command, small] of ALPHABETS) {
    const letter = pattern.exec(name)?.[1];
    if (letter) addMath(cp, `${command}{${small ? letter.toLowerCase() : letter}}`);
  }
}

/** Blocks of text characters, which XeLaTeX and LuaLaTeX may set from a font. */
const RAW_BLOCKS = [
  [0x00a0, 0x02ff],
  [0x0370, 0x052f],
  [0x1e00, 0x1eff],
  [0x2000, 0x25ff],
  [0x27c0, 0x2bff],
  [0xfb00, 0xfb06],
];

const candidates = new Set([...texts.keys(), ...maths.keys(), ...cyrillic]);
for (const [from, to] of RAW_BLOCKS) for (let cp = from; cp <= to; cp++) candidates.add(cp);
const usable = [...candidates]
  .filter(
    (cp) =>
      cp > 0x7f &&
      (cp < 0x2500 || cp > 0x259f) &&
      (cp < 0x2600 || cp > 0x27bf || texts.has(cp) || maths.has(cp)) &&
      (cp < 0x2e80 || cp > 0xfaff) &&
      unicode.has(cp) &&
      !/^[MCZ]/.test(unicode.get(cp)[1]),
  )
  .sort((a, b) => a - b);

/** A command as text takes `{}`, so a space after it stays. */
const closed = (code) => (/\\[A-Za-z]+$/.test(code) ? `${code}{}` : code);

/**
 * What a character is made of, as text every engine sets: ⁴ a raised 4, ₂ a
 * lowered 2, ⅓ a fraction, ① a circled 1. `null` for what is not one of these.
 */
function composed(cp) {
  const decomposition = unicode.get(cp)?.[2] ?? "";
  const [, tag, rest] = /^<(\w+)> (.+)$/.exec(decomposition) ?? [];
  if (!tag) return null;
  const parts = rest.split(" ").map((hex) => parseInt(hex, 16));
  // Of what the parts are, only ASCII letters, digits and signs that need no escape.
  const plain = (list) =>
    list.every((c) => c < 0x80 && /[A-Za-z0-9+=()-]/.test(String.fromCodePoint(c))) ? String.fromCodePoint(...list) : null;
  if (tag === "super" || tag === "sub") {
    const inner = plain(parts) ?? (parts.length === 1 && parts[0] === 0x2212 ? "\\textminus{}" : null);
    return inner === null ? null : `\\text${tag === "super" ? "superscript" : "subscript"}{${inner}}`;
  }
  if (tag === "fraction") {
    const slash = parts.indexOf(0x2044);
    const [over, under] = [plain(parts.slice(0, slash)), plain(parts.slice(slash + 1))];
    return slash > 0 && over && under ? `\\textsuperscript{${over}}\\textfractionsolidus{}\\textsubscript{${under}}` : null;
  }
  if (tag === "circle" && parts.length === 1) {
    const inner = plain(parts);
    return inner ? `\\textcircled{${inner}}` : null;
  }
  return null;
}

// --- The setups -----------------------------------------------------------

/** The fallback font as the app writes it into the preamble (see latex/symbols.ts). */
const SYMBOL_FONT = String.raw`\usepackage{fontspec}\newfontfamily\symbolfont{FreeSerif}[Extension=.otf, UprightFont=*, BoldFont=*Bold, ItalicFont=*Italic, BoldItalicFont=*BoldItalic]\DeclareTextFontCommand{\textsymbol}{\symbolfont}`;
const MATH = String.raw`\usepackage{amsmath}\usepackage{amssymb}\usepackage{mathtools}\usepackage{stmaryrd}`;

const SETUPS = {
  pdf: { engine: "pdflatex", preamble: String.raw`\usepackage[T1]{fontenc}\usepackage{lmodern}${MATH}` },
  lua: { engine: "lualatex", preamble: MATH },
  xe: { engine: "xelatex", preamble: MATH },
  // Cyrillic text, where babel (russian, ukrainian …) makes T2A the encoding; such documents set their
  // own fonts for it (the Russian template Tempora), so Computer Modern here.
  pdfcyr: { engine: "pdflatex", preamble: String.raw`\usepackage[T1,T2A]{fontenc}` },
  luasym: { engine: "lualatex", preamble: SYMBOL_FONT },
  xesym: { engine: "xelatex", preamble: SYMBOL_FONT },
};

const scratch = mkdtempSync(join(tmpdir(), "gilgamesh-symbols-"));
let runs = 0;

async function latex(engine, name, source) {
  writeFileSync(join(scratch, `${name}.tex`), source);
  // Errors make the exit code non-zero; the log tells which probe caused them.
  await run(join(bin, engine), ["-interaction=nonstopmode", `${name}.tex`], {
    cwd: scratch,
    env: { ...process.env, max_print_line: "10000" },
    maxBuffer: 1 << 28,
  }).catch(() => {});
  return readFileSync(join(scratch, `${name}.log`), "latin1");
}

/**
 * The ids of `chunk` that set cleanly in `setup`, or `null` where the run
 * says nothing certain about the probes after one: it ended early, or a probe
 * left TeX other than it found it (in math, in a group), which errors
 * downstream hide.
 */
async function compile(setup, chunk) {
  const { engine, preamble } = SETUPS[setup];
  const body = chunk
    .map(
      (p) =>
        `\\typeout{@@probe ${p.id}}\\noindent\\hbox{${p.body}}\\clearpage\\typeout{@@end ${p.id} \\ifmmode math \\fi\\the\\currentgrouplevel}`,
    )
    .join("\n");
  const log = await latex(
    engine,
    `${setup}-${runs++}`,
    `\\documentclass{article}${preamble}\n\\tracinglostchars=3\n\\begin{document}\n${body}\n\\typeout{@@done}\n\\end{document}\n`,
  );
  if (!log.includes("@@done")) return null;
  const failed = new Set();
  const ended = new Set();
  let current = null;
  for (const line of log.split("\n")) {
    const marker = /^@@probe (\d+)/.exec(line);
    const end = /^@@end (\d+) (.*)$/.exec(line);
    if (marker) current = Number(marker[1]);
    else if (end) {
      if (end[2].trim() !== "1") return null;
      ended.add(Number(end[1]));
      current = null;
    } else if (current !== null && (line.startsWith("!") || /Missing character|Warning/.test(line))) failed.add(current);
  }
  if (chunk.some((p) => !ended.has(p.id))) return null;
  return chunk.map((p) => p.id).filter((id) => !failed.has(id));
}

/**
 * The probes of `ids` that set cleanly in `setup`. Those that failed are tried
 * once more: the first use of a font may make TeX build it (mktextfm), which
 * the log reports, and that is not the probe's fault.
 */
async function passing(setup, ids) {
  const ok = await passingOnce(setup, ids);
  for (const id of await passingOnce(
    setup,
    ids.filter((id) => !ok.has(id)),
  ))
    ok.add(id);
  return ok;
}

async function passingOnce(setup, ids) {
  const ok = new Set();
  const queue = [];
  for (let i = 0; i < ids.length; i += 80) queue.push(ids.slice(i, i + 80).map((id) => ({ id, body: probes[id].body })));
  const worker = async () => {
    for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
      const result = await compile(setup, chunk);
      if (result) for (const id of result) ok.add(id);
      // An unclear run: in halves, until single probes fail alone.
      else if (chunk.length > 1) queue.push(chunk.slice(0, chunk.length / 2), chunk.slice(chunk.length / 2));
    }
  };
  await Promise.all(Array.from({ length: Math.max(2, cpus().length - 2) }, worker));
  return ok;
}

// --- The probes -----------------------------------------------------------

/** What is compiled: `body` in the setups of `setups`, all of which must pass. */
const probes = [];
/** `${cp} ${kind}` → indices into `probes`, in the order of preference. */
const probesOf = new Map();
function probe(cp, kind, body, setups, code = body) {
  const key = `${cp} ${kind}`;
  (probesOf.get(key) ?? probesOf.set(key, []).get(key)).push(probes.length);
  probes.push({ cp, kind, body, code, setups });
}
const ALL = ["pdf", "lua", "xe"];
for (const cp of usable) {
  const char = String.fromCodePoint(cp);
  probe(cp, "raw", char, ALL);
  for (const code of texts.get(cp) ?? []) probe(cp, "text", closed(code), ALL);
  const parts = composed(cp);
  if (parts) probe(cp, "composed", parts, ALL);
  for (const code of maths.get(cp) ?? []) probe(cp, "math", `$${code}$`, ALL, code);
  if (cyrillic.has(cp)) probe(cp, "cyrillic", char, ["pdfcyr"]);
  // From a font only text characters: math alphabets (𝐀, 𝒜) are formulas' letters.
  if (!RAW_BLOCKS.some(([from, to]) => cp >= from && cp <= to)) continue;
  probe(cp, "unicode", char, ["lua", "xe"]);
  probe(cp, "symbol", `\\textsymbol{${char}}`, ["luasym", "xesym"]);
}
console.log(`${usable.length} characters, ${probes.length} probes`);

const results = {};
for (const setup of Object.keys(SETUPS)) {
  // A probe for several setups is compiled once in each; "unicode" shares the raw probe's runs.
  const ids = probes.map((p, i) => (p.setups.includes(setup) && p.kind !== "unicode" ? i : -1)).filter((i) => i >= 0);
  results[setup] = await passing(setup, ids);
  console.log(`${setup}: ${results[setup].size} of ${ids.length} set`);
}
// The "unicode" probe is the raw one, in XeLaTeX and LuaLaTeX only.
for (const [i, p] of probes.entries()) {
  if (p.kind !== "unicode") continue;
  const raw = probesOf.get(`${p.cp} raw`)[0];
  for (const setup of ["lua", "xe"]) if (results[setup].has(raw)) results[setup].add(i);
}

/** The first probe of `kinds` for `cp` that passes in all its setups. */
function first(cp, ...kinds) {
  for (const kind of kinds) {
    const at = (probesOf.get(`${cp} ${kind}`) ?? []).find((i) => probes[i].setups.every((setup) => results[setup].has(i)));
    if (at !== undefined) return probes[at];
  }
  return undefined;
}

/** What a math command needs loaded, the least of: nothing, amssymb, amsmath, mathtools, stmaryrd. */
const commandPackages = new Map();
{
  const commands = [...new Set(probes.filter((p) => p.kind === "math").map((p) => /^\\[A-Za-z]+/.exec(p.code)[0]))];
  const sets = [[], ["amssymb"], ["amsmath"], ["mathtools"], ["stmaryrd"]];
  const found = await Promise.all(
    sets.map(async (packages) => {
      const tests = commands.map((c, i) => `\\typeout{@@def ${i} \\ifdefined${c} y\\else n\\fi}`).join("\n");
      const use = packages.map((p) => `\\usepackage{${p}}`).join("");
      const log = await latex(
        "pdflatex",
        `defined-${runs++}`,
        `\\documentclass{article}${use}\n\\begin{document}\n${tests}\n\\end{document}\n`,
      );
      return new Set([...log.matchAll(/^@@def (\d+) y/gm)].map((m) => commands[Number(m[1])]));
    }),
  );
  for (const command of commands) {
    const index = found.findIndex((set) => set.has(command));
    commandPackages.set(command, index < 0 ? ["amsmath", "amssymb"] : sets[index]);
  }
}
const mathPackagesOf = (code) => commandPackages.get(/^\\[A-Za-z]+/.exec(code)[0]);

// --- The table ------------------------------------------------------------

/** The dialog's group of a character, by its general category and block. */
function categoryOf(cp, name, gc) {
  const within = (from, to) => cp >= from && cp <= to;
  if (gc === "Sc") return "currency";
  if (within(0x2190, 0x21ff) || within(0x27f0, 0x27ff) || within(0x2900, 0x297f) || within(0x2b00, 0x2bff)) return "arrows";
  if (within(0x2100, 0x214f) || name.startsWith("MATHEMATICAL ")) return gc === "Sm" ? "math" : "letterlike";
  if (within(0x0250, 0x02af) || within(0x1d00, 0x1dbf)) return "ipa";
  if (gc.startsWith("L") || within(0x0300, 0x036f)) {
    if (within(0x0370, 0x03ff)) return "greek";
    if (within(0x0400, 0x052f)) return "cyrillic";
    return "latin";
  }
  if (within(0x2070, 0x209f) || within(0x2150, 0x218f) || within(0x2460, 0x24ff) || gc.startsWith("N")) return "numbers";
  if (gc.startsWith("P")) return "punctuation";
  if (gc === "Sm") return "math";
  return "symbols";
}

const rows = [];
const stats = { all: 0, pdfOnly: 0, unicodeOnly: 0, both: 0 };
for (const cp of usable) {
  const [name, gc] = unicode.get(cp);
  const char = String.fromCodePoint(cp);
  const asText = (p) => (p ? (p.code === char ? "" : p.code) : null);
  // As text with every engine: the character itself, the kernel's command, or what it is made of.
  const text = first(cp, "raw", "text", "composed");
  const math = first(cp, "math");
  // Else one for each kind of engine.
  const pdf = text ? undefined : first(cp, "cyrillic");
  const uni = text ? undefined : first(cp, "unicode", "symbol");
  if (!text && !math && !pdf && !uni) continue;
  const pdfPackages = pdf ? "@T2A" : "";
  const uniPackages = uni?.kind === "symbol" ? "@symbolfont" : "";
  rows.push([
    char,
    categoryOf(cp, name, gc),
    name,
    asText(text),
    math?.code ?? null,
    math ? mathPackagesOf(math.code).join(",") : "",
    asText(pdf),
    pdfPackages,
    asText(uni),
    uniPackages,
  ]);
  if (text || math) stats.all++;
  else if (pdf && uni) stats.both++;
  else if (pdf) stats.pdfOnly++;
  else stats.unicodeOnly++;
}

const counts = {};
for (const row of rows) counts[row[1]] = (counts[row[1]] ?? 0) + 1;
console.log(`${rows.length} characters kept:`, stats, counts);

writeFileSync(
  output,
  `// Generated by scripts/symbol-table.mjs from the TeX distribution's tables,
// each character compiled with pdfLaTeX, XeLaTeX and LuaLaTeX: do not edit by
// hand. A row (see CharSymbol in latex/symbols.ts):
//
// [character, category, Unicode name,
//  text code for every engine, math command, packages it needs,
//  text code for pdfLaTeX, packages, text code for XeLaTeX and LuaLaTeX, packages]
//
// A text code of "" is the character itself, null none. Packages are a comma
// list; "@T2A" asks for a document that loads that encoding, "@symbolfont"
// for the fallback font \\textsymbol.

export type SymbolRow = [string, string, string, string | null, string | null, string, string | null, string, string | null, string];

export const SYMBOL_ROWS: SymbolRow[] = [
${rows.map((row) => `  ${JSON.stringify(row)},`).join("\n")}
];
`,
);
if (!process.env.KEEP) rmSync(scratch, { recursive: true, force: true });
else console.log(scratch);
console.log(`wrote ${output} (${runs} runs)`);
