// The LaTeX behind the edit tab's link buttons: links to web pages and
// references to headings, figures, tables and equations of the document.
// hyperref goes into the preamble through preamble.ts.

import type { ProjectScan } from "$lib/api";
import { preambleOf, uniqueLabel, labelFrom } from "./preamble";
import { stripComment as code } from "./syntax";

/** How a reference reads in the PDF. */
export type ReferenceStyle = "named" | "number" | "title" | "page" | "text";
export const REFERENCE_STYLES: ReferenceStyle[] = ["named", "number", "title", "page", "text"];

export type TargetKind = "heading" | "figure" | "table" | "equation" | "other";

export interface LinkTarget {
  kind: TargetKind;
  /** The label references use; `null` for a heading without one, which gets `newLabel`. */
  key: string | null;
  /** For a heading without a label: the one it gets once it is referenced. */
  newLabel?: string;
  /** Heading title or caption; the label where there is neither. */
  title: string;
  /** "2.1" for a numbered heading; `null` otherwise. */
  number: string | null;
  /** Heading level (0 = part … 5 = paragraph); 0 for other targets. */
  level: number;
  file: string;
  line: number;
  /** Starred headings have no number of their own: `\ref` would give the one around them. */
  numbered: boolean;
}

const HEADING_LABEL_PREFIX = ["part", "ch", "sec", "sec", "sec", "par"];

const ENVIRONMENT_KIND: [RegExp, TargetKind][] = [
  [/^(figure|wrapfigure|subfigure)\*?$/, "figure"],
  [/^(table|wraptable|subtable|longtable)\*?$/, "table"],
  [/^(equation|align|gather|multline|flalign|alignat|eqnarray)\*?$/, "equation"],
];

const PREFIX_KIND: Record<string, TargetKind> = {
  fig: "figure",
  abb: "figure",
  tab: "table",
  eq: "equation",
  eqn: "equation",
  gl: "equation",
};

/**
 * What a reference can point to, in reading order where the outline knows it:
 * every heading (with or without a label), then the other labels with their
 * captions. `read` gives a project file's current text.
 */
export async function linkTargets(scan: ProjectScan, read: (path: string) => Promise<string>): Promise<LinkTarget[]> {
  const texts = new Map<string, string[]>();
  const lines = async (file: string) => {
    if (!texts.has(file)) texts.set(file, (await read(file)).split("\n"));
    return texts.get(file)!;
  };
  const taken = scan.labels.map((l) => l.key);
  const used = new Set<string>();
  const targets: LinkTarget[] = [];

  for (const heading of scan.outline) {
    const text = await lines(heading.file);
    const label = scan.labels.find(
      (l) =>
        l.file === heading.file &&
        !used.has(`${l.file}:${l.line}:${l.key}`) &&
        (l.line === heading.line || (l.line === heading.line + 1 && /^\s*\\label\s*\{/.test(code(text[l.line - 1] ?? "")))),
    );
    if (label) used.add(`${label.file}:${label.line}:${label.key}`);
    const target: LinkTarget = {
      kind: "heading",
      key: label?.key ?? null,
      title: heading.title,
      number: heading.number,
      level: heading.level,
      file: heading.file,
      line: heading.line,
      numbered: heading.number !== null,
    };
    if (!label) {
      target.newLabel = uniqueLabel(labelFrom(HEADING_LABEL_PREFIX[heading.level] ?? "sec", heading.title, "heading"), taken);
      taken.push(target.newLabel);
    }
    targets.push(target);
  }

  for (const label of scan.labels) {
    if (used.has(`${label.file}:${label.line}:${label.key}`) || !label.file.endsWith(".tex")) continue;
    const { kind, caption } = surroundings(await lines(label.file), label.line - 1, label.key);
    targets.push({
      kind,
      key: label.key,
      title: caption || label.key,
      number: null,
      level: 0,
      file: label.file,
      line: label.line,
      numbered: true,
    });
  }
  return targets;
}

/** The environment a label stands in, and its caption, from the lines around it. */
function surroundings(lines: string[], index: number, key: string): { kind: TargetKind; caption: string } {
  let kind: TargetKind | null = null;
  let begin = index;
  const open: string[] = [];
  // Backwards to the innermost environment that is still open at the label.
  outer: for (let i = index; i >= 0 && i > index - 60; i--) {
    const matches = [...code(lines[i]).matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)].reverse();
    for (const [, which, name] of matches) {
      if (which === "end") open.push(name);
      else if (open.at(-1) === name) open.pop();
      else {
        const found = ENVIRONMENT_KIND.find(([pattern]) => pattern.test(name.trim()));
        if (found) {
          kind = found[1];
          begin = i;
          break outer;
        }
      }
    }
  }
  kind ??= PREFIX_KIND[key.split(":")[0].toLowerCase()] ?? "other";
  let caption = "";
  if (kind === "figure" || kind === "table") {
    const near = lines
      .slice(begin, index + 15)
      .map(code)
      .join("\n");
    const at = near.search(/\\caption\s*(\[[^\]]*\])?\s*\{/);
    if (at >= 0) caption = cleanTitle(braced(near, near.indexOf("{", at)) ?? "");
  }
  return { kind, caption };
}

/** The text between the brace at `open` and its partner, `null` if it is not closed. */
function braced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** "Results and errors" for "Results \emph{and} errors\label{x}": readable in the dialog. */
function cleanTitle(text: string): string {
  return text
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\*?\s*(\[[^\]]*\])?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where `\label{label}` goes for the heading on line `line` (1-based) of
 * `text`: right behind its title's closing brace. `null` if the heading
 * cannot be found there.
 */
export function headingLabelEdit(text: string, line: number, label: string): { at: number; insert: string } | null {
  let start = 0;
  for (let i = 1; i < line; i++) {
    start = text.indexOf("\n", start) + 1;
    if (start === 0) return null;
  }
  const rest = text.slice(start);
  const heading = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/.exec(rest);
  if (!heading || rest.slice(0, heading.index).includes("\n")) return null;
  const open = heading.index + heading[0].length - 1;
  const title = braced(rest, open);
  if (title === null) return null;
  return { at: start + open + title.length + 2, insert: `\\label{${label}}` };
}

/**
 * The reference to `key` in `style`. "named" prefixes the kind as the
 * document's language names it ("Section 2.1"): with `\cref` where
 * cleveref is loaded, with hyperref's `\autoref` otherwise.
 */
export function referenceCode(key: string, style: ReferenceStyle, text: string, mainSource: string): string {
  switch (style) {
    case "named":
      return preambleOf(mainSource).packages.has("cleveref") ? `\\cref{${key}}` : `\\autoref{${key}}`;
    case "number":
      return `\\ref{${key}}`;
    case "title":
      return `\\nameref{${key}}`;
    case "page":
      return `\\pageref{${key}}`;
    case "text":
      return `\\hyperref[${key}]{${text}}`;
  }
}

/** `https://` before a bare domain, `mailto:` before an e-mail address. */
function normalizeUrl(input: string): string {
  const url = input.trim();
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return `https://${url.replace(/^\/+/, "")}`;
  return url;
}

/** Whether `input` can be a link target at all: no spaces, balanced braces. */
export function isUrl(input: string): boolean {
  const url = input.trim();
  if (!url || /\s/.test(url) || url.includes("\\")) return false;
  let depth = 0;
  for (const c of url) {
    if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0 && /[.:]/.test(url);
}

/**
 * `\href{url}{text}`, or `\url{url}` without text: the address itself shows.
 * In `\href`, `%` and `#` are escaped, so the link works inside other
 * commands' arguments (footnotes, captions) as well; `\url` reads its
 * argument verbatim and would print the backslash.
 */
export function webLinkCode(input: string, text: string): string {
  const url = normalizeUrl(input);
  const href = url.replace(/(?<!\\)([%#])/g, "\\$1");
  if (text.trim()) return `\\href{${href}}{${text.trim()}}`;
  // An e-mail address shows without its mailto:.
  if (url.startsWith("mailto:")) return `\\href{${href}}{\\nolinkurl{${url.slice(7)}}}`;
  return `\\url{${url}}`;
}
