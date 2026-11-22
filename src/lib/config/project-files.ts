// The file types of a project: which the explorer shows, which open in the
// editor, and which are viewed instead; and the names files and folders may have.

import { m } from "$lib/paraglide/messages";
import { fileName } from "$lib/util/paths";

/**
 * Which files the project explorer shows. Anything not listed here, such as
 * `gilgamesh.json` or leftovers from other tools, stays hidden. Folders are
 * always shown, hidden entries (`.git`, …) never.
 *
 * Extensions are lowercase and without the dot.
 */
export const PROJECT_FILES = {
  /**
   * Opened in the editor: what LaTeX reads as text. Must match
   * `TEXT_EXTENSIONS` in `watch.rs`, which reviews changes from outside.
   */
  editable: [
    "tex",
    "bib",
    "sty",
    "cls",
    // TikZ pictures, package and class parts, LaTeX files of other kinds.
    "tikz",
    "pgf",
    "def",
    "cfg",
    "clo",
    "ltx",
    // Bibliography styles: BibTeX's, and biblatex's (bibliography, citation, language, data model).
    "bst",
    "bbx",
    "cbx",
    "lbx",
    "dbx",
    // Index styles (makeindex, xindy), LuaLaTeX code.
    "ist",
    "xdy",
    "lua",
    // Data for pgfplots or csvsimple, notes.
    "csv",
    "dat",
    "tsv",
    "txt",
    "md",
    "markdown",
  ],
  /** Shown in a tab of their own, as they are; not edited. */
  viewable: ["png", "jpg", "jpeg", "svg", "pdf", "eps"],
} as const;

export type FileKind = keyof typeof PROJECT_FILES;

const listed = (extensions: readonly string[]) => extensions.map((e) => `.${e}`).join(", ");

/** Every extension the explorer shows, with the dot, for messages. */
export const VISIBLE_EXTENSIONS = listed(Object.values(PROJECT_FILES).flat());

/** The extensions of files the editor opens, with the dot, for messages. */
export const EDITABLE_EXTENSIONS = listed(PROJECT_FILES.editable);

/** A file's extension, lowercase and without the dot; "" without one. */
export function extensionOf(path: string): string {
  const name = fileName(path);
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

/** The kind of a project file, or `null` if it is hidden. */
export function fileKind(path: string): FileKind | null {
  const ext = extensionOf(path);
  for (const kind of Object.keys(PROJECT_FILES) as FileKind[]) {
    if ((PROJECT_FILES[kind] as readonly string[]).includes(ext)) return kind;
  }
  return null;
}

/** How the editor highlights a file: as LaTeX, as Lua, or not at all (data, notes, BibTeX styles). */
export type TextSyntax = "latex" | "lua" | "plain";

const LATEX_SYNTAX = new Set(["tex", "bib", "sty", "cls", "tikz", "pgf", "def", "cfg", "clo", "ltx", "bbx", "cbx", "lbx", "dbx"]);

export function syntaxOf(path: string): TextSyntax {
  const ext = extensionOf(path);
  return LATEX_SYNTAX.has(ext) ? "latex" : ext === "lua" ? "lua" : "plain";
}

/** Whether a file opens in a tab: in the editor, or shown as an image. */
export function opensInTab(path: string): boolean {
  const kind = fileKind(path);
  return kind === "editable" || kind === "viewable";
}

/**
 * Checks a file or folder name typed by the user. Files without an extension
 * get `.tex` appended; other types are refused, since the explorer would hide them.
 */
export function validateName(input: string, kind: "file" | "folder"): string {
  const name = input.trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name)) {
    throw new Error(m.error_invalid_name({ name: input }));
  }
  if (kind === "folder") return name;
  const file = name.includes(".") ? name : `${name}.tex`;
  if (fileKind(file) !== "editable") throw new Error(m.error_file_type({ extensions: EDITABLE_EXTENSIONS }));
  return file;
}

/**
 * Checks a new name for an existing entry. A file name without extension
 * keeps the old one, and the result must stay a type the explorer shows,
 * otherwise the file would seem to vanish.
 */
export function validateRename(path: string, input: string, folder: boolean): string {
  const name = validateName(input, "folder");
  if (folder) return name;
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  const file = name.includes(".") ? name : `${name}${extension}`;
  if (fileKind(file) === null) throw new Error(m.error_file_type({ extensions: VISIBLE_EXTENSIONS }));
  return file;
}
