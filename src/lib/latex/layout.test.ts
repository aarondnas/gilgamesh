// Page layout: line and paragraph spacing, margins and paper, columns, notes.
import { describe, expect, it } from "vitest";
import { applyEdits, applyFormat, rangeOf } from "../../../tests/edits";
import { columnsAt, columnsEdit, documentColumns, documentColumnsEdits } from "./columns";
import { marginsEdits, marginsSupported, orientationEdits, pageLayoutOf, paperEdits, PAPERS } from "./margins";
import { NOTE, noteEdit, notesHidden, notesHiddenEdits, notesStyleEdits } from "./notes";
import {
  documentStretchOf,
  paragraphSpacingEdits,
  paragraphSpacingOf,
  spacingDocumentEdits,
  spacingPackages,
  spacingRange,
  stretchAt,
} from "./spacing";

const ARTICLE = "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nText.\n\\end{document}";

describe("line spacing", () => {
  it("reads the document's stretch and the one at the cursor", () => {
    expect(documentStretchOf(ARTICLE)).toBe(1);
    expect(documentStretchOf("\\usepackage{setspace}\n\\onehalfspacing\n\\begin{document}")).toBe(1.5);
    expect(documentStretchOf("\\usepackage{setspace}\n\\setstretch{1.15}\n\\begin{document}")).toBe(1.15);
    expect(stretchAt("\\begin{spacing}{2}\ninside")).toBe(2);
    expect(stretchAt("\\begin{spacing}{2}\nx\n\\end{spacing}\nafter")).toBeNull();
  });

  it("sets the whole document's stretch after the packages, single spacing by none", () => {
    const set = applyEdits(ARTICLE, spacingDocumentEdits(ARTICLE, 1.5));
    expect(set).toContain("\\usepackage{graphicx}\n\\setstretch{1.5}\n\\begin{document}");
    expect(documentStretchOf(set)).toBe(1.5);
    expect(applyEdits(set, spacingDocumentEdits(set, 1))).toBe(ARTICLE);
    expect(spacingPackages(ARTICLE)).toEqual(["setspace"]);
    expect(spacingPackages("\\usepackage{setspace}\n\\begin{document}")).toEqual([]);
  });

  it("puts a spacing environment around paragraphs, gone at the document's own stretch", () => {
    const text = "One.\n\nTwo.";
    const range = rangeOf(text, "Two.");
    const spaced = applyFormat(text, spacingRange(text, range, 2, 1, { anchor: range.from, head: range.to }));
    expect(spaced.text).toBe("One.\n\n\\begin{spacing}{2}\nTwo.\n\\end{spacing}");
    expect(spaced.selected).toBe("Two.");
    const inner = rangeOf(spaced.text, "Two.");
    const back = spacingRange(spaced.text, inner, 1, 1, { anchor: inner.from, head: inner.to });
    expect(applyFormat(spaced.text, back).text).toBe(text);
  });
});

describe("paragraph spacing", () => {
  it("is an indent by default, parskip's or KOMA's option otherwise", () => {
    expect(paragraphSpacingOf(ARTICLE)).toBe("indent");
    expect(paragraphSpacingOf("\\documentclass[parskip=full]{scrartcl}\n\\begin{document}")).toBe("full");
    expect(paragraphSpacingOf("\\documentclass{article}\n\\usepackage{parskip}\n\\begin{document}")).toBe("half");
  });

  it("loads parskip for standard classes and sets KOMA's option", () => {
    const half = applyEdits(ARTICLE, paragraphSpacingEdits(ARTICLE, "half"));
    expect(paragraphSpacingOf(half)).toBe("half");
    expect(applyEdits(half, paragraphSpacingEdits(half, "indent"))).toBe(ARTICLE);
    const koma = "\\documentclass{scrreprt}\n\\begin{document}";
    const full = applyEdits(koma, paragraphSpacingEdits(koma, "full"));
    expect(full).toContain("parskip=full");
    expect(paragraphSpacingOf(full)).toBe("full");
  });
});

describe("margins and paper", () => {
  it("are not set for beamer or without a class", () => {
    expect(marginsSupported(ARTICLE)).toBe(true);
    expect(marginsSupported("\\documentclass{beamer}")).toBe(false);
    expect(marginsSupported("Text only")).toBe(false);
  });

  it("adds geometry with the margins, and reads them back", () => {
    const set = applyEdits(ARTICLE, marginsEdits(ARTICLE, { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 }, "cm"));
    expect(set).toContain("\\usepackage{graphicx}\n\\usepackage[margin=2.5cm]{geometry}");
    expect(pageLayoutOf(set).margins).toEqual({ top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 });
    const uneven = applyEdits(set, marginsEdits(set, { top: 2, bottom: 2, left: 3, right: 2 }, "cm"));
    expect(uneven).toContain("\\usepackage[top=2cm, bottom=2cm, left=3cm, right=2cm]{geometry}");
  });

  it("reads lengths in other units into cm", () => {
    const layout = pageLayoutOf("\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}");
    expect(layout.margins.top).toBeCloseTo(2.54);
  });

  it("sets paper and orientation, keeping the margins", () => {
    const geometry = "\\documentclass{article}\n\\usepackage[margin=2cm]{geometry}\n\\begin{document}";
    const landscape = applyEdits(geometry, orientationEdits(geometry, "landscape"));
    expect(landscape).toContain("margin=2cm");
    expect(pageLayoutOf(landscape).landscape).toBe(true);
    expect(pageLayoutOf(landscape).paper.width).toBeGreaterThan(pageLayoutOf(landscape).paper.height);
    const letter = applyEdits(geometry, paperEdits(geometry, "letter"));
    expect(letter).toContain("letterpaper");
    const [width, height] = PAPERS.letter;
    expect(pageLayoutOf(letter).paper).toEqual({ width, height });
  });
});

describe("columns", () => {
  it("sets the whole document in two columns by the class option", () => {
    expect(documentColumns(ARTICLE)).toBe(1);
    const two = applyEdits(ARTICLE, documentColumnsEdits(ARTICLE, 2));
    expect(two.startsWith("\\documentclass[twocolumn]{article}")).toBe(true);
    expect(documentColumns(two)).toBe(2);
    expect(applyEdits(two, documentColumnsEdits(two, 1))).toBe(ARTICLE);
  });

  it("puts a multicols around paragraphs and changes or removes it", () => {
    const text = "One.\n\nTwo.";
    const at = text.indexOf("Two");
    const three = applyFormat(text, columnsEdit(text, at, at, 3)!).text;
    expect(three).toBe("One.\n\n\\begin{multicols}{3}\nTwo.\n\\end{multicols}");
    expect(columnsAt(three.slice(0, three.indexOf("Two")))).toBe(3);
    const inside = three.indexOf("Two");
    expect(applyFormat(three, columnsEdit(three, inside, inside, 2)!).text).toContain("\\begin{multicols}{2}");
    expect(applyFormat(three, columnsEdit(three, inside, inside, 1)!).text).toBe(text);
    expect(columnsEdit(text, at, at, 1)).toBeNull();
  });
});

describe("notes", () => {
  it("puts a margin note into the line with one space each side", () => {
    const text = "Some words here.";
    const at = text.indexOf(" here");
    const edit = noteEdit(text, at, at, false);
    const result = applyFormat(text, edit);
    expect(result.text).toBe("Some words \\todo{} here.");
    expect(result.text[edit.from + edit.select.anchor]).toBe("}");
    expect(NOTE.test(result.text)).toBe(true);
  });

  it("puts a note in the text on a line of its own, with the line's indentation", () => {
    const text = "  Some words here.";
    const at = text.indexOf(" here");
    expect(applyFormat(text, noteEdit(text, at, at, true)).text).toBe("  Some words\n  \\todo[inline]{}\n  here.");
  });

  it("hides and shows the notes with todonotes' disable option", () => {
    const main = "\\documentclass{article}\n\\usepackage{todonotes}\n\\begin{document}";
    expect(notesHidden(main)).toBe(false);
    const hidden = applyEdits(main, notesHiddenEdits(main, true));
    expect(hidden).toContain("\\usepackage[disable]{todonotes}");
    expect(notesHidden(hidden)).toBe(true);
    expect(applyEdits(hidden, notesHiddenEdits(hidden, false))).toBe(main);
    expect(notesHiddenEdits("\\usepackage{todonotes,xcolor}", true)).toEqual([]);
  });

  it("styles the notes once, after todonotes", () => {
    const main = "\\documentclass{article}\n\\usepackage{todonotes}\n\\begin{document}";
    const styled = applyEdits(main, notesStyleEdits(main));
    expect(styled).toContain("\\usepackage{todonotes}\n% Notes: quiet, without a frame\n\\setuptodonotes{");
    expect(notesStyleEdits(styled)).toEqual([]);
  });
});
