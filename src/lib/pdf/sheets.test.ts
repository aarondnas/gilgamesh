import { describe, expect, it } from "vitest";
import { MAX_PAGES_PER_SIDE, parsePageRange, sheetLayout } from "./sheets";

describe("parsePageRange", () => {
  it("reads pages and ranges in the order written, open ends included", () => {
    expect(parsePageRange("1-3, 5, 8-", 9)).toEqual([1, 2, 3, 5, 8, 9]);
    expect(parsePageRange("-2; 4", 5)).toEqual([1, 2, 4]);
    expect(parsePageRange("3–4", 5)).toEqual([3, 4]);
  });

  it("refuses what the document does not have", () => {
    expect(parsePageRange("0", 5)).toBeNull();
    expect(parsePageRange("4-9", 5)).toBeNull();
    expect(parsePageRange("3-1", 5)).toBeNull();
    expect(parsePageRange("a", 5)).toBeNull();
    expect(parsePageRange(" , ", 5)).toBeNull();
  });
});

describe("sheetLayout", () => {
  it("lays portrait pages out as large as they can be", () => {
    expect(sheetLayout(1, 0.7)).toEqual({ cols: 1, rows: 1, landscape: false });
    expect(sheetLayout(2, 0.7)).toEqual({ cols: 2, rows: 1, landscape: true });
    expect(sheetLayout(4, 0.7)).toEqual({ cols: 2, rows: 2, landscape: false });
    expect(sheetLayout(8, 0.7)).toEqual({ cols: 4, rows: 2, landscape: true });
  });

  it("puts landscape pages one below the other", () => {
    expect(sheetLayout(2, 1.4)).toEqual({ cols: 1, rows: 2, landscape: false });
  });

  it("keeps the number of pages within what a sheet can hold", () => {
    const most = sheetLayout(50, 0.7);
    expect(most.cols * most.rows).toBeGreaterThanOrEqual(MAX_PAGES_PER_SIDE);
    expect(sheetLayout(0, 0.7)).toEqual({ cols: 1, rows: 1, landscape: false });
  });
});
