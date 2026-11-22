<!-- The ribbon's Layout: margins, orientation and paper. -->
<script lang="ts">
  import Columns2 from "@lucide/svelte/icons/columns-2";
  import Proportions from "@lucide/svelte/icons/proportions";
  import RectangleHorizontal from "@lucide/svelte/icons/rectangle-horizontal";
  import RectangleVertical from "@lucide/svelte/icons/rectangle-vertical";
  import { MARGIN_PRESETS, PAPER_NAMES, PAPERS, type PaperName } from "$lib/latex/margins";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { locale } from "$lib/state/locale.svelte";
  import { pageLayout } from "$lib/state/page-layout.svelte";
  import { project } from "$lib/state/project.svelte";
  import { fromCm, units } from "$lib/state/units.svelte";
  import PagePreview from "../../dialogs/PagePreview.svelte";
  import MarginsIcon from "../MarginsIcon.svelte";
  import RibbonButton from "../RibbonButton.svelte";
  import RibbonGroup from "../RibbonGroup.svelte";

  /** `A4`, `Letter`: a paper by its name. */
  const paperTitle = (name: PaperName) => (name.length === 2 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1));

  /** `21 × 29,7 cm`: width and height in cm, in the unit lengths are shown in. */
  function paperSize(width: number, height: number): string {
    const unit = units.current;
    const number = new Intl.NumberFormat(locale.current, { maximumFractionDigits: 2 });
    return `${number.format(fromCm(width, unit))} × ${number.format(fromCm(height, unit))} ${unit}`;
  }

  /** `A4 (21 × 29,7 cm)`: a paper by its name and size. */
  const paperLabel = (name: PaperName) => `${paperTitle(name)} (${paperSize(...PAPERS[name])})`;

  /**
   * The page the paper menu shows for `name` (the document's own paper for `null`): turned as the
   * document is, with its margins, the class's left to the normal ones, and its columns.
   */
  function pageFor(name: PaperName | null) {
    const setup = formatting.pageSetup;
    let paper = setup?.paper ?? { width: 21, height: 29.7 };
    if (name) {
      const [width, height] = PAPERS[name];
      paper = setup?.landscape ? { width: height, height: width } : { width, height };
    }
    const normal = MARGIN_PRESETS.metric.normal;
    const given = setup?.margins;
    const margins = {
      top: given?.top ?? normal.top,
      bottom: given?.bottom ?? normal.bottom,
      left: given?.left ?? normal.left,
      right: given?.right ?? normal.right,
    };
    return { paper, margins };
  }
</script>

<RibbonGroup label={m.ribbon_group_page_setup()}>
  <RibbonButton
    large
    icon={MarginsIcon}
    label={m.ribbon_margins()}
    title={m.ribbon_margins_title()}
    disabled={!project.config.main}
    onclick={() => (doc.marginsDialog = true)}
  />
  <!-- The whole document by the class, a part of it by multicol, as Word sets columns for a section. -->
  <RibbonButton
    large
    icon={Columns2}
    label={m.ribbon_columns()}
    title={m.ribbon_columns_title()}
    disabled={!project.config.main || !formatting.pageSetup}
    menu={[
      {
        label: m.columns_one(),
        heading: m.columns_document(),
        checked: formatting.documentColumns === 1,
        onclick: () => void formatting.setDocumentColumns(1),
      },
      { label: m.columns_two(), checked: formatting.documentColumns === 2, onclick: () => void formatting.setDocumentColumns(2) },
      {
        label: m.columns_part_two(),
        heading: m.columns_part(),
        checked: formatting.cursorColumns === 2,
        onclick: () => void formatting.setColumns(2),
      },
      { label: m.columns_part_three(), checked: formatting.cursorColumns === 3, onclick: () => void formatting.setColumns(3) },
      ...(formatting.cursorColumns ? [{ label: m.columns_part_off(), onclick: () => void formatting.setColumns(1) }] : []),
    ]}
  />
  <!-- What the main file sets is marked in the menus; the orientation's symbol shows it too. -->
  <RibbonButton
    large
    icon={formatting.pageSetup?.landscape ? RectangleHorizontal : RectangleVertical}
    label={m.ribbon_orientation()}
    title={m.ribbon_orientation_title()}
    disabled={!project.config.main || !formatting.pageSetup}
    menu={[
      {
        label: m.orientation_portrait(),
        icon: RectangleVertical,
        checked: formatting.pageSetup?.landscape === false,
        onclick: () => void pageLayout.setOrientation("portrait"),
      },
      {
        label: m.orientation_landscape(),
        icon: RectangleHorizontal,
        checked: formatting.pageSetup?.landscape === true,
        onclick: () => void pageLayout.setOrientation("landscape"),
      },
    ]}
  />
  <RibbonButton
    large
    icon={Proportions}
    label={m.ribbon_paper()}
    title={m.ribbon_paper_title()}
    disabled={!project.config.main || !formatting.pageSetup}
    menu={PAPER_NAMES.map((name) => ({
      label: paperLabel(name),
      checked: formatting.pageSetup?.paperName === name,
      onclick: () => void pageLayout.setPaper(name),
    }))}
    preview={paperPreview}
  />
</RibbonGroup>

<!-- Beside the paper menu: the page in the paper under the pointer, else in the document's, with its name and size. -->
{#snippet paperPreview(index: number | null)}
  {@const name = index === null ? (formatting.pageSetup?.paperName ?? null) : PAPER_NAMES[index]}
  {@const { paper, margins } = pageFor(name)}
  <PagePreview {paper} {margins} columns={formatting.documentColumns} width={paper.width > paper.height ? 150 : 110} />
  <span class="paper-caption">
    {#if name}<strong>{paperTitle(name)}</strong>{/if}
    <span>{paperSize(paper.width, paper.height)}</span>
  </span>
{/snippet}
