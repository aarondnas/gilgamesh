<!-- The ribbon's Start: editing, the AI's changes to review, search, notes and building. -->
<script lang="ts">
  import CheckCheck from "@lucide/svelte/icons/check-check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Focus from "@lucide/svelte/icons/focus";
  import History from "@lucide/svelte/icons/history";
  import Search from "@lucide/svelte/icons/search";
  import StickyNote from "@lucide/svelte/icons/sticky-note";
  import X from "@lucide/svelte/icons/x";
  import type { Engine } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { build } from "$lib/state/build.svelte";
  import { doc, type Tab } from "$lib/state/document.svelte";
  import { formatting } from "$lib/state/formatting.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import { review } from "$lib/state/review.svelte";
  import RibbonButton from "../RibbonButton.svelte";
  import RibbonGroup from "../RibbonGroup.svelte";

  /** Clicking the active tab again folds the panel away; switching to another tab unfolds it. */
  let collapsed = $state(false);

  function select(id: Tab) {
    if (id === "file") {
      if (doc.tab === "file") doc.leaveFile();
      else doc.showFile();
    } else if (doc.tab === id) collapsed = !collapsed;
    else doc.tab = id;
  }

  /** The engine list goes back to the engine in effect where the switch was declined. */
  function switchEngine(select: HTMLSelectElement) {
    void doc.setEngine(select.value as Engine).then(() => (select.value = project.config.engine));
  }

  const engines: { id: Engine; label: string }[] = [
    { id: "lualatex", label: "LuaLaTeX" },
    { id: "xelatex", label: "XeLaTeX" },
    { id: "pdflatex", label: "pdfLaTeX" },
  ];
</script>

<RibbonGroup label={m.ribbon_group_edit()}>
  <RibbonButton
    large
    icon={History}
    label={m.ribbon_history()}
    title={m.ribbon_history_title()}
    disabled={!project.file}
    onclick={() => (doc.historyFor = project.file)}
  />
  <div class="stack options">
    <label title={m.ribbon_auto_save_title()}>
      <input type="checkbox" bind:checked={doc.autoSave} />
      {m.ribbon_auto_save()}
    </label>
  </div>
</RibbonGroup>

<RibbonGroup label={m.review_group()}>
  <div class="review-nav">
    <RibbonButton
      iconOnly
      icon={ChevronUp}
      label={m.review_previous()}
      title={m.review_previous()}
      disabled={review.count === 0}
      onclick={() => void review.previous()}
    />
    <span class="review-count" class:none={review.count === 0}>
      {review.shown === null ? "–" : review.shown + 1} / {review.count}
    </span>
    <RibbonButton
      iconOnly
      icon={ChevronDown}
      label={m.review_next()}
      title={m.review_next()}
      disabled={review.count === 0}
      onclick={() => void review.next()}
    />
  </div>
  <RibbonButton
    large
    icon={CheckCheck}
    label={m.review_accept_all()}
    title={m.review_accept_all_title()}
    disabled={review.count === 0}
    onclick={() => review.acceptAll()}
  />
  <RibbonButton
    large
    icon={X}
    label={m.review_reject_all()}
    title={m.review_reject_all_title()}
    disabled={review.count === 0}
    onclick={() => void review.rejectAll()}
  />
</RibbonGroup>

<RibbonGroup label={m.ribbon_group_search()}>
  <RibbonButton
    large
    icon={Search}
    label={m.ribbon_search()}
    title={m.ribbon_search_title()}
    disabled={!project.root}
    onclick={() => void doc.openSearch()}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_notes()}>
  <RibbonButton
    large
    icon={StickyNote}
    label={m.ribbon_note()}
    title={m.ribbon_note_title()}
    disabled={!project.config.main || !project.file?.endsWith(".tex")}
    menu={[
      { label: m.note_margin(), onclick: () => void inserting.insertNote(false) },
      { label: m.note_inline(), onclick: () => void inserting.insertNote(true) },
      { label: m.note_next(), heading: m.note_group_review(), onclick: () => void inserting.nextNote() },
      { label: m.note_hide(), checked: formatting.notesHidden, onclick: () => void inserting.setNotesHidden(!formatting.notesHidden) },
    ]}
  />
</RibbonGroup>
<RibbonGroup label={m.ribbon_group_compile()}>
  <RibbonButton
    large
    icon={Focus}
    label={m.ribbon_current_only()}
    title={m.ribbon_current_only_title()}
    active={build.compileCurrentOnly}
    disabled={!project.file || project.includeOnlyArgument(project.file) === null}
    onclick={() => {
      build.compileCurrentOnly = !build.compileCurrentOnly;
      void build.compile();
    }}
  />
  <div class="stack options">
    <label>
      {m.ribbon_engine()}
      <select value={project.config.engine} disabled={!project.root} onchange={(e) => switchEngine(e.currentTarget)}>
        {#each engines as engine (engine.id)}
          <option value={engine.id}>{engine.label}</option>
        {/each}
      </select>
    </label>
    <label>
      <input type="checkbox" bind:checked={build.autoCompile} />
      {m.ribbon_auto_compile()}
    </label>
    <label title={m.ribbon_auto_install_title()}>
      <input type="checkbox" bind:checked={build.autoInstall} />
      {m.ribbon_auto_install()}
    </label>
  </div>
</RibbonGroup>
