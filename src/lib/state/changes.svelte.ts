// Changes the app makes away from where the user works: a package loaded in
// the main file's preamble, the page margins, the whole document's
// alignment, a step undone in a file not shown. The editor stays where it
// is; instead, the explorer lets the place light up for a moment: the file
// in the file view, the section in the outline.

import type { ProjectScan } from "$lib/api";

/** How long a place shows as just changed; matches the explorer's animation (see `review.touch`). */
const GLOW_MS = 1400;

export interface ChangeMark {
  file: string;
  /** 1-based line where the change starts. */
  line: number;
}

class Changes {
  /** Places changed a moment ago, newest last. */
  marks = $state.raw<readonly ChangeMark[]>([]);
  /** The files of `marks`. */
  readonly files: ReadonlySet<string> = $derived(new Set(this.marks.map((mark) => mark.file)));

  /** `file` was just changed at offset `at` of `text` (its text after the change). */
  mark(file: string, text: string, at: number) {
    const mark: ChangeMark = { file, line: text.slice(0, at).split("\n").length };
    this.marks = [...this.marks.filter((m) => m.file !== file || m.line !== mark.line), mark];
    setTimeout(() => (this.marks = this.marks.filter((m) => m !== mark)), GLOW_MS);
  }
}

export const changes = new Changes();

/**
 * The headings of `scan.outline` whose sections hold `marks`: the last
 * heading before the change in its file, or else before the line that reads
 * the file in. A change before every heading (the preamble, the start of the
 * body) concerns the whole document: then every heading of the top level.
 */
export function sectionsChanged(scan: ProjectScan, marks: readonly ChangeMark[]): Set<number> {
  const { outline, inclusions } = scan;
  const top = Math.min(...outline.map((h) => h.level));
  const sections = new Set<number>();
  for (const mark of marks) {
    let { file, line } = mark;
    let found = -1;
    // Up through the files that read this one in; a loop in them ends with the depth.
    for (let depth = 0; found < 0 && depth < 20; depth++) {
      outline.forEach((h, i) => {
        if (h.file === file && h.line <= line) found = i;
      });
      const inclusion = inclusions.find((inc) => inc.file === file);
      if (found >= 0 || !inclusion) break;
      ({ parent: file, line } = inclusion);
    }
    if (found >= 0) sections.add(found);
    else outline.forEach((h, i) => h.level === top && sections.add(i));
  }
  return sections;
}
