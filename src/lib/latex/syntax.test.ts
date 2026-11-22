import { describe, expect, it } from "vitest";
import {
  afterPackages,
  BEGIN_DOCUMENT,
  documentClassOf,
  hasChapters,
  headOf,
  indentOf,
  lineEnd,
  loadedPackages,
  maskComments,
  packageNames,
  splitOptions,
  stripComment,
  stripComments,
  USEPACKAGE,
} from "./syntax";

const MAIN = String.raw`\documentclass[12pt,a4paper]{report}
\usepackage[utf8]{inputenc}
% \usepackage{hidden}
\usepackage{graphicx, booktabs}
\begin{document}
Text with 50\% and % a comment
\end{document}`;

describe("comments", () => {
  it("strips them, but not an escaped percent sign", () => {
    expect(stripComment("50\\% done % note")).toBe("50\\% done ");
    expect(stripComments("a % x\nb % y")).toBe("a \nb ");
  });

  it("masks them with spaces, keeping every offset", () => {
    const masked = maskComments(MAIN);
    expect(masked).toHaveLength(MAIN.length);
    expect(masked).not.toContain("hidden");
    expect(masked).toContain("50\\% and ");
  });
});

describe("the preamble", () => {
  it("ends at \\begin{document}", () => {
    expect(headOf(MAIN)).toBe(MAIN.slice(0, MAIN.indexOf("\\begin{document}")));
    expect(headOf("no body")).toBe("no body");
    expect(BEGIN_DOCUMENT.test("\\begin {document}")).toBe(true);
  });

  it("reads the class", () => {
    const documentClass = documentClassOf(MAIN)!;
    expect(documentClass.name).toBe("report");
    expect(documentClass.options).toBe("12pt,a4paper");
    expect(MAIN.slice(documentClass.from, documentClass.to)).toBe("\\documentclass[12pt,a4paper]{report}");
    expect(documentClassOf("\\begin{document}")).toBeNull();
    expect(hasChapters("report")).toBe(true);
    expect(hasChapters("article")).toBe(false);
  });

  it("knows the packages loaded, commented ones aside", () => {
    expect([...loadedPackages(MAIN)]).toEqual(["inputenc", "graphicx", "booktabs"]);
    const uses = [...maskComments(MAIN).matchAll(USEPACKAGE)];
    expect(uses.map(packageNames)).toEqual([["inputenc"], ["graphicx", "booktabs"]]);
  });

  it("puts new lines after the last package, else after the class", () => {
    expect(MAIN.slice(0, afterPackages(MAIN)).endsWith("\\usepackage{graphicx, booktabs}")).toBe(true);
    const bare = "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    expect(afterPackages(bare)).toBe("\\documentclass{article}".length);
    expect(afterPackages("\\begin{document}")).toBe(-1);
    // Not behind \begin{document} on the same line.
    const tight = "\\documentclass{article}\\usepackage{x}\\begin{document}";
    expect(afterPackages(tight)).toBe(tight.indexOf("\\begin"));
  });
});

describe("small helpers", () => {
  it("splits options at commas outside braces", () => {
    expect(splitOptions("a=1, b={2,3} ,, c")).toEqual(["a=1", "b={2,3}", "c"]);
    expect(splitOptions("")).toEqual([]);
  });

  it("finds line ends and indentation", () => {
    expect(lineEnd("ab\ncd", 0)).toBe(2);
    expect(lineEnd("ab\ncd", 3)).toBe(5);
    expect(indentOf("\t  \\item x")).toBe("\t  ");
    expect(indentOf("x")).toBe("");
  });
});
