<!-- The ribbon's Edit: the font, the paragraph and the heading styles. -->
<script lang="ts">
  import AlignCenter from "@lucide/svelte/icons/align-center";
  import AlignJustify from "@lucide/svelte/icons/align-justify";
  import AlignLeft from "@lucide/svelte/icons/align-left";
  import AlignRight from "@lucide/svelte/icons/align-right";
  import Baseline from "@lucide/svelte/icons/baseline";
  import Bold from "@lucide/svelte/icons/bold";
  import Hash from "@lucide/svelte/icons/hash";
  import Heading from "@lucide/svelte/icons/heading";
  import Highlighter from "@lucide/svelte/icons/highlighter";
  import Italic from "@lucide/svelte/icons/italic";
  import List from "@lucide/svelte/icons/list";
  import ListOrdered from "@lucide/svelte/icons/list-ordered";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Strikethrough from "@lucide/svelte/icons/strikethrough";
  import Underline from "@lucide/svelte/icons/underline";
  import { untrack, type Component } from "svelte";
  import type { FontFamily } from "$lib/api";
  import { ALIGN_SCOPES, ALIGNMENTS, type Alignment } from "$lib/latex/align";
  import { BULLET_KINDS, bulletActive, type BulletKind } from "$lib/latex/bullets";
  import { HIGHLIGHT_COLORS, TEXT_COLORS } from "$lib/latex/colors";
  import { CATALOG, fontLabel, fontModeOf, managedFontKey } from "$lib/latex/fonts";
  import { FONT_SIZES, type Emphasis } from "$lib/latex/format";
  import { HEADING_STYLES, headingLevel, type DepthCounter, type HeadingStyle } from "$lib/latex/headings";
  import { emphasisScopes, SCOPES } from "$lib/latex/scope";
  import { LINE_SPACINGS, PARAGRAPH_SPACINGS, type ParagraphSpacing } from "$lib/latex/spacing";
  import { m } from "$lib/paraglide/messages";
  import { available } from "$lib/state/availability.svelte";
  import { doc, type Tab } from "$lib/state/document.svelte";
  import { fonts } from "$lib/state/fonts.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { locale } from "$lib/state/locale.svelte";
  import { project } from "$lib/state/project.svelte";
  import { loadCatalogFonts, loadManagedFont, previewFamily } from "$lib/util/font-preview";
  import ColorPicker from "../ColorPicker.svelte";
  import LineSpacingIcon from "../LineSpacingIcon.svelte";
  import MultilevelListIcon from "../MultilevelListIcon.svelte";
  import RibbonButton from "../RibbonButton.svelte";
  import RibbonGroup from "../RibbonGroup.svelte";
  import ScopePicker from "../ScopePicker.svelte";

  /** Clicking the active tab again folds the panel away; switching to another tab unfolds it. */
  let collapsed = $state(false);

  function select(id: Tab) {
    if (id === "file") {
      if (doc.tab === "file") doc.leaveFile();
      else doc.showFile();
    } else if (doc.tab === id) collapsed = !collapsed;
    else doc.tab = id;
  }

  /**
   * Down to which heading the document numbers its headings, and lists them in the table of contents:
   * none, Heading 1, Heading 1–2, Heading 1–3, the one in effect checked.
   */
  const numberingMenu = $derived.by(() => {
    const choices = (counter: DepthCounter, current: number, heading: string) =>
      [0, 1, 2, 3].map((n) => {
        const level = headingLevel(n, formatting.chapters);
        return {
          label: n === 0 ? m.numbering_none() : n === 1 ? m.style_heading({ level: 1 }) : m.numbering_upto({ level: n }),
          heading: n === 0 ? heading : undefined,
          checked: current === level,
          onclick: () => void formatting.setHeadingDepth(counter, level),
        };
      });
    return [
      ...choices("secnumdepth", formatting.numberingDepth, m.numbering_depth_heading()),
      ...choices("tocdepth", formatting.contentsDepth, m.contents_depth_heading()),
    ];
  });

  /** The command a heading style sets in this document, for its tooltip. */
  const headingCommand = (style: Exclude<HeadingStyle, "normal">) =>
    `\\${(formatting.chapters ? ["chapter", "section", "subsection"] : ["section", "subsection", "subsubsection"])[style - 1]}`;

  /**
   * How the styles gallery shows a style: in the document's font, at the size the class sets it
   * relative to the text (\huge, \Large, \large, \normalsize), bold as LaTeX sets headings.
   * KOMA classes set headings sans-serif. The largest are capped to fit the gallery's rows.
   */
  const styleLook = (style: HeadingStyle) => {
    const heading = style !== "normal";
    const sans =
      heading &&
      /^scr(artcl|reprt|book)$/.test(formatting.documentClass) &&
      !CATALOG.some((font) => `tex:${font.id}` === formatting.documentFont && font.kind === "sans");
    const ratio = style === "normal" ? 1 : (formatting.chapters ? [2.07, 1.44, 1.2] : [1.44, 1.2, 1])[style - 1];
    return {
      family: previewFamily(sans ? "tex:latin-modern-sans" : formatting.documentFont),
      size: `${Math.min(12 * ratio, 18)}px`,
      weight: heading ? "700" : "400",
    };
  };

  /** Word's sizes; the one at the cursor too where the document sets another (`\Large`: 14,4). */
  const sizeChoices = $derived(
    (FONT_SIZES as readonly number[]).includes(formatting.cursorFontSize)
      ? FONT_SIZES
      : [...FONT_SIZES, formatting.cursorFontSize].sort((a, b) => a - b),
  );

  /** "10,5" as Word shows it: the number alone, in the language's notation. */
  const sizeLabel = (points: number) => new Intl.NumberFormat(locale.current, { maximumFractionDigits: 1 }).format(points);

  const paragraphSpacingNames: Record<ParagraphSpacing, () => string> = {
    indent: m.paragraph_spacing_indent,
    half: m.paragraph_spacing_half,
    full: m.paragraph_spacing_full,
  };

  /**
   * The spacing menu, as in Word: the line spacings for what the scope beside
   * it names, the one in effect there marked; below them the space between
   * paragraphs, which LaTeX sets for the whole document.
   */
  const spacingMenu = $derived.by(() => {
    const number = new Intl.NumberFormat(locale.current, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    const current = formatting.spacingTarget === "document" ? formatting.documentStretch : formatting.cursorStretch;
    return [
      ...LINE_SPACINGS.map((stretch, k) => ({
        label: number.format(stretch),
        heading: k === 0 ? m.line_spacing_heading() : undefined,
        checked: current === stretch,
        onclick: () => void formatting.setLineSpacing(stretch),
      })),
      ...PARAGRAPH_SPACINGS.map((spacing, k) => ({
        label: paragraphSpacingNames[spacing](),
        heading: k === 0 ? m.paragraph_spacing_heading() : undefined,
        checked: formatting.paragraphSpacing === spacing,
        onclick: () => void formatting.setParagraphSpacing(spacing),
      })),
    ];
  });

  const bulletNames: Record<BulletKind, { icon: Component<{ size?: number; class?: string }>; label: () => string; title: () => string }> =
    {
      itemize: { icon: List, label: m.ribbon_bullets, title: m.ribbon_bullets_title },
      enumerate: { icon: ListOrdered, label: m.ribbon_numbering, title: m.ribbon_numbering_title },
      multilevel: { icon: MultilevelListIcon, label: m.ribbon_multilevel, title: m.ribbon_multilevel_title },
    };

  const alignNames: Record<Alignment, { icon: typeof AlignLeft; label: () => string; title: () => string }> = {
    left: { icon: AlignLeft, label: m.ribbon_align_left, title: m.ribbon_align_left_title },
    center: { icon: AlignCenter, label: m.ribbon_align_center, title: m.ribbon_align_center_title },
    right: { icon: AlignRight, label: m.ribbon_align_right, title: m.ribbon_align_right_title },
    justify: { icon: AlignJustify, label: m.ribbon_align_justify, title: m.ribbon_align_justify_title },
  };

  const emphasisNames: Record<Emphasis, { icon: typeof Bold; label: () => string; title: () => string }> = {
    textbf: { icon: Bold, label: m.ribbon_bold, title: m.ribbon_bold_title },
    textit: { icon: Italic, label: m.ribbon_italic, title: m.ribbon_italic_title },
    underline: { icon: Underline, label: m.ribbon_underline, title: m.ribbon_underline_title },
    sout: { icon: Strikethrough, label: m.ribbon_strikethrough, title: m.ribbon_strikethrough_title },
  };

  /** Under XeLaTeX and LuaLaTeX the font list offers the system's fonts too, read once the edit tab shows. */
  const systemFontsShown = $derived(fontModeOf(project.config.engine) === "unicode");

  $effect(() => {
    if (systemFontsShown) void formatting.readSystemFonts();
  });

  /**
   * The list shows each font in itself; the catalog's are loaded from the distribution once the edit tab shows,
   * and the font manager's catalog is read, for the fonts installed with it.
   */
  $effect(() => {
    loadCatalogFonts();
    void fonts.load();
  });

  /** The font the list shows: the document's, or the one at the cursor where it acts on a part. */
  const shownFont = $derived(formatting.fontTarget === "document" ? formatting.documentFont : formatting.cursorFont);

  /** Fonts installed from the font manager that this engine can use, beyond the catalog above; no math fonts. */
  const installedFonts = $derived(
    fonts.families
      .filter((family) => family.installed && family.kind !== "math")
      .map((family) => ({ family, key: managedFontKey(family, fontModeOf(project.config.engine)) }))
      .filter((font): font is { family: FontFamily; key: string } => !!font.key && !font.key.startsWith("tex:"))
      .sort((a, b) => a.family.name.localeCompare(b.family.name)),
  );

  $effect(() => {
    const keys = [...installedFonts.map((font) => font.key), shownFont];
    // Loading tracks its progress in state, which must not run this again.
    untrack(() => keys.forEach(loadManagedFont));
  });

  /** A font the lists below do not offer (a setup of the project's own) is shown above them. */
  const fontListed = $derived(
    shownFont.startsWith("tex:")
      ? CATALOG.some((font) => `tex:${font.id}` === shownFont)
      : installedFonts.some((font) => font.key === shownFont) ||
          (systemFontsShown && formatting.systemFonts.some((family) => `system:${family}` === shownFont)),
  );

  /** The font list's last entry, which opens the font manager instead of setting a font. */
  const MORE_FONTS = "more:";
</script>

<RibbonGroup label={m.ribbon_group_font()}>
  <!--
    As in Word: the font and its size above, emphasis and the colours below. Right beside
    each, as a symbol, what it acts on (one for the emphases and colours, all character
    formatting), greyed out while text is selected, which is what they act on then.
  -->
  <div class="format font">
    <div class="row">
      <div class="scoped">
        <select
          class="font-family"
          aria-label={m.ribbon_font_family()}
          title={m.ribbon_font_family_title()}
          value={shownFont}
          style:font-family={previewFamily(shownFont)}
          disabled={!available(`format.${formatting.fontTarget}`)}
          onchange={(e) => {
            const key = e.currentTarget.value;
            // The list shows the font in effect, which changes with the text, not with the choice.
            e.currentTarget.value = shownFont;
            if (key === MORE_FONTS) fonts.dialog = true;
            else void formatting.setFont(key);
          }}
        >
          {#if !fontListed}
            <optgroup label={m.font_group_document()} style:font-family="var(--font-ui)">
              <option value={shownFont} style:font-family={previewFamily(shownFont)}>{fontLabel(shownFont)}</option>
            </optgroup>
            <hr />
          {/if}
          <!-- The catalog's fonts head the list, without a heading of their own. -->
          {#each CATALOG as font (font.id)}
            <option value={`tex:${font.id}`} style:font-family={previewFamily(`tex:${font.id}`)}>{font.name}</option>
          {/each}
          {#if installedFonts.length}
            <optgroup label={m.font_group_installed()} style:font-family="var(--font-ui)">
              {#each installedFonts as { family, key } (key)}
                <option value={key} style:font-family={previewFamily(key)}>{family.name}</option>
              {/each}
            </optgroup>
          {/if}
          {#if systemFontsShown && formatting.systemFonts.length}
            <optgroup label={m.font_group_system()} style:font-family="var(--font-ui)">
              {#each formatting.systemFonts as family (family)}
                <option value={`system:${family}`} style:font-family={previewFamily(`system:${family}`)}>{family}</option>
              {/each}
            </optgroup>
          {/if}
          <!--
            No font but a way to more, as "More symbols …" below the symbols: set off by a line,
            in the interface's font, not in the shown one, which the list's entries inherit (so
            do the group labels). A native list draws no margins around a line: an empty entry
            in a tiny font gives a little space before it, as high as its font.
          -->
          <option class="gap" disabled aria-hidden="true"></option>
          <hr />
          <option value={MORE_FONTS} style:font-family="var(--font-ui)">{m.font_more()}</option>
        </select>
        <ScopePicker
          label={m.ribbon_font_scope()}
          title={m.ribbon_font_scope_title()}
          choice={formatting.fontScope}
          scopes={SCOPES}
          disabled={!project.root || formatting.selected}
        />
      </div>
      <div class="scoped">
        <select
          class="font-size"
          aria-label={m.ribbon_font_size()}
          title={m.ribbon_font_size_title()}
          value={String(formatting.cursorFontSize)}
          disabled={!available(`format.${formatting.sizeTarget}`)}
          onchange={(e) => void formatting.fontSize(Number(e.currentTarget.value))}
        >
          {#each sizeChoices as points (points)}
            <option value={String(points)}>{sizeLabel(points)}</option>
          {/each}
        </select>
        <ScopePicker
          label={m.ribbon_size_scope()}
          title={m.ribbon_size_scope_title()}
          choice={formatting.sizeScope}
          scopes={SCOPES}
          disabled={!project.root || formatting.selected}
        />
      </div>
    </div>
    <div class="row">
      <!-- As wide as the row above: the emphases at the left, the colours at the right. -->
      <div class="scoped emphasis">
        {#each ["textbf", "textit", "underline", "sout"] as const as command (command)}
          <RibbonButton
            iconOnly
            icon={emphasisNames[command].icon}
            label={emphasisNames[command].label()}
            title={emphasisNames[command].title()}
            disabled={!available(`format.${formatting.emphasisTarget}`) || !emphasisScopes(command).includes(formatting.emphasisTarget)}
            onclick={() => void formatting.emphasize(command)}
          />
        {/each}
        <div class="colors">
          <ColorPicker
            icon={Baseline}
            color={formatting.textColor}
            colors={TEXT_COLORS}
            recent={formatting.customTextColors}
            label={m.ribbon_text_color()}
            title={m.ribbon_text_color_title()}
            none={m.color_automatic()}
            disabled={!available(`format.${formatting.emphasisTarget}`)}
            onpick={(color) => void formatting.setTextColor(color)}
          />
          <ColorPicker
            icon={Highlighter}
            color={formatting.highlightColor}
            colors={HIGHLIGHT_COLORS}
            recent={formatting.customHighlightColors}
            label={m.ribbon_highlight()}
            title={m.ribbon_highlight_title()}
            none={m.highlight_none()}
            disabled={!available(`format.${formatting.emphasisTarget}`) || formatting.emphasisTarget === "document"}
            onpick={(color) => void formatting.setHighlight(color)}
          />
        </div>
        <ScopePicker
          label={m.ribbon_emphasis_scope()}
          title={m.ribbon_emphasis_scope_title()}
          choice={formatting.emphasisScope}
          scopes={SCOPES}
          disabled={!project.root || formatting.selected}
        />
      </div>
    </div>
  </div>
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_paragraph()}>
  <!--
    As in Word: the lists above, the list the cursor is in pressed; they go in at the
    cursor, so they have no scope. Beside them line and paragraph spacing, with its own. Below, the alignment at the cursor pressed (the whole
    document's for that scope); beside it, what a click sets. Greyed out without a cursor
    where it acts at the cursor.
  -->
  <div class="format paragraph">
    <div class="row">
      {#each BULLET_KINDS as kind (kind)}
        <RibbonButton
          iconOnly
          icon={bulletNames[kind].icon}
          label={bulletNames[kind].label()}
          title={bulletNames[kind].title()}
          active={bulletActive(kind, formatting.cursorLists)}
          disabled={!project.config.main || !project.file?.endsWith(".tex")}
          onclick={() => void inserting.insertBullets(kind)}
        />
      {/each}
      <div class="scoped">
        <RibbonButton
          iconOnly
          icon={LineSpacingIcon}
          label={m.ribbon_spacing()}
          title={m.ribbon_spacing_title()}
          disabled={!project.config.main}
          menu={spacingMenu}
        />
        <ScopePicker
          label={m.ribbon_spacing_scope()}
          title={m.ribbon_spacing_scope_title()}
          choice={formatting.spacingScope}
          scopes={ALIGN_SCOPES}
          disabled={!project.root || formatting.selected}
        />
      </div>
    </div>
    <div class="row">
      <div class="scoped">
        {#each ALIGNMENTS as alignment (alignment)}
          <RibbonButton
            iconOnly
            icon={alignNames[alignment].icon}
            label={alignNames[alignment].label()}
            title={alignNames[alignment].title()}
            active={(formatting.alignTarget === "document" ? formatting.mainAlignment : formatting.cursorAlignment) === alignment}
            disabled={!available(`align.${formatting.alignTarget}`)}
            onclick={() => void formatting.align(alignment)}
          />
        {/each}
        <ScopePicker
          label={m.ribbon_align_scope()}
          title={m.ribbon_align_scope_title()}
          choice={formatting.alignScope}
          scopes={ALIGN_SCOPES}
          disabled={!project.root || formatting.selected}
        />
      </div>
    </div>
  </div>
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_styles()}>
  <!-- As Word's gallery: each style shown as it looks in the document, the one at the cursor marked. -->
  <div class="styles" role="radiogroup" aria-label={m.ribbon_group_styles()}>
    {#each HEADING_STYLES as style (style)}
      {@const look = styleLook(style)}
      <button
        class="style"
        style:font-family={look.family}
        style:font-size={look.size}
        style:font-weight={look.weight}
        role="radio"
        aria-checked={formatting.headingStyle === style}
        class:active={formatting.headingStyle === style}
        disabled={!project.file?.endsWith(".tex")}
        title={style === "normal" ? m.style_normal_title() : m.style_heading_title({ command: headingCommand(style) })}
        onclick={() => formatting.setHeadingStyle(style)}
      >
        {style === "normal" ? m.style_normal() : m.style_heading({ level: style })}
      </button>
    {/each}
  </div>
  <!-- The heading at the cursor numbered or not above; below, how deep the whole document numbers and lists them. -->
  <div class="numbering">
    <RibbonButton
      icon={Hash}
      label={m.style_numbered()}
      title={m.style_numbered_title()}
      active={formatting.headingNumbered}
      disabled={!project.file?.endsWith(".tex") || formatting.headingStyle === "normal"}
      onclick={() => void formatting.toggleHeadingNumbering()}
    />
    <RibbonButton
      icon={ListTree}
      label={m.numbering_menu()}
      title={m.numbering_menu_title()}
      disabled={!project.config.main}
      menu={numberingMenu}
    />
  </div>
</RibbonGroup>
