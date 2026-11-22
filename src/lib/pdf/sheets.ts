// How printed pages go onto sheets: which pages a range names, and the grid
// several pages share a sheet in. Pure calculations, used by the print page,
// its preview and the print layout (print.ts).

/** Short side / long side of the paper: A4 (Letter, 0.77, is close). */
export const PAPER_RATIO = 210 / 297;
export const MAX_PAGES_PER_SIDE = 9;

/** Margin of a sheet carrying several pages, and the gap between them (CSS, also in the preview). */
export const SHEET_PADDING = "3%";
export const CELL_GAP = "2%";

/**
 * Pages of a range such as "1-3, 5, 8-" (1-based, in the order written);
 * `null` if the text is not a valid range for `count` pages.
 */
export function parsePageRange(text: string, count: number): number[] | null {
  const pages: number[] = [];
  for (const part of text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    let from: number;
    let to: number;
    const range = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part);
    if (range) {
      // Open ends: "-3" from the first page, "8-" to the last.
      from = range[1] ? Number(range[1]) : 1;
      to = range[2] ? Number(range[2]) : count;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else {
      return null;
    }
    if (from < 1 || to > count || from > to) return null;
    for (let n = from; n <= to; n++) pages.push(n);
  }
  return pages.length > 0 ? pages : null;
}

export interface SheetLayout {
  cols: number;
  rows: number;
  /** The paper lies across. */
  landscape: boolean;
}

/**
 * The grid and paper orientation that show `pagesPerSide` pages of the given
 * width / height as large as possible, filled row by row. Two portrait pages
 * lie side by side on a landscape sheet, three in a row, eight as 4 × 2.
 * Ties go to the paper lying as the pages do, then to fewer empty cells.
 */
export function sheetLayout(pagesPerSide: number, pageAspect: number): SheetLayout {
  const n = Math.min(Math.max(Math.round(pagesPerSide), 1), MAX_PAGES_PER_SIDE);
  const pageLandscape = pageAspect > 1;
  let best: (SheetLayout & { scale: number; empty: number; turned: boolean }) | null = null;
  for (const landscape of [pageLandscape, !pageLandscape]) {
    // Paper with a long side of 1; the page fitted into each cell keeps its aspect.
    const [width, height] = landscape ? [1, PAPER_RATIO] : [PAPER_RATIO, 1];
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellWidth = width / cols;
      const cellHeight = height / rows;
      const scale = Math.min(cellWidth, cellHeight * pageAspect);
      const empty = cols * rows - n;
      const turned = landscape !== pageLandscape;
      const better =
        !best ||
        scale > best.scale + 1e-9 ||
        (Math.abs(scale - best.scale) < 1e-9 && (turned < best.turned || (turned === best.turned && empty < best.empty)));
      if (better) best = { cols, rows, landscape, scale, empty, turned };
    }
  }
  return { cols: best!.cols, rows: best!.rows, landscape: best!.landscape };
}
