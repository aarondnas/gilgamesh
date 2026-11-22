import { describe, expect, it } from "vitest";
import type { TreeEntry } from "$lib/api";
import { fileName, isWithin, joinPath, normalizePath, parentDir, relativePath, resolveInclude, treeFiles, treeFolders } from "./paths";

const file = (path: string): TreeEntry => ({ path, name: fileName(path), isDir: false, children: [] }) as unknown as TreeEntry;
const dir = (path: string, children: TreeEntry[]): TreeEntry =>
  ({ path, name: fileName(path), isDir: true, children }) as unknown as TreeEntry;

describe("project paths", () => {
  it("splits a path into folder and name", () => {
    expect(fileName("chapters/intro.tex")).toBe("intro.tex");
    expect(fileName("main.tex")).toBe("main.tex");
    expect(parentDir("chapters/part/intro.tex")).toBe("chapters/part");
    expect(parentDir("main.tex")).toBe("");
    expect(joinPath("", "main.tex")).toBe("main.tex");
    expect(joinPath("chapters", "intro.tex")).toBe("chapters/intro.tex");
  });

  it("knows what lies inside a folder", () => {
    expect(isWithin("chapters/intro.tex", "chapters")).toBe(true);
    expect(isWithin("chapters", "chapters")).toBe(true);
    expect(isWithin("chapters2/intro.tex", "chapters")).toBe(false);
  });

  it("normalizes and refuses to leave the project", () => {
    expect(normalizePath("./chapters/../images\\logo.png")).toBe("images/logo.png");
    expect(normalizePath("chapters//intro.tex")).toBe("chapters/intro.tex");
    expect(normalizePath("../secret")).toBeNull();
    expect(normalizePath("a/../../b")).toBeNull();
  });

  it("writes paths relative to the folder TeX resolves against", () => {
    expect(relativePath("chapters", "images/logo.png")).toBe("../images/logo.png");
    expect(relativePath("", "images/logo.png")).toBe("images/logo.png");
    expect(relativePath("chapters", "chapters/intro.tex")).toBe("intro.tex");
    expect(relativePath("a/b", "a/c/d.tex")).toBe("../c/d.tex");
  });

  it("resolves \\input paths like LaTeX, adding .tex", () => {
    expect(resolveInclude("", "chapters/intro")).toBe("chapters/intro.tex");
    expect(resolveInclude("thesis", "../shared/defs.sty")).toBe("shared/defs.sty");
    expect(resolveInclude("thesis", "./intro")).toBe("thesis/intro.tex");
  });

  it("walks the tree", () => {
    const tree = [
      dir("chapters", [file("chapters/a.tex"), dir("chapters/sub", [file("chapters/sub/b.tex")])]),
      file("main.tex"),
      file("logo.png"),
    ];
    expect(treeFiles(tree)).toEqual(["chapters/a.tex", "chapters/sub/b.tex", "main.tex", "logo.png"]);
    expect(treeFiles(tree, (p) => p.endsWith(".tex"))).toEqual(["chapters/a.tex", "chapters/sub/b.tex", "main.tex"]);
    expect(treeFolders(tree)).toEqual(["", "chapters", "chapters/sub"]);
  });
});
