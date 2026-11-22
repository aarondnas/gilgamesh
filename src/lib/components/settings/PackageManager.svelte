<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import Folder from "@lucide/svelte/icons/folder";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Search from "@lucide/svelte/icons/search";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { api, type Bundle, type Package } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { build } from "$lib/state/build.svelte";
  import { packages } from "$lib/state/packages.svelte";
  import Button from "../ui/Button.svelte";
  import Segmented from "../ui/Segmented.svelte";

  const MAX_ROWS = 300;

  const bundles: { id: Bundle; title: string; text: string }[] = $derived([
    { id: "TinyTeX-1", title: m.bundle_standard(), text: m.bundle_standard_text() },
    { id: "TinyTeX", title: m.bundle_extended(), text: m.bundle_extended_text() },
  ]);

  let bundle = $state<Bundle>("TinyTeX-1");
  let query = $state("");
  let onlyInstalled = $state(false);
  let logEl: HTMLPreElement | undefined = $state();

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return packages.catalog.filter(
      (p) => (!onlyInstalled || p.installed) && (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)),
    );
  });
  const installedCount = $derived(packages.catalog.filter((p) => p.installed).length);

  const progressText = $derived.by(() => {
    const p = packages.progress;
    if (!p) return m.progress_connecting();
    if (p.phase === "download") {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
      return p.total
        ? m.progress_download({ received: mb(p.received), total: mb(p.total) })
        : m.progress_download_unknown_size({ received: mb(p.received) });
    }
    if (p.phase === "restore") return m.progress_restore({ count: p.total ?? 0 });
    return {
      extract: m.progress_extract,
      configure: m.progress_configure,
      essentials: m.progress_essentials,
      done: m.progress_done,
    }[p.phase]();
  });
  const progressValue = $derived(
    packages.progress?.phase === "download" && packages.progress.total ? packages.progress.received / packages.progress.total : null,
  );

  $effect(() => {
    if (packages.installed && !packages.catalogLoaded) void packages.loadCatalog();
  });

  $effect(() => {
    void packages.log.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  async function remove(pkg: Package) {
    const confirmed = await ask(m.remove_confirm({ name: pkg.name }), {
      title: m.remove_confirm_title(),
      kind: "warning",
    });
    if (confirmed) await packages.remove([pkg.name]);
  }

  async function uninstall() {
    const confirmed = await ask(m.uninstall_confirm(), { title: m.uninstall_confirm_title(), kind: "warning" });
    if (confirmed) await packages.uninstallDistribution();
  }
</script>

<div class="manager">
  {#if !packages.installed}
    <section class="setup">
      <h1>{m.setup_title()}</h1>
      <p>{m.setup_text()}</p>

      <div class="bundles">
        {#each bundles as b (b.id)}
          <label class="bundle" class:selected={bundle === b.id}>
            <input type="radio" name="bundle" value={b.id} bind:group={bundle} disabled={packages.busy} />
            <strong>{b.title}</strong>
            <span>{b.text}</span>
          </label>
        {/each}
      </div>

      {#if packages.busy}
        <div class="progress">
          <div class="bar" class:indeterminate={progressValue === null}>
            <div style:width={progressValue === null ? undefined : `${progressValue * 100}%`}></div>
          </div>
          <span>{progressText}</span>
        </div>
      {:else}
        <Button variant="primary" size="md" onclick={() => packages.installDistribution(bundle).then(() => build.offerAutoInstall())}>
          <Download size={16} />
          {m.setup_install()}
        </Button>
      {/if}

      {#if packages.error}<p class="error">{packages.error}</p>{/if}
      {#if packages.status}<p class="path">{m.setup_location()} <code>{packages.status.root}</code></p>{/if}
    </section>
  {:else}
    <div class="toolbar">
      <label class="search">
        <Search size={15} />
        <input type="search" placeholder={m.catalog_search_placeholder()} bind:value={query} />
      </label>
      <Segmented
        bind:value={onlyInstalled}
        options={[
          { value: false, label: m.catalog_filter_all() },
          { value: true, label: m.catalog_filter_installed({ count: installedCount }) },
        ]}
      />
      <span class="summary">
        {#if packages.loadingCatalog}
          <LoaderCircle size={14} class="spin" /> {m.catalog_loading()}
        {:else}
          {m.catalog_summary({ shown: filtered.length, total: packages.catalog.length })}
        {/if}
      </span>

      <div class="actions">
        {#if packages.status?.manifest}
          <span class="distribution">
            TinyTeX {packages.status.manifest.version} ·
            {packages.status.manifest.bundle === "TinyTeX" ? m.bundle_extended() : m.bundle_standard()}
          </span>
        {/if}
        <Button variant="ghost" disabled={packages.loadingCatalog} onclick={() => packages.loadCatalog()}>
          <RefreshCw size={14} class={packages.loadingCatalog ? "spin" : ""} />
          {m.catalog_reload()}
        </Button>
        <Button variant="ghost" title={m.packages_user_folder_title()} onclick={() => api.openUserTexmf()}>
          <Folder size={14} />
          {m.packages_user_folder()}
        </Button>
        <Button variant="ghost" title={m.packages_update_title()} disabled={packages.busy} onclick={() => packages.updateAll()}>
          <Download size={14} />
          {m.packages_update()}
        </Button>
        <Button variant="ghost" disabled={packages.busy} onclick={uninstall}>
          <Trash2 size={14} />
          {m.distribution_uninstall()}
        </Button>
      </div>
    </div>

    {#if packages.busy && packages.progress && packages.progress.phase !== "done"}
      <!-- An update that installs a new TeX Live year: it downloads as the setup does. -->
      <div class="progress banner">
        <div class="bar" class:indeterminate={progressValue === null}>
          <div style:width={progressValue === null ? undefined : `${progressValue * 100}%`}></div>
        </div>
        <span>{progressText}</span>
      </div>
    {/if}
    {#if packages.error}<p class="error banner">{packages.error}</p>{/if}

    <div class="list">
      <table>
        <tbody>
          {#each filtered.slice(0, MAX_ROWS) as pkg (pkg.name)}
            <tr>
              <td class="name">{pkg.name}</td>
              <td class="description">{pkg.description}</td>
              <td class="state">
                {#if pkg.installed}
                  <span class="badge">{m.package_installed()}</span>
                  <Button disabled={packages.busy} onclick={() => remove(pkg)}>{m.package_remove()}</Button>
                {:else}
                  <Button variant="secondary" disabled={packages.busy} onclick={() => packages.install([pkg.name])}>
                    {m.package_install()}
                  </Button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if filtered.length > MAX_ROWS}
        <p class="more">{m.catalog_more({ count: filtered.length - MAX_ROWS })}</p>
      {/if}
    </div>
  {/if}

  <section class="console">
    <header>
      <span>
        {#if packages.task}<LoaderCircle size={13} class="spin" />{/if}
        {packages.task ?? m.console_output()}
      </span>
      <Button variant="link" onclick={() => packages.clearLog()}>{m.console_clear()}</Button>
    </header>
    <pre bind:this={logEl}>{packages.log.join("\n")}</pre>
  </section>
</div>

<style>
  .manager {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
  }

  /* Setup */

  .setup {
    align-self: center;
    width: min(640px, 100% - 2 * var(--space-6));
    margin-top: var(--space-8);
    overflow-y: auto;
  }

  .setup h1 {
    margin: 0 0 var(--space-4);
    font-size: var(--font-lg);
    font-weight: 600;
  }

  .setup p {
    color: var(--text-muted);
    line-height: 1.5;
  }

  .bundles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-5);
    margin: var(--space-7) 0;
  }

  .bundle {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .bundle.selected {
    border-color: var(--accent-strong);
    box-shadow: 0 0 0 1px var(--accent-strong);
    background: var(--hover);
  }

  .bundle span {
    grid-column: 2;
    font-size: var(--font-sm);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  .bar {
    height: 6px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .bar div {
    height: 100%;
    background: var(--accent-strong);
    transition: width 0.2s;
  }

  .bar.indeterminate div {
    width: 30%;
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }

  .path {
    font-size: var(--font-sm);
  }

  .error {
    color: var(--error);
    font-size: var(--font-sm);
  }

  .progress.banner {
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .error.banner {
    margin: 0;
    padding: var(--space-3) var(--space-5);
    background: var(--error-bg);
  }

  /* Catalog */

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-5);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    max-width: 380px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
  }

  .search input {
    flex: 1;
    padding: 0;
    border: none;
    outline: none;
    background: none;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .distribution {
    margin-right: var(--space-3);
    font-size: var(--font-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-md);
  }

  tr {
    border-bottom: 1px solid var(--surface-2);
  }

  tr:hover {
    background: var(--hover);
  }

  td {
    padding: var(--space-3) var(--space-5);
    vertical-align: middle;
  }

  .name {
    width: 1%;
    font-weight: 600;
    white-space: nowrap;
  }

  .description {
    color: var(--text-muted);
  }

  .state {
    width: 1%;
    white-space: nowrap;
    text-align: right;
  }

  .badge {
    margin-right: var(--space-4);
    font-size: var(--font-xs);
    color: var(--success);
  }

  .more {
    padding: var(--space-4) var(--space-5);
    font-size: var(--font-sm);
    color: var(--text-muted);
  }

  /* Console */

  .console {
    display: flex;
    flex-direction: column;
    height: 150px;
    margin-top: auto;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }

  .console header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-1) var(--space-5);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .console header span {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  pre {
    flex: 1;
    margin: 0;
    padding: var(--space-2) var(--space-5) var(--space-4);
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--font-xs);
    color: var(--text-muted);
  }
</style>
