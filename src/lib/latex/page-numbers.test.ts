import { describe, expect, it } from "vitest";
import { applyEdits, applySorted } from "../../../tests/edits";
import {
  bodyLines,
  countingEdits,
  EMPTY_HEADER_FOOTER,
  headerFooterEdits,
  headerFooterOf,
  needsLastPage,
  POSITIONS,
  regionsOf,
  sameCounting,
  STYLES,
  styleExample,
  type HeaderFooter,
} from "./page-numbers";

const MAIN =
  "\\documentclass{report}\n\\usepackage{fancyhdr}\n\\begin{document}\n\\chapter{One}\nText.\n\\chapter{Two}\nMore.\n\\end{document}";

describe("how the number reads", () => {
  it("in each style and language", () => {
    expect(styleExample("number", "en")).toBe("3");
    expect(styleExample("dashes", "en")).toBe("– 3 –");
    expect(styleExample("page", "de")).toBe("Seite 3");
    expect(styleExample("pageOf", "en")).toMatch(/3.*12/);
    expect(needsLastPage("pageOf")).toBe(true);
    expect(needsLastPage("number")).toBe(false);
    expect(STYLES.every((style) => styleExample(style, "en").includes("3"))).toBe(true);
  });

  it("offers inner and outer fields for two-sided printing", () => {
    expect(POSITIONS.oneSided).toContain("bottom-center");
    expect(POSITIONS.twoSided).toContain("bottom-outer");
  });
});

describe("header and footer", () => {
  const setup: HeaderFooter = {
    fields: { "bottom-center": { kind: "page" }, "top-right": { kind: "chapter" }, "top-left": { kind: "text", text: "Thesis" } },
    style: "dashes",
    small: false,
    rule: true,
  };

  it("are set in a block before \\begin{document}, read back the same", () => {
    expect(headerFooterOf(MAIN)).toBeNull();
    const set = applyEdits(MAIN, headerFooterEdits(MAIN, setup, "en"));
    expect(set.indexOf("\\fancyhf{}")).toBeLessThan(set.indexOf("\\begin{document}"));
    expect(set).toContain("\\pagestyle{fancy}");
    const read = headerFooterOf(set)!;
    expect(read.ours).toBe(true);
    expect(read.style).toBe("dashes");
    expect(read.rule).toBe(true);
    expect(read.fields).toEqual(setup.fields);
  });

  it("replace their own block when set again", () => {
    const set = applyEdits(MAIN, headerFooterEdits(MAIN, setup, "en"));
    const again = applyEdits(set, headerFooterEdits(set, { ...EMPTY_HEADER_FOOTER, fields: { "bottom-right": { kind: "page" } } }, "en"));
    expect(again.match(/\\fancyhf\{\}/g)).toHaveLength(2);
    expect(headerFooterOf(again)!.fields).toEqual({ "bottom-right": { kind: "page" } });
    expect(headerFooterEdits("no body", setup, "en")).toEqual([]);
  });

  it("take over the document's own fancyhdr lines", () => {
    const own = MAIN.replace("\\begin{document}", "\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyfoot[C]{\\thepage}\n\\begin{document}");
    expect(headerFooterOf(own)).toMatchObject({ ours: false, fields: { "bottom-center": { kind: "page" } } });
    const set = applyEdits(own, headerFooterEdits(own, setup, "en"));
    expect(set).not.toContain("\\fancyfoot[C]{\\thepage}");
  });
});

describe("how the numbers count", () => {
  const files: Record<string, string> = {
    "main.tex": "\\documentclass{report}\n\\begin{document}\n\\pagenumbering{roman}\n\\tableofcontents\n\\input{body}\n\\end{document}",
    "body.tex": "\\chapter{Intro}\nText.\n\\chapter{End}\nMore.",
  };
  const inclusions = [{ file: "body.tex", parent: "main.tex", line: 5 }];
  const outline = [
    { level: 1, number: "1", title: "Intro", file: "body.tex", line: 1 },
    { level: 1, number: "2", title: "End", file: "body.tex", line: 3 },
  ];
  const lines = bodyLines("main.tex", (file) => files[file] ?? null, inclusions);

  it("reads the body across the files read in", () => {
    // From the line with \begin{document} to the one with \end{document}.
    expect(lines.map((l) => `${l.file}:${l.line}`)).toEqual([
      "main.tex:2",
      "main.tex:3",
      "main.tex:4",
      "main.tex:5",
      "body.tex:1",
      "body.tex:2",
      "body.tex:3",
      "body.tex:4",
      "main.tex:6",
    ]);
    expect(lines.every((l) => (files[l.file] ?? "").slice(l.from).startsWith(l.text))).toBe(true);
  });

  it("splits it into regions with the switches that act on them", () => {
    const regions = regionsOf(lines, outline);
    expect(regions.map((r) => r.kind)).toEqual(["start", "contents", "heading", "heading"]);
    // \pagenumbering starts the count at 1 again, as in LaTeX.
    expect(regions[0].counting).toEqual({ format: "roman", start: 1 });
    expect(regions[0].switches).toHaveLength(1);
    expect(regions[2].title).toBe("Intro");
  });

  it("sets the counting of a region, with a page break before it", () => {
    const regions = regionsOf(lines, outline);
    const intro = regions[2];
    const edits = countingEdits(intro, { format: "arabic", start: 1 }, false);
    const body = applySorted(files["body.tex"], edits.get("body.tex") ?? []);
    expect(body).toContain("\\clearpage");
    expect(body).toContain("\\pagenumbering{arabic}");
    expect(body.indexOf("\\pagenumbering{arabic}")).toBeLessThan(body.indexOf("\\chapter{Intro}"));
    expect(sameCounting({ format: "arabic", start: 1 }, { format: "arabic", start: 1 })).toBe(true);
    expect(sameCounting({ format: "arabic", start: 1 }, { format: "roman", start: 1 })).toBe(false);
  });
});
