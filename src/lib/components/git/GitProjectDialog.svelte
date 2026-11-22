<script lang="ts">
  import { untrack } from "svelte";
  import { api, errorMessage } from "$lib/api";
  import { TEMPLATE_IDS, type TemplateId } from "$lib/config/templates";
  import { m } from "$lib/paraglide/messages";
  import { isRemoteUrl } from "$lib/util/git-url";
  import { doc } from "$lib/state/document.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import GitIdentity, { identityValid, missingIdentity, type Identity } from "./GitIdentity.svelte";
  import GitMissing from "./GitMissing.svelte";
  import ProjectTarget, { targetPath } from "../project/ProjectTarget.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Segmented from "../ui/Segmented.svelte";

  /**
   * A project in a Git repository: made new from a template (and published to an
   * empty repository on a server, if one is given), or cloned from a server.
   */
  let mode = $state<"init" | "clone">("init");
  /** Both ways are offered (the start page); from "New" or "Open" only the one that fits. */
  let choice = $state(false);
  const title = $derived(choice ? m.git_project_title() : mode === "init" ? m.git_init_title() : m.git_clone());
  let url = $state("");
  let templateId = $state<TemplateId>("article");
  let name = $state("");
  let location = $state("");
  let inNewWindow = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** Git is not installed: nothing here can work. */
  let gitMissing = $state(false);
  /** Name and e-mail for commits, asked for only when Git has none (a fresh installation). */
  let identity = $state<Identity | null>(null);
  /** The project was made, but setting up the repository or publishing it failed. */
  let problem = $state<string | null>(null);
  /** The name taken from the link last; replaced as the link changes, unless the user typed another. */
  let suggested = "";

  const templates = $derived<Record<TemplateId, string>>({
    article: m.template_article(),
    thesis: m.template_thesis(),
    presentation: m.template_presentation(),
    letter: m.template_letter(),
  });

  /** HTTP(S), SSH, or `user@host:path`, as `git.rs` accepts them. */
  /** Required for cloning; for a new repository only if something was typed. */
  const urlValid = $derived(mode === "clone" ? isRemoteUrl(url.trim()) : !url.trim() || isRemoteUrl(url.trim()));
  const ready = $derived(!gitMissing && urlValid && identityValid(identity) && !!targetPath(location, name));

  /** "https://github.com/me/thesis.git" → "thesis". */
  const repoName = (value: string) =>
    value
      .trim()
      .replace(/[\\/]+$/, "")
      .split(/[\\/:]/)
      .pop()
      ?.replace(/\.git$/i, "") ?? "";

  $effect(() => {
    const suggestion = repoName(url);
    untrack(() => {
      if (name === suggested) name = suggestion;
      suggested = suggestion;
    });
  });

  function show(opened: "init" | "clone" | "either") {
    choice = opened === "either";
    mode = opened === "clone" ? "clone" : "init";
    url = name = suggested = "";
    inNewWindow = false;
    error = problem = null;
    identity = null;
    void checkGit();
  }

  /** Git and who commits; asked again from the notice once Git is installed. */
  async function checkGit() {
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
      if (identity) {
        await api.gitSetIdentity(identity.name, identity.email);
        identity = null;
      }
      if (mode === "clone") {
        await doc.cloneProject(url.trim(), location, name, inNewWindow);
      } else {
        const remote = url.trim() || null;
        problem = await doc.createGitProject(location, name, templateId, m.git_first_commit(), remote, inNewWindow);
        // All went well: nothing more to say. Otherwise the dialog stays, the project is open behind it.
        if (!problem) doc.gitProject = null;
      }
      settings.update({ projectLocation: location });
    } catch (err) {
      error = mode === "clone" ? m.git_clone_failed({ message: errorMessage(err) }) : errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  open={!!doc.gitProject}
  width={560}
  onopen={() => show(doc.gitProject!)}
  onclose={() => !busy && (doc.gitProject = null)}
  oncancel={(e) => busy && e.preventDefault()}
>
  {#if problem}
    <div class="done">
      <h1>{title}</h1>
      <p>{m.git_init_problem()}</p>
      <p class="error">{problem}</p>
      <footer>
        <Button variant="primary" onclick={() => (doc.gitProject = null)}>{m.git_close()}</Button>
      </footer>
    </div>
  {:else}
    <form onsubmit={submit}>
      <h1>{title}</h1>

      {#if choice}
        <div class="mode">
          <Segmented
            options={[
              { value: "init", label: m.git_mode_init() },
              { value: "clone", label: m.git_mode_clone() },
            ]}
            bind:value={mode}
          />
        </div>
      {/if}
      <p class="intro">{mode === "init" ? m.git_init_text() : m.git_clone_text()}</p>

      {#if gitMissing}
        <GitMissing onretry={checkGit} />
      {/if}

      {#if mode === "init"}
        <label class="field">
          <span>{m.git_template()}</span>
          <select bind:value={templateId} disabled={busy}>
            {#each TEMPLATE_IDS as id (id)}<option value={id}>{templates[id]}</option>{/each}
          </select>
        </label>
      {/if}

      <label class="field">
        <span>{mode === "init" ? m.git_remote_optional() : m.git_url()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="mono"
          bind:value={url}
          placeholder={m.git_url_placeholder()}
          spellcheck="false"
          autocomplete="off"
          autofocus={mode === "clone"}
          disabled={busy}
        />
      </label>
      {#if url.trim() && !urlValid}
        <p class="hint">{m.git_url_invalid()}</p>
      {:else if mode === "init"}
        <p class="hint">{m.git_remote_hint()}</p>
      {/if}

      {#if identity}<GitIdentity bind:identity disabled={busy} />{/if}

      <ProjectTarget bind:name bind:location bind:inNewWindow disabled={busy} />
      {#if busy}<p class="progress">{mode === "clone" ? m.git_cloning() : m.git_initializing()}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}

      <footer>
        <Button onclick={() => (doc.gitProject = null)} disabled={busy}>{m.new_project_cancel()}</Button>
        <Button type="submit" variant="primary" disabled={busy || !ready}>
          {mode === "clone" ? m.git_clone_submit() : m.git_init_submit()}
        </Button>
      </footer>
    </form>
  {/if}
</Dialog>

<style>
  h1 {
    margin-bottom: var(--space-5);
  }

  .mode {
    display: flex;
    margin-bottom: var(--space-4);
  }

  .intro,
  .done p {
    margin: 0 0 var(--space-5);
    color: var(--text-muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  input.mono {
    font-family: var(--font-mono);
    font-size: var(--font-md);
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

  .error,
  .done p.error {
    margin: var(--space-3) 0 0;
    color: var(--error);
    font-size: var(--font-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
