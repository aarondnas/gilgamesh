// A small picture of a PDF's first page, e.g. for a gallery of the project's images.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * The first page of `data` as a PNG whose shorter side is `size` pixels, so a
 * square cut from its middle is sharp.
 */
export async function pdfThumbnail(data: ArrayBuffer, size: number): Promise<Blob> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: size / Math.min(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // On white, as printed: pdf.js fills the background itself.
    await page.render({ canvas, viewport }).promise;
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no thumbnail"))), "image/png"),
    );
  } finally {
    void task.destroy();
  }
}
