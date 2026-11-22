// The TeX distribution, its packages, and building (src-tauri/src/commands/tex.rs).
import { invoke } from "@tauri-apps/api/core";
import { localize } from "./localize";

export type Bundle = "TinyTeX-1" | "TinyTeX";
export type Engine = "lualatex" | "xelatex" | "pdflatex";

export interface Manifest {
  version: string;
  bundle: Bundle;
  installedAt: number;
}

export interface TexStatus {
  installed: boolean;
  root: string;
  userDir: string;
  manifest: Manifest | null;
}

export interface Package {
  name: string;
  installed: boolean;
  description: string;
}

export type FontKind = "serif" | "sans" | "mono" | "math" | "other";

/** A font family of the repository (src-tauri/src/tex/fonts.rs). */
export interface FontFamily {
  /** `package/Stem`, unique. */
  id: string;
  package: string;
  name: string;
  kind: FontKind;
  /** Its faces, relative to `texmf-dist` (`fonts/opentype/public/…`); the regular one always. */
  regular: string;
  italic: string | null;
  bold: string | null;
  boldItalic: string | null;
  /** How many faces it has in all. */
  faces: number;
  /** The LaTeX package that sets it under pdfLaTeX; `null` where only XeLaTeX and LuaLaTeX can use it. */
  sty: string | null;
  description: string;
  license: string;
  /** The download size of its package in bytes. */
  size: number;
  installed: boolean;
}

export interface InstallProgress {
  /** `restore`: after a new TeX Live year, the packages of the old installation go in again. */
  phase: "download" | "extract" | "configure" | "essentials" | "restore" | "done";
  received: number;
  total: number | null;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number | null;
  file: string | null;
}

/** An edited file not saved yet, which the build reads instead of the one on disk. */
export interface UnsavedFile {
  /** Relative to the main file's folder. */
  path: string;
  text: string;
}

export interface CompileResult {
  status: "success" | "failed" | "cancelled";
  pdfPath: string | null;
  diagnostics: Diagnostic[];
  /** Provided by a TeX Live package; can be installed. */
  missingFiles: string[];
  /** Provided by no package, so the project lacks it (wrong path, deleted file). */
  missingProjectFiles: string[];
  durationMs: number;
  runs: number;
}

/** An entry of the table of contents as the last build set it: number and page as the PDF prints them. */
export interface ContentsEntry {
  level: string;
  number: string | null;
  /** As LaTeX wrote it, commands and all. */
  title: string;
  page: string;
}

/** A source line; `file` is "" for the main file, else the path TeX recorded. */
export interface SourceLocation {
  file: string;
  line: number;
}

/** A line's box on a page, in PDF points from the page's top-left corner. */
export interface PdfLocation {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WordCount {
  /** Text, headings and captions together. */
  total: number;
  text: number;
  headers: number;
  captions: number;
  /** Per chapter (or section), in reading order; the first is what comes before the first, with an empty title. */
  parts: { title: string; words: number }[];
}

export const texApi = {
  texStatus: () => invoke<TexStatus>("tex_status"),
  texInstall: (bundle: Bundle) => invoke<Manifest>("tex_install", { bundle }),
  texUninstall: () => invoke<void>("tex_uninstall"),
  openUserTexmf: () => invoke<void>("open_user_texmf"),
  /** The font families installed on the system, which XeLaTeX and LuaLaTeX can use (fontspec). */
  systemFonts: () => invoke<string[]>("system_fonts"),
  /** A font file of the distribution (`lm/lmroman10-regular.otf`), to show the font in the font list. */
  texFont: (file: string) => invoke<ArrayBuffer>("tex_font", { file }),
  /** Every font family of the repository, for the font manager. */
  fontFamilies: () => invoke<FontFamily[]>("font_families"),
  /**
   * A face of a family (`face` as `fontFamilies` names it). A package not installed yet is fetched
   * for it only with `fetch`; without, a face neither installed nor fetched before comes back empty.
   */
  fontFace: (pkg: string, face: string, fetch: boolean) => invoke<ArrayBuffer>("font_face", { package: pkg, face, fetch }),
  /** The server previews of fonts not installed come from (`tlnet.yihui.org`). */
  fontPreviewHost: () => invoke<string>("font_preview_host"),

  packagesList: (remote: boolean) => invoke<Package[]>("packages_list", { remote }),
  packagesInstall: (names: string[]) => invoke<void>("packages_install", { names }),
  packagesRemove: (names: string[]) => invoke<void>("packages_remove", { names }),
  /** `true` if a new TeX Live year had TinyTeX installed anew, with the same packages. */
  packagesUpdateAll: () => invoke<boolean>("packages_update_all"),
  packagesForFile: (file: string) => invoke<string[]>("packages_for_file", { file }),

  /**
   * `includeOnly` compiles a single `\include`d file (path without `.tex`, relative to the main file).
   * The app's own messages among the diagnostics come in the user's language (see `localize`).
   */
  compile: async (
    source: string,
    filePath: string | null,
    engine: Engine,
    pdfStandard: string | null = null,
    includeOnly: string | null = null,
    unsaved: UnsavedFile[] = [],
  ) => {
    const result = await invoke<CompileResult>("compile", { request: { source, filePath, engine, pdfStandard, includeOnly, unsaved } });
    return { ...result, diagnostics: result.diagnostics.map((d) => ({ ...d, message: localize(d.message) })) };
  },
  readBuildFile: (path: string) => invoke<ArrayBuffer>("read_build_file", { path }),
  /** An EPS figure of the project as PDF; installs `epstopdf` where it is missing. */
  epsToPdf: (root: string, path: string) => invoke<ArrayBuffer>("eps_to_pdf", { root, path }),
  /** The table of contents of the build that made `pdfPath` (see `contents.rs`). */
  buildContents: (pdfPath: string) => invoke<ContentsEntry[]>("build_contents", { pdfPath }),
  synctexEdit: (pdfPath: string, page: number, x: number, y: number) =>
    invoke<SourceLocation | null>("synctex_edit", { pdfPath, page, x, y }),
  /** `file` is an absolute path, or `null` for the main file. */
  synctexView: (pdfPath: string, file: string | null, line: number) => invoke<PdfLocation | null>("synctex_view", { pdfPath, file, line }),
  /** `by`: "chapter" or "section", the parts the count is split into; `null` if texcount is not installed. */
  wordCount: (main: string, by: "chapter" | "section") => invoke<WordCount | null>("word_count", { main, by }),
};
