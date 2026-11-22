// Completions for LaTeX: commands, environments, packages and the project's
// own labels and bibliography keys.
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";

export interface CompletionData {
  labels: { key: string; file: string }[];
  citations: { key: string; title: string; author: string }[];
  /** Package names known to the distribution, if loaded. */
  packages: string[];
}

/** Common commands; `{}` marks where the cursor goes. Details stay language-neutral (package or symbol). */
const COMMANDS: [string, string][] = [
  ["section{}", ""],
  ["subsection{}", ""],
  ["subsubsection{}", ""],
  ["chapter{}", ""],
  ["part{}", ""],
  ["paragraph{}", ""],
  ["label{}", ""],
  ["ref{}", ""],
  ["eqref{}", ""],
  ["pageref{}", ""],
  ["cref{}", "cleveref"],
  ["Cref{}", "cleveref"],
  ["autoref{}", "hyperref"],
  ["nameref{}", ""],
  ["cite{}", ""],
  ["parencite{}", "biblatex"],
  ["textcite{}", "biblatex"],
  ["autocite{}", "biblatex"],
  ["footcite{}", "biblatex"],
  ["citep{}", "natbib"],
  ["citet{}", "natbib"],
  ["printbibliography", "biblatex"],
  ["addbibresource{}", "biblatex"],
  ["bibliography{}", "BibTeX"],
  ["emph{}", ""],
  ["textbf{}", ""],
  ["textit{}", ""],
  ["texttt{}", ""],
  ["underline{}", ""],
  ["textsc{}", ""],
  ["footnote{}", ""],
  ["url{}", ""],
  ["href{}{}", ""],
  ["includegraphics{}", ""],
  ["caption{}", ""],
  ["centering", ""],
  ["input{}", ""],
  ["include{}", ""],
  ["usepackage{}", ""],
  ["documentclass{}", ""],
  ["title{}", ""],
  ["author{}", ""],
  ["date{}", ""],
  ["maketitle", ""],
  ["tableofcontents", ""],
  ["listoffigures", ""],
  ["listoftables", ""],
  ["appendix", ""],
  ["newpage", ""],
  ["clearpage", ""],
  ["item", ""],
  ["hline", ""],
  ["toprule", "booktabs"],
  ["midrule", "booktabs"],
  ["bottomrule", "booktabs"],
  ["frac{}{}", ""],
  ["sqrt{}", ""],
  ["sum", ""],
  ["int", ""],
  ["prod", ""],
  ["lim", ""],
  ["infty", "∞"],
  ["alpha", "α"],
  ["beta", "β"],
  ["gamma", "γ"],
  ["delta", "δ"],
  ["epsilon", "ε"],
  ["lambda", "λ"],
  ["mu", "μ"],
  ["pi", "π"],
  ["sigma", "σ"],
  ["theta", "θ"],
  ["omega", "ω"],
  ["cdot", "·"],
  ["times", "×"],
  ["leq", "≤"],
  ["geq", "≥"],
  ["neq", "≠"],
  ["approx", "≈"],
  ["rightarrow", "→"],
  ["Rightarrow", "⇒"],
  ["mathbb{}", ""],
  ["mathrm{}", ""],
  ["mathbf{}", ""],
  ["text{}", ""],
  ["left(", ""],
  ["right)", ""],
  ["SI{}{}", "siunitx"],
  ["si{}", "siunitx"],
  ["qty{}{}", "siunitx"],
  ["num{}", "siunitx"],
  ["gls{}", "glossaries"],
  ["acrshort{}", "glossaries"],
  ["acrlong{}", "glossaries"],
  ["newcommand{}{}", ""],
  ["vspace{}", ""],
  ["hspace{}", ""],
  ["noindent", ""],
  ["linewidth", ""],
  ["textwidth", ""],
];

const ENVIRONMENTS = [
  "document",
  "figure",
  "table",
  "tabular",
  "tabularx",
  "itemize",
  "enumerate",
  "description",
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "multline",
  "cases",
  "matrix",
  "pmatrix",
  "bmatrix",
  "center",
  "minipage",
  "quote",
  "quotation",
  "verbatim",
  "lstlisting",
  "minted",
  "abstract",
  "thebibliography",
  "frame",
  "block",
  "columns",
  "column",
  "theorem",
  "lemma",
  "proof",
  "definition",
  "tikzpicture",
  "axis",
  "subfigure",
  "longtable",
  "xltabular",
  "landscape",
];

/** Popular packages, offered until the distribution's catalog is loaded. */
const COMMON_PACKAGES = [
  "amsmath",
  "amssymb",
  "amsthm",
  "babel",
  "biblatex",
  "booktabs",
  "caption",
  "cleveref",
  "csquotes",
  "enumitem",
  "fancyhdr",
  "float",
  "fontenc",
  "fontspec",
  "geometry",
  "glossaries",
  "graphicx",
  "hyperref",
  "inputenc",
  "listings",
  "longtable",
  "mathtools",
  "microtype",
  "minted",
  "multirow",
  "natbib",
  "pdfpages",
  "pgfplots",
  "setspace",
  "siunitx",
  "subcaption",
  "tabularx",
  "tikz",
  "titlesec",
  "todonotes",
  "tocloft",
  "url",
  "xcolor",
  "xltabular",
];

const REF_COMMANDS = /\\(?:ref|eqref|pageref|cref|Cref|cpageref|autoref|nameref|vref|Vref|labelcref)\*?\{([^}]*)$/;
const CITE_COMMANDS = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const ENV_COMMANDS = /\\(?:begin|end)\{([^}]*)$/;
const PACKAGE_COMMANDS = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)$/;

/** Inserts `name`, placing the cursor in the first `{}` if there is one. */
function command(name: string, detail: string): Completion {
  const brace = name.indexOf("{}");
  return {
    label: `\\${name.replaceAll("{}", "{…}")}`,
    detail: detail || undefined,
    type: "keyword",
    apply: (view, _completion, from, to) => {
      const text = `\\${name}`;
      const cursor = brace >= 0 ? from + 1 + brace + 1 : from + text.length;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: cursor } });
    },
  };
}

const COMMAND_COMPLETIONS = COMMANDS.map(([name, detail]) => command(name, detail));

/** Completes inside an argument; the list may hold several comma-separated keys. */
function argument(context: CompletionContext, pattern: RegExp, options: Completion[]): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const match = pattern.exec(line.text.slice(0, context.pos - line.from));
  if (!match) return null;
  const typed = match[1].split(",").pop() ?? "";
  return { from: context.pos - typed.trimStart().length, options, validFor: /^[^,}\s]*$/ };
}

export function latexCompletions(data: () => CompletionData): CompletionSource {
  return (context) => {
    const { labels, citations, packages } = data();
    const refs = argument(
      context,
      REF_COMMANDS,
      labels.map((l) => ({ label: l.key, detail: l.file, type: "variable" })),
    );
    if (refs) return refs;
    const cites = argument(
      context,
      CITE_COMMANDS,
      citations.map((c) => ({
        label: c.key,
        detail: c.author,
        info: c.title || undefined,
        type: "text",
      })),
    );
    if (cites) return cites;
    const envs = argument(
      context,
      ENV_COMMANDS,
      ENVIRONMENTS.map((e) => ({ label: e, type: "class" })),
    );
    if (envs) return envs;
    const pkgs = argument(
      context,
      PACKAGE_COMMANDS,
      (packages.length > 0 ? packages : COMMON_PACKAGES).map((p) => ({ label: p, type: "namespace" })),
    );
    if (pkgs) return pkgs;

    const word = context.matchBefore(/\\[a-zA-Z]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    return { from: word.from, options: COMMAND_COMPLETIONS, validFor: /^\\[a-zA-Z]*$/ };
  };
}
