import { describe, expect, it } from "vitest";
import { applyFormat, rangeOf } from "../../../tests/edits";
import {
  baseSizeOf,
  closingBrace,
  declarationAt,
  FONT_SIZES,
  groupHead,
  pointsAt,
  setGroup,
  sizeCommandLine,
  sizeCommandName,
  sizeCommandsOf,
  sizeDeclarations,
  toggleEmphasis,
} from "./format";

describe("closingBrace", () => {
  it("finds the matching brace, escaped braces aside", () => {
    const text = "{a {b} \\} c}d";
    expect(closingBrace(text, 0)).toBe(text.length - 2);
    expect(closingBrace("{open", 0)).toBe(-1);
  });
});

describe("toggleEmphasis", () => {
  const text = "some words here";
  const { from, to } = rangeOf(text, "words");

  it("puts the command around the selection, which stays selected", () => {
    const result = applyFormat(text, toggleEmphasis(text, from, to, "textbf"));
    expect(result).toEqual({ text: "some \\textbf{words} here", selected: "words" });
  });

  it("takes it away again, whether its text or the whole command is selected", () => {
    const bold = "some \\textbf{words} here";
    const inner = rangeOf(bold, "words");
    expect(applyFormat(bold, toggleEmphasis(bold, inner.from, inner.to, "textbf")).text).toBe(text);
    const whole = rangeOf(bold, "\\textbf{words}");
    expect(applyFormat(bold, toggleEmphasis(bold, whole.from, whole.to, "textbf")).text).toBe(text);
  });

  it("leaves another command alone and nests", () => {
    const italic = "\\textit{words}";
    const inner = rangeOf(italic, "words");
    expect(applyFormat(italic, toggleEmphasis(italic, inner.from, inner.to, "textbf")).text).toBe("\\textit{\\textbf{words}}");
  });

  it("inserts the empty command to type into without a selection", () => {
    const edit = toggleEmphasis(text, 4, 4, "underline");
    expect(edit.insert).toBe("\\underline{}");
    expect(edit.select.anchor).toBe("\\underline{".length);
  });
});

describe("sizes", () => {
  const MAIN = String.raw`\documentclass[12pt]{report}
\newcommand*{\sizeFourteen}{\fontsize{14}{16.8}\selectfont}
\begin{document}`;

  it("names and declares the ribbon's own sizes", () => {
    expect(sizeCommandName(14)).toBe("sizeFourteen");
    expect(sizeCommandName(10.5)).toBe("sizeTenHalf");
    expect(sizeCommandName(13)).toBe("sizeCustom");
    expect(sizeCommandLine("sizeFourteen", 14)).toBe("\\newcommand*{\\sizeFourteen}{\\fontsize{14}{16.8}\\selectfont}");
    expect([...sizeCommandsOf(MAIN)]).toEqual([["sizeFourteen", 14]]);
    expect(FONT_SIZES.every((points) => sizeCommandName(points) !== "sizeCustom")).toBe(true);
  });

  it("reads the base size from the class options or the class", () => {
    expect(baseSizeOf(MAIN)).toBe(12);
    expect(baseSizeOf("\\documentclass[fontsize=11pt]{scrartcl}")).toBe(11);
    expect(baseSizeOf("\\documentclass{scrreprt}")).toBe(11);
    expect(baseSizeOf("\\documentclass{article}")).toBe(10);
  });

  it("knows the points at the cursor", () => {
    expect(pointsAt("{\\large text", MAIN, 12)).toBe(14.4);
    expect(pointsAt("{\\large a} back", MAIN, 12)).toBe(12);
    expect(pointsAt("{\\sizeFourteen deep", MAIN, 12)).toBe(14);
    expect(pointsAt("\\begin{small} inside", MAIN, 10)).toBe(9);
    expect(pointsAt("plain", MAIN, 11)).toBe(11);
  });
});

describe("declarations", () => {
  const sizes = sizeDeclarations("");

  it("finds the one in effect, groups and environments counted", () => {
    expect(declarationAt("{\\Large x {\\small y} z", sizes)).toBe("Large");
    expect(declarationAt("\\begin{huge} x", sizes)).toBe("huge");
    expect(declarationAt("\\begin{huge} x \\end{huge} y", sizes)).toBeNull();
    expect(declarationAt("\\large % {\\tiny in a comment\n", sizes)).toBe("large");
    expect(declarationAt("\\large\\begin{document} x", sizes)).toBeNull();
    expect(declarationAt("\\largeish x", sizes)).toBeNull();
  });

  it("recognizes the head of a group", () => {
    expect(groupHead(sizes).exec("{\\small text}")?.[1]).toBe("small");
    expect(groupHead(sizes).exec("{\\smallcaps text}")).toBeNull();
  });

  it("puts a group around the selection, with \\par where it spans paragraphs", () => {
    const text = "a b c";
    const one = applyFormat(text, setGroup(text, 2, 3, sizes, "large"));
    expect(one).toEqual({ text: "a {\\large b} c", selected: "b" });
    const paragraphs = "one\n\ntwo";
    expect(applyFormat(paragraphs, setGroup(paragraphs, 0, paragraphs.length, sizes, "small")).text).toBe("{\\small one\n\ntwo\\par}");
  });

  it("changes or removes a group instead of nesting another", () => {
    const text = "a {\\large b} c";
    const inner = rangeOf(text, "b");
    expect(applyFormat(text, setGroup(text, inner.from, inner.to, sizes, "Huge")).text).toBe("a {\\Huge b} c");
    expect(applyFormat(text, setGroup(text, inner.from, inner.to, sizes, null)).text).toBe("a b c");
    const whole = rangeOf(text, "{\\large b}");
    expect(applyFormat(text, setGroup(text, whole.from, whole.to, sizes, null)).text).toBe("a b c");
  });

  it("inserts an empty group, or changes the empty one the cursor is in", () => {
    const edit = setGroup("x", 1, 1, sizes, "large");
    expect(edit.insert).toBe("{\\large }");
    const empty = "{\\large }";
    expect(applyFormat(empty, setGroup(empty, empty.length - 1, empty.length - 1, sizes, "small")).text).toBe("{\\small }");
    expect(applyFormat(empty, setGroup(empty, empty.length - 1, empty.length - 1, sizes, null)).text).toBe("");
  });
});
