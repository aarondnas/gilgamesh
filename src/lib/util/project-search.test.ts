import { describe, expect, it } from "vitest";
import { hitsIn, MAX_HITS, patternOf, replacementOf, type SearchOptions } from "./project-search";

const options = (query: string, more: Partial<SearchOptions> = {}): SearchOptions => ({
  query,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...more,
});

describe("patternOf", () => {
  it("has no pattern for an empty query", () => {
    expect(patternOf(options(""))).toBeNull();
  });

  it("searches plain text literally and ignores case unless asked", () => {
    const pattern = patternOf(options("a.b")) as RegExp;
    expect("A.B".match(pattern)).toEqual(["A.B"]);
    expect("axb".match(pattern)).toBeNull();
    expect("A.B".match(patternOf(options("a.b", { caseSensitive: true })) as RegExp)).toBeNull();
  });

  it("finds whole words only, letters of any script counting as word", () => {
    const pattern = patternOf(options("Haus", { wholeWord: true })) as RegExp;
    expect("Haus Häuser Hausboot".match(pattern)).toEqual(["Haus"]);
    expect("Ä-Haus".match(pattern)).toEqual(["Haus"]);
  });

  it("reports a broken regular expression as an error", () => {
    expect(patternOf(options("(", { regex: true }))).toBeInstanceOf(Error);
  });
});

describe("hitsIn", () => {
  it("finds every hit with its line and offsets", () => {
    const text = "one two\ntwo three two";
    const hits = hitsIn("main.tex", text, patternOf(options("two")) as RegExp);
    expect(hits.map((h) => [h.line, h.from, h.to])).toEqual([
      [1, 4, 7],
      [2, 8, 11],
      [2, 18, 21],
    ]);
    expect(hits.every((h) => text.slice(h.from, h.to) === "two")).toBe(true);
    expect(hits[1]).toMatchObject({ file: "main.tex", text: "two three two", start: 0, end: 3 });
  });

  it("skips empty matches and stops at the limit", () => {
    expect(hitsIn("a", "abc", patternOf(options("x*", { regex: true })) as RegExp)).toEqual([]);
    expect(hitsIn("a", "aaaa", patternOf(options("a")) as RegExp, 2)).toHaveLength(2);
    expect(MAX_HITS).toBeGreaterThan(0);
  });
});

describe("replacementOf", () => {
  it("fills in groups for a regular expression only", () => {
    const pattern = patternOf(options("(\\w+)@(\\w+)", { regex: true })) as RegExp;
    const [hit] = hitsIn("a", "mail me@home now", pattern);
    expect(replacementOf(hit, pattern, "$2 at $1", true)).toBe("home at me");
    expect(replacementOf(hit, pattern, "$2 at $1", false)).toBe("$2 at $1");
  });
});
