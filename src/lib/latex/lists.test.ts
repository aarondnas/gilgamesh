// Lists of figures, tables, the bibliography …: put in, changed and taken out.
import { describe, expect, it } from "vitest";
import {
  fileNameFor,
  ListError,
  listContext,
  listEditContext,
  planList,
  planListEdit,
  planListRemoval,
  printedLists,
  type ListSource,
} from "./lists";

const MAIN = "\\documentclass{report}\n\\begin{document}\n\\tableofcontents\n\\chapter{Intro}\nText.\n\\end{document}\n";
const apply = (text: string, edit: { from: number; to: number; insert: string }) =>
  text.slice(0, edit.from) + edit.insert + text.slice(edit.to);

function project(files: Record<string, string>): Omit<ListSource, "kind"> {
  return { main: "main.tex", source: files["main.tex"], read: async (path) => files[path] ?? "" };
}

describe("a new list", () => {
  it("is offered where such lists usually go", async () => {
    const context = await listContext({ ...project({ "main.tex": MAIN }), kind: "figures" });
    expect(context.exists).toBe(false);
    expect(context.lists).toEqual([{ line: 3, kind: "contents", file: null }]);
    const place = context.positions.find((p) => p.at === context.suggested)!;
    // After the table of contents, before the first chapter.
    expect(MAIN.slice(place.at).startsWith("\\chapter{Intro}")).toBe(true);
    expect(context.tocChoice).toBe(true);
  });

  it("goes into a file of its own, read in at the place chosen", async () => {
    const source = project({ "main.tex": MAIN });
    const context = await listContext({ ...source, kind: "figures" });
    const plan = await planList({
      ...source,
      kind: "figures",
      heading: "Figures",
      file: "lists/figures.tex",
      at: context.suggested,
      toc: true,
      bibFiles: [],
      newBib: "references.bib",
    });
    expect(plan.text).toContain("\\listoffigures");
    expect(plan.text).toContain("Figures");
    expect(plan.createBib).toBeNull();
    const main = apply(MAIN, plan.edit);
    expect(main).toContain("\\input{lists/figures}");
    expect(main.indexOf("\\input{lists/figures}")).toBeLessThan(main.indexOf("\\chapter{Intro}"));
    const printed = await printedLists(project({ "main.tex": main, "lists/figures.tex": plan.text }));
    expect(printed.map((list) => list.kind)).toEqual(["contents", "figures"]);
  });

  it("creates a bibliography file where the project has none", async () => {
    const source = project({ "main.tex": MAIN });
    const context = await listContext({ ...source, kind: "bibliography" });
    const plan = await planList({
      ...source,
      kind: "bibliography",
      heading: "References",
      file: "lists/references.tex",
      at: context.suggested,
      toc: false,
      bibFiles: [],
      newBib: "references.bib",
    });
    expect(plan.createBib).toBe("references.bib");
  });

  it("is refused where the main file changed or has no body", async () => {
    const source = project({ "main.tex": MAIN });
    const request = { ...source, kind: "figures" as const, heading: "F", file: "f.tex", at: 3, toc: false, bibFiles: [], newBib: "r.bib" };
    await expect(planList(request)).rejects.toBeInstanceOf(ListError);
    await expect(listContext({ ...project({ "main.tex": "\\documentclass{article}" }), kind: "figures" })).rejects.toBeInstanceOf(
      ListError,
    );
  });
});

describe("a list printed already", () => {
  const WITH_LIST = MAIN.replace("\\tableofcontents\n", "\\tableofcontents\n\\listoffigures\n");

  it("can be moved, renamed and taken out", async () => {
    const source = { ...project({ "main.tex": WITH_LIST }), kind: "figures" as const };
    const context = await listEditContext({ ...source, line: 4 });
    expect(context.entry).toMatchObject({ kind: "figures", line: 4, file: null, movable: true });
    const renamed = await planListEdit({ ...source, line: 4, at: context.suggested, heading: "Pictures", toc: false });
    expect(renamed.edit ?? renamed.file?.edit).not.toBeNull();
    const removal = await planListRemoval({ ...source, line: 4 });
    expect(apply(WITH_LIST, removal.edit)).toBe(MAIN);
    expect(removal.file).toBeNull();
  });
});

describe("fileNameFor", () => {
  it("makes a file name of a heading", () => {
    expect(fileNameFor("List of Figures", "figures")).toBe("list-of-figures");
    expect(fileNameFor("Abbildungsverzeichnis", "figures")).toBe("abbildungsverzeichnis");
    expect(fileNameFor("Größenübersicht", "tables")).toBe("groessenuebersicht");
    expect(fileNameFor("Café", "index")).toBe("cafe");
    expect(fileNameFor("€", "index")).toBe("index");
  });
});
