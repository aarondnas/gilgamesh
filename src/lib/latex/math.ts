// The LaTeX behind the ribbon's formula buttons: formulas of their own (inline,
// displayed, numbered, aligned) and structures such as fractions or sums at
// the cursor; amsmath goes into the preamble through preamble.ts where needed.
// Kept free of editor dependencies so it can be tested on its own.

/** Environments whose content is math. */
const MATH_ENVIRONMENTS = new Set([
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
]);

/**
 * Whether `offset` of `text` lies in math: between `$…$`, `$$…$$`, `\(…\)`,
 * `\[…\]` or in a math environment. Comments and `\verb` are skipped.
 */
export function inMath(text: string, offset: number): boolean {
  /** What ends the math the scan is in, `null` outside math. */
  let closer: string | null = null;
  let i = 0;
  while (i < offset) {
    const c = text[i];
    if (c === "%") {
      const end = text.indexOf("\n", i);
      if (end < 0 || end >= offset) return false;
      i = end + 1;
    } else if (c === "\\") {
      if (closer?.startsWith("\\") && text.startsWith(closer, i)) {
        i += closer.length;
        closer = null;
        continue;
      }
      const next = text[i + 1];
      if (closer === null && next === "(") closer = "\\)";
      else if (closer === null && next === "[") closer = "\\]";
      const name = /^[a-zA-Z@]+\*?/.exec(text.slice(i + 1, i + 40))?.[0];
      if (!name) {
        i += 2; // An escaped character such as \$ or \%.
        continue;
      }
      i += 1 + name.length;
      if (closer !== null) continue;
      if (name === "begin") {
        const env = /^\s*\{([^}]*)\}/.exec(text.slice(i, i + 60));
        if (env && MATH_ENVIRONMENTS.has(env[1].trim())) {
          closer = `\\end{${env[1]}}`;
          i += env[0].length;
        }
      } else if (name === "verb" && text[i]) {
        const end = text.indexOf(text[i], i + 1);
        i = end < 0 ? text.length : end + 1;
      }
    } else if (c === "$") {
      const double = text[i + 1] === "$";
      if (closer === null) {
        closer = double ? "$$" : "$";
        i += double ? 2 : 1;
      } else if (closer === "$$" && double) {
        closer = null;
        i += 2;
      } else {
        if (closer === "$") closer = null;
        i++;
      }
    } else {
      i++;
    }
  }
  return closer !== null;
}

/**
 * Fills a template: `@` takes the selected text, `#` are further slots, and
 * lines after the first get `indent`. The cursor goes into the first slot left
 * empty, else behind the code.
 */
function fillTemplate(template: string, selection: string, indent = ""): { code: string; cursor: number } {
  let code = "";
  let cursor = -1;
  for (const c of template.replace(/\n/g, `\n${indent}`)) {
    if (c === "@" && selection) code += selection;
    else if (c === "@" || c === "#") cursor = cursor < 0 ? code.length : cursor;
    else code += c;
  }
  return { code, cursor: cursor < 0 ? code.length : cursor };
}

/** The groups of the ribbon's structure menu, each under a heading, in the order it shows them. */
export const STRUCTURE_GROUPS = {
  fractions: ["fraction", "sqrt", "root", "binom"],
  scripts: ["superscript", "subscript"],
  operators: ["sum", "product", "integral", "limit", "derivative", "partial"],
  brackets: ["parens", "brackets", "braces", "abs", "norm"],
  accents: ["vec", "hat", "bar", "dot", "overbrace", "underbrace"],
  functions: ["sin", "cos", "tan", "log", "ln", "exp", "text"],
  matrices: ["matrix", "bmatrix", "vmatrix", "cases"],
} as const;

export type StructureGroup = keyof typeof STRUCTURE_GROUPS;
export type StructureKind = (typeof STRUCTURE_GROUPS)[StructureGroup][number];

const AMS = ["amsmath"];
const STRUCTURES: Record<StructureKind, { template: string; packages: string[] }> = {
  fraction: { template: "\\frac{@}{#}", packages: [] },
  sqrt: { template: "\\sqrt{@}", packages: [] },
  root: { template: "\\sqrt[#]{@}", packages: [] },
  binom: { template: "\\binom{@}{#}", packages: AMS },
  superscript: { template: "^{@}", packages: [] },
  subscript: { template: "_{@}", packages: [] },
  sum: { template: "\\sum_{#}^{#} @", packages: [] },
  product: { template: "\\prod_{#}^{#} @", packages: [] },
  integral: { template: "\\int_{#}^{#} @ \\,\\mathrm{d}#", packages: [] },
  limit: { template: "\\lim_{# \\to #} @", packages: [] },
  derivative: { template: "\\frac{\\mathrm{d}@}{\\mathrm{d}#}", packages: [] },
  partial: { template: "\\frac{\\partial @}{\\partial #}", packages: [] },
  parens: { template: "\\left( @ \\right)", packages: [] },
  brackets: { template: "\\left[ @ \\right]", packages: [] },
  braces: { template: "\\left\\{ @ \\right\\}", packages: [] },
  abs: { template: "\\left| @ \\right|", packages: [] },
  norm: { template: "\\left\\| @ \\right\\|", packages: [] },
  vec: { template: "\\vec{@}", packages: [] },
  hat: { template: "\\hat{@}", packages: [] },
  bar: { template: "\\bar{@}", packages: [] },
  dot: { template: "\\dot{@}", packages: [] },
  overbrace: { template: "\\overbrace{@}^{#}", packages: [] },
  underbrace: { template: "\\underbrace{@}_{#}", packages: [] },
  sin: { template: "\\sin @", packages: [] },
  cos: { template: "\\cos @", packages: [] },
  tan: { template: "\\tan @", packages: [] },
  log: { template: "\\log @", packages: [] },
  ln: { template: "\\ln @", packages: [] },
  exp: { template: "\\exp @", packages: [] },
  text: { template: "\\text{@}", packages: AMS },
  matrix: { template: "\\begin{pmatrix}\n  @ & # \\\\\n  # & #\n\\end{pmatrix}", packages: AMS },
  bmatrix: { template: "\\begin{bmatrix}\n  @ & # \\\\\n  # & #\n\\end{bmatrix}", packages: AMS },
  vmatrix: { template: "\\begin{vmatrix}\n  @ & # \\\\\n  # & #\n\\end{vmatrix}", packages: AMS },
  cases: { template: "\\begin{cases}\n  @ & \\text{#} \\\\\n  # & \\text{#}\n\\end{cases}", packages: AMS },
};

const row = (...cells: string[]) => `<mtr>${cells.map((cell) => `<mtd>${cell}</mtd>`).join("")}</mtr>`;
/** A formula set apart, in MathML: the web view sets it as LaTeX would, with no library of its own. */
const displayed = (content: string) => `<math displaystyle="true">${content}</math>`;
const fenced = (open: string, content: string, close: string) => `<mrow><mo>${open}</mo>${content}<mo>${close}</mo></mrow>`;
const square = `<mtable>${row("<mi>a</mi>", "<mi>b</mi>")}${row("<mi>c</mi>", "<mi>d</mi>")}</mtable>`;
const accent = (mark: string) => `<mover accent="true"><mi>a</mi><mo>${mark}</mo></mover>`;
/** `sin x`: the function's name upright, then its argument. */
const apply = (name: string) => `<mi>${name}</mi><mo>&#x2061;</mo><mi>x</mi>`;
const AB = "<mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow>";

/** An example of each structure, which the ribbon's menu shows beside its name. */
export const STRUCTURE_EXAMPLES: Record<StructureKind, string> = Object.fromEntries(
  Object.entries({
    fraction: "<mfrac><mi>a</mi><mi>b</mi></mfrac>",
    sqrt: "<msqrt><mi>x</mi></msqrt>",
    root: "<mroot><mi>x</mi><mi>n</mi></mroot>",
    binom: fenced("(", '<mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac>', ")"),
    superscript: "<msup><mi>x</mi><mn>2</mn></msup>",
    subscript: "<msub><mi>x</mi><mi>i</mi></msub>",
    sum: "<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub>",
    product: "<munderover><mo>∏</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>a</mi><mi>i</mi></msub>",
    integral:
      "<msubsup><mo>∫</mo><mi>a</mi><mi>b</mi></msubsup><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo>" +
      '<mspace width="0.17em"></mspace><mi mathvariant="normal">d</mi><mi>x</mi>',
    limit: "<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mi>∞</mi></mrow></munder><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo>",
    derivative:
      '<mfrac><mrow><mi mathvariant="normal">d</mi><mi>f</mi></mrow><mrow><mi mathvariant="normal">d</mi><mi>x</mi></mrow></mfrac>',
    partial: "<mfrac><mrow><mo>∂</mo><mi>f</mi></mrow><mrow><mo>∂</mo><mi>x</mi></mrow></mfrac>",
    parens: fenced("(", "<mfrac><mi>a</mi><mi>b</mi></mfrac>", ")"),
    brackets: fenced("[", "<mfrac><mi>a</mi><mi>b</mi></mfrac>", "]"),
    braces: fenced("{", "<mfrac><mi>a</mi><mi>b</mi></mfrac>", "}"),
    abs: fenced("|", "<mi>x</mi>", "|"),
    norm: fenced("‖", "<mi>x</mi>", "‖"),
    vec: accent("→"),
    hat: accent("^"),
    bar: accent("¯"),
    dot: accent("˙"),
    overbrace: `<mover><mover>${AB}<mo>⏞</mo></mover><mi>n</mi></mover>`,
    underbrace: `<munder><munder>${AB}<mo>⏟</mo></munder><mi>n</mi></munder>`,
    sin: apply("sin"),
    cos: apply("cos"),
    tan: apply("tan"),
    log: apply("log"),
    ln: apply("ln"),
    exp: apply("exp"),
    text: '<mi>x</mi><mo>=</mo><mn>0</mn><mspace width="1em"></mspace><mtext>Text</mtext>',
    matrix: fenced("(", square, ")"),
    bmatrix: fenced("[", square, "]"),
    vmatrix: fenced("|", square, "|"),
    cases:
      "<mrow><mo>{</mo><mtable>" +
      row("<mn>1</mn>", "<mrow><mi>x</mi><mo>≥</mo><mn>0</mn></mrow>") +
      row("<mn>0</mn>", "<mrow><mi>x</mi><mo>&lt;</mo><mn>0</mn></mrow>") +
      "</mtable></mrow>",
  }).map(([kind, content]) => [kind, displayed(content)]),
) as Record<StructureKind, string>;

/**
 * A structure in place of `from`…`to` of `text`, with the selected text in it;
 * outside math it comes in `$…$`. `edit.select` is relative to `from`.
 */
export function structureEdit(text: string, from: number, to: number, kind: StructureKind, indent: string) {
  const structure = STRUCTURES[kind];
  let { code, cursor } = fillTemplate(structure.template, text.slice(from, to), indent);
  if (!inMath(text, from)) {
    code = `$${code}$`;
    cursor += 1;
  }
  return { edit: { from, to, insert: code, select: { anchor: cursor, head: cursor } }, packages: structure.packages };
}

export interface Operator {
  symbol: string;
  command: string;
  /** What the preamble must load for it. */
  packages: string[];
}

const op = (symbol: string, command: string, packages: string[] = []): Operator => ({ symbol, command, packages });

/** The operators formulas use most, a group of the symbol dialog: arithmetic, relations, arrows and logic, sets, analysis. */
export const OPERATORS: Operator[] = [
  op("±", "\\pm"),
  op("∓", "\\mp"),
  op("×", "\\times"),
  op("÷", "\\div"),
  op("·", "\\cdot"),
  op("∘", "\\circ"),
  op("∗", "\\ast"),
  op("⊕", "\\oplus"),
  op("≠", "\\neq"),
  op("≈", "\\approx"),
  op("≡", "\\equiv"),
  op("∼", "\\sim"),
  op("∝", "\\propto"),
  op("≤", "\\leq"),
  op("≥", "\\geq"),
  op("≔", "\\coloneqq", ["mathtools"]),
  op("≪", "\\ll"),
  op("≫", "\\gg"),
  op("→", "\\to"),
  op("←", "\\leftarrow"),
  op("↔", "\\leftrightarrow"),
  op("↦", "\\mapsto"),
  op("⇒", "\\Rightarrow"),
  op("⇔", "\\Leftrightarrow"),
  op("¬", "\\neg"),
  op("∧", "\\land"),
  op("∨", "\\lor"),
  op("∀", "\\forall"),
  op("∃", "\\exists"),
  op("∄", "\\nexists", ["amssymb"]),
  op("∴", "\\therefore", ["amssymb"]),
  op("∵", "\\because", ["amssymb"]),
  op("∈", "\\in"),
  op("∉", "\\notin"),
  op("⊂", "\\subset"),
  op("⊆", "\\subseteq"),
  op("∪", "\\cup"),
  op("∩", "\\cap"),
  op("∖", "\\setminus"),
  op("∅", "\\emptyset"),
  op("∞", "\\infty"),
  op("∂", "\\partial"),
  op("∇", "\\nabla"),
  op("∏", "\\prod"),
  op("∮", "\\oint"),
  op("′", "'"),
  op("°", "^\\circ"),
  op("…", "\\dots"),
];

export type FormulaKind = "inline" | "display" | "equation" | "align" | "alignNoNumber" | "gather" | "gatherNoNumber" | "multline";

export const FORMULA_KINDS: FormulaKind[] = [
  "inline",
  "display",
  "equation",
  "align",
  "alignNoNumber",
  "gather",
  "gatherNoNumber",
  "multline",
];

/** The label of a numbered formula comes in for `%label%`. */
const EMC = "<mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup>";
const cell = (content: string, align: "left" | "right") => `<mtd style="text-align: ${align}">${content}</mtd>`;
const number = (n: number) => `<mtd style="padding-left: 1.5em"><mtext>(${n})</mtext></mtd>`;

/** Lines aligned at `=`, numbered or not. */
const aligned = (numbered: boolean) =>
  displayed(
    "<mtable>" +
      `<mtr>${cell("<mi>a</mi>", "right")}${cell("<mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi>", "left")}${numbered ? number(1) : ""}</mtr>` +
      `<mtr>${cell("", "right")}${cell("<mo>=</mo><mi>d</mi>", "left")}${numbered ? number(2) : ""}</mtr>` +
      "</mtable>",
  );
/** Lines of their own, each centred, numbered or not. */
const gathered = (numbered: boolean) =>
  displayed(
    "<mtable>" +
      `<mtr><mtd>${EMC}</mtd>${numbered ? number(1) : ""}</mtr>` +
      `<mtr><mtd><mi>F</mi><mo>=</mo><mi>m</mi><mi>a</mi></mtd>${numbered ? number(2) : ""}</mtr>` +
      "</mtable>",
  );

/**
 * An example of each kind of formula, which the ribbon's menu shows beside its
 * name: in a line of text, set apart, numbered, over lines aligned at `=`,
 * over lines each centred, and one too long for a line, broken.
 */
export const FORMULA_EXAMPLES: Record<FormulaKind, string> = {
  inline: `<math><mtext>…&#x2009;</mtext>${EMC}<mtext>&#x2009;…</mtext></math>`,
  display: displayed(EMC),
  equation: displayed(`<mtable><mtr><mtd>${EMC}</mtd>${number(1)}</mtr></mtable>`),
  align: aligned(true),
  alignNoNumber: aligned(false),
  gather: gathered(true),
  gatherNoNumber: gathered(false),
  multline: displayed(
    "<mtable>" +
      `<mtr>${cell("<mi>a</mi><mo>+</mo><mi>b</mi><mo>+</mo><mi>c</mi>", "left")}<mtd></mtd></mtr>` +
      `<mtr>${cell("<mo>+</mo><mi>d</mi><mo>+</mo><mi>e</mi>", "right")}${number(1)}</mtr>` +
      "</mtable>",
  ),
};

const FORMULAS: Record<Exclude<FormulaKind, "inline">, { template: string; packages: string[] }> = {
  display: { template: "\\[\n  @\n\\]", packages: [] },
  equation: { template: "\\begin{equation}\n  @\n  \\label{%label%}\n\\end{equation}", packages: [] },
  align: { template: "\\begin{align}\n  @ &= # \\\\\n    &= #\n\\end{align}", packages: AMS },
  alignNoNumber: { template: "\\begin{align*}\n  @ &= # \\\\\n    &= #\n\\end{align*}", packages: AMS },
  // No line left blank while its slot is empty: that would end the paragraph inside the formula.
  gather: { template: "\\begin{gather}\n  @ = # \\\\\n  # = #\n\\end{gather}", packages: AMS },
  gatherNoNumber: { template: "\\begin{gather*}\n  @ = # \\\\\n  # = #\n\\end{gather*}", packages: AMS },
  multline: { template: "\\begin{multline}\n  @ \\\\\n  + #\n\\end{multline}", packages: AMS },
};

export type FormulaTemplate = "circle" | "pythagoras" | "quadratic" | "binomial" | "expansion" | "taylor" | "fourier" | "trig1" | "trig2";

/** The formulas Word offers ready-made ("built-in"), in its order of them. */
export const FORMULA_TEMPLATES: FormulaTemplate[] = [
  "circle",
  "binomial",
  "expansion",
  "fourier",
  "pythagoras",
  "quadratic",
  "taylor",
  "trig1",
  "trig2",
];

const half = "<mfrac><mn>1</mn><mn>2</mn></mfrac>";
const angles = (sign: string) => `<mo>(</mo><mi>α</mi><mo>${sign}</mo><mi>β</mi><mo>)</mo>`;
const frac = (over: string, under: string) => `<mfrac><mrow>${over}</mrow><mrow>${under}</mrow></mfrac>`;
const nPiX = "<mi>n</mi><mi>π</mi><mi>x</mi>";

/** Each ready-made formula: its LaTeX, what that needs, and how the menu shows it. */
const TEMPLATES: Record<FormulaTemplate, { code: string; packages: string[]; example: string }> = {
  circle: { code: "A = \\pi r^2", packages: [], example: "<mi>A</mi><mo>=</mo><mi>π</mi><msup><mi>r</mi><mn>2</mn></msup>" },
  binomial: {
    code: "(x + a)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^k a^{n-k}",
    packages: AMS,
    example:
      "<msup><mrow><mo>(</mo><mi>x</mi><mo>+</mo><mi>a</mi><mo>)</mo></mrow><mi>n</mi></msup><mo>=</mo>" +
      "<munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>0</mn></mrow><mi>n</mi></munderover>" +
      fenced("(", '<mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac>', ")") +
      "<msup><mi>x</mi><mi>k</mi></msup><msup><mi>a</mi><mrow><mi>n</mi><mo>−</mo><mi>k</mi></mrow></msup>",
  },
  expansion: {
    code: "(1 + x)^n = 1 + \\frac{nx}{1!} + \\frac{n(n-1)x^2}{2!} + \\cdots",
    packages: [],
    example:
      "<msup><mrow><mo>(</mo><mn>1</mn><mo>+</mo><mi>x</mi><mo>)</mo></mrow><mi>n</mi></msup><mo>=</mo><mn>1</mn><mo>+</mo>" +
      frac("<mi>n</mi><mi>x</mi>", "<mn>1</mn><mo>!</mo>") +
      "<mo>+</mo>" +
      frac("<mi>n</mi><mo>(</mo><mi>n</mi><mo>−</mo><mn>1</mn><mo>)</mo><msup><mi>x</mi><mn>2</mn></msup>", "<mn>2</mn><mo>!</mo>") +
      "<mo>+</mo><mo>⋯</mo>",
  },
  fourier: {
    code: "f(x) = a_0 + \\sum_{n=1}^{\\infty} \\left( a_n \\cos\\frac{n\\pi x}{L} + b_n \\sin\\frac{n\\pi x}{L} \\right)",
    packages: [],
    example:
      "<mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><msub><mi>a</mi><mn>0</mn></msub><mo>+</mo>" +
      "<munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>∞</mi></munderover>" +
      fenced(
        "(",
        `<msub><mi>a</mi><mi>n</mi></msub><mi>cos</mi>${frac(nPiX, "<mi>L</mi>")}<mo>+</mo><msub><mi>b</mi><mi>n</mi></msub><mi>sin</mi>${frac(nPiX, "<mi>L</mi>")}`,
        ")",
      ),
  },
  pythagoras: {
    code: "a^2 + b^2 = c^2",
    packages: [],
    example: "<msup><mi>a</mi><mn>2</mn></msup><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup><mo>=</mo><msup><mi>c</mi><mn>2</mn></msup>",
  },
  quadratic: {
    code: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    packages: [],
    example: `<mi>x</mi><mo>=</mo>${frac("<mo>−</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt>", "<mn>2</mn><mi>a</mi>")}`,
  },
  taylor: {
    code: "e^x = 1 + \\frac{x}{1!} + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots, \\quad -\\infty < x < \\infty",
    packages: [],
    example:
      `<msup><mi>e</mi><mi>x</mi></msup><mo>=</mo><mn>1</mn><mo>+</mo>${frac("<mi>x</mi>", "<mn>1</mn><mo>!</mo>")}<mo>+</mo>` +
      `${frac("<msup><mi>x</mi><mn>2</mn></msup>", "<mn>2</mn><mo>!</mo>")}<mo>+</mo>${frac("<msup><mi>x</mi><mn>3</mn></msup>", "<mn>3</mn><mo>!</mo>")}` +
      '<mo>+</mo><mo>⋯</mo><mo>,</mo><mspace width="1em"></mspace><mo>−</mo><mi>∞</mi><mo>&lt;</mo><mi>x</mi><mo>&lt;</mo><mi>∞</mi>',
  },
  trig1: {
    code: "\\sin\\alpha \\pm \\sin\\beta = 2 \\sin\\frac{1}{2}(\\alpha \\pm \\beta) \\cos\\frac{1}{2}(\\alpha \\mp \\beta)",
    packages: [],
    example: `<mi>sin</mi><mi>α</mi><mo>±</mo><mi>sin</mi><mi>β</mi><mo>=</mo><mn>2</mn><mi>sin</mi>${half}${angles("±")}<mi>cos</mi>${half}${angles("∓")}`,
  },
  trig2: {
    code: "\\cos\\alpha + \\cos\\beta = 2 \\cos\\frac{1}{2}(\\alpha + \\beta) \\cos\\frac{1}{2}(\\alpha - \\beta)",
    packages: [],
    example: `<mi>cos</mi><mi>α</mi><mo>+</mo><mi>cos</mi><mi>β</mi><mo>=</mo><mn>2</mn><mi>cos</mi>${half}${angles("+")}<mi>cos</mi>${half}${angles("−")}`,
  },
};

/** How the ribbon's menu shows each ready-made formula. */
export const FORMULA_TEMPLATE_EXAMPLES = Object.fromEntries(
  FORMULA_TEMPLATES.map((id) => [id, displayed(TEMPLATES[id].example)]),
) as Record<FormulaTemplate, string>;

/**
 * A ready-made formula in place of `from`…`to` of `text` where that lies in
 * math; `null` elsewhere, where it goes on lines of its own (`templateBlock`).
 */
export function templateEdit(text: string, from: number, to: number, id: FormulaTemplate) {
  if (!inMath(text, from)) return null;
  const { code, packages } = TEMPLATES[id];
  return { edit: { from, to, insert: code, select: { anchor: code.length, head: code.length } }, packages };
}

/** A ready-made formula set apart (`\[…\]`), the cursor behind it. */
export function templateBlock(id: FormulaTemplate, indent: string) {
  const { code, packages } = TEMPLATES[id];
  const block = `\\[\n${indent}  ${code}\n${indent}\\]`;
  return { code: block, select: { anchor: block.length, head: block.length }, packages };
}

/** `$…$` in place of `from`…`to` of `text`, around the selected text. */
export function inlineFormulaEdit(text: string, from: number, to: number) {
  const { code, cursor } = fillTemplate("$@$", text.slice(from, to));
  return { from, to, insert: code, select: { anchor: cursor, head: cursor } };
}

/** A formula on lines of its own around `selection`; `label` names a numbered one. */
export function formulaBlock(kind: Exclude<FormulaKind, "inline">, selection: string, label: string, indent: string) {
  const formula = FORMULAS[kind];
  const { code, cursor } = fillTemplate(formula.template.replace("%label%", label), selection.trim(), indent);
  return { code, select: { anchor: cursor, head: cursor }, packages: formula.packages };
}
