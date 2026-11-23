// What the stores work out without the backend: units, changed sections, languages.
import { describe, expect, it } from "vitest";
import type { ProjectScan } from "$lib/api";
import { sectionsChanged } from "./changes.svelte";
import { localeName } from "./locale.svelte";
import { fromCm, isUnit, regionOf, toCm } from "./units.svelte";

describe("units", () => {
  it("convert from and to cm, rounded to what is worth showing", () => {
    expect(fromCm(2.54, "in")).toBe(1);
    expect(fromCm(2.5, "mm")).toBe(25);
    expect(fromCm(1.23456, "cm")).toBe(1.23);
    expect(toCm(1, "in")).toBe(2.54);
    expect(isUnit("mm")).toBe(true);
    expect(isUnit("pt")).toBe(false);
  });

  it("read a language's region, and none from a tag such as Linux's C locale gives", () => {
    expect(regionOf("en")).toBe("US");
    expect(regionOf("de-AT")).toBe("AT");
    expect(regionOf("c")).toBeNull();
  });
});

describe("languages", () => {
  it("are named in their own language, capitalized", () => {
    expect(localeName("de")).toBe("Deutsch");
    expect(localeName("fr")).toBe("Français");
  });
});

describe("sectionsChanged", () => {
  const scan = {
    outline: [
      { level: 1, number: "1", title: "A", file: "main.tex", line: 5 },
      { level: 1, number: "2", title: "B", file: "b.tex", line: 1 },
      { level: 2, number: "2.1", title: "B1", file: "b.tex", line: 10 },
    ],
    inclusions: [{ file: "b.tex", parent: "main.tex", line: 8, command: "input" }],
  } as unknown as ProjectScan;

  it("finds the section of each change, through the files that read others in", () => {
    expect([...sectionsChanged(scan, [{ file: "main.tex", line: 6 }])]).toEqual([0]);
    expect([...sectionsChanged(scan, [{ file: "b.tex", line: 12 }])]).toEqual([2]);
    // No heading before it in its file nor where that is read in: the whole document's top level.
    expect([...sectionsChanged({ ...scan, outline: scan.outline.slice(2) }, [{ file: "b.tex", line: 1 }])]).toEqual([0]);
  });

  it("takes a change before every heading as one to the whole document", () => {
    expect([...sectionsChanged(scan, [{ file: "main.tex", line: 1 }])]).toEqual([0, 1]);
  });
});
