// The LaTeX behind the ribbon's image button: a figure at the cursor; graphicx
// goes into the preamble through preamble.ts.

import { fileName } from "$lib/util/paths";
import { labelFrom, placementOf } from "./preamble";

/** Formats pdfLaTeX and LuaLaTeX include directly (`eps` through epstopdf). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "pdf", "eps"] as const;

export function isImage(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/** Folder names that hold a project's images, by convention; the first one present is suggested. */
export const IMAGE_FOLDERS = ["bilder", "images", "img", "figures", "abbildungen", "grafiken", "assets/images", "assets"];

export interface Figure {
  /** As `\includegraphics` finds it: relative to the main file's folder. */
  image: string;
  caption: string;
  label: string;
  /** Share of the text width, e.g. 0.8. */
  width: number;
}

/** The figure environment for `figure`, indented like the line it goes into. */
export function figureCode(figure: Figure, mainSource: string, indent = ""): string {
  const width = Number.isInteger(figure.width) ? "\\textwidth" : `${figure.width}\\textwidth`;
  const lines = [`\\begin{figure}[${placementOf(mainSource)}]`, "  \\centering", `  \\includegraphics[width=${width}]{${figure.image}}`];
  if (figure.caption.trim()) lines.push(`  \\caption{${figure.caption.trim()}}`);
  if (figure.label.trim()) lines.push(`  \\label{${figure.label.trim()}}`);
  lines.push("\\end{figure}");
  return lines.map((line, i) => (i === 0 ? line : indent + line)).join("\n");
}

/**
 * `University logo` for `images/University_logo.png`: a caption to start from. Underscores
 * read as spaces; LaTeX's other special characters are escaped, so it compiles.
 */
export function captionFor(image: string): string {
  return fileName(image)
    .replace(/\.[^.]+$/, "")
    .replace(/[_~]+/g, " ")
    .replace(/\^/g, "")
    .replace(/[&%$#{}]/g, (c) => `\\${c}`)
    .trim();
}

/** `fig:university-logo` for `images/University logo.png`: what cross references use. */
export function labelFor(image: string): string {
  const name = fileName(image).replace(/\.[^.]+$/, "");
  return labelFrom("fig", name, "image");
}
