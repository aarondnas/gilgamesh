<!-- The ribbon's Insert: pages, lists, images, tables, sources, links, symbols and formulas. -->
<script lang="ts">
  import Bookmark from "@lucide/svelte/icons/bookmark";
  import Heading from "@lucide/svelte/icons/heading";
  import ImageIcon from "@lucide/svelte/icons/image";
  import Link from "@lucide/svelte/icons/link";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Omega from "@lucide/svelte/icons/omega";
  import PanelTop from "@lucide/svelte/icons/panel-top";
  import Quote from "@lucide/svelte/icons/quote";
  import Radical from "@lucide/svelte/icons/radical";
  import Sigma from "@lucide/svelte/icons/sigma";
  import Superscript from "@lucide/svelte/icons/superscript";
  import {
    FORMULA_EXAMPLES,
    FORMULA_KINDS,
    FORMULA_TEMPLATE_EXAMPLES,
    FORMULA_TEMPLATES,
    STRUCTURE_EXAMPLES,
    STRUCTURE_GROUPS,
    type FormulaKind,
    type FormulaTemplate,
    type StructureGroup,
    type StructureKind,
  } from "$lib/latex/math";
  import { SYMBOLS } from "$lib/latex/symbols";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import PageBreakIcon from "../PageBreakIcon.svelte";
  import RibbonButton from "../RibbonButton.svelte";
  import RibbonGroup from "../RibbonGroup.svelte";
  import TableButton from "../TableButton.svelte";

  const formulaNames: Record<FormulaKind, () => string> = {
    inline: m.formula_inline,
    display: m.formula_display,
    equation: m.formula_equation,
    align: m.formula_align,
    alignNoNumber: m.formula_align_no_number,
    gather: m.formula_gather,
    gatherNoNumber: m.formula_gather_no_number,
    multline: m.formula_multline,
  };

  const templateNames: Record<FormulaTemplate, () => string> = {
    circle: m.formula_template_circle,
    binomial: m.formula_template_binomial,
    expansion: m.formula_template_expansion,
    fourier: m.formula_template_fourier,
    pythagoras: m.formula_template_pythagoras,
    quadratic: m.formula_template_quadratic,
    taylor: m.formula_template_taylor,
    trig1: m.formula_template_trig1,
    trig2: m.formula_template_trig2,
  };

  const structureNames: Record<StructureKind, () => string> = {
    fraction: m.structure_fraction,
    sqrt: m.structure_sqrt,
    root: m.structure_root,
    binom: m.structure_binom,
    superscript: m.structure_superscript,
    subscript: m.structure_subscript,
    sum: m.structure_sum,
    product: m.structure_product,
    integral: m.structure_integral,
    limit: m.structure_limit,
    derivative: m.structure_derivative,
    partial: m.structure_partial,
    parens: m.structure_parens,
    brackets: m.structure_brackets,
    braces: m.structure_braces,
    abs: m.structure_abs,
    norm: m.structure_norm,
    vec: m.structure_vec,
    hat: m.structure_hat,
    bar: m.structure_bar,
    dot: m.structure_dot,
    overbrace: m.structure_overbrace,
    underbrace: m.structure_underbrace,
    sin: m.structure_sin,
    cos: m.structure_cos,
    tan: m.structure_tan,
    log: m.structure_log,
    ln: m.structure_ln,
    exp: m.structure_exp,
    text: m.structure_text,
    matrix: m.structure_matrix,
    bmatrix: m.structure_bmatrix,
    vmatrix: m.structure_vmatrix,
    cases: m.structure_cases,
  };

  const structureGroupNames: Record<StructureGroup, () => string> = {
    fractions: m.structure_group_fractions,
    scripts: m.structure_group_scripts,
    operators: m.structure_group_operators,
    brackets: m.structure_group_brackets,
    accents: m.structure_group_accents,
    functions: m.structure_group_functions,
    matrices: m.structure_group_matrices,
  };
</script>

<RibbonGroup label={m.ribbon_group_pages()}>
  <RibbonButton
    large
    icon={PageBreakIcon}
    label={m.ribbon_page_break()}
    title={m.ribbon_page_break_title()}
    disabled={!project.config.main || !project.file?.endsWith(".tex")}
    onclick={() => void inserting.insertPageBreak()}
  />
  <RibbonButton
    large
    icon={PanelTop}
    label={m.ribbon_header_footer()}
    title={m.ribbon_header_footer_title()}
    disabled={!project.config.main || !formatting.pageSetup}
    onclick={() => (doc.headerFooterDialog = true)}
  />
  <RibbonButton
    large
    icon={Heading}
    label={m.ribbon_title()}
    title={m.ribbon_title_title()}
    disabled={!project.config.main || !formatting.pageSetup}
    onclick={() => (doc.titleDialog = true)}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_lists()}>
  <RibbonButton
    large
    icon={ListTree}
    label={m.ribbon_lists()}
    title={m.ribbon_lists_title()}
    disabled={!project.config.main}
    onclick={() => (doc.listDialog = { kind: null, line: null })}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_images()}>
  <RibbonButton
    large
    icon={ImageIcon}
    label={m.ribbon_image()}
    title={m.ribbon_image_title()}
    disabled={!project.config.main || !project.file?.endsWith(".tex")}
    onclick={() => (doc.imageDialog = true)}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_tables()}>
  <TableButton disabled={!project.config.main || !project.file?.endsWith(".tex")} />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_sources()}>
  <RibbonButton
    large
    icon={Quote}
    label={m.ribbon_sources()}
    title={m.ribbon_sources_title()}
    disabled={!project.config.main}
    onclick={() => (doc.citationDialog = project.file?.endsWith(".tex") ? "cite" : "add")}
  />
  <RibbonButton
    large
    icon={Superscript}
    label={m.ribbon_footnote()}
    title={m.ribbon_footnote_title()}
    disabled={!project.file?.endsWith(".tex")}
    onclick={() => inserting.insertFootnote()}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_links()}>
  <RibbonButton
    large
    icon={Link}
    label={m.ribbon_link()}
    title={m.ribbon_link_title()}
    disabled={!project.config.main || !project.file?.endsWith(".tex")}
    onclick={() => (doc.linkDialog = "web")}
  />
  <RibbonButton
    large
    icon={Bookmark}
    label={m.ribbon_reference()}
    title={m.ribbon_reference_title()}
    disabled={!project.config.main || !project.file?.endsWith(".tex")}
    onclick={() => (doc.linkDialog = "reference")}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_symbols()}>
  <RibbonButton
    large
    icon={Omega}
    label={m.ribbon_symbols()}
    title={m.ribbon_symbols_title()}
    disabled={!project.file?.endsWith(".tex")}
    columns={8}
    menu={[
      ...SYMBOLS.map((symbol) => ({
        label: symbol.symbol,
        title: symbol.code,
        onclick: () => void inserting.insertSymbol(symbol),
      })),
      { label: m.symbols_more(), wide: true, onclick: () => (doc.symbolDialog = true) },
    ]}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_formulas()}>
  <RibbonButton
    large
    icon={Sigma}
    label={m.ribbon_formula()}
    title={m.ribbon_formula_title()}
    disabled={!project.file?.endsWith(".tex")}
    groupColumns={2}
    menu={[
      ...FORMULA_KINDS.map((kind) => ({
        label: formulaNames[kind](),
        example: FORMULA_EXAMPLES[kind],
        onclick: () => void inserting.insertFormula(kind),
      })),
      ...FORMULA_TEMPLATES.map((id, i) => ({
        label: templateNames[id](),
        heading: i === 0 ? m.formula_templates() : undefined,
        example: FORMULA_TEMPLATE_EXAMPLES[id],
        onclick: () => void inserting.insertFormulaTemplate(id),
      })),
    ]}
  />
  <RibbonButton
    large
    icon={Radical}
    label={m.ribbon_structures()}
    title={m.ribbon_structures_title()}
    disabled={!project.file?.endsWith(".tex")}
    groupColumns={3}
    menu={Object.entries(STRUCTURE_GROUPS).flatMap(([group, kinds]) =>
      kinds.map((kind, i) => ({
        label: structureNames[kind](),
        heading: i === 0 ? structureGroupNames[group as StructureGroup]() : undefined,
        example: STRUCTURE_EXAMPLES[kind],
        onclick: () => void inserting.insertStructure(kind),
      })),
    )}
  />
</RibbonGroup>
