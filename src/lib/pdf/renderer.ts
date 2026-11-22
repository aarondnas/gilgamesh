// Framework-independent PDF rendering with pdf.js.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { PdfLocation } from "$lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_GAP = 16;
export const MIN_PDF_ZOOM = 0.25;
export const MAX_PDF_ZOOM = 4;
const HIGHLIGHT_MS = 1500;
/** How long zooming must pause before the pages are drawn sharp at the new size. */
const ZOOM_SETTLE_MS = 150;

interface RenderedPage {
  canvas: HTMLCanvasElement;
  /** CSS pixels per PDF point. */
  scale: number;
  /** The page's links, in points from its top-left corner. */
  links: PageLink[];
}

/** A web address, or a destination in the document (hyperref's `
ef`, the table of contents). */
export type LinkTarget = { url: string } | { dest: unknown };

interface PageLink {
  left: number;
  top: number;
  right: number;
  bottom: number;
  target: LinkTarget;
}

/**
 * Renders every page of a PDF into `container`. At 100 % a whole page fits
 * it, as wide as it is or as tall, whichever is reached first: the docked
 * preview is made exactly as wide as a page needs, a detached window may have
 * any shape.
 * New documents are rendered off-screen and swapped in, so the preview does
 * not flicker and keeps its scroll position while the user types.
 */
export class PdfRenderer {
  #container: HTMLElement;
  #task: PDFDocumentLoadingTask | null = null;
  #doc: PDFDocumentProxy | null = null;
  #zoom = 1;
  #generation = 0;
  #pages: RenderedPage[] = [];
  #pageAspect = 210 / 297;
  /** Size the shown pages were drawn for. */
  #renderedFor = "";
  /** A render was skipped while the container was hidden. */
  #stale = false;
  /** The shown pages' element, and the zoom they were drawn at. */
  #pagesEl: HTMLElement | null = null;
  #drawnZoom = 1;
  /** While zooming around a point: that point on its page (PDF points). */
  #anchor: { page: number; x: number; y: number } | null = null;
  #commitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(container: HTMLElement) {
    this.#container = container;
  }

  get zoom() {
    return this.#zoom;
  }

  /** Width / height of the first page; A4 until a document is loaded. */
  get pageAspect() {
    return this.#pageAspect;
  }

  /**
   * Shows a new document. `beforeRender` runs once its page shape is known
   * (`pageAspect`) and before anything is drawn, e.g. to size the pane for
   * it: drawn first, the pages would be drawn again at the new size.
   */
  async load(data: ArrayBuffer, beforeRender?: () => Promise<void>) {
    const task = pdfjs.getDocument({ data });
    const doc = await task.promise;
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    this.#pageAspect = first.width / first.height;
    const previous = this.#task;
    this.#task = task;
    this.#doc = doc;
    await beforeRender?.();
    await this.render();
    void previous?.destroy();
  }

  async setZoom(zoom: number) {
    this.#zoom = Math.min(Math.max(zoom, MIN_PDF_ZOOM), MAX_PDF_ZOOM);
    await this.render();
  }

  /**
   * Zooms around a point on screen, e.g. the pointer, which keeps what lies
   * under it there. The pages are scaled at once, so a pinch or quick wheel
   * steps follow the fingers, and drawn sharp once the zooming pauses.
   */
  zoomAround(zoom: number, clientX: number, clientY: number) {
    this.#zoom = Math.min(Math.max(zoom, MIN_PDF_ZOOM), MAX_PDF_ZOOM);
    this.#anchor ??= this.#pointNear(clientX, clientY);
    this.#preview();
    clearTimeout(this.#commitTimer);
    this.#commitTimer = setTimeout(() => void this.render(), ZOOM_SETTLE_MS);
  }

  /** Scales the drawn pages to the current zoom around the anchor, until they are drawn anew. */
  #preview() {
    const pages = this.#pagesEl;
    const anchor = this.#anchor;
    const page = anchor && this.#pages[anchor.page - 1];
    if (!pages || !anchor || !page) return;
    const factor = this.#zoom / this.#drawnZoom;
    // The anchor in the pages' own layout, which a transform leaves as it is.
    pages.style.transformOrigin = `${page.canvas.offsetLeft + anchor.x * page.scale}px ${page.canvas.offsetTop + anchor.y * page.scale}px`;
    pages.style.transform = factor === 1 ? "" : `scale(${factor})`;
  }

  /** The point under a screen point on the page at that height, also beside it or in the gap below it. */
  #pointNear(clientX: number, clientY: number): { page: number; x: number; y: number } | null {
    for (const [i, { canvas, scale }] of this.#pages.entries()) {
      const rect = canvas.getBoundingClientRect();
      if (clientY <= rect.bottom + PAGE_GAP / 2 || i === this.#pages.length - 1) {
        return { page: i + 1, x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
      }
    }
    return null;
  }

  /** After the container changed size; skips the work when its width stayed the same. */
  async resize() {
    const { width, height } = this.#available();
    if (this.#stale || `${width}x${height}` !== this.#renderedFor) await this.render();
  }

  /** The room inside the container's padding. */
  #available() {
    const style = getComputedStyle(this.#container);
    const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    return {
      width: Math.max(this.#container.clientWidth - horizontal, 100),
      height: Math.max(this.#container.clientHeight - vertical, 100),
    };
  }

  /** Re-renders at the current container width (after resize or zoom). */
  async render() {
    const doc = this.#doc;
    if (!doc) return;
    // A hidden container (e.g. while the settings are open) has no width: rendering
    // then would draw thumbnails that flash up when it is shown again. The old pages
    // stay, and `resize` catches up once the container is visible.
    if (this.#container.clientWidth === 0) {
      this.#stale = true;
      return;
    }
    const generation = ++this.#generation;
    clearTimeout(this.#commitTimer);
    const zoom = this.#zoom;
    const available = this.#available();
    // The preview may be shown in a detached window with a screen of its own.
    const ratio = this.#container.ownerDocument.defaultView?.devicePixelRatio || 1;

    // Pages are drawn off-screen in this page's own document, even for a
    // detached window: pdf.js loads the PDF's fonts into `document.fonts`, and
    // a canvas looks fonts up in its own document. Drawn elsewhere, every
    // glyph would be missing. Moved into the window afterwards, the pixels stay.

    const pages = document.createElement("div");
    // As wide as the widest page at least: zoomed in, the pages reach out of the
    // view on both sides and must be scrollable to on both.
    pages.style.cssText = `position:relative;display:flex;flex-direction:column;align-items:center;gap:${PAGE_GAP}px;min-width:100%;width:max-content`;
    const rendered: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (generation !== this.#generation) return;
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(available.width / base.width, available.height / base.height);
      const viewport = page.getViewport({ scale: fit * zoom });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.className = "pdf-page";
      await page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      const links = await linksOf(page, base);
      if (generation !== this.#generation) return;
      pages.append(canvas);
      rendered.push({ canvas, scale: viewport.scale, links });
    }

    // Zoomed around a point: where it shows now, scaled and perhaps scrolled since the zooming began.
    const anchor = this.#anchor;
    const shown = anchor && this.#pages[anchor.page - 1];
    let anchorAt: { x: number; y: number } | null = null;
    if (anchor && shown && shown.canvas.offsetWidth) {
      const rect = shown.canvas.getBoundingClientRect();
      const scale = shown.scale * (rect.width / shown.canvas.offsetWidth);
      anchorAt = { x: rect.left + anchor.x * scale, y: rect.top + anchor.y * scale };
    }

    const { scrollTop, scrollLeft } = this.#container;
    this.#container.replaceChildren(pages);
    this.#pages = rendered;
    this.#pagesEl = pages;
    this.#drawnZoom = zoom;
    this.#renderedFor = `${available.width}x${available.height}`;
    this.#stale = false;
    this.#container.scrollTop = scrollTop;
    this.#container.scrollLeft = scrollLeft;

    // The point stays where it showed, so the sharp pages replace the scaled ones without a jump.
    const page = anchor && rendered[anchor.page - 1];
    if (anchor && page && anchorAt) {
      const rect = page.canvas.getBoundingClientRect();
      this.#container.scrollLeft += rect.left + anchor.x * page.scale - anchorAt.x;
      this.#container.scrollTop += rect.top + anchor.y * page.scale - anchorAt.y;
    }
    // Still zooming while these pages were drawn: they follow on until the next drawing.
    if (this.#zoom !== zoom) this.#preview();
    else this.#anchor = null;
  }

  /** The page and PDF position (points from its top-left corner) under a screen point. */
  locate(clientX: number, clientY: number): { page: number; x: number; y: number } | null {
    for (const [i, { canvas, scale }] of this.#pages.entries()) {
      const rect = canvas.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { page: i + 1, x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
      }
    }
    return null;
  }

  /** The link under a screen point, `null` where there is none. */
  linkAt(clientX: number, clientY: number): LinkTarget | null {
    const at = this.locate(clientX, clientY);
    const page = at && this.#pages[at.page - 1];
    if (!at || !page) return null;
    const link = page.links.find((l) => at.x >= l.left && at.x <= l.right && at.y >= l.top && at.y <= l.bottom);
    return link?.target ?? null;
  }

  /** Scrolls to a destination of the document, as a link names it. */
  async goTo(dest: unknown) {
    const doc = this.#doc;
    if (!doc) return;
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return;
    const [ref, kind, ...args] = explicit as [unknown, { name?: string } | undefined, ...(number | null)[]];
    const index = typeof ref === "number" ? ref : await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    const target = this.#pages[index];
    if (!target) return;
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    // XYZ names a point (left, top); FitH and FitBH a height; the other kinds the whole page.
    const top = kind?.name === "XYZ" ? args[1] : kind?.name === "FitH" || kind?.name === "FitBH" ? args[0] : null;
    const y = typeof top === "number" ? base.convertToViewportPoint(0, top)[1] : 0;
    const container = this.#container;
    const offset = target.canvas.getBoundingClientRect().top - container.getBoundingClientRect().top;
    // A little room above the target, so a heading does not stick to the edge.
    container.scrollTo({ top: container.scrollTop + offset + y * target.scale - 24, behavior: "smooth" });
  }

  /** Scrolls to a location and flashes a highlight over it. */
  reveal(at: PdfLocation) {
    const target = this.#pages[at.page - 1];
    if (!target) return;
    const { canvas, scale } = target;
    const container = this.#container;
    const offset = canvas.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: container.scrollTop + offset + at.y * scale - container.clientHeight / 3, behavior: "smooth" });

    const mark = container.ownerDocument.createElement("div");
    mark.className = "sync-highlight";
    mark.style.left = `${canvas.offsetLeft + at.x * scale - 3}px`;
    mark.style.top = `${canvas.offsetTop + at.y * scale - 3}px`;
    mark.style.width = `${Math.max(at.width * scale, 48) + 6}px`;
    mark.style.height = `${at.height * scale + 6}px`;
    canvas.parentElement?.append(mark);
    setTimeout(() => mark.remove(), HIGHLIGHT_MS);
  }

  destroy() {
    this.#generation++;
    void this.#task?.destroy();
    this.#task = null;
    this.#doc = null;
  }
}

/** The link annotations of `page`, converted to points from its top-left corner by `base` (scale 1). */
async function linksOf(
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
  base: ReturnType<typeof page.getViewport>,
): Promise<PageLink[]> {
  const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
  const links: PageLink[] = [];
  for (const a of annotations) {
    if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
    const target: LinkTarget | null = typeof a.url === "string" ? { url: a.url } : a.dest ? { dest: a.dest } : null;
    if (!target) continue;
    const [x1, y1] = base.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
    const [x2, y2] = base.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
    links.push({ left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2), target });
  }
  return links;
}
