// Finding text in all of the project's text files, and replacing it, for the
// project search: plain text or a regular expression, whole words, case.

import { escapeRegExp } from "./regex";

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchHit {
  file: string;
  /** From 1. */
  line: number;
  /** In the file's text. */
  from: number;
  to: number;
  /** The line, and where the hit is in it. */
  text: string;
  start: number;
  end: number;
}

/** How many hits a search shows at most. */
export const MAX_HITS = 1000;

/** The pattern for `options`; `null` for an empty query, an `Error` for a regular expression that is none. */
export function patternOf(options: SearchOptions): RegExp | Error | null {
  if (!options.query) return null;
  let source = options.regex ? options.query : escapeRegExp(options.query);
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${options.caseSensitive ? "" : "i"}`);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/** The hits of `pattern` in `text`, line by line (a hit does not reach over a line's end). */
export function hitsIn(file: string, text: string, pattern: RegExp, limit = MAX_HITS): SearchHit[] {
  const hits: SearchHit[] = [];
  let offset = 0;
  for (const [i, line] of text.split("\n").entries()) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      if (match[0] === "") continue;
      const start = match.index!;
      hits.push({
        file,
        line: i + 1,
        from: offset + start,
        to: offset + start + match[0].length,
        text: line,
        start,
        end: start + match[0].length,
      });
      if (hits.length >= limit) return hits;
    }
    offset += line.length + 1;
  }
  return hits;
}

/** What replaces `hit`: `replacement` with `$1` and the like filled in for a regular expression. */
export function replacementOf(hit: SearchHit, pattern: RegExp, replacement: string, regex: boolean): string {
  if (!regex) return replacement;
  const single = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  return hit.text.slice(hit.start, hit.end).replace(single, replacement);
}
