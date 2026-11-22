<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Copy from "@lucide/svelte/icons/copy";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import FileX from "@lucide/svelte/icons/file-x";
  import Package from "@lucide/svelte/icons/package";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import { m } from "$lib/paraglide/messages";
  import Button from "../ui/Button.svelte";
  import { explain, type Explanation, type Fix } from "$lib/latex/problems";
  import { translate, type Diagnostic } from "$lib/api";

  let open = $state(true);
  let showFollowUps = $state(false);

  const diagnostics = $derived(build.lastResult?.diagnostics ?? []);
  const missing = $derived(build.lastResult?.missingFiles ?? []);
  const notFound = $derived(build.lastResult?.missingProjectFiles ?? []);
  const errors = $derived(diagnostics.filter((d) => d.severity === "error").length);
  const warnings = $derived(diagnostics.length - errors);
  /** Anything to list; ignored warnings are not. */
  const shown = $derived(diagnostics.length > 0 || missing.length > 0 || notFound.length > 0);
  const installingAll = $derived(build.installAllProgress !== null);
  // While something is missing, the other messages are mostly its consequences.
  const hideFollowUps = $derived(missing.length > 0 && !showFollowUps);
  const followUpsLabel = $derived(hideFollowUps ? m.problems_follow_ups_show({ count: diagnostics.length }) : m.problems_follow_ups_hide());

  /** What a message means in plain words, for the line below it (see latex/problems.ts). */
  function explanationOf(d: Diagnostic): Explanation | null {
    return explain(d.message, build.diagnosticLine(d));
  }

  function explanationText(e: Explanation): string {
    return translate(`problem_${e.id}`, e.params) ?? "";
  }

  function fixLabel(fix: Fix): string {
    switch (fix.kind) {
      case "package":
        return m.problem_fix_package({ package: fix.name });
      case "escape":
        return m.problem_fix_escape({ code: `\\${fix.char}` });
      case "engine":
        return m.problem_fix_engine();
      case "compile":
        return m.problem_fix_compile();
      case "source":
        return m.problem_fix_source();
    }
  }

  /** A message as one line of text, as the row shows it: for the clipboard. */
  function diagnosticText(d: Diagnostic): string {
    const severity = d.severity === "error" ? m.problems_error() : m.problems_warning();
    const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}` : d.line ? m.problems_line({ line: d.line }) : "";
    return `${severity}: ${d.message}${where ? ` (${where})` : ""}`;
  }
  const missingText = (file: string) => `${m.problems_missing_file()} ${file}`;
  const notFoundText = (file: string) => `${m.problems_not_found()} ${file}`;

  /** Every row, also the follow-ups that are folded away. */
  const allText = $derived([...notFound.map(notFoundText), ...missing.map(missingText), ...diagnostics.map(diagnosticText)].join("\n"));

  /** Right-click menu of a row: its text and, for a message, the message; where it was clicked. */
  let menu = $state<{ x: number; y: number; text: string; diagnostic?: Diagnostic } | null>(null);
  /** Briefly true after "Copy all": the button shows a check mark. */
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  function openMenu(event: MouseEvent, text: string, diagnostic?: Diagnostic) {
    event.preventDefault();
    event.stopPropagation();
    menu = { x: event.clientX, y: event.clientY, text, diagnostic };
  }

  function ignoreFromMenu() {
    const diagnostic = menu?.diagnostic;
    menu = null;
    if (diagnostic) void build.ignoreWarning(diagnostic);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function copyRow() {
    const text = menu?.text;
    menu = null;
    if (text) await copy(text);
  }

  async function copyAll() {
    if (!(await copy(allText))) return;
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1500);
  }

  // A new build without missing files starts collapsed again next time.
  $effect(() => {
    if (missing.length === 0) showFollowUps = false;
  });
</script>

<svelte:window onclick={() => (menu = null)} onblur={() => (menu = null)} onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<!-- See `build.problemsVisible`; shown by Window > Problems with nothing to list, a single line. -->
{#if build.problemsVisible}
  <section class="problems">
    <div class="head">
      {#if shown}
        <button class="header" onclick={() => (open = !open)}>
          <span class="chevron" class:open>›</span>
          {m.problems_title()}
          {#if errors}<span class="count error">{errors}</span>{/if}
          {#if warnings}<span class="count warning">{warnings}</span>{/if}
        </button>
      {:else}
        <span class="header">{m.problems_title()} <span class="none">{m.problems_none()}</span></span>
      {/if}
      {#if build.ignoredWarnings > 0}
        <Button variant="ghost" class="muted" onclick={() => build.showIgnoredWarnings()}>
          {m.problems_ignored({ count: build.ignoredWarnings })}
        </Button>
      {/if}
      {#if shown}
        <Button variant="ghost" class="copy-all" title={m.problems_copy_all_title()} onclick={copyAll}>
          {#if copied}<Check size={13} />{m.problems_copied()}{:else}<Copy size={13} />{m.problems_copy_all()}{/if}
        </Button>
      {/if}
    </div>

    {#if open && shown}
      <ul>
        {#each notFound as file (file)}
          <li class="row missing" title={m.problems_not_found_title()} oncontextmenu={(e) => openMenu(e, notFoundText(file))}>
            <FileX size={14} />
            <span class="message">{m.problems_not_found()} <code>{file}</code></span>
          </li>
        {/each}
        {#each missing as file, i (file)}
          <li class="row missing" oncontextmenu={(e) => openMenu(e, missingText(file))}>
            <Package size={14} />
            <span class="message" title={file}>{m.problems_missing_file()} <code>{file}</code></span>
            {#if !installingAll}
              <Button variant="primary" disabled={packages.busy} onclick={() => build.installMissing(file)}>
                {packages.task ?? m.problems_install_package()}
              </Button>
            {/if}
            {#if i === 0}
              {#if installingAll}
                {@const progress = packages.task ?? m.problems_install_all_progress({ count: build.installAllProgress ?? 0 })}
                <span class="progress" title={progress}>{progress}</span>
                <Button onclick={() => build.stopInstallAll()}>{m.problems_install_all_stop()}</Button>
              {:else}
                <Button
                  variant="secondary"
                  title={m.problems_install_all_title()}
                  disabled={packages.busy}
                  onclick={() => build.installAllMissing()}
                >
                  {m.problems_install_all()}
                </Button>
              {/if}
            {/if}
          </li>
        {/each}
        {#if missing.length > 0 && diagnostics.length > 0}
          <li>
            <button class="row item follow-ups" onclick={() => (showFollowUps = !showFollowUps)}>
              <span class="message" title={followUpsLabel}>{followUpsLabel}</span>
            </button>
          </li>
        {/if}
        {#each hideFollowUps ? [] : diagnostics as d, i (i)}
          {@const explanation = explanationOf(d)}
          <li oncontextmenu={(e) => openMenu(e, diagnosticText(d), d)}>
            <button class="row item" onclick={() => build.goToDiagnostic(d)}>
              {#if d.severity === "error"}
                <CircleAlert size={14} class="icon-error" />
              {:else}
                <TriangleAlert size={14} class="icon-warning" />
              {/if}
              <span class="message" title={d.message}>{d.message}</span>
              {#if d.file}
                <span class="location path" title={d.line ? `${d.file}:${d.line}` : d.file}>{d.file}</span>
              {/if}
              {#if d.line}
                <span class="location">{d.file ? `:${d.line}` : m.problems_line({ line: d.line })}</span>
              {/if}
            </button>
            {#if explanation}
              <div class="explanation">
                <span>{explanationText(explanation)}</span>
                {#if explanation.fix}
                  {@const fix = explanation.fix}
                  <Button onclick={() => build.fixProblem(d, fix)}>{fixLabel(fix)}</Button>
                {/if}
                {#if d.severity === "warning"}
                  <Button title={m.problems_ignore_title()} onclick={() => build.ignoreWarning(d)}>{m.problems_ignore()}</Button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if menu}
  <div class="menu" role="menu" tabindex="-1" style:left="{menu.x}px" style:top="{menu.y}px">
    <button role="menuitem" onclick={copyRow}><Copy size={14} />{m.problems_copy()}</button>
    {#if menu.diagnostic?.severity === "warning"}
      <button role="menuitem" title={m.problems_ignore_title()} onclick={ignoreFromMenu}><EyeOff size={14} />{m.problems_ignore()}</button>
    {/if}
  </div>
{/if}

<style>
  .problems {
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    font-size: var(--font-sm);
  }

  .head {
    display: flex;
    align-items: center;
    padding-right: var(--space-4);
  }

  .head :global(.muted),
  .head :global(.copy-all) {
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .header {
    box-sizing: border-box;
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2) var(--space-5);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 600;
  }

  .none {
    color: var(--text-muted);
    font-weight: normal;
  }

  .chevron {
    display: inline-block;
    transition: transform 0.15s;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .count {
    min-width: 18px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--on-status);
    font-size: var(--font-xs);
    text-align: center;
  }

  .count.error {
    background: var(--error);
  }

  .count.warning {
    background: var(--warning);
  }

  ul {
    max-height: 160px;
    overflow-x: hidden;
    overflow-y: auto;
    margin: 0;
    padding: 0 0 var(--space-2);
    list-style: none;
  }

  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-1) var(--space-5) var(--space-1) var(--space-7);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .item:hover {
    background: var(--hover);
  }

  /* Icons, buttons and line numbers keep their size; only texts shrink. */
  .row > :global(*) {
    flex-shrink: 0;
  }

  .message,
  .progress,
  .path {
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message {
    flex: 1;
  }

  .progress {
    color: var(--text-muted);
  }

  .follow-ups {
    color: var(--text-muted);
    font-style: italic;
  }

  .location {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .location.path {
    max-width: 50%;
  }

  /* The message in plain words, under it, with the fix where there is one. */
  .explanation {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-5) var(--space-2) calc(var(--space-7) + 14px + var(--space-4));
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .explanation span {
    flex: 1;
    min-width: 0;
  }

  /* As the explorer's right-click menu. */
  .menu {
    position: fixed;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: var(--space-2) 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
    font-size: var(--font-md);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-5);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .menu button:hover {
    background: var(--hover);
  }
</style>
