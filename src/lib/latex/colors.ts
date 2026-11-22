// Text colour and highlighting, as the ribbon sets them for the word, the
// paragraph, the section or (text colour only) the whole document. Pure text
// in, one change out, as in format.ts.
//
// The colours are xcolor's own names, which need no definitions and read the
// same with every engine. Text colour is `\textcolor{red}{…}`, for the whole
// document `\color{red}` after `\begin{document}`. Highlighting is `\hlc[cyan]{…}`,
// which the preamble defines once (see `highlightSetup`): with lua-ul under
// LuaLaTeX, which keeps kerning and takes any text, else with soul; so a
// document highlights alike under every engine and needs nothing rewritten
// when the engine changes.

import { closingBrace, selectAll, type FormatEdit } from "./format";
import { declareInBody } from "./align";
import { atWord, combine, type Change } from "./scope";
import { afterPackages, BEGIN_DOCUMENT, headOf, maskComments } from "./syntax";

/** Colours for text, darkest first, all of xcolor's base names that read on white. */
export const TEXT_COLORS = [
  "black",
  "darkgray",
  "gray",
  "red",
  "orange",
  "brown",
  "olive",
  "green",
  "teal",
  "cyan",
  "blue",
  "violet",
  "purple",
  "magenta",
] as const;

/** Colours to highlight in, light enough to read black text on. */
export const HIGHLIGHT_COLORS = ["yellow", "lime", "green", "cyan", "pink", "orange", "lightgray", "magenta"] as const;

export type XColor = (typeof TEXT_COLORS)[number] | (typeof HIGHLIGHT_COLORS)[number];

/** How xcolor mixes each name (xcolor.sty), for the swatches. */
export const SWATCHES: Record<XColor, string> = {
  black: "#000000",
  darkgray: "#404040",
  gray: "#808080",
  lightgray: "#bfbfbf",
  red: "#ff0000",
  orange: "#ff8000",
  brown: "#bf8040",
  olive: "#808000",
  yellow: "#ffff00",
  lime: "#bfff00",
  green: "#00ff00",
  teal: "#008080",
  cyan: "#00ffff",
  blue: "#0000ff",
  violet: "#800080",
  purple: "#bf0040",
  magenta: "#ff00ff",
  pink: "#ffbfbf",
};

/** A command around text that carries a colour: how its head looks and is written. */
interface Wrapper {
  /** Its head at the start of a text, `\textcolor{red}{`. */
  head: RegExp;
  /** Its head at the end of a text, to find one right before the selection. */
  headBefore: RegExp;
  open: (color: string) => string;
}

/** A colour of the user's own from the colour picker, `#ff8800`, rather than one of xcolor's names. */
export const isCustomColor = (color: string) => /^#[0-9a-fA-F]{6}$/.test(color);
/** `#ff8800` → `FF8800`, as xcolor's HTML model writes it. */
const hexOf = (color: string) => color.slice(1).toUpperCase();
/** The name a highlight colour of the user's own is defined under (see `highlightColorDefinition`): `\hlc` takes names only. */
const highlightNameOf = (color: string) => `hl${hexOf(color)}`;

/** A colour of the user's own by xcolor's HTML model, which needs no definition: `\textcolor[HTML]{FF8800}{…}`. */
const TEXT_COLOR: Wrapper = {
  head: /^\\textcolor\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{/,
  headBefore: /\\textcolor\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{$/,
  open: (color) => (isCustomColor(color) ? `\\textcolor[HTML]{${hexOf(color)}}{` : `\\textcolor{${color}}{`),
};

/** Yellow is `\hlc`'s default, so it goes without its option; a colour of the user's own goes by its defined name. */
const HIGHLIGHT: Wrapper = {
  head: /^\\hlc\s*(?:\[[^\]]*\])?\s*\{/,
  headBefore: /\\hlc\s*(?:\[[^\]]*\])?\s*\{$/,
  open: (color) => (color === "yellow" ? "\\hlc{" : `\\hlc[${isCustomColor(color) ? highlightNameOf(color) : color}]{`),
};

type Range = { from: number; to: number };
type Selection = { anchor: number; head: number };

/**
 * The selection in `color` by `wrapper`; `null` takes the colour away. A
 * selection that is such a command already, or its text, gets the new colour
 * instead of a second one. Without a selection the empty command goes in with
 * the cursor inside, to type into.
 */
function wrapSelection(text: string, from: number, to: number, wrapper: Wrapper, color: string | null): FormatEdit {
  if (from === to) {
    if (!color) return { from, to, insert: "", select: { anchor: 0, head: 0 } };
    const open = wrapper.open(color);
    return { from, to, insert: `${open}}`, select: { anchor: open.length, head: open.length } };
  }
  const selected = text.slice(from, to);
  let groupFrom = -1;
  let groupTo = -1;
  let inner = selected;
  const own = wrapper.head.exec(selected);
  if (own && closingBrace(selected, own[0].length - 1) === selected.length - 1) {
    [groupFrom, groupTo, inner] = [from, to, selected.slice(own[0].length, -1)];
  } else {
    const before = wrapper.headBefore.exec(text.slice(Math.max(0, from - 80), from));
    if (before && closingBrace(text, from - 1) === to) [groupFrom, groupTo] = [from - before[0].length, to + 1];
  }
  if (groupFrom >= 0 && !color) return selectAll(groupFrom, groupTo, inner);
  if (!color) return selectAll(from, to, selected);
  const open = wrapper.open(color);
  // The text inside selected, so another click finds the command around it.
  return {
    from: groupFrom >= 0 ? groupFrom : from,
    to: groupFrom >= 0 ? groupTo : to,
    insert: `${open}${inner}}`,
    select: { anchor: open.length, head: open.length + inner.length },
  };
}

/** Each of `paragraphs` in `color` by `wrapper`, one that has such a command around it already in the new one; `null` takes it away. */
function wrapParagraphs(text: string, paragraphs: Range[], wrapper: Wrapper, color: string | null, select: Selection): FormatEdit | null {
  if (!paragraphs.length) return null;
  const changes: Change[] = [];
  for (const paragraph of paragraphs) {
    const own = wrapper.head.exec(text.slice(paragraph.from, paragraph.to));
    const wrapped = own && closingBrace(text, paragraph.from + own[0].length - 1) === paragraph.to - 1;
    if (wrapped) {
      changes.push({ from: paragraph.from, to: paragraph.from + own[0].length, insert: color ? wrapper.open(color) : "", assoc: 1 });
      if (!color) changes.push({ from: paragraph.to - 1, to: paragraph.to, insert: "", assoc: -1 });
    } else if (color) {
      changes.push({ from: paragraph.from, to: paragraph.from, insert: wrapper.open(color), assoc: 1 });
      changes.push({ from: paragraph.to, to: paragraph.to, insert: "}", assoc: -1 });
    }
  }
  return combine(text, changes, select, paragraphs[0].from);
}

/** The selection, the word at the cursor, or what is typed next in text colour `color`; `null` is the document's colour again. */
export const colorWord = (text: string, from: number, to: number, color: string | null): FormatEdit =>
  atWord(text, from, to, (a, b) => wrapSelection(text, a, b, TEXT_COLOR, color));

/** Each of `paragraphs` in text colour `color`; `null` is the document's colour again. */
export const colorParagraphs = (text: string, paragraphs: Range[], color: string | null, select: Selection) =>
  wrapParagraphs(text, paragraphs, TEXT_COLOR, color, select);

/** The whole document in text colour `color`, declared after `\begin{document}`; `null` takes it away. `null` without `\begin{document}`. */
export const colorDocument = (main: string, color: string | null): FormatEdit | null =>
  declareInBody(main, ["color"], color ? (isCustomColor(color) ? `color[HTML]{${hexOf(color)}}` : `color{${color}}`) : null);

/** The selection, the word at the cursor, or what is typed next highlighted in `color`; `null` takes the highlighting away. */
export const highlightWord = (text: string, from: number, to: number, color: string | null): FormatEdit =>
  atWord(text, from, to, (a, b) => wrapSelection(text, a, b, HIGHLIGHT, color));

/** Each of `paragraphs` highlighted in `color`; `null` takes the highlighting away. */
export const highlightParagraphs = (text: string, paragraphs: Range[], color: string | null, select: Selection) =>
  wrapParagraphs(text, paragraphs, HIGHLIGHT, color, select);

/**
 * What defines `\hlc` for every engine (see the top of this file). Its
 * packages are `\RequirePackage`d: a package added later goes after the last
 * `\usepackage` line (preamble.ts), so before this block, not into a
 * branch only one engine reads.
 */
const HIGHLIGHT_DEFINITION = [
  "% Highlighting for every engine: lua-ul under LuaLaTeX, soul otherwise.",
  "\\RequirePackage{iftex}",
  "\\ifLuaTeX",
  "  \\RequirePackage{luacolor,lua-ul}",
  "  \\newcommand{\\hlc}[2][yellow]{\\highLight[#1]{#2}}",
  "\\else",
  "  \\RequirePackage{soul}",
  "  \\newcommand{\\hlc}[2][yellow]{{\\sethlcolor{#1}\\hl{#2}}}",
  "\\fi",
];

/** Whether the preamble defines `\hlc` already, ours or the user's own. */
const DEFINES_HLC = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|def)\*?\s*\{?\\hlc(?![a-zA-Z])/;

/**
 * The definition of `\hlc` in the preamble of the main file `main`, after its
 * last `\usepackage` line (xcolor must come first); `null` where it is there
 * already or the file has no `\begin{document}`.
 */
export function highlightSetup(main: string): { at: number; insert: string } | null {
  const masked = maskComments(main);
  if (!BEGIN_DOCUMENT.test(masked) || DEFINES_HLC.test(headOf(masked))) return null;
  const at = afterPackages(main);
  return at < 0 ? null : { at, insert: `\n${HIGHLIGHT_DEFINITION.join("\n")}` };
}

/**
 * The definition of a highlight colour of the user's own, `#ff8800`, under
 * the name `\hlc` takes (`\definecolor{hlFF8800}{HTML}{FF8800}`): on a line
 * of its own right before `\begin{document}`, so after xcolor wherever that
 * is loaded. `null` for one of xcolor's names, for one defined already and
 * without `\begin{document}`.
 */
export function highlightColorDefinition(main: string, color: string): { at: number; insert: string } | null {
  if (!isCustomColor(color)) return null;
  const masked = maskComments(main);
  const begin = BEGIN_DOCUMENT.exec(masked);
  if (!begin) return null;
  const name = highlightNameOf(color);
  if (new RegExp(`\\\\definecolor\\s*\\{${name}\\}`).test(masked.slice(0, begin.index))) return null;
  const at = main.lastIndexOf("\n", begin.index - 1) + 1;
  return { at, insert: `\\definecolor{${name}}{HTML}{${hexOf(color)}}\n` };
}

/** How many colours of the user's own the colour lists offer again. */
const RECENT = 7;

/** `recent` with `color` first, each once, as many as the lists offer. */
export const recentColors = (recent: readonly string[], color: string): string[] =>
  [color.toLowerCase(), ...recent.filter((other) => other !== color.toLowerCase())].slice(0, RECENT);
