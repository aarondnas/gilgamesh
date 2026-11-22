// Characters for running text that keyboards lack (€, ©, §, –, „…“, a
// protected space), as LaTeX commands that every engine sets; the math
// symbols are the operators' (math.ts). The symbol dialog offers all
// the distribution sets, from a table scripts/symbol-table.mjs generates.

import type { FontMode } from "./fonts";
import type { FormatEdit } from "./format";
import { inMath } from "./math";
import { afterPackages, headOf, stripComments } from "./syntax";

export interface TextSymbol {
  symbol: string;
  /** What goes into the text; `{}` keeps a space after a command. */
  code: string;
  packages: string[];
  /** Around the selection, the cursor in it where nothing is selected (quotes). */
  wraps?: boolean;
}

const sym = (symbol: string, code: string, packages: string[] = []): TextSymbol => ({ symbol, code, packages });

/** In the order the menu shows them, eight to a row. */
export const SYMBOLS: TextSymbol[] = [
  { symbol: "„“", code: "\\enquote{}", packages: ["csquotes"], wraps: true },
  sym("–", "--"),
  sym("—", "---"),
  sym("…", "\\dots{}"),
  sym("␣", "~"),
  sym("‧", "\\-"),
  sym("•", "\\textbullet{}"),
  sym("·", "\\textperiodcentered{}"),
  sym("€", "\\texteuro{}"),
  sym("£", "\\pounds{}"),
  sym("¥", "\\textyen{}"),
  sym("¢", "\\textcent{}"),
  sym("©", "\\copyright{}"),
  sym("®", "\\textregistered{}"),
  sym("™", "\\texttrademark{}"),
  sym("№", "\\textnumero{}"),
  sym("§", "\\S{}"),
  sym("¶", "\\P{}"),
  sym("†", "\\dag{}"),
  sym("‡", "\\ddag{}"),
  sym("°", "\\textdegree{}"),
  sym("‰", "\\textperthousand{}"),
  sym("µ", "\\textmu{}"),
  sym("✓", "\\checkmark{}", ["amssymb"]),
  sym("½", "\\textonehalf{}"),
  sym("¼", "\\textonequarter{}"),
  sym("¾", "\\textthreequarters{}"),
  sym("²", "\\textsuperscript{2}"),
  sym("³", "\\textsuperscript{3}"),
  sym("±", "\\textpm{}"),
  sym("×", "\\texttimes{}"),
  sym("→", "\\textrightarrow{}"),
];

/** The groups of the symbol dialog, in the order it lists them. */
export const SYMBOL_CATEGORIES = [
  "punctuation",
  "latin",
  "greek",
  "cyrillic",
  "ipa",
  "currency",
  "symbols",
  "letterlike",
  "numbers",
  "math",
  "arrows",
] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

/**
 * What a text character needs beyond packages: `symbolfont` the fallback font
 * \textsymbol in the preamble (`symbolFontEdit`), `T2A` a document whose text
 * is Cyrillic (it loads the encoding, babel switches to it).
 */
export type SymbolSetup = "symbolfont" | "T2A";

export interface SymbolText {
  code: string;
  packages: string[];
  setup: SymbolSetup | null;
}

/** A character of the symbol dialog (see symbol-table.ts), as text, in math, or both. */
export interface CharSymbol {
  char: string;
  category: SymbolCategory;
  /** Its Unicode name, "COPYRIGHT SIGN". */
  name: string;
  /** What sets it in running text, by the kind of engine (`fontModeOf`); `null` where that one sets it only in math. */
  text: Record<FontMode, SymbolText | null>;
  /** The math command for it; `null` where there is none. */
  math: string | null;
  mathPackages: string[];
}

/** The dialog's characters, from the generated table, which is loaded only when it opens. */
export async function loadCharSymbols(): Promise<CharSymbol[]> {
  const { SYMBOL_ROWS } = await import("./symbol-table");
  const list = (packages: string) => (packages ? packages.split(",") : []);
  return SYMBOL_ROWS.map(([char, category, name, all, math, mathPackages, pdf, pdfPackages, uni, uniPackages]) => {
    const variant = (code: string | null, packages: string): SymbolText | null =>
      code === null
        ? null
        : {
            code: code || char,
            packages: list(packages).filter((p) => !p.startsWith("@")),
            setup:
              (list(packages)
                .find((p) => p.startsWith("@"))
                ?.slice(1) as SymbolSetup | undefined) ?? null,
          };
    const both = variant(all, "");
    return {
      char,
      category: category as SymbolCategory,
      name,
      text: { pdflatex: both ?? variant(pdf, pdfPackages), unicode: both ?? variant(uni, uniPackages) },
      math,
      mathPackages: list(mathPackages),
    };
  });
}

/** Whether the main file loads the Cyrillic encoding T2A, which its Cyrillic text then uses (pdfLaTeX). */
export function hasCyrillicText(source: string): boolean {
  return /\\usepackage\s*\[[^\]]*\bT2A\b[^\]]*\]\s*\{fontenc\}/.test(stripComments(headOf(source)));
}

/** How `symbol` sets as text in a document of `mode`; `null` where only as math. */
export function symbolTextFor(symbol: CharSymbol, mode: FontMode, cyrillic: boolean): SymbolText | null {
  const text = symbol.text[mode];
  return text && (text.setup !== "T2A" || cyrillic) ? text : null;
}

/**
 * `symbol` in place of `from`…`to` of `text`, the cursor behind it: in math its
 * command (a text character in `\mbox`), outside math as text (a math one in
 * `$…$`), as a document of `mode` sets it. `edit.select` is relative to `from`.
 */
export function charSymbolEdit(text: string, from: number, to: number, symbol: CharSymbol, mode: FontMode, cyrillic: boolean) {
  const math = inMath(text, from);
  const asText = symbolTextFor(symbol, mode, cyrillic);
  let insert: string;
  let packages: string[];
  let setup: SymbolSetup | null = null;
  if (math && symbol.math) {
    insert = /[a-zA-Z]$/.test(symbol.math) ? `${symbol.math} ` : symbol.math;
    packages = symbol.mathPackages;
  } else if (asText) {
    insert = math ? `\\mbox{${asText.code}}` : asText.code;
    ({ packages, setup } = asText);
  } else {
    insert = `$${symbol.math}$`;
    packages = symbol.mathPackages;
  }
  return { edit: { from, to, insert, select: { anchor: insert.length, head: insert.length } }, packages, setup };
}

/** The fallback font for characters the document's font lacks, as the symbol table was compiled with (FreeSerif, from GNU FreeFont). */
const SYMBOL_FONT = [
  "% Characters the document's font lacks (symbol dialog), from FreeSerif",
  String.raw`\newfontfamily\symbolfont{FreeSerif}[Extension=.otf, UprightFont=*, BoldFont=*Bold, ItalicFont=*Italic, BoldItalicFont=*BoldItalic]`,
  String.raw`\DeclareTextFontCommand{\textsymbol}{\symbolfont}`,
].join("\n");

/** The same under pdfLaTeX, which cannot load the font: the characters as they are. */
const SYMBOL_FONT_PDF = [
  "% Characters the document's font lacks (symbol dialog): only XeLaTeX and LuaLaTeX set them from FreeSerif",
  String.raw`\providecommand{\textsymbol}[1]{#1}`,
].join("\n");

/** Whether `head` sets up the fallback font as `symbolFontEdit` writes it, for XeLaTeX and LuaLaTeX. */
export const hasSymbolFont = (head: string) => head.includes(SYMBOL_FONT);

/** The fallback font's lines of `head` as the engines of `to` need them, for `convertFonts`; `head` where it has none. */
export function convertSymbolFont(head: string, to: FontMode): string {
  const [from, into] = to === "pdflatex" ? [SYMBOL_FONT, SYMBOL_FONT_PDF] : [SYMBOL_FONT_PDF, SYMBOL_FONT];
  return head.replace(from, into);
}

/**
 * Defines `\textsymbol` after the last `\usepackage` of `source` (fontspec must
 * be loaded already); `null` where the document has it, or has no preamble.
 */
export function symbolFontEdit(source: string): { at: number; insert: string } | null {
  if (/\\textsymbol(?![A-Za-z@])/.test(stripComments(headOf(source)))) return null;
  const at = afterPackages(source);
  return at < 0 ? null : { at, insert: `\n${SYMBOL_FONT}` };
}

/** `symbol` in place of the selection, or around it for quotes. */
export function symbolEdit(text: string, from: number, to: number, symbol: TextSymbol): FormatEdit {
  if (symbol.wraps) {
    const open = symbol.code.slice(0, -1);
    const inner = text.slice(from, to);
    const insert = `${open}${inner}}`;
    return { from, to, insert, select: inner ? { anchor: 0, head: insert.length } : { anchor: open.length, head: open.length } };
  }
  return { from, to, insert: symbol.code, select: { anchor: symbol.code.length, head: symbol.code.length } };
}
