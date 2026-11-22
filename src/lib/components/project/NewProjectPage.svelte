<script lang="ts">
  import type { Component } from "svelte";
  import FileText from "@lucide/svelte/icons/file-text";
  import GraduationCap from "@lucide/svelte/icons/graduation-cap";
  import Mail from "@lucide/svelte/icons/mail";
  import Presentation from "@lucide/svelte/icons/presentation";
  import { api, errorMessage } from "$lib/api";
  import { TEMPLATE_IDS, type TemplateId } from "$lib/config/templates";
  import { m } from "$lib/paraglide/messages";
  import { isRemoteUrl } from "$lib/util/git-url";
  import { doc } from "$lib/state/document.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import GitIdentity, { identityValid, missingIdentity, type Identity } from "../git/GitIdentity.svelte";
  import GitMissing from "../git/GitMissing.svelte";
  import ProjectTarget, { targetPath } from "./ProjectTarget.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  let templateId = $state<TemplateId>("article");
  let name = $state("");
  let location = $state("");
  let inNewWindow = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Name and location are asked for only once a template is chosen. */
  let dialog = $state<HTMLDialogElement>();
  /** Set up as a Git repository with a first commit (and published, if a server is given). */
  let withGit = $state(false);
  let url = $state("");
  /** Git is not installed: the repository cannot be set up. */
  let gitMissing = $state(false);
  /** Name and e-mail for commits, asked for only when Git has none (a fresh installation). */
  let identity = $state<Identity | null>(null);
  /** The project was made, but setting up the repository or publishing it failed. */
  let problem = $state<string | null>(null);

  const templates = $derived<Record<TemplateId, { name: string; text: string; icon: Component }>>({
    article: { name: m.template_article(), text: m.template_article_text(), icon: FileText },
    thesis: { name: m.template_thesis(), text: m.template_thesis_text(), icon: GraduationCap },
    presentation: { name: m.template_presentation(), text: m.template_presentation_text(), icon: Presentation },
    letter: { name: m.template_letter(), text: m.template_letter_text(), icon: Mail },
  });

  /** HTTP(S), SSH, or `user@host:path`, as `git.rs` accepts them. */
  const urlValid = $derived(!url.trim() || isRemoteUrl(url.trim()));
  const ready = $derived(!!targetPath(location, name) && (!withGit || (!gitMissing && urlValid && identityValid(identity))));

  function choose(id: TemplateId) {
    templateId = id;
    error = problem = null;
    dialog?.showModal();
  }

  /** Git is looked at only once it is wanted: a project without it needs nothing of Git. */
  async function checkGit() {
    if (!withGit) return;
    gitMissing = false;
    try {
      identity = await missingIdentity();
    } catch {
      gitMissing = true;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    busy = true;
    error = null;
    try {
      if (withGit) {
        if (identity) {
          await api.gitSetIdentity(identity.name, identity.email);
          identity = null;
        }
        const remote = url.trim() || null;
        problem = await doc.createGitProject(location, name, templateId, m.git_first_commit(), remote, inNewWindow);
      } else {
        await doc.createProject(location, name, templateId, inNewWindow);
      }
      settings.update({ projectLocation: location });
      // Opened in another window, this page stays: ready for the next project.
      name = url = "";
      // On a problem the dialog stays to tell it; the project is open behind it.
      if (!problem) dialog?.close();
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<h2>{m.new_project_template()}</h2>
<div class="templates">
  {#each TEMPLATE_IDS as id (id)}
    {@const t = templates[id]}
    <button type="button" class="template" onclick={() => choose(id)}>
      <!-- A sketch of the first page, so the choice is seen rather than read. -->
      <span class="thumb {id}" aria-hidden="true">
        <span class="sheet">
          <t.icon size={22} strokeWidth={1.5} />
          <span class="line long"></span>
          <span class="line"></span>
          <span class="line short"></span>
        </span>
      </span>
      <strong>{t.name}</strong>
      <span class="text">{t.text}</span>
    </button>
  {/each}
</div>

<Dialog bind:dialog width={480} oncancel={(e) => busy && e.preventDefault()}>
  {#if problem}
    <div class="done">
      <h1>{templates[templateId].name}</h1>
      <p>{m.git_init_problem()}</p>
      <p class="error">{problem}</p>
      <footer>
        <Button variant="primary" onclick={() => dialog?.close()}>{m.git_close()}</Button>
      </footer>
    </div>
  {:else}
    <form onsubmit={submit}>
      <h1>{templates[templateId].name}</h1>
      <ProjectTarget bind:name bind:location bind:inNewWindow disabled={busy} />

      <label class="check">
        <input type="checkbox" bind:checked={withGit} onchange={checkGit} disabled={busy} />
        {m.git_init_title()}
      </label>

      {#if withGit}
        <div class="git">
          {#if gitMissing}<GitMissing onretry={checkGit} />{/if}

          <label class="field">
            <span>{m.git_remote_optional()}</span>
            <input
              class="mono"
              bind:value={url}
              placeholder={m.git_url_placeholder()}
              spellcheck="false"
              autocomplete="off"
              disabled={busy}
            />
          </label>
          <p class="hint">{url.trim() && !urlValid ? m.git_url_invalid() : m.git_remote_hint()}</p>

          {#if identity}<GitIdentity bind:identity disabled={busy} />{/if}
        </div>
      {/if}

      {#if busy && withGit}<p class="progress">{m.git_initializing()}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}
      <footer>
        <Button onclick={() => dialog?.close()} disabled={busy}>{m.new_project_cancel()}</Button>
        <Button type="submit" variant="primary" disabled={busy || !ready}>
          {m.new_project_create()}
        </Button>
      </footer>
    </form>
  {/if}
</Dialog>

<style>
  h2 {
    margin: var(--space-7) 0 var(--space-4);
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--text-muted);
  }

  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-5);
  }

  .template {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 150ms ease,
      background-color 150ms ease,
      box-shadow 150ms ease,
      transform 150ms ease;
  }

  .template:hover {
    border-color: var(--accent-strong);
    background: var(--hover);
    transform: translateY(-1px);
  }

  .template:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 2px;
  }

  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
    margin-bottom: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--canvas);
  }

  .sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    width: 74px;
    height: 100px;
    padding: var(--space-4);
    box-sizing: border-box;
    background: var(--paper);
    box-shadow: var(--shadow-page);
    color: var(--accent-strong);
  }

  .presentation .sheet {
    width: 124px;
    height: 70px;
  }

  /* Letters start with the address, top left. */
  .letter .sheet {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .line {
    display: block;
    width: 70%;
    height: 3px;
    border-radius: var(--radius-pill);
    background: var(--border);
  }

  .line.long {
    width: 90%;
  }

  .line.short {
    width: 45%;
  }

  .template strong {
    font-size: var(--font-base);
  }

  .text {
    color: var(--text-muted);
    font-size: var(--font-sm);
    line-height: 1.4;
  }

  h1 {
    margin-bottom: var(--space-5);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
    font-size: var(--font-base);
  }

  .check input {
    margin: 0;
    accent-color: var(--accent-strong);
  }

  .git {
    margin-top: var(--space-5);
  }

  .field input {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    font-weight: normal;
  }

  .field input.mono {
    font-family: var(--font-mono);
    font-size: var(--font-md);
  }

  .field input:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  .hint {
    margin: calc(-1 * var(--space-3)) 0 var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  .progress {
    margin: var(--space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  .done p {
    margin: 0 0 var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  .error,
  .done p.error {
    margin: var(--space-3) 0 0;
    color: var(--error);
    font-size: var(--font-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .template:hover {
      transform: none;
    }
  }
</style>
