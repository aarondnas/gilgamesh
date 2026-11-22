import { describe, expect, it } from "vitest";
import { applyFormat } from "../../../tests/edits";
import {
  CATALOG,
  convertFonts,
  DEFAULT_FONT,
  documentFontOf,
  fontCommand,
  fontCommandsOf,
  fontDeclarations,
  fontLabel,
  fontModeOf,
  setDocumentFont,
  sizeCommand,
} from "./fonts";

const MAIN = "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\nText.\n\\end{document}";
const apply = (main: string, edit: ReturnType<typeof setDocumentFont>) => (edit ? applyFormat(main, edit).text : main);

describe("fonts", () => {
  it("knows the engines' ways and the catalog", () => {
    expect(fontModeOf("pdflatex")).toBe("pdflatex");
    expect(fontModeOf("lualatex")).toBe("unicode");
    expect(fontLabel("tex:pagella")).toBe("Palatino (TeX Gyre Pagella)");
    expect(fontLabel("system:Arial")).toBe("Arial");
    expect(new Set(CATALOG.map((f) => f.id)).size).toBe(CATALOG.length);
  });

  it("reads the document font as each engine sets it", () => {
    expect(documentFontOf(MAIN, "pdflatex")).toBe(DEFAULT_FONT);
    expect(documentFontOf("\\usepackage{tgpagella}\n\\begin{document}", "pdflatex")).toBe("tex:pagella");
    expect(documentFontOf("\\renewcommand{\\rmdefault}{qtm}\n\\begin{document}", "pdflatex")).toBe("tex:termes");
    expect(
      documentFontOf("\\renewcommand{\\sfdefault}{qhv}\n\\renewcommand{\\familydefault}{\\sfdefault}\n\\begin{document}", "pdflatex"),
    ).toBe("tex:heros");
    expect(documentFontOf("\\setmainfont{TeX Gyre Termes}\n\\begin{document}", "unicode")).toBe("tex:termes");
    expect(documentFontOf("\\setmainfont{Arial}\n\\begin{document}", "unicode")).toBe("system:Arial");
    expect(documentFontOf("\\setmainfont{EBGaramond-Regular.otf}\n\\begin{document}", "unicode")).toBe("otf:EBGaramond-Regular.otf");
  });

  it("sets the document font, replacing the one before", () => {
    const pagella = apply(MAIN, setDocumentFont(MAIN, "tex:pagella", "pdflatex"));
    expect(pagella).toContain("\\usepackage{graphicx}\n\\renewcommand{\\rmdefault}{qpl}\n\\begin{document}");
    expect(documentFontOf(pagella, "pdflatex")).toBe("tex:pagella");
    const termes = apply(pagella, setDocumentFont(pagella, "tex:termes", "pdflatex"));
    expect(termes).not.toContain("qpl");
    expect(documentFontOf(termes, "pdflatex")).toBe("tex:termes");
    expect(setDocumentFont(termes, "tex:termes", "pdflatex")).toBeNull();
    expect(setDocumentFont("no body", "tex:termes", "pdflatex")).toBeNull();
  });

  it("loads fontspec for a system font", () => {
    const arial = apply(MAIN, setDocumentFont(MAIN, "system:Arial", "unicode"));
    expect(arial).toContain("\\usepackage{fontspec}\n\\setmainfont{Arial}");
    expect(documentFontOf(arial, "unicode")).toBe("system:Arial");
  });

  it("declares a command for a font of part of the document, once", () => {
    const command = fontCommand(MAIN, "tex:pagella", "pdflatex")!;
    expect(command.name).toBe("fontPagella");
    const declared = apply(MAIN, command.edit);
    expect(declared).toContain("\\newcommand*{\\fontPagella}{\\fontfamily{qpl}\\selectfont}");
    expect(fontCommand(declared, "tex:pagella", "pdflatex")).toEqual({ name: "fontPagella", edit: null });
    expect([...fontCommandsOf(declared)]).toEqual([["fontPagella", "tex:pagella"]]);
    expect(fontDeclarations(declared).names).toEqual(["fontPagella"]);
    expect(fontCommand("no body", "tex:pagella", "pdflatex")).toBeNull();
  });

  it("declares a command for a size, once", () => {
    const size = sizeCommand(MAIN, 14)!;
    expect(size.name).toBe("sizeFourteen");
    const declared = apply(MAIN, size.edit);
    expect(sizeCommand(declared, 14)).toEqual({ name: "sizeFourteen", edit: null });
  });

  it("converts the fonts for the other kind of engine", () => {
    const pdf =
      "\\documentclass{article}\n\\renewcommand{\\rmdefault}{qtm}\n\\newcommand*{\\fontPagella}{\\fontfamily{qpl}\\selectfont}\n\\begin{document}";
    const conversion = convertFonts(pdf, "pdflatex", "unicode");
    const unicode = apply(pdf, conversion.edit);
    expect(documentFontOf(unicode, "unicode")).toBe("tex:termes");
    expect(unicode).toContain("\\usepackage{fontspec}");
    expect([...fontCommandsOf(unicode)]).toEqual([["fontPagella", "tex:pagella"]]);
    expect(conversion.lost).toEqual([]);
    expect(convertFonts(pdf, "pdflatex", "pdflatex").edit).toBeNull();
  });

  it("names what pdfLaTeX cannot use", () => {
    const system = "\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Arial}\n\\begin{document}";
    const conversion = convertFonts(system, "unicode", "pdflatex");
    expect(conversion.lost).toEqual(["Arial"]);
    expect(apply(system, conversion.edit)).not.toContain("\\setmainfont");
  });
});
