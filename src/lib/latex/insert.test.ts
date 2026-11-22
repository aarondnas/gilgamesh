// What the ribbon's insert buttons write: packages, figures and tables.
import { describe, expect, it } from "vitest";
import { captionFor, figureCode, isImage, labelFor } from "./figures";
import { labelFrom, packagesEdit, placementOf, preambleOf, slugOf, uniqueLabel } from "./preamble";
import { tableCode, tableNumberAt, tablePackages, type Table } from "./tables";

const MAIN = String.raw`\documentclass{article}
\usepackage{graphicx}
\usepackage{cleveref}
\begin{document}
\end{document}`;

const apply = (source: string, edit: { at: number; insert: string } | null) =>
  edit ? source.slice(0, edit.at) + edit.insert + source.slice(edit.at) : source;

describe("the preamble", () => {
  it("reads class and packages", () => {
    const preamble = preambleOf(MAIN);
    expect(preamble.className).toBe("article");
    expect([...preamble.packages]).toEqual(["graphicx", "cleveref"]);
    expect(preambleOf("Text only")).toEqual({ packages: new Set(), className: "" });
  });

  it("adds only what is missing, hyperref before cleveref", () => {
    expect(packagesEdit(MAIN, ["graphicx"])).toBeNull();
    const result = apply(MAIN, packagesEdit(MAIN, ["booktabs", "hyperref"]));
    expect(result).toContain("\\usepackage{graphicx}\n\\usepackage{booktabs}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{cleveref}");
  });

  it("knows what classes and other packages provide", () => {
    const beamer = "\\documentclass{beamer}\n\\begin{document}\\end{document}";
    expect(packagesEdit(beamer, ["graphicx", "hyperref", "xcolor"])).toBeNull();
    expect(packagesEdit("\\documentclass{article}\\usepackage{tikz}\n\\begin{document}", ["xcolor"])).toBeNull();
  });

  it("places floats here where the float package is loaded", () => {
    expect(placementOf(MAIN)).toBe("htbp");
    expect(placementOf("\\documentclass{report}\n\\usepackage{float}\n\\begin{document}")).toBe("H");
  });
});

describe("labels", () => {
  it("are slugs of a caption", () => {
    expect(slugOf("Café results 2024!")).toBe("cafe-results-2024");
    expect(labelFrom("tab", "Results 2024", "table")).toBe("tab:results-2024");
    expect(labelFrom("fig", "€€", "image")).toBe("fig:image");
  });

  it("get a number where the label is taken", () => {
    expect(uniqueLabel("tab:a", [])).toBe("tab:a");
    expect(uniqueLabel("tab:a", ["tab:a", "tab:a-1"])).toBe("tab:a-2");
    expect(uniqueLabel("tab:table", [], true)).toBe("tab:table-1");
  });
});

describe("figures", () => {
  it("recognizes the images TeX includes", () => {
    expect(isImage("images/logo.PNG")).toBe(true);
    expect(isImage("diagram.eps")).toBe(true);
    expect(isImage("photo.webp")).toBe(false);
    expect(isImage("png")).toBe(false);
  });

  it("suggests caption and label from the file name", () => {
    expect(captionFor("images/University_logo.png")).toBe("University logo");
    expect(captionFor("a&b_50%.png")).toBe("a\\&b 50\\%");
    expect(labelFor("images/University logo.png")).toBe("fig:university-logo");
  });

  it("writes the figure environment, indented like its line", () => {
    const code = figureCode({ image: "images/logo.png", caption: " Logo ", label: "fig:logo", width: 0.8 }, MAIN, "  ");
    expect(code).toBe(
      [
        "\\begin{figure}[htbp]",
        "    \\centering",
        "    \\includegraphics[width=0.8\\textwidth]{images/logo.png}",
        "    \\caption{Logo}",
        "    \\label{fig:logo}",
        "  \\end{figure}",
      ].join("\n"),
    );
    expect(figureCode({ image: "a.png", caption: "", label: "", width: 1 }, MAIN)).not.toContain("\\caption");
  });
});

describe("tables", () => {
  const table = (more: Partial<Table> = {}): Table => ({
    columns: 2,
    rows: 2,
    header: true,
    style: "booktabs",
    fullWidth: false,
    caption: "Results",
    label: "tab:results",
    headerText: (column) => `Column ${column}`,
    ...more,
  });

  it("needs booktabs and tabularx where used", () => {
    expect(tablePackages(table())).toEqual(["booktabs"]);
    expect(tablePackages(table({ style: "grid", fullWidth: true }))).toEqual(["tabularx"]);
  });

  it("writes a booktabs table and selects the first header cell", () => {
    const { code, select } = tableCode(table(), MAIN);
    expect(code).toBe(
      [
        "\\begin{table}[htbp]",
        "  \\centering",
        "  \\caption{Results}",
        "  \\label{tab:results}",
        "  \\begin{tabular}{ll}",
        "    \\toprule",
        "    Column 1 & Column 2 \\\\",
        "    \\midrule",
        "     &  \\\\",
        "     &  \\\\",
        "    \\bottomrule",
        "  \\end{tabular}",
        "\\end{table}",
      ].join("\n"),
    );
    expect(code.slice(select.anchor, select.head)).toBe("Column 1");
  });

  it("writes a grid over the text width, selecting the first cell without a header", () => {
    const { code, select } = tableCode(table({ style: "grid", fullWidth: true, header: false, rows: 1 }), MAIN, "  ");
    expect(code).toContain("\\begin{tabularx}{\\textwidth}{|X|X|}");
    expect(code.match(/\\hline/g)).toHaveLength(2);
    expect(select.anchor).toBe(select.head);
    expect(code.slice(select.anchor - 4, select.anchor)).toBe("    ");
  });

  it("numbers a new table after the captioned ones before it", async () => {
    const main = String.raw`\documentclass{report}
\begin{document}
\chapter{One}
\begin{table}\caption{A}\end{table}
\input{chapters/two}
\appendix
\chapter{Extra}
\begin{table}\caption{B}\end{table}
HERE
\end{document}`;
    const files: Record<string, string> = {
      "chapters/two.tex": String.raw`\chapter{Two}
\begin{table}\caption*{unnumbered}\end{table}
\begin{table}\caption{C}\end{table}
TWO`,
    };
    const read = async (path: string) => files[path];
    const at = (file: string, marker: string) =>
      tableNumberAt({ main: "main.tex", mainSource: main, read, file, offset: (file === "main.tex" ? main : files[file]).indexOf(marker) });
    expect(await at("main.tex", "HERE")).toBe("A.2");
    expect(await at("chapters/two.tex", "TWO")).toBe("2.2");
    expect(await at("main.tex", "\\chapter{One}")).toBe("1");
  });
});
