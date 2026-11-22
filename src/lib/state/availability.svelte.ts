// Whether a function of the ribbon can act now. Each names what it needs,
// and is greyed out while any of it is missing: a function that acts at the
// cursor needs one in the editor, which a file just switched to has not
// (see `formatting.cursor`). New functions get an entry in `NEEDS` and ask `available`.

import { formatting } from "./formatting.svelte";
import { project } from "./project.svelte";

/** What a function can need. */
export type Need =
  /** A project is open. */
  | "project"
  /** It has a main file. */
  | "main"
  /** The editor shows a file. */
  | "file"
  /** The editor shows a `.tex` file. */
  | "texFile"
  /** The user has put the cursor into the shown file. */
  | "cursor";

const HAS: Record<Need, () => boolean> = {
  project: () => project.root !== null,
  main: () => Boolean(project.config.main),
  file: () => project.file !== null,
  texFile: () => Boolean(project.file?.toLowerCase().endsWith(".tex")),
  cursor: () => formatting.cursor !== null && formatting.cursor.file === project.file,
};

/** The functions that ask, and what each needs. */
const NEEDS = {
  "align.paragraph": ["texFile", "cursor"],
  "align.section": ["texFile", "cursor"],
  "align.document": ["main"],
  "format.word": ["file"],
  "format.paragraph": ["texFile", "cursor"],
  "format.section": ["texFile", "cursor"],
  "format.document": ["main"],
} as const satisfies Record<string, readonly Need[]>;

export type Feature = keyof typeof NEEDS;

/** Whether `feature` can act now; reactive where read in a component. */
export function available(feature: Feature): boolean {
  return NEEDS[feature].every((need) => HAS[need]());
}
