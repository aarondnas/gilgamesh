// Finds the prose words in LaTeX source for spell checking. Kept free of
// editor dependencies so it can be tested on its own.

export interface Token {
  from: number;
  to: number;
  word: string;
}

/**
 * Commands whose arguments are prose. The arguments of every other command
 * (\usepackage{…}, \DeclareFieldFormat{…}{…}, user macros, …) are keys, code
 * or settings and are not checked.
 */
const PROSE_ARGUMENTS = new Set([
  "text",
  "textbf",
  "textit",
  "textsl",
  "textsc",
  "textup",
  "textmd",
  "textrm",
  "textsf",
  "textnormal",
  "emph",
  "underline",
  "uline",
  "sout",
  "textsuperscript",
  "textsubscript",
  "mbox",
  "fbox",
  "MakeUppercase",
  "MakeLowercase",
  "MakeTextUppercase",
  "MakeTextLowercase",
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
  "addchap",
  "addsec",
  "addpart",
  "minisec",
  "caption",
  "footnote",
  "footnotetext",
  "marginpar",
  "marginnote",
  "title",
  "subtitle",
  "date",
  "thanks",
  "dedication",
  "enquote",
  "textquote",
  "item",
  "todo",
  "frametitle",
  "framesubtitle",
  "intertext",
  "shortintertext",
]);

/** Commands with leading key arguments before the prose: how many mandatory ones to skip. */
const KEY_THEN_PROSE = new Map([
  ["href", 1],
  ["textcolor", 1],
  ["colorbox", 1],
  ["fcolorbox", 2],
  ["captionof", 1],
  ["parbox", 1],
  ["raisebox", 1],
  ["makebox", 0],
  ["framebox", 0],
  ["hyperref", 0],
]);

/** Environments whose content is not prose. */
const SKIP_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "math",
  "displaymath",
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment",
  "tikzpicture",
  "axis",
  "filecontents",
  "filecontents*",
]);

/**
 * Words of a LaTeX source that are prose: no commands, comments, math,
 * verbatim, or arguments of commands other than text commands like `\emph`.
 * Exported for tests.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const length = text.length;
  let i = 0;

  /** Skips a balanced group starting at `open` ({ or [); returns the index after it. */
  const skipGroup = (at: number, open: string, close: string): number => {
    let depth = 0;
    for (let j = at; j < length; j++) {
      if (text[j] === "\\") j++;
      else if (text[j] === open) depth++;
      else if (text[j] === close && --depth === 0) return j + 1;
    }
    return length;
  };
  const skipSpaces = (at: number) => {
    while (at < length && (text[at] === " " || text[at] === "\t")) at++;
    return at;
  };
  const skipUntil = (at: number, marker: string) => {
    const end = text.indexOf(marker, at);
    return end < 0 ? length : end + marker.length;
  };
  /** Skips optional arguments and up to `mandatory` mandatory ones on the same line. */
  const skipArguments = (at: number, mandatory = Infinity): number => {
    let j = at;
    for (;;) {
      const k = skipSpaces(j);
      if (text[k] === "[") j = skipGroup(k, "[", "]");
      else if (text[k] === "{" && mandatory-- > 0) j = skipGroup(k, "{", "}");
      else return j;
    }
  };

  while (i < length) {
    const c = text[i];
    if (c === "%") {
      i = skipUntil(i, "\n");
    } else if (c === "$") {
      i = text[i + 1] === "$" ? skipUntil(i + 2, "$$") : skipInlineMath(text, i + 1);
    } else if (c === "\\") {
      const next = text[i + 1];
      if (next === "(") i = skipUntil(i + 2, "\)");
      else if (next === "[") i = skipUntil(i + 2, "\]");
      else {
        const name = /^[a-zA-Z@]+\*?/.exec(text.slice(i + 1, i + 40))?.[0];
        if (!name) {
          i += 2; // An escaped character such as \% or \&.
          continue;
        }
        i += 1 + name.length;
        const command = name.replace(/\*$/, "");
        if (command === "begin") {
          const env = /^\s*\{([^}]*)\}/.exec(text.slice(i, i + 60));
          if (env && SKIP_ENVIRONMENTS.has(env[1])) {
            i = skipUntil(i, `\end{${env[1]}}`);
            continue;
          }
          // The name and settings such as \begin{tabular}{ll} or \begin{figure}[ht].
          i = skipArguments(i);
        } else if (command === "verb") {
          // \verb|code|: any delimiter character.
          i = text[i] ? skipUntil(i + 1, text[i]) : length;
        } else if (KEY_THEN_PROSE.has(command)) {
          i = skipArguments(i, KEY_THEN_PROSE.get(command));
        } else if (!PROSE_ARGUMENTS.has(command)) {
          i = skipArguments(i);
        }
      }
    } else if (/\p{L}/u.test(c)) {
      const start = i;
      while (i < length && /[\p{L}\p{M}'’]/u.test(text[i])) i++;
      // Glued to a command, digit or underscore: an identifier, not a word.
      const before = text[start - 1];
      const after = text[i];
      if (before !== "\\" && !/[\d_@]/.test(before ?? "") && !/[\d_@]/.test(after ?? "")) {
        const word = text.slice(start, i).replace(/['’]+$/, "");
        if (isCheckable(word)) tokens.push({ from: start, to: start + word.length, word });
      }
    } else {
      i++;
    }
  }
  return tokens;
}

function skipInlineMath(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "$") return j + 1;
  }
  return text.length;
}

/** Single letters, acronyms (GMP) and names like camelCase or iPhone are not checked. */
function isCheckable(word: string): boolean {
  return word.length > 1 && !/\p{Lu}/u.test(word.slice(1));
}
