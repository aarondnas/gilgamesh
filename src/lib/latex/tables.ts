// The LaTeX behind the ribbon's table button: a table at the cursor; the
// packages it needs go into the preamble through preamble.ts.

import { parentDir, resolveInclude } from "$lib/util/paths";
import { placementOf } from "./preamble";
import { documentClassOf, hasChapters, stripComments } from "./syntax";

/** Environments whose `\caption` numbers a table. */
const TABLE_ENVS = /^(table\*?|sidewaystable\*?|longtable|xltabular|longtabu|tabu)$/;
const TOKEN =
  /\\(begin|end)\s*\{([^}]*)\}|\\(input|include)\s*\{([^}]*)\}|\\(chapter)\b(\s*\*)?|\\(appendix)\b|\\(caption)\b(\s*\*)?|\\(captionof)\s*\*?\s*\{\s*table\s*\}/g;

export interface TableNumberSource {
  main: string;
  mainSource: string;
  read: (path: string) => Promise<string>;
  /** The file the table goes into, and where. */
  file: string;
  offset: number;
}

/**
 * The number LaTeX will give a table inserted at `offset` of `file`: the
 * numbered tables before it in reading order (the main file, through `\input`
 * and `\include`), plus one. Only captions number tables. Classes with
 * chapters count per chapter (`2.1`), with letters after `\appendix` (`A.1`).
 */
export async function tableNumberAt(source: TableNumberSource): Promise<string> {
  const chapters = hasChapters(documentClassOf(stripComments(source.mainSource))?.name ?? "");
  const base = parentDir(source.main);
  let chapter = 0;
  let appendix = false;
  let count = 0;
  let depth = 0;
  const visited = new Set<string>();

  /** Reads `text` (of `path`) in order; `true` once the insertion point is reached. */
  async function walk(path: string, text: string): Promise<boolean> {
    const atTarget = path === source.file;
    // Comments do not count; the line breaks stay, so offsets keep their lines.
    const code = stripComments(atTarget ? text.slice(0, source.offset) : text);
    for (const match of code.matchAll(TOKEN)) {
      const [, beginEnd, env, input, file, chapterCmd, chapterStar, appendixCmd, caption, captionStar, captionof] = match;
      if (beginEnd && TABLE_ENVS.test(env.trim())) depth = Math.max(0, depth + (beginEnd === "begin" ? 1 : -1));
      else if (input) {
        const included = resolveInclude(base, file);
        if (visited.has(included)) continue;
        visited.add(included);
        if (await walk(included, await source.read(included).catch(() => ""))) return true;
      } else if (chapterCmd && !chapterStar) {
        chapter++;
        count = chapters ? 0 : count;
      } else if (appendixCmd) {
        appendix = true;
        chapter = 0;
      } else if ((caption && !captionStar && depth > 0) || captionof) count++;
    }
    return atTarget;
  }

  visited.add(source.main);
  // A file the main file does not read: count what the main file has.
  await walk(source.main, source.mainSource);
  const number = count + 1;
  // Before the first chapter there is no chapter part (`\thetable` adds it only from chapter 1).
  if (!chapters || chapter === 0) return String(number);
  const chapterName = appendix ? String.fromCharCode(64 + chapter) : String(chapter);
  return `${chapterName}.${number}`;
}

export type TableStyle = "booktabs" | "grid";

export interface Table {
  columns: number;
  /** Rows below the header. */
  rows: number;
  header: boolean;
  /** booktabs rules (`\toprule` …), or lines around every cell. */
  style: TableStyle;
  /** Spread over the text width with tabularx, else as wide as the content. */
  fullWidth: boolean;
  caption: string;
  label: string;
  /** Placeholder of a header cell, e.g. "Column 1". */
  headerText: (column: number) => string;
}

/** Packages `table` needs in the preamble. */
export function tablePackages(table: Table): string[] {
  return [...(table.style === "booktabs" ? ["booktabs"] : []), ...(table.fullWidth ? ["tabularx"] : [])];
}

/**
 * The table environment, indented like the line it goes into, and the part
 * to select afterwards: the first header cell, or the first cell to fill in.
 * The caption sits above the table, as usual for tables.
 */
export function tableCode(table: Table, mainSource: string, indent = ""): { code: string; select: { anchor: number; head: number } } {
  const columns = Math.max(1, Math.floor(table.columns));
  const rows = Math.max(1, Math.floor(table.rows));
  const grid = table.style === "grid";
  const cell = table.fullWidth ? "X" : "l";
  const spec = grid ? `|${Array(columns).fill(cell).join("|")}|` : cell.repeat(columns);
  const env = table.fullWidth ? "tabularx" : "tabular";
  const rule = (booktabs: string) => (grid ? "\\hline" : booktabs);

  const lines: string[] = [`\\begin{table}[${placementOf(mainSource)}]`, "  \\centering"];
  if (table.caption.trim()) lines.push(`  \\caption{${table.caption.trim()}}`);
  if (table.label.trim()) lines.push(`  \\label{${table.label.trim()}}`);
  lines.push(`  \\begin{${env}}${table.fullWidth ? "{\\textwidth}" : ""}{${spec}}`, `    ${rule("\\toprule")}`);
  /** Line and column within it of what gets selected. */
  let select: { line: number; from: number; to: number } | null = null;
  if (table.header) {
    const cells = Array.from({ length: columns }, (_, i) => table.headerText(i + 1));
    select = { line: lines.length, from: 4, to: 4 + cells[0].length };
    lines.push(`    ${cells.join(" & ")} \\\\`, `    ${rule("\\midrule")}`);
  }
  for (let r = 0; r < rows; r++) {
    // Room to type in every cell: " &  & " rather than "&&".
    select ??= { line: lines.length, from: 4, to: 4 };
    lines.push(`    ${Array(columns).fill("").join(" & ")} \\\\`);
    if (grid) lines.push("    \\hline");
  }
  if (!grid) lines.push("    \\bottomrule");
  lines.push(`  \\end{${env}}`, "\\end{table}");

  const indented = lines.map((line, i) => (i === 0 ? line : indent + line));
  const at = select!;
  // Lines before the selected one, plus its own indentation.
  const offset = indented.slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0) + indent.length;
  return { code: indented.join("\n"), select: { anchor: offset + at.from, head: offset + at.to } };
}
