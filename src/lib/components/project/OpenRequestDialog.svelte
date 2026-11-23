<!--
  A file was opened with Gilgamesh while this window shows another project
  (see `doc.listenForOpenRequests`): open its project here, in a new window, or not at all.
-->
<script lang="ts">
  import AppWindow from "@lucide/svelte/icons/app-window";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { project } from "$lib/state/project.svelte";
  import { fileName } from "$lib/util/paths";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  const request = $derived(doc.openRequest);
  /** The folder's name, as `project.name`: the root is a system path, with `\` on Windows. */
  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
</script>

<Dialog open={request !== null} width={520} onclose={() => void doc.answerOpenRequest(null)}>
  {#if request}
    <h1>{m.open_request_title({ file: request.file ? fileName(request.file) : folderName(request.root) })}</h1>
    <p class="text">{m.open_request_text({ current: project.name, project: folderName(request.root) })}</p>
    <p class="path" title={request.root}>{request.root}</p>
    <footer>
      <Button onclick={() => void doc.answerOpenRequest(null)}>{m.new_project_cancel()}</Button>
      <Button onclick={() => void doc.answerOpenRequest("window")}><AppWindow size={14} />{m.open_request_new_window()}</Button>
      <!-- svelte-ignore a11y_autofocus -->
      <Button variant="primary" autofocus onclick={() => void doc.answerOpenRequest("here")}>
        <FolderOpen size={14} />{m.open_request_here()}
      </Button>
    </footer>
  {/if}
</Dialog>

<style>
  .text {
    margin: 0 0 var(--space-4);
    line-height: 1.5;
  }

  .path {
    overflow: hidden;
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
