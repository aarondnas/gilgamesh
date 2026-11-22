// What the font buttons act on: a word, paragraphs, a section, the document; and the colours.
import { describe, expect, it } from "vitest";
import { applyFormat, rangeOf } from "../../../tests/edits";
import {
  colorDocument,
  colorParagraphs,
  colorWord,
  highlightColorDefinition,
  highlightParagraphs,
  highlightSetup,
  highlightWord,
  isCustomColor,
  recentColors,
} from "./colors";
import { sizeDeclarations } from "./format";
import {
  combine,
  declareDocument,
  declareParagraphs,
  declareRange,
  declareWord,
  emphasisPackages,
  emphasisScopes,
  emphasizeDocument,
  emphasizeParagraphs,
  emphasizeWord,
} from "./scope";

const MAIN = "\\documentclass{article}\n\\usepackage{xcolor}\n\\begin{document}\nText.\n\\end{document}";
const sizes = sizeDeclarations("");

describe("a word", () => {
  const text = "one word here";
  const cursor = text.indexOf("ord");

  it("formats the word at the cursor, which keeps its place", () => {
    const edit = emphasizeWord(text, cursor, cursor, "textbf");
    const result = applyFormat(text, edit);
    expect(result.text).toBe("one \\textbf{word} here");
    expect(result.text.slice(edit.from + edit.select.anchor)).toBe("ord} here");
  });

  it("formats what is typed next at a word's edge, and the selection where there is one", () => {
    expect(emphasizeWord(text, 4, 4, "textit").insert).toBe("\\textit{}");
    expect(applyFormat(text, emphasizeWord(text, 0, 3, "underline")).text).toBe("\\underline{one} word here");
  });

  it("does not take a command's name for a word", () => {
    const command = "\\large x";
    expect(emphasizeWord(command, 3, 3, "textbf").insert).toBe("\\textbf{}");
  });

  it("sets declarations such as sizes", () => {
    expect(applyFormat(text, declareWord(text, cursor, cursor, sizes, "large")).text).toBe("one {\\large word} here");
  });
});

describe("several places at once", () => {
  it("combines changes into one edit, the selection staying on its text", () => {
    const text = "aa bb cc";
    const edit = combine(
      text,
      [
        { from: 0, to: 0, insert: "[", assoc: 1 },
        { from: 5, to: 5, insert: "]", assoc: -1 },
      ],
      { anchor: 3, head: 5 },
      0,
    );
    const result = applyFormat(text, edit);
    expect(result.text).toBe("[aa bb] cc");
    expect(result.selected).toBe("bb");
  });

  it("emphasizes every paragraph, or takes it away where all have it", () => {
    const text = "One.\n\nTwo.";
    const paragraphs = [rangeOf(text, "One."), rangeOf(text, "Two.")];
    const bold = applyFormat(text, emphasizeParagraphs(text, paragraphs, "textbf", { anchor: 0, head: text.length })!).text;
    expect(bold).toBe("\\textbf{One.}\n\n\\textbf{Two.}");
    const again = [rangeOf(bold, "\\textbf{One.}"), rangeOf(bold, "\\textbf{Two.}")];
    expect(applyFormat(bold, emphasizeParagraphs(bold, again, "textbf", { anchor: 0, head: bold.length })!).text).toBe(text);
    expect(emphasizeParagraphs(text, [], "textbf", { anchor: 0, head: 0 })).toBeNull();
  });

  it("underlines paragraphs with ulem, which breaks lines", () => {
    const text = "One.";
    const edit = emphasizeParagraphs(text, [rangeOf(text, "One.")], "underline", { anchor: 0, head: 4 })!;
    expect(edit.insert).toContain("\\uline{");
    expect(emphasisPackages(edit)).toEqual(["ulem"]);
    expect(emphasisPackages(emphasizeWord("x", 0, 1, "textbf"))).toEqual([]);
  });

  it("declares a size for paragraphs and for a section", () => {
    const text = "One.";
    const paragraph = applyFormat(text, declareParagraphs(text, [rangeOf(text, "One.")], sizes, "small", { anchor: 0, head: 4 })!).text;
    expect(paragraph).toBe("{\\small One.\\par}");
    const section = "Para one.\n\nPara two.";
    const range = { from: 0, to: section.length };
    const declared = applyFormat(section, declareRange(section, range, sizes, "large", { anchor: 0, head: 0 })).text;
    expect(declared.startsWith("\\begin{large}\n")).toBe(true);
    expect(declared.endsWith("\n\n\\end{large}")).toBe(true);
  });
});

describe("the whole document", () => {
  it("declares bold after \\begin{document}; a second click takes it away", () => {
    const bold = applyFormat(MAIN, emphasizeDocument(MAIN, "textbf")!).text;
    expect(bold).toContain("\\begin{document}\n\\bfseries\n");
    expect(applyFormat(bold, emphasizeDocument(bold, "textbf")!).text).toBe(MAIN);
    expect(emphasizeDocument(MAIN, "underline")).toBeNull();
    expect(emphasisScopes("underline")).not.toContain("document");
    expect(emphasisScopes("textbf")).toContain("document");
  });

  it("declares a size", () => {
    expect(applyFormat(MAIN, declareDocument(MAIN, sizes, "large")!).text).toContain("\\begin{document}\n\\large\n");
  });
});

describe("colours", () => {
  it("colours a word, and the document's colour takes it away", () => {
    const text = "a red word";
    const at = text.indexOf("ed");
    const red = applyFormat(text, colorWord(text, at, at, "red")).text;
    expect(red).toBe("a \\textcolor{red}{red} word");
    const inside = red.lastIndexOf("ed}");
    expect(applyFormat(red, colorWord(red, inside, inside, null)).text).toBe(text);
  });

  it("writes colours of the user's own by xcolor's HTML model", () => {
    expect(isCustomColor("#FF8800")).toBe(true);
    expect(isCustomColor("red")).toBe(false);
    expect(colorWord("x", 0, 1, "#ff8800").insert).toBe("\\textcolor[HTML]{FF8800}{x}");
  });

  it("colours paragraphs and the document", () => {
    const text = "One.";
    expect(applyFormat(text, colorParagraphs(text, [rangeOf(text, "One.")], "blue", { anchor: 0, head: 4 })!).text).toBe(
      "\\textcolor{blue}{One.}",
    );
    expect(applyFormat(MAIN, colorDocument(MAIN, "blue")!).text).toContain("\\begin{document}\n\\color{blue}\n");
  });

  it("highlights, yellow without an option", () => {
    expect(highlightWord("x", 0, 1, "yellow").insert).toBe("\\hlc{x}");
    expect(highlightWord("x", 0, 1, "cyan").insert).toBe("\\hlc[cyan]{x}");
    const text = "One.";
    expect(applyFormat(text, highlightParagraphs(text, [rangeOf(text, "One.")], "pink", { anchor: 0, head: 4 })!).text).toBe(
      "\\hlc[pink]{One.}",
    );
  });

  it("defines \\hlc once, after the packages", () => {
    const setup = highlightSetup(MAIN)!;
    const result = MAIN.slice(0, setup.at) + setup.insert + MAIN.slice(setup.at);
    expect(result.indexOf("\\newcommand{\\hlc}")).toBeGreaterThan(result.indexOf("\\usepackage{xcolor}"));
    expect(result.indexOf("\\newcommand{\\hlc}")).toBeLessThan(result.indexOf("\\begin{document}"));
    expect(highlightSetup(result)).toBeNull();
    expect(highlightSetup("no document")).toBeNull();
  });

  it("defines a highlight colour of the user's own before \\begin{document}", () => {
    const definition = highlightColorDefinition(MAIN, "#ff8800")!;
    expect(definition.insert).toBe("\\definecolor{hlFF8800}{HTML}{FF8800}\n");
    expect(MAIN.slice(definition.at).startsWith("\\begin{document}")).toBe(true);
    const defined = MAIN.slice(0, definition.at) + definition.insert + MAIN.slice(definition.at);
    expect(highlightColorDefinition(defined, "#ff8800")).toBeNull();
    expect(highlightColorDefinition(MAIN, "yellow")).toBeNull();
  });

  it("keeps the recent colours, newest first, each once", () => {
    expect(recentColors(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(
      recentColors(
        Array.from({ length: 10 }, (_, i) => `#00000${i}`),
        "#ffffff",
      ),
    ).toHaveLength(7);
  });
});
