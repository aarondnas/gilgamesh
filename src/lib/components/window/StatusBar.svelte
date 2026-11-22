<script lang="ts">
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import { assistantActivity } from "$lib/mcp/assistant.svelte";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { project } from "$lib/state/project.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import { updates } from "$lib/state/updates.svelte";
  import { m } from "$lib/paraglide/messages";
  import { getLocale } from "$lib/paraglide/runtime";

  const number = $derived(new Intl.NumberFormat(getLocale()));

  const buildText = $derived.by(() => {
    if (build.building) return m.status_compiling();
    if (doc.error) return doc.error;
    const r = build.lastResult;
    if (!r) return "";
    const seconds = (r.durationMs / 1000).toLocaleString(getLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const errors = r.diagnostics.filter((d) => d.severity === "error").length;
    return r.status === "success" ? m.status_compiled({ seconds }) : m.status_failed({ errors, seconds });
  });
</script>

<footer class="status">
  <!-- The folded project explorer takes no room of its own: it folds and unfolds from here. -->
  {#if project.root}
    {@const collapsed = settings.data.sidebarCollapsed}
    <button
      class="fold"
      title={collapsed ? m.sidebar_show() : m.sidebar_hide()}
      aria-label={collapsed ? m.sidebar_show() : m.sidebar_hide()}
      aria-expanded={!collapsed}
      onclick={() => settings.update({ sidebarCollapsed: !collapsed })}
    >
      {#if collapsed}<PanelLeftOpen size={14} />{:else}<PanelLeftClose size={14} />{/if}
    </button>
  {/if}
  <span class="file" title={project.file ? project.absolute(project.file) : (project.root ?? "")}>
    {project.file ? `${project.name}/${project.file}` : project.name}
  </span>
  <span class:error={!!doc.error || build.lastResult?.status === "failed"}>{buildText}</span>
  <span class="spacer"></span>
  {#if assistantActivity.tool}<span>{m.status_assistant({ tool: assistantActivity.tool })}</span>{/if}
  {#if packages.task}<span>{packages.task}</span>{/if}
  <!-- A new version of Gilgamesh (see updates.svelte.ts): installed from the settings. -->
  {#if updates.status?.installing}
    <span>{updates.percent != null ? m.update_downloading({ percent: updates.percent }) : m.update_downloading_unknown()}</span>
  {:else if updates.available}
    <button class="update" onclick={() => doc.openSettings("updates")}>{m.status_update_available({ version: updates.available })}</button>
  {/if}
  {#if doc.words}
    <button
      class="words"
      title={m.status_words_title({
        text: number.format(doc.words.text),
        headers: number.format(doc.words.headers),
        captions: number.format(doc.words.captions),
      })}
      popovertarget="word-parts"
      onclick={() => doc.countWords(true)}
    >
      {m.status_words({ count: doc.words.total, formatted: number.format(doc.words.total) })}
    </button>
    <!-- The words per chapter, above the bar: counted again with each click. -->
    <div id="word-parts" popover="auto" class="word-parts">
      <table>
        <tbody>
          {#each doc.words.parts as part, i (i)}
            {#if part.title || part.words}
              <tr>
                <td class:muted={!part.title}>{part.title || m.status_words_before()}</td>
                <td class="count">{number.format(part.words)}</td>
              </tr>
            {/if}
          {/each}
          <tr class="total">
            <td>{m.status_words_total()}</td>
            <td class="count">{number.format(doc.words.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
  <span>
    {#if packages.status?.manifest}
      TinyTeX {packages.status.manifest.version}
    {:else if !packages.installed}
      {m.status_latex_missing()}
    {/if}
  </span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    height: var(--statusbar-height);
    padding: 0 var(--space-5);
    background: var(--accent);
    color: var(--on-accent);
    font-size: var(--font-sm);
    white-space: nowrap;
  }

  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 45%;
    color: var(--on-accent-muted);
  }

  .error {
    font-weight: 600;
  }

  .words,
  .update {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
  }

  /* Flush with the window's left edge, as high as the bar. */
  .fold {
    display: flex;
    align-items: center;
    align-self: stretch;
    margin-left: calc(-1 * var(--space-5));
    margin-right: calc(-1 * var(--space-6) + var(--space-3));
    padding: 0 var(--space-4);
    border: none;
    background: none;
    color: var(--on-accent-muted);
  }

  .fold:hover {
    background: var(--on-accent-hover);
    color: var(--on-accent);
  }

  .words:hover,
  .update:hover {
    text-decoration: underline;
  }

  .update {
    font-weight: 600;
  }

  .word-parts {
    position: fixed;
    inset: auto var(--space-5) calc(var(--statusbar-height) + var(--space-2)) auto;
    max-height: 60vh;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-size: var(--font-sm);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
  }

  .word-parts table {
    border-collapse: collapse;
  }

  .word-parts td {
    max-width: 320px;
    padding: var(--space-1) var(--space-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .word-parts .count {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .word-parts .muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .word-parts .total td {
    border-top: 1px solid var(--border);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }
</style>
