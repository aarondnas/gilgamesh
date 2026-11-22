// Working across the project's files: problems of a build, link targets, moving headings.
import { describe, expect, it } from "vitest";
import type { ProjectScan } from "$lib/api";
import { translate } from "$lib/api/localize";
import { linkTargets } from "./links";
import { canDrop, OutlineMoveError, partOf, planExtract, planMove, spanOf, type FileEdit, type MoveSource } from "./outline-move";
import { escapeLine, explain, usedBy, warningKey, type ExplanationId } from "./problems";

describe("problems", () => {
  it("explains LaTeX's messages, with a fix where there is one", () => {
    expect(explain("Undefined control sequence: \\href", null)).toEqual({
      id: "undefined_command_package",
      params: { command: "\\href", package: "hyperref" },
      fix: { kind: "package", name: "hyperref" },
    });
    expect(explain("LaTeX Error: Environment wrapfigure undefined.", null)?.fix).toEqual({ kind: "package", name: "wrapfig" });
    expect(explain("Package biblatex Warning: Please (re)run Biber on the file", null)?.id).toBe("rerun");
    expect(explain("Overfull \\hbox (12.3pt too wide) in paragraph", null)?.params).toEqual({ width: "12" });
    expect(explain("Something nobody explains", null)).toBeNull();
  });

  it("offers to escape an underscore only in running text", () => {
    expect(explain("Missing $ inserted.", "file_name.tex")?.fix).toEqual({ kind: "escape", char: "_" });
    expect(explain("Missing $ inserted.", "$x_1$")?.fix).toBeNull();
    expect(escapeLine("A & B_1 \\& % c & d", "&")).toBe("A \\& B_1 \\& % c & d");
  });

  it("leaves a package's own files to the list of missing ones", () => {
    expect(explain("LaTeX Error: File `tikz.sty' not found.", null)).toBeNull();
    expect(explain("LaTeX Error: File `chapter1.tex' not found.", null)?.id).toBe("file_not_found");
  });

  it("has a message for every explanation in every case", () => {
    const ids: Record<ExplanationId, true> = {
      undefined_command: true,
      undefined_command_package: true,
      undefined_environment: true,
      undefined_environment_package: true,
      missing_dollar: true,
      alignment_tab: true,
      braces: true,
      extra_alignment: true,
      no_line: true,
      lonely_item: true,
      file_not_found: true,
      citation_undefined: true,
      empty_bibliography: true,
      reference_undefined: true,
      rerun: true,
      unicode: true,
      overfull: true,
      underfull: true,
      float_too_large: true,
      option_clash: true,
      missing_number: true,
      missing_begin_document: true,
      environment_mismatch: true,
      emergency_stop: true,
      bib_file_missing: true,
      notes_margin: true,
    };
    for (const id of Object.keys(ids)) expect(translate(`problem_${id}`, {}), id).not.toBeNull();
  });

  it("remembers ignored warnings by file and text, and knows those that wait for use", () => {
    expect(warningKey({ file: "main.tex", message: "x" })).toBe("main.tex: x");
    expect(usedBy("The length marginparwidth is less than 2cm")?.test("\\todo{a}")).toBe(true);
    expect(usedBy("other")).toBeNull();
  });
});

// A report whose chapters are each in a file of their own.
const MAIN =
  "\\documentclass{report}\n\\begin{document}\n\\input{chapters/a}\n\\input{chapters/b}\n\\appendix\n\\input{chapters/c}\n\\end{document}\n";
const FILES: Record<string, string> = {
  "main.tex": MAIN,
  "chapters/a.tex": "\\chapter{Alpha}\\label{ch:alpha}\nText.\n\\section{Inner}\nMore.\n",
  "chapters/b.tex": "\\chapter{Beta}\nText.\n",
  "chapters/c.tex": "\\chapter{Gamma}\nText.\n",
};
const heading = (level: number, number: string, title: string, file: string, line: number) => ({ level, number, title, file, line });
const SCAN: ProjectScan = {
  outline: [
    heading(1, "1", "Alpha", "chapters/a.tex", 1),
    heading(2, "1.1", "Inner", "chapters/a.tex", 3),
    heading(1, "2", "Beta", "chapters/b.tex", 1),
    heading(1, "A", "Gamma", "chapters/c.tex", 1),
  ],
  labels: [{ key: "ch:alpha", file: "chapters/a.tex", line: 1 }],
  citations: [],
  includes: [],
  inclusions: [
    { file: "chapters/a.tex", parent: "main.tex", line: 3, command: "input" },
    { file: "chapters/b.tex", parent: "main.tex", line: 4, command: "input" },
    { file: "chapters/c.tex", parent: "main.tex", line: 6, command: "input" },
  ],
  appendix: { file: "main.tex", line: 5, index: 3 },
  language: null,
};
const read = async (path: string) => FILES[path];
const source: MoveSource = { outline: SCAN.outline, inclusions: SCAN.inclusions, appendix: SCAN.appendix, main: "main.tex", read };

/** The files after `edits`, each file's edits applied last first. */
function applyFileEdits(edits: FileEdit[]): Record<string, string> {
  const result = { ...FILES };
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    result[edit.file] = result[edit.file].slice(0, edit.from) + edit.insert + result[edit.file].slice(edit.to);
  }
  return result;
}

describe("link targets", () => {
  it("lists every heading, with its label or the one it would get", async () => {
    const targets = await linkTargets(SCAN, read);
    expect(targets.map((t) => [t.title, t.key, t.newLabel ?? null])).toEqual([
      ["Alpha", "ch:alpha", null],
      ["Inner", null, "sec:inner"],
      ["Beta", null, "ch:beta"],
      ["Gamma", null, "ch:gamma"],
    ]);
  });
});

describe("moving headings", () => {
  it("knows what a heading covers and where it may go", () => {
    expect(spanOf(SCAN.outline, 0)).toBe(2);
    expect(spanOf(SCAN.outline, 2)).toBe(3);
    expect(canDrop(SCAN.outline, 2, 0)).toBe(true);
    expect(canDrop(SCAN.outline, 0, 1)).toBe(false);
    expect(canDrop(SCAN.outline, 2, 1)).toBe(false);
    expect(partOf(SCAN.appendix, 3)).toBe("appendix");
    expect(partOf(SCAN.appendix, 2)).toBe("main");
  });

  it("moves the line that reads a chapter in", async () => {
    const moved = applyFileEdits(await planMove(source, 2, 0));
    expect(moved["main.tex"]).toBe(MAIN.replace("\\input{chapters/a}\n\\input{chapters/b}", "\\input{chapters/b}\n\\input{chapters/a}"));
    expect(moved["chapters/b.tex"]).toBe(FILES["chapters/b.tex"]);
  });

  it("moves a chapter into the appendix", async () => {
    const moved = applyFileEdits(await planMove(source, 2, 3, "appendix"));
    expect(moved["main.tex"]).toBe(MAIN.replace("\\input{chapters/b}\n\\appendix\n", "\\appendix\n\\input{chapters/b}\n"));
  });

  it("refuses a heading that shares its file", async () => {
    await expect(planMove(source, 1, 3)).rejects.toBeInstanceOf(OutlineMoveError);
    await expect(planMove(source, 1, 3)).rejects.toMatchObject({ code: "shared" });
  });

  it("puts a section into a file of its own, read in where it stood", async () => {
    const extraction = await planExtract(source, 1, "chapters/inner");
    const text = FILES[extraction.file];
    expect(extraction.file).toBe("chapters/a.tex");
    expect(extraction.content).toBe("\\section{Inner}\nMore.\n");
    expect(text.slice(0, extraction.from) + extraction.insert + text.slice(extraction.to)).toBe(
      "\\chapter{Alpha}\\label{ch:alpha}\nText.\n\\input{chapters/inner}\n",
    );
  });
});
