// Lays a PDF's pages out for print, one sheet per printed page with as many
// PDF pages on it as chosen, shown only under `@media print`. The system's
// webview then prints this page (WebView2 on Windows, WebKitGTK on Linux; see
// `print/`). Gilgamesh arranges the sheets itself: print systems know only
// 1, 2, 4, 6, 9 or 16 pages per sheet.
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Paper } from "$lib/api";
import "./renderer"; // sets up the pdf.js worker
import { CELL_GAP, SHEET_PADDING, type SheetLayout } from "./sheets";

/** Print quality; pdf.js's own viewer prints at 150 dpi, text looks crisper at 300. */
const PRINT_DPI = 300;
const POINTS_PER_INCH = 72;

/**
 * Each sheet is exactly one printed page: the viewport where that is the page
 * (WebView2), otherwise the paper's size (WebKitGTK takes `vw` and `vh` from
 * the window, also when printing).
 */
const printStyle = (width: string, height: string) => `
@media screen {
  .print-sheets { display: none; }
}
@media print {
  @page { margin: 0; }
  html, body {
    height: auto !important;
    margin: 0 !important;
    overflow: visible !important;
    background: #fff !important;
  }
  body > :not(.print-sheets) { display: none !important; }
  .print-sheets .sheet {
    display: grid;
    width: ${width};
    height: ${height};
    box-sizing: border-box;
    overflow: hidden;
    break-after: page;
  }
  .print-sheets .sheet.multi { padding: ${SHEET_PADDING}; gap: ${CELL_GAP}; }
  .print-sheets .sheet:last-child { break-after: auto; }
  .print-sheets .cell { min-width: 0; min-height: 0; }
  .print-sheets img { display: block; width: 100%; height: 100%; object-fit: contain; }
}`;

export function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js takes ownership of the buffer, so hand it a copy.
  return pdfjs.getDocument({ data: data.slice(0) }).promise;
}

/** Width / height of the first page. */
export async function pageAspectOf(pdf: PDFDocumentProxy): Promise<number> {
  const { width, height } = (await pdf.getPage(1)).getViewport({ scale: 1 });
  return width / height;
}

/**
 * Renders `pages` at print resolution into the print layout of this document,
 * `pagesPerSide` to a sheet arranged as `layout`, for `paper` if the page has
 * to size the sheets itself (see `printPaper`). Returns a function that
 * removes it again; call it once the job is spooled.
 */
export async function preparePrint(
  pdf: PDFDocumentProxy,
  pages: number[],
  pagesPerSide: number,
  layout: SheetLayout,
  paper: Paper | null,
  onProgress: (done: number) => void,
): Promise<() => void> {
  const style = document.createElement("style");
  if (paper) {
    // Landscape sheets lie across the paper.
    const [width, height] = layout.landscape ? [paper.height, paper.width] : [paper.width, paper.height];
    // A pixel less than the paper: WebKitGTK rounds the printed page down to whole
    // pixels, and a sheet a fraction higher would spill onto a blank page of its own.
    style.textContent = printStyle(`${width}mm`, `calc(${height}mm - 1px)`);
  } else {
    style.textContent = printStyle("100vw", "100vh");
  }
  const sheets = document.createElement("div");
  sheets.className = "print-sheets";
  const urls: string[] = [];
  const remove = () => {
    sheets.remove();
    style.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };
  // Smaller pages need fewer pixels for the same sharpness on paper.
  const scale = PRINT_DPI / POINTS_PER_INCH / Math.max(layout.cols, layout.rows);

  try {
    // One canvas for all pages: a page at 300 dpi takes tens of megabytes.
    const canvas = document.createElement("canvas");
    let sheet: HTMLDivElement | null = null;
    for (const [i, n] of pages.entries()) {
      if (i % pagesPerSide === 0) {
        sheet = document.createElement("div");
        sheet.className = pagesPerSide > 1 ? "sheet multi" : "sheet";
        sheet.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
        sheet.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`;
        sheets.append(sheet);
      }
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d")!;
      // Transparent areas would print as they are; paper is white.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error(`page ${n} could not be rendered`);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const cell = document.createElement("div");
      cell.className = "cell";
      const img = document.createElement("img");
      img.src = url;
      cell.append(img);
      sheet!.append(cell);
      onProgress(i + 1);
    }
    canvas.width = canvas.height = 0;

    document.head.append(style);
    document.body.append(sheets);
    // Printed only once every image is decoded, or sheets would come out blank.
    await Promise.all([...sheets.querySelectorAll("img")].map((img) => img.decode()));
    return remove;
  } catch (err) {
    remove();
    throw err;
  }
}
