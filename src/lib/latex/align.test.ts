import { describe, expect, it } from "vitest";
import { applyFormat, rangeOf } from "../../../tests/edits";
import {
  alignDocument,
  alignmentAt,
  alignmentPackages,
  alignRange,
  bodyDeclarations,
  declareInBody,
  documentAlignment,
  environmentAround,
  paragraphRange,
  sectionRange,
  textParagraphs,
  wholeDocumentAlignment,
} from "./align";

const BODY = `First paragraph
still the first.

Second paragraph.

\\section{Next}
Under next.`;

describe("alignment at the cursor", () => {
  it("is justified by default, else the environment or declaration around it", () => {
    expect(alignmentAt("plain text")).toBe("justify");
    expect(alignmentAt("\\begin{center}\ninside")).toBe("center");
    expect(alignmentAt("\\begin{center}\nx\n\\end{center}\nafter")).toBe("justify");
    expect(alignmentAt("{\\raggedleft inside")).toBe("right");
    expect(alignmentAt("\\raggedright\ntext")).toBe("left");
    expect(alignmentAt("text", "center")).toBe("center");
  });

  it("is what the main file declares after \\begin{document}, also for included files", () => {
    const main = "\\documentclass{article}\n\\begin{document}\n\\centering\n\\input{chapters/intro}\n\\end{document}";
    expect(documentAlignment(main)).toBe("center");
    expect(documentAlignment(main, "chapters/intro")).toBe("center");
    expect(wholeDocumentAlignment(main)).toBe("center");
    expect(wholeDocumentAlignment("\\documentclass{article}\n\\usepackage[document]{ragged2e}\n\\begin{document}\n")).toBe("left");
  });

  it("needs ragged2e only to justify", () => {
    expect(alignmentPackages("justify")).toEqual(["ragged2e"]);
    expect(alignmentPackages("center")).toEqual([]);
  });
});

describe("ranges", () => {
  it("takes whole paragraphs, up to blank lines", () => {
    const at = BODY.indexOf("still");
    expect(BODY.slice(paragraphRange(BODY, at, at)!.from, paragraphRange(BODY, at, at)!.to)).toBe("First paragraph\nstill the first.");
    expect(paragraphRange(BODY, BODY.indexOf("\n\n") + 1, BODY.indexOf("\n\n") + 1)).toBeNull();
  });

  it("takes what belongs to a heading", () => {
    const range = sectionRange(BODY, BODY.indexOf("Under"))!;
    expect(BODY.slice(range.from, range.to)).toBe("Under next.");
    expect(sectionRange(BODY, 0)).toBeNull();
  });

  it("finds the text of each paragraph", () => {
    const text = "\\begin{itemize}\n  \\item One % note\n  \\item Two\n\\end{itemize}";
    const range = rangeOf(text, "  \\item One % note\n  \\item Two");
    expect(textParagraphs(text, range).map((p) => text.slice(p.from, p.to))).toEqual(["One", "Two"]);
  });

  it("finds an environment around lines", () => {
    const text = "\\begin{center}\nMiddle\n\\end{center}";
    const inner = rangeOf(text, "Middle");
    const wrapper = environmentAround(text, inner.from, inner.to, { center: "center" });
    expect(wrapper).not.toBeNull();
    expect(environmentAround("Middle", 0, 6, { center: "center" })).toBeNull();
  });
});

describe("aligning a paragraph", () => {
  const text = "Before.\n\nCentre me.\n\nAfter.";
  const range = rangeOf(text, "Centre me.");
  const select = { anchor: range.from, head: range.to };

  it("puts an environment around it, which a second click takes away", () => {
    const centered = applyFormat(text, alignRange(text, range, "center", "justify", select));
    expect(centered.text).toBe("Before.\n\n\\begin{center}\nCentre me.\n\\end{center}\n\nAfter.");
    expect(centered.selected).toBe("Centre me.");
    const again = rangeOf(centered.text, "Centre me.");
    const back = alignRange(centered.text, again, "center", "justify", { anchor: again.from, head: again.to });
    expect(applyFormat(centered.text, back).text).toBe(text);
  });

  it("changes the environment around it instead of nesting", () => {
    const centered = "\\begin{center}\nText.\n\\end{center}";
    const inner = rangeOf(centered, "Text.");
    const right = alignRange(centered, inner, "right", "justify", { anchor: inner.from, head: inner.to });
    expect(applyFormat(centered, right).text).toBe("\\begin{flushright}\nText.\n\\end{flushright}");
  });

  it("needs nothing of its own where the text around has that alignment", () => {
    const inside = "\\begin{center}\nText.\n\\end{center}";
    const inner = rangeOf(inside, "Text.");
    const edit = alignRange(inside, inner, "justify", "justify", { anchor: inner.from, head: inner.to });
    expect(applyFormat(inside, edit).text).toBe("Text.");
  });
});

describe("the whole document", () => {
  const main = "\\documentclass{article}\n\\begin{document}\nText.\n\\end{document}";

  it("declares the alignment after \\begin{document}, and takes it away again", () => {
    const centered = applyFormat(main, alignDocument(main, "center")!).text;
    expect(centered).toBe("\\documentclass{article}\n\\begin{document}\n\\centering\nText.\n\\end{document}");
    expect(applyFormat(centered, alignDocument(centered, "center")!).text).toBe(main);
    expect(alignDocument("no body", "center")).toBeNull();
  });

  it("keeps the other declarations there", () => {
    const declared = "\\begin{document}\n\\large\n\\centering\nText.";
    expect(bodyDeclarations(declared)).not.toBeNull();
    const edit = declareInBody(declared, ["centering", "raggedright", "raggedleft"], "raggedleft")!;
    const result = applyFormat(declared, edit).text;
    expect(result).toContain("\\large");
    expect(result).toContain("\\raggedleft");
    expect(result).not.toContain("\\centering");
  });
});
