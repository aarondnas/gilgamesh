// Applying what the LaTeX modules return, for the tests.
import type { FormatEdit } from "$lib/latex/format";
import type { TextEdit } from "$lib/latex/syntax";

/** `text` after `edit`, and the text it selects afterwards. */
export function applyFormat(text: string, edit: FormatEdit): { text: string; selected: string } {
  const result = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const start = edit.from + Math.min(edit.select.anchor, edit.select.head);
  const end = edit.from + Math.max(edit.select.anchor, edit.select.head);
  return { text: result, selected: result.slice(start, end) };
}

/** `text` after `edits`, applied in the order given (the modules return them last first). */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  return edits.reduce((result, edit) => result.slice(0, edit.from) + edit.insert + result.slice(edit.to), text);
}

/** `text` with `edits` sorted last first, for modules that do not sort them. */
export function applySorted(text: string, edits: readonly TextEdit[]): string {
  return applyEdits(
    text,
    [...edits].sort((a, b) => b.from - a.from),
  );
}

/** The offsets of the first `marker` in `text`: where it starts and ends. */
export function rangeOf(text: string, marker: string): { from: number; to: number } {
  const from = text.indexOf(marker);
  if (from < 0) throw new Error(`${marker} not in the text`);
  return { from, to: from + marker.length };
}
