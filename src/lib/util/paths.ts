// Paths inside a project: relative to its root, with `/` separators, as the
// backend reports them (see `TreeEntry`).
import type { TreeEntry } from "$lib/api";

/** `chapters/intro.tex` → `intro.tex`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `chapters/intro.tex` → `chapters`; "" for the project folder itself. */
export function parentDir(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** Whether `path` is `entry` itself or lies inside the folder `entry`. */
export function isWithin(path: string, entry: string): boolean {
  return path === entry || path.startsWith(`${entry}/`);
}

/** Resolves `.` and `..` segments and `\` separators; `null` if the path leaves the project. */
export function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.pop()) return null;
    } else parts.push(part);
  }
  return parts.join("/");
}

/** `path` as seen from the folder `base`, which TeX resolves against: `../images/logo.png`. */
export function relativePath(base: string, path: string): string {
  const from = base ? base.split("/") : [];
  const to = path.split("/");
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...Array<string>(from.length - same).fill(".."), ...to.slice(same)].join("/");
}

/** A path from `\input`/`\include` in the main file's folder `base` as project path; `.tex` added like LaTeX does. */
export function resolveInclude(base: string, path: string): string {
  const parts = base ? base.split("/") : [];
  for (const part of path.trim().split(/[\\/]/)) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  const joined = parts.join("/");
  return /\.[^/]+$/.test(joined) ? joined : `${joined}.tex`;
}

/** The files of a project tree, in tree order; only those `keep` accepts. */
export function treeFiles(entries: TreeEntry[], keep: (path: string) => boolean = () => true): string[] {
  return entries.flatMap((e) => (e.isDir ? treeFiles(e.children, keep) : keep(e.path) ? [e.path] : []));
}

/** The folders of a project tree, sorted, with "" for the project folder itself first. */
export function treeFolders(entries: TreeEntry[]): string[] {
  const folders = (list: TreeEntry[]): string[] => list.flatMap((e) => (e.isDir ? [e.path, ...folders(e.children)] : []));
  return ["", ...folders(entries).sort((a, b) => a.localeCompare(b))];
}
