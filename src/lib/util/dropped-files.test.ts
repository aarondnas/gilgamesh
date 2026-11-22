import { describe, expect, it } from "vitest";
import { carriesFiles, droppedFiles } from "./dropped-files";

/** A file system entry as the browser hands it over, from a nested description. */
type Tree = { [name: string]: string | Tree };

function entry(name: string, content: string | Tree): FileSystemEntry {
  if (typeof content === "string") {
    const file = { name, content } as unknown as File;
    return { name, isFile: true, isDirectory: false, file: (resolve: (f: File) => void) => resolve(file) } as unknown as FileSystemEntry;
  }
  // readEntries hands out the folder once, then an empty batch.
  let read = false;
  const reader = {
    readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
      resolve(read ? [] : Object.entries(content).map(([child, value]) => entry(child, value)));
      read = true;
    },
  };
  return { name, isFile: false, isDirectory: true, createReader: () => reader } as unknown as FileSystemEntry;
}

const transfer = (tree: Tree) =>
  ({ items: Object.entries(tree).map(([name, value]) => ({ webkitGetAsEntry: () => entry(name, value) })) }) as unknown as DataTransfer;

describe("dropped files", () => {
  it("knows a drag of files from outside", () => {
    expect(carriesFiles({ dataTransfer: { types: ["Files"] } } as unknown as DragEvent)).toBe(true);
    expect(carriesFiles({ dataTransfer: { types: ["text/plain"] } } as unknown as DragEvent)).toBe(false);
    expect(carriesFiles({ dataTransfer: null } as unknown as DragEvent)).toBe(false);
  });

  it("walks dropped folders, hidden entries left out", async () => {
    const files = await droppedFiles(
      transfer({ "logo.png": "png", images: { "a.jpg": "a", ".DS_Store": "x", sub: { "b.png": "b" } }, ".git": {} }),
    );
    expect(files.map((f) => f.path)).toEqual(["logo.png", "images/a.jpg", "images/sub/b.png"]);
    expect(files[0].file.name).toBe("logo.png");
  });
});
