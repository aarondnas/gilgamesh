<script lang="ts" module>
  /** Repositories whose trust was asked for in this session; "No" is not asked again until a restart. */
  const asked = new Set<string>();
</script>

<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { onMount } from "svelte";
  import { api, errorMessage, events, type GitChangeKind, type GitFileChange, type GitInfo, type GitStatus } from "$lib/api";
  import { opensInTab } from "$lib/config/project-files";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { project } from "$lib/state/project.svelte";
  import { fileName, parentDir } from "$lib/util/paths";
  import { identityValid } from "./GitIdentity.svelte";
  import GitMissing from "./GitMissing.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  /** Changes on disk arrive in bursts (several saves, a build); the status is read once after them. */
  const REFRESH_DELAY = 400;

  /** `null` while asking the backend. */
  let info = $state<GitInfo | null>(null);
  let status = $state<GitStatus | null>(null);
  let error = $state<string | null>(null);
  /** What is running: a Git command takes a moment, a sync over the network longer. */
  let busy = $state<"commit" | "sync" | "fetch" | "stage" | "init" | "remote" | "identity" | "trust" | null>(null);
  let message = $state("");
  /** Name and e-mail for commits, asked for only while Git has none (a fresh installation). */
  let identity = $state<{ name: string; email: string } | null>(null);
  const complete = $derived(!!identity && identityValid(identity));
  /** The link typed to connect a repository without remote; `null` while the field is closed. */
  let remoteUrl = $state<string | null>(null);
  /** The repository whose authors the user is asked to trust, while the question shows. */
  let askTrust = $state<string | null>(null);

  const staged = $derived(status?.files.filter((f) => f.staged) ?? []);
  const unstaged = $derived(status?.files.filter((f) => f.unstaged) ?? []);
  /**
   * Commits that are not on the remote yet: until they are synced (or the branch
   * is published), syncing takes the place of committing. Without a remote there
   * is nothing to sync to, so committing stays.
   */
  const unsynced = $derived(!!status?.hasRemote && !!status.branch && (status.ahead > 0 || (!status.upstream && status.hasCommits)));
  /** Nothing staged: committing takes all changes, as VS Code offers it. */
  const commitsAll = $derived(staged.length === 0 && unstaged.length > 0);

  async function refresh(root: string | null) {
    if (!root) {
      info = { available: false, repository: null };
      status = null;
      return;
    }
    const next = await api.gitInfo(root).catch(() => null);
    // Git reads nothing of an untrusted repository beyond where it is (see `git/trust.rs`).
    const trusted = !!next?.repository?.trusted;
    const nextStatus = trusted ? await api.gitStatus(root).catch((e) => ((error = errorMessage(e)), null)) : null;
    const who = trusted ? await api.gitIdentity().catch(() => null) : null;
    if (project.root !== root) return;
    info = next;
    status = nextStatus;
    // Asked once per repository and session, as VS Code asks when a folder opens.
    if (next?.repository && !trusted && !asked.has(next.repository.path)) {
      asked.add(next.repository.path);
      askTrust = next.repository.path;
    }
    // Kept while typed into; asked for again only if Git still lacks it.
    if (who && (!who.name || !who.email)) identity ??= { name: who.name ?? "", email: who.email ?? "" };
    else identity = null;
  }

  $effect(() => {
    error = null;
    message = "";
    void refresh(project.root);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(project.root), REFRESH_DELAY);
  };

  // Files change by saving, by the AI, outside Gilgamesh: the lists follow.
  onMount(() => {
    const stop = events.onProjectChanges(refreshSoon);
    window.addEventListener("focus", refreshSoon);
    return () => {
      clearTimeout(timer);
      void stop.then((unlisten) => unlisten());
      window.removeEventListener("focus", refreshSoon);
    };
  });

  /** Runs a Git action on the saved files and shows the result, or what went wrong. */
  async function act(kind: NonNullable<typeof busy>, action: (root: string) => Promise<unknown>) {
    const root = project.root;
    if (!root || busy) return;
    busy = kind;
    error = null;
    try {
      // Git reads the files on disk: the editor's last keystrokes go there first.
      await project.flush();
      await action(root);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = null;
      await refresh(root);
    }
  }

  const stage = (files: GitFileChange[]) => act("stage", (root) => api.gitStage(root, paths(files)));
  const unstage = (files: GitFileChange[]) => act("stage", (root) => api.gitUnstage(root, paths(files)));

  /** A rename's old name goes along, so Git sees both sides of it. */
  const paths = (files: GitFileChange[]) => files.flatMap((f) => (f.original ? [f.path, f.original] : [f.path]));

  function commit() {
    const text = message.trim();
    if (!text || (staged.length === 0 && unstaged.length === 0)) return;
    void act("commit", async (root) => {
      if (commitsAll) await api.gitStage(root, paths(unstaged));
      await api.gitCommit(root, text);
      message = "";
    });
  }

  /**
   * Makes a text field exactly as high as its text: one line when empty, more
   * as lines are added or wrap, less again when they go (also when the text is
   * cleared after a commit, hence `text`).
   */
  function fitContent(node: HTMLTextAreaElement, _text: string) {
    const fit = () => {
      node.style.height = "auto";
      const style = getComputedStyle(node);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      node.style.height = `${node.scrollHeight + borders}px`;
    };
    fit();
    // Narrower or wider, the text wraps differently; its own height changes are no reason.
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      fit();
    });
    observer.observe(node);
    return { update: fit, destroy: () => observer.disconnect() };
  }

  function onMessageKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      commit();
    }
  }

  /** Asks the remote what is new before showing the lists again. */
  const fetchAndRefresh = () => act("fetch", (root) => (status?.hasRemote ? api.gitFetch(root) : Promise.resolve()));

  function open(file: GitFileChange) {
    const path = file.projectPath;
    const gone = file.unstaged === "deleted" || (file.staged === "deleted" && !file.unstaged);
    if (path && !gone && opensInTab(path)) void doc.openFile(path);
  }

  const LETTERS: Record<GitChangeKind, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    untracked: "U",
    conflict: "!",
  };

  const kindTitle = (kind: GitChangeKind) =>
    ({
      modified: m.git_kind_modified(),
      added: m.git_kind_added(),
      deleted: m.git_kind_deleted(),
      renamed: m.git_kind_renamed(),
      untracked: m.git_kind_untracked(),
      conflict: m.git_kind_conflict(),
    })[kind];

  /** Briefly true after copying the path: the button shows a check mark. */
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 1500);
    } catch (err) {
      error = errorMessage(err);
    }
  }

  /** Asks again first: Git may have been installed since the tab was shown. */
  async function gitReady(): Promise<boolean> {
    error = null;
    await refresh(project.root);
    if (!info?.available) error = m.git_not_found();
    return !!info?.available;
  }

  async function startClone() {
    if (await gitReady()) doc.gitProject = "clone";
  }

  /** The open folder becomes a repository; its files then show up as changes to commit. */
  async function initialize() {
    if (await gitReady()) await act("init", (root) => api.gitInitFolder(root));
  }

  function saveIdentity() {
    const who = identity;
    if (!who || !complete) return;
    void act("identity", async () => {
      await api.gitSetIdentity(who.name, who.email);
      identity = null;
    });
  }

  async function trust() {
    askTrust = null;
    await act("trust", (root) => api.gitTrust(root));
  }

  function connectRemote() {
    const url = remoteUrl?.trim();
    if (!url) return;
    void act("remote", async (root) => {
      await api.gitSetRemote(root, url);
      remoteUrl = null;
    });
  }
</script>

{#snippet fileList(files: GitFileChange[], side: "staged" | "unstaged")}
  {#each files as file (file.path)}
    {@const kind = side === "staged" ? file.staged! : file.unstaged!}
    {@const name = fileName(file.path)}
    {@const dir = parentDir(file.path)}
    <div class="file">
      <button class="file-name" title={file.original ? `${file.original} → ${file.path}` : file.path} onclick={() => open(file)}>
        <span class="name" class:deleted={kind === "deleted"}>{name}</span>
        {#if dir}<span class="dir">{dir}</span>{/if}
      </button>
      {#if side === "staged"}
        <button class="icon" title={m.git_unstage()} aria-label={m.git_unstage()} disabled={!!busy} onclick={() => unstage([file])}>
          <Minus size={13} />
        </button>
      {:else}
        <button class="icon" title={m.git_stage()} aria-label={m.git_stage()} disabled={!!busy} onclick={() => stage([file])}>
          <Plus size={13} />
        </button>
      {/if}
      <span class="kind {kind}" title={kindTitle(kind)}>{LETTERS[kind]}</span>
    </div>
  {/each}
{/snippet}

<div class="git">
  {#if info?.repository && status}
    <header>
      <span class="branch" title={status.upstream ?? undefined}><GitBranch size={14} />{status.branch ?? "–"}</span>
      <button class="icon" title={m.git_refresh()} aria-label={m.git_refresh()} disabled={!!busy} onclick={fetchAndRefresh}>
        <RefreshCw size={13} class={busy === "fetch" ? "spin" : ""} />
      </button>
    </header>

    <div class="commit">
      {#if unsynced}
        <Button
          variant="primary"
          title={status.upstream ? m.git_sync_title({ behind: status.behind, ahead: status.ahead }) : undefined}
          disabled={!!busy || !status.branch}
          onclick={() => act("sync", (root) => api.gitSync(root))}
        >
          <RefreshCw size={14} class={busy === "sync" ? "spin" : ""} />
          {status.upstream ? m.git_sync() : m.git_publish()}
          {#if status.upstream}<span class="counts">{status.behind}↓ {status.ahead}↑</span>{/if}
        </Button>
      {:else}
        {#if identity}
          <!-- Without them Git refuses every commit; asked for once, they hold for all repositories. -->
          <fieldset class="identity">
            <legend>{m.git_identity_title()}</legend>
            <p>{m.git_identity_text()}</p>
            <input bind:value={identity.name} placeholder={m.git_identity_name()} autocomplete="name" disabled={!!busy} />
            <input type="email" bind:value={identity.email} placeholder={m.git_identity_email()} autocomplete="email" disabled={!!busy} />
            <Button disabled={!!busy || !complete} onclick={saveIdentity}>{m.git_identity_save()}</Button>
          </fieldset>
        {/if}
        <textarea
          bind:value={message}
          use:fitContent={message}
          rows="1"
          placeholder={m.git_commit_placeholder()}
          disabled={busy === "commit"}
          onkeydown={onMessageKeydown}
        ></textarea>
        <Button
          variant="primary"
          title={commitsAll ? m.git_commit_all_title() : undefined}
          disabled={!!busy || !!identity || !message.trim() || (staged.length === 0 && unstaged.length === 0)}
          onclick={commit}
        >
          <Check size={14} />{commitsAll ? m.git_commit_all() : m.git_commit()}
        </Button>
      {/if}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if staged.length > 0}
      <section>
        <h3>
          <span>{m.git_staged()} <span class="count">{staged.length}</span></span>
          <button
            class="icon"
            title={m.git_unstage_all()}
            aria-label={m.git_unstage_all()}
            disabled={!!busy}
            onclick={() => unstage(staged)}
          >
            <Minus size={13} />
          </button>
        </h3>
        {@render fileList(staged, "staged")}
      </section>
    {/if}
    {#if unstaged.length > 0}
      <section>
        <h3>
          <span>{m.git_changes()} <span class="count">{unstaged.length}</span></span>
          <button class="icon" title={m.git_stage_all()} aria-label={m.git_stage_all()} disabled={!!busy} onclick={() => stage(unstaged)}>
            <Plus size={13} />
          </button>
        </h3>
        {@render fileList(unstaged, "unstaged")}
      </section>
    {/if}
    {#if staged.length === 0 && unstaged.length === 0}
      <p class="intro">{m.git_no_changes()}</p>
    {/if}

    <!-- Where the repository lies and where it syncs to: at the foot of the explorer. -->
    <dl class="info">
      <dt>{m.git_location()}</dt>
      <dd class="location">
        <button
          class="path"
          title={m.git_open_folder({ path: info.repository.path })}
          onclick={() => project.root && api.gitOpenFolder(project.root).catch((e) => (error = errorMessage(e)))}
        >
          <FolderOpen size={13} /><span>{info.repository.path}</span>
        </button>
        <button
          class="icon"
          title={copied ? m.git_path_copied() : m.git_copy_path()}
          aria-label={m.git_copy_path()}
          onclick={() => info?.repository && copyPath(info.repository.path)}
        >
          {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
        </button>
      </dd>
      <dt>{m.git_remote()}</dt>
      {#if info.repository.remote}
        <dd title={info.repository.remote}>{info.repository.remote}</dd>
      {:else}
        <dd class="location">
          <span class="none">{m.git_no_remote()}</span>
          {#if remoteUrl === null}
            <button class="link" title={m.git_connect_remote_title()} onclick={() => (remoteUrl = "")}>{m.git_connect_remote()}</button>
          {/if}
        </dd>
      {/if}
      {#if remoteUrl !== null}
        <!-- An empty repository on GitHub, GitLab or the like: afterwards "Publish branch" uploads the commits. -->
        <dd class="connect">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:value={remoteUrl}
            placeholder={m.git_url_placeholder()}
            spellcheck="false"
            autocomplete="off"
            autofocus
            disabled={!!busy}
            onkeydown={(e) => (e.key === "Enter" ? connectRemote() : e.key === "Escape" && (remoteUrl = null))}
          />
          <div class="row">
            <Button onclick={() => (remoteUrl = null)} disabled={!!busy}>{m.new_project_cancel()}</Button>
            <Button variant="primary" onclick={connectRemote} disabled={!!busy || !remoteUrl.trim()}>{m.git_connect_remote()}</Button>
          </div>
        </dd>
      {/if}
    </dl>
  {:else if info?.repository && !info.repository.trusted}
    <p class="intro">{m.git_untrusted()}</p>
    <Button variant="primary" size="md" disabled={!!busy} onclick={() => (askTrust = info?.repository?.path ?? null)}>
      <ShieldCheck size={15} />{m.git_trust_button()}
    </Button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else if project.root && info && !info.available}
    <GitMissing onretry={() => refresh(project.root)} />
  {:else if info && !info.repository}
    <p class="intro">{m.git_intro_folder()}</p>
    <Button variant="primary" size="md" title={m.git_init_folder_title()} disabled={!!busy} onclick={initialize}>
      <GitBranch size={15} />{m.git_init_folder()}
    </Button>
    <Button size="md" title={m.git_clone_title()} disabled={!!busy} onclick={startClone}>
      <Download size={15} />{m.git_clone()}
    </Button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</div>

<!-- Before Git works in a repository from elsewhere: its configuration can make Git run programs. -->
<Dialog open={askTrust !== null} width={520} onclose={() => (askTrust = null)}>
  <h1>{m.git_trust_title()}</h1>
  <p class="trust-text">{m.git_trust_text()}</p>
  <p class="trust-path" title={askTrust}>{askTrust}</p>
  <footer>
    <Button onclick={() => (askTrust = null)}>{m.git_trust_no()}</Button>
    <Button variant="primary" onclick={trust}><ShieldCheck size={14} />{m.git_trust_yes()}</Button>
  </footer>
</Dialog>

<style>
  .git {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-4);
    overflow: auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .branch {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trust-text {
    margin: 0 0 var(--space-5);
    line-height: 1.5;
  }

  .trust-path {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .intro {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  .error {
    margin: 0;
    color: var(--error);
    font-size: var(--font-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    font-size: var(--font-sm);
  }

  /* At the bottom of the explorer, flush with its edge; long lists scroll behind it. */
  .info {
    position: sticky;
    bottom: calc(-1 * var(--space-4));
    flex-shrink: 0;
    margin: auto calc(-1 * var(--space-4)) calc(-1 * var(--space-4));
    padding: var(--space-4);
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* The repository's folder: the whole path is in the tooltip, a click shows it in the file manager. */
  .path {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    max-width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .path span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path:hover span {
    text-decoration: underline;
  }

  .path :global(svg) {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
  }

  .icon:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }

  .commit {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .commit :global(.btn) {
    justify-content: center;
  }

  /* One line at first, as high as the message after that (see `fitContent`), up to about ten lines. */
  textarea {
    box-sizing: border-box;
    max-height: 12em;
    overflow-y: auto;
    resize: none;
    padding: var(--space-2) var(--space-3);
    line-height: 1.4;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .identity legend {
    padding: 0 var(--space-1);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .identity p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
    line-height: 1.4;
  }

  .identity input,
  .connect input {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
  }

  .connect input {
    width: 100%;
    font-family: var(--font-mono);
  }

  .identity input:focus,
  .connect input:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  .identity input::placeholder,
  .connect input::placeholder {
    color: var(--text-muted);
  }

  /* The field to connect a remote takes the whole width of the info block. */
  .connect {
    display: flex;
    grid-column: 1 / -1;
    flex-direction: column;
    gap: var(--space-2);
    overflow: visible;
    white-space: normal;
  }

  .connect .row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .none {
    color: var(--text-muted);
  }

  .link {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline;
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent-strong);
  }

  .counts {
    color: inherit;
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }

  h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .count {
    margin-left: var(--space-1);
    font-variant-numeric: tabular-nums;
  }

  .file {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-sm);
  }

  .file:hover {
    background: var(--hover);
  }

  /* The stage/unstage button shows on the row under the pointer, as in VS Code. */
  .file .icon {
    visibility: hidden;
  }

  .file:hover .icon,
  .file .icon:focus-visible {
    visibility: visible;
  }

  .file-name {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--font-sm);
    text-align: left;
  }

  .name {
    flex-shrink: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.deleted {
    text-decoration: line-through;
  }

  .dir {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--font-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    flex-shrink: 0;
    width: 14px;
    margin-right: var(--space-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-xs);
    font-weight: 600;
    text-align: center;
  }

  .kind.added,
  .kind.untracked {
    color: var(--syn-atom);
  }

  .kind.deleted,
  .kind.conflict {
    color: var(--error);
  }
</style>
