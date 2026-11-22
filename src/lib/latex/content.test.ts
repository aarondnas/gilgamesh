// What the ribbon puts into the text: citations, formulas, symbols.
import { describe, expect, it } from "vitest";
import { applyEdits, applyFormat } from "../../../tests/edits";
import {
  bibSetupOf,
  citeCode,
  citeForms,
  entryKey,
  entryType,
  formatEntry,
  parseEntry,
  setupEdits,
  styleEdits,
  uniqueKey,
} from "./citations";
import {
  FORMULA_TEMPLATES,
  formulaBlock,
  inlineFormulaEdit,
  inMath,
  OPERATORS,
  STRUCTURE_EXAMPLES,
  STRUCTURE_GROUPS,
  structureEdit,
  templateBlock,
  templateEdit,
} from "./math";
import {
  charSymbolEdit,
  convertSymbolFont,
  hasCyrillicText,
  hasSymbolFont,
  loadCharSymbols,
  symbolEdit,
  symbolFontEdit,
  SYMBOLS,
  symbolTextFor,
  type CharSymbol,
} from "./symbols";

const ARTICLE = "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\end{document}";

describe("the bibliography tool", () => {
  it("is biblatex, natbib, BibTeX or none, with style and files", () => {
    const biblatex = "\\usepackage[style=apa]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\n\\printbibliography";
    expect(bibSetupOf(biblatex)).toEqual({ tool: "biblatex", style: "apa", files: ["refs.bib"], printed: true });
    const bibtex = "\\begin{document}\n\\bibliographystyle{plain}\n\\bibliography{refs,more.bib}";
    expect(bibSetupOf(bibtex)).toMatchObject({ tool: "bibtex", style: "plain", files: ["refs.bib", "more.bib"] });
    expect(bibSetupOf("\\usepackage{natbib}\n\\begin{document}").tool).toBe("natbib");
    expect(bibSetupOf(ARTICLE)).toEqual({ tool: "none", style: null, files: [], printed: false });
  });

  it("sets biblatex up after the packages", () => {
    const set = applyEdits(ARTICLE, setupEdits(ARTICLE, "refs.bib", "numeric"));
    expect(set).toContain(
      "\\usepackage{graphicx}\n\\usepackage{csquotes}\n\\usepackage[backend=biber, style=numeric]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}",
    );
    expect(bibSetupOf(set).tool).toBe("biblatex");
  });

  it("changes the style in place", () => {
    const biblatex = "\\usepackage[backend=biber, citestyle=x, style=apa]{biblatex}\n\\begin{document}";
    expect(applyEdits(biblatex, styleEdits(biblatex, "ieee"))).toContain("\\usepackage[backend=biber, style=ieee]{biblatex}");
    const bare = "\\usepackage{biblatex}\n\\begin{document}";
    expect(applyEdits(bare, styleEdits(bare, "ieee"))).toContain("\\usepackage[style=ieee]{biblatex}");
    const bibtex = "\\begin{document}\n\\bibliography{refs}";
    expect(applyEdits(bibtex, styleEdits(bibtex, "alpha"))).toContain("\\bibliographystyle{alpha}\n\\bibliography{refs}");
  });
});

describe("citations", () => {
  it("are written with the tool's commands", () => {
    expect(citeCode("biblatex", "paren", ["knuth1984"], "cf. ", "p. 12")).toBe("\\parencite[cf.][p.~12]{knuth1984}");
    expect(citeCode("biblatex", "text", ["a", "b"], "", "")).toBe("\\textcite{a,b}");
    expect(citeCode("natbib", "paren", ["a"], "", "p. 3")).toBe("\\citep[p.~3]{a}");
    expect(citeCode("bibtex", "plain", ["a"], "see", "")).toBe("\\cite{a}");
    expect(citeForms("bibtex")).toEqual(["plain"]);
    expect(citeForms("biblatex")).toContain("foot");
  });
});

describe("bibliography entries", () => {
  const DOI =
    '@article{Knuth_1984, title={Literate Programming}, author={Knuth, Donald E.}, year={1984}, month=may, journal="The Computer Journal"}';

  it("are read from doi.org's one-line BibTeX and written a field per line", () => {
    const entry = parseEntry(DOI)!;
    expect(entry.type).toBe("article");
    expect(entry.key).toBe("Knuth_1984");
    expect(entry.fields).toContainEqual(["month", "may", true]);
    expect(entry.fields).toContainEqual(["journal", "The Computer Journal", false]);
    const formatted = formatEntry(entry);
    expect(formatted.split("\n")[0]).toBe("@article{Knuth_1984,");
    expect(formatted).toContain("  month   = may");
    expect(parseEntry(formatted)?.fields).toEqual(entry.fields);
    expect(parseEntry("no entry")).toBeNull();
  });

  it("get a key from surname and year, unique in the project", () => {
    expect(entryKey(parseEntry(DOI)!)).toBe("knuth1984");
    expect(
      entryKey({
        type: "book",
        key: "",
        fields: [
          ["author", "Ada Lovelace"],
          ["date", "1843-01-01"],
        ],
      }),
    ).toBe("lovelace1843");
    expect(entryKey({ type: "misc", key: "", fields: [] })).toBe("source");
    expect(uniqueKey("knuth1984", [])).toBe("knuth1984");
    expect(uniqueKey("knuth1984", ["knuth1984", "knuth1984b"])).toBe("knuth1984c");
  });

  it("use BibTeX's types where biblatex's are unknown", () => {
    expect(entryType("online", "biblatex")).toBe("online");
    expect(entryType("online", "bibtex")).toBe("misc");
    expect(entryType("thesis", "natbib")).toBe("phdthesis");
  });
});

describe("formulas", () => {
  it("knows what lies in math", () => {
    const text = "a $x$ b \\[ y \\] c \\begin{align} z \\end{align} d % $w$";
    expect(inMath(text, text.indexOf("x"))).toBe(true);
    expect(inMath(text, text.indexOf("y"))).toBe(true);
    expect(inMath(text, text.indexOf("z"))).toBe(true);
    for (const outside of ["a", "b", "c", "d", "w"]) expect(inMath(text, text.indexOf(` ${outside}`) + 1), outside).toBe(false);
  });

  it("inserts structures, in $…$ outside math, around the selection", () => {
    const text = "a + b";
    const fraction = structureEdit(text, 0, 5, "fraction", "");
    const result = text.slice(0, 0) + fraction.edit.insert;
    expect(result).toBe("$\\frac{a + b}{}$");
    expect(result.slice(fraction.edit.select.anchor)).toBe("}$");
    const inside = "$x$";
    expect(structureEdit(inside, 1, 2, "sqrt", "").edit.insert).toBe("\\sqrt{x}");
    expect(
      Object.values(STRUCTURE_GROUPS)
        .flat()
        .every((kind) => STRUCTURE_EXAMPLES[kind]),
    ).toBe(true);
  });

  it("writes inline formulas and formulas on lines of their own", () => {
    const inline = applyFormat("E=mc^2", inlineFormulaEdit("E=mc^2", 0, 6));
    expect(inline.text).toBe("$E=mc^2$");
    const equation = formulaBlock("equation", " a = b ", "eq:ab", "  ");
    expect(equation.code).toBe("\\begin{equation}\n    a = b\n    \\label{eq:ab}\n  \\end{equation}");
    expect(equation.packages).toEqual([]);
    const align = formulaBlock("align", "", "", "");
    expect(align.packages).toEqual(["amsmath"]);
    expect(align.code.slice(align.select.anchor).startsWith(" &= ")).toBe(true);
  });

  it("puts ready-made formulas into math, or on lines of their own", () => {
    for (const id of FORMULA_TEMPLATES) {
      const block = templateBlock(id, "");
      expect(block.code.startsWith("\\[\n  ")).toBe(true);
      expect(block.select.anchor).toBe(block.code.length);
    }
    expect(templateEdit("plain", 0, 0, "pythagoras")).toBeNull();
    expect(templateEdit("$ $", 1, 2, "pythagoras")!.edit.insert).toContain("^2");
  });

  it("offers operators with their commands", () => {
    const times = OPERATORS.find((o) => o.symbol === "×");
    expect(times).toMatchObject({ command: "\\times", packages: [] });
  });
});

describe("symbols", () => {
  it("inserts a symbol, or quotes around the selection", () => {
    const euro = SYMBOLS.find((s) => s.symbol === "€")!;
    expect(applyFormat("price ", symbolEdit("price ", 6, 6, euro)).text).toBe("price \\texteuro{}");
    const quotes = SYMBOLS.find((s) => s.wraps)!;
    const quoted = applyFormat("say hi", symbolEdit("say hi", 4, 6, quotes));
    expect(quoted.text).toBe("say \\enquote{hi}");
  });

  const omega: CharSymbol = {
    char: "Ω",
    category: "greek",
    name: "GREEK CAPITAL LETTER OMEGA",
    text: { pdflatex: { code: "\\textOmega{}", packages: ["textgreek"], setup: null }, unicode: { code: "Ω", packages: [], setup: null } },
    math: "\\Omega",
    mathPackages: [],
  };

  it("sets a character as text or as math, as the place and the engine need", () => {
    expect(charSymbolEdit("a ", 2, 2, omega, "unicode", false).edit.insert).toBe("Ω");
    expect(charSymbolEdit("a ", 2, 2, omega, "pdflatex", false).packages).toEqual(["textgreek"]);
    expect(charSymbolEdit("$x$", 2, 2, omega, "unicode", false).edit.insert).toBe("\\Omega ");
    const mathOnly = { ...omega, text: { pdflatex: null, unicode: null } };
    expect(charSymbolEdit("a ", 2, 2, mathOnly, "unicode", false).edit.insert).toBe("$\\Omega$");
    const cyrillic = { ...omega, text: { ...omega.text, pdflatex: { code: "x", packages: [], setup: "T2A" as const } } };
    expect(symbolTextFor(cyrillic, "pdflatex", false)).toBeNull();
    expect(symbolTextFor(cyrillic, "pdflatex", true)).not.toBeNull();
  });

  it("knows Cyrillic text and the fallback font", () => {
    expect(hasCyrillicText("\\usepackage[T2A,T1]{fontenc}\n\\begin{document}")).toBe(true);
    expect(hasCyrillicText(ARTICLE)).toBe(false);
    const edit = symbolFontEdit(ARTICLE)!;
    const set = ARTICLE.slice(0, edit.at) + edit.insert + ARTICLE.slice(edit.at);
    expect(set.indexOf("\\textsymbol")).toBeGreaterThan(set.indexOf("\\usepackage{graphicx}"));
    expect(hasSymbolFont(set)).toBe(true);
    expect(symbolFontEdit(set)).toBeNull();
    const pdf = convertSymbolFont(set, "pdflatex");
    expect(hasSymbolFont(pdf)).toBe(false);
    expect(convertSymbolFont(pdf, "unicode")).toBe(set);
  });

  it("loads the generated table of characters", async () => {
    const symbols = await loadCharSymbols();
    expect(symbols.length).toBeGreaterThan(100);
    expect(symbols.find((s) => s.char === "©")?.name).toBe("COPYRIGHT SIGN");
  });
});
