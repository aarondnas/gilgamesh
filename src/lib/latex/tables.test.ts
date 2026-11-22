// The fixed lists the ribbon and the dialogs offer: each complete and consistent.
import { describe, expect, it } from "vitest";
import { ALIGN_SCOPES, ALIGNMENTS } from "./align";
import { BULLET_KINDS } from "./bullets";
import { SOURCE_KINDS } from "./citations";
import { HIGHLIGHT_COLORS, SWATCHES, TEXT_COLORS } from "./colors";
import { IMAGE_EXTENSIONS, IMAGE_FOLDERS, isImage } from "./figures";
import { FONT_SIZES, RELATIVE_SIZES, selectAll } from "./format";
import { HEADING_STYLES, secnumdepthOf } from "./headings";
import { REFERENCE_STYLES } from "./links";
import { LIST_KINDS } from "./lists";
import { MARGIN_PRESETS, PAPER_NAMES, PAPERS } from "./margins";
import { FORMULA_EXAMPLES, FORMULA_KINDS, FORMULA_TEMPLATE_EXAMPLES, FORMULA_TEMPLATES } from "./math";
import { FORMATS } from "./page-numbers";
import { atWord, SCOPES } from "./scope";
import { LINE_SPACINGS, PARAGRAPH_SPACINGS } from "./spacing";
import { SYMBOL_ROWS } from "./symbol-table";
import { SYMBOL_CATEGORIES, SYMBOLS } from "./symbols";
import { DOCUMENT_CLASS } from "./syntax";

const unique = (list: readonly unknown[]) => new Set(list).size === list.length;

describe("the fixed lists", () => {
  it("hold each choice once", () => {
    for (const list of [
      ALIGNMENTS,
      ALIGN_SCOPES,
      BULLET_KINDS,
      HEADING_STYLES,
      REFERENCE_STYLES,
      LIST_KINDS,
      PAPER_NAMES,
      FORMULA_KINDS,
      FORMULA_TEMPLATES,
      FORMATS,
      SCOPES,
      LINE_SPACINGS,
      PARAGRAPH_SPACINGS,
      SYMBOL_CATEGORIES,
      FONT_SIZES,
      RELATIVE_SIZES,
    ]) {
      expect(unique(list)).toBe(true);
    }
  });

  it("have what each choice needs", () => {
    for (const color of [...TEXT_COLORS, ...HIGHLIGHT_COLORS]) expect(SWATCHES[color], color).toMatch(/^#[0-9a-f]{6}$/i);
    for (const name of PAPER_NAMES) expect(PAPERS[name][0]).toBeLessThan(PAPERS[name][1]);
    for (const kind of FORMULA_KINDS) expect(FORMULA_EXAMPLES[kind]).toContain("<math");
    for (const id of FORMULA_TEMPLATES) expect(FORMULA_TEMPLATE_EXAMPLES[id]).toBeTruthy();
    for (const preset of Object.values(MARGIN_PRESETS.metric)) expect(preset.left).toBeGreaterThan(0);
    for (const fields of Object.values(SOURCE_KINDS)) expect(unique(fields)).toBe(true);
    expect(IMAGE_EXTENSIONS.every((ext) => isImage(`a.${ext}`))).toBe(true);
    expect(unique(IMAGE_FOLDERS)).toBe(true);
    expect(FONT_SIZES).toEqual([...FONT_SIZES].sort((a, b) => a - b));
  });

  it("offer symbols of known categories, each once", () => {
    expect(unique(SYMBOLS.map((s) => s.symbol))).toBe(true);
    const categories = new Set<string>(SYMBOL_CATEGORIES);
    expect(SYMBOL_ROWS.length).toBeGreaterThan(100);
    expect(unique(SYMBOL_ROWS.map((row) => row[0]))).toBe(true);
    expect(SYMBOL_ROWS.every((row) => categories.has(row[1] as string))).toBe(true);
  });
});

describe("small helpers", () => {
  it("select a whole new text", () => {
    expect(selectAll(3, 5, "abc")).toEqual({ from: 3, to: 5, insert: "abc", select: { anchor: 0, head: 3 } });
  });

  it("act on the word at the cursor, keeping the cursor's place in it", () => {
    const edit = atWord("one word", 6, 6, (from, to) => ({ from, to, insert: "WORD", select: { anchor: 0, head: 4 } }));
    expect(edit).toEqual({ from: 4, to: 8, insert: "WORD", select: { anchor: 2, head: 2 } });
  });

  it("read the number depth and the class", () => {
    expect(secnumdepthOf("\\setcounter{secnumdepth}{0}\n\\begin{document}", false)).toBe(0);
    expect(DOCUMENT_CLASS.exec("\\documentclass[a4paper]{article}")?.slice(1)).toEqual(["a4paper", "article"]);
  });
});
