<script lang="ts">
  import { errorMessage } from "$lib/api";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { settings } from "$lib/state/settings.svelte";
  import ProjectTarget, { targetPath } from "./ProjectTarget.svelte";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  let name = $state("");
  let location = $state("");
  let inNewWindow = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  function show(archive: string) {
    // Suggest the archive's name ("thesis.zip" → "thesis").
    name =
      archive
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.zip$/i, "") ?? "";
    inNewWindow = false;
    error = null;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !targetPath(location, name)) return;
    busy = true;
    error = null;
    try {
      await doc.importInto(location, name, inNewWindow);
      settings.update({ projectLocation: location });
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={!!doc.importArchive} width={560} onopen={() => show(doc.importArchive ?? "")} onclose={() => (doc.importArchive = null)}>
  <form onsubmit={submit}>
    <h1>{m.import_title()}</h1>
    <p class="archive" title={doc.importArchive}>{doc.importArchive}</p>

    <ProjectTarget bind:name bind:location bind:inNewWindow disabled={busy} />
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.importArchive = null)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !targetPath(location, name)}>{m.import_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .archive {
    margin: calc(-1 * var(--space-4)) 0 var(--space-5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
</style>
