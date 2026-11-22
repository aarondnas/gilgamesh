// Files and folders dragged in from the system's file manager.

export interface DroppedFile {
  /** Relative to the drop: `logo.png`, or `bilder/logo.png` inside a dropped folder. */
  path: string;
  file: File;
}

/** Whether a drag carries files from outside the app. */
export function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * All files of a drop, with dropped folders walked recursively. Hidden
 * entries (`.git`, `.DS_Store`, …) are left out.
 */
export function droppedFiles(data: DataTransfer): Promise<DroppedFile[]> {
  // The entries are only readable during the drop event itself, so collect them before any await.
  const entries = [...data.items].map((item) => item.webkitGetAsEntry()).filter((e) => e !== null);
  return collect(entries);
}

async function collect(entries: FileSystemEntry[]): Promise<DroppedFile[]> {
  const result: DroppedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string) => {
    if (entry.name.startsWith(".")) return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      result.push({ path, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns the folder in batches until an empty one.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return result;
}
