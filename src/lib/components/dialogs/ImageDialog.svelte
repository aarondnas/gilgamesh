<script lang="ts">
  import ImagePlus from "@lucide/svelte/icons/image-plus";
  import { errorMessage } from "$lib/api";
  import { captionFor, IMAGE_EXTENSIONS, IMAGE_FOLDERS, isImage, labelFor } from "$lib/latex/figures";
  import { uniqueLabel } from "$lib/latex/preamble";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { inserting } from "$lib/state/inserting.svelte";
  import { project } from "$lib/state/project.svelte";
  import { parentDir, treeFiles, treeFolders } from "$lib/util/paths";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import ImageGallery from "./ImageGallery.svelte";

  const WIDTHS = [0.25, 0.5, 0.8, 1];

  let picker: HTMLInputElement;
  let image = $state("");
  let caption = $state("");
  let label = $state("");
  /** The caption and label follow the image until the user types their own. */
  let captionTouched = $state(false);
  let labelTouched = $state(false);
  let width = $state(0.8);
  /** Where pictures from outside the project are copied to. */
  let folder = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  /** While a file is dragged over the drop area. */
  let over = $state(false);
  /** Counts the openings: each shows a fresh gallery, with images replaced meanwhile read anew. */
  let opened = $state(0);

  /** Project files and folders; "" is the project folder itself. */
  const tree = $derived({
    images: treeFiles(project.tree, isImage).sort((a, b) => a.localeCompare(b)),
    folders: treeFolders(project.tree),
  });

  function show() {
    opened++;
    const { images, folders } = tree;
    captionTouched = false;
    labelTouched = false;
    choose(images[0] ?? "");
    width = 0.8;
    // The folder with the most recent convention, else the one the images are in, else the main file's.
    folder =
      IMAGE_FOLDERS.find((f) => folders.includes(f)) ?? (images.length ? parentDir(images[0]) : parentDir(project.config.main ?? ""));
    error = null;
  }

  function choose(path: string) {
    image = path;
    // Never one the project uses already: the same picture may well appear twice.
    const taken = (project.scan?.labels ?? []).map((l) => l.key);
    if (!labelTouched) label = path ? uniqueLabel(labelFor(path), taken) : "";
    if (!captionTouched) caption = path ? captionFor(path) : "";
  }

  function importPicked() {
    const file = picker.files?.[0];
    picker.value = "";
    if (file) void importFile(file);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    over = false;
    const file = event.dataTransfer?.files[0];
    if (file && !busy) void importFile(file);
  }

  /** Copies a picture from outside the project into `folder` and selects it. */
  async function importFile(file: File) {
    if (!isImage(file.name)) {
      error = m.image_drop_wrong({ name: file.name, extensions: IMAGE_EXTENSIONS.join(", ") });
      return;
    }
    busy = true;
    error = null;
    try {
      const [written] = await project.importFiles(folder, [{ path: file.name, file }]);
      choose(written);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !image) return;
    busy = true;
    error = null;
    try {
      await inserting.insertFigure({ image, caption, label, width });
      doc.imageDialog = false;
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open={doc.imageDialog} width={480} onopen={show} onclose={() => (doc.imageDialog = false)}>
  <form onsubmit={submit}>
    <h1>{m.image_dialog_title()}</h1>

    <!-- A picture from outside the project: dropped here, or picked with a click. -->
    <button
      type="button"
      class="drop"
      class:over
      disabled={busy}
      onclick={() => picker.click()}
      ondragenter={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragover={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }}
      ondragleave={(e) => {
        // Not when the pointer only moves onto the icon or text inside.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) over = false;
      }}
      ondrop={drop}
    >
      <ImagePlus size={28} />
      <span>{m.image_drop()}</span>
    </button>

    <div class="field">
      <span>{m.image_file()}</span>
      {#key opened}
        <ImageGallery images={tree.images} selected={image} disabled={busy} onchoose={choose} />
      {/key}
    </div>
    <input bind:this={picker} type="file" accept={IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(",")} hidden onchange={importPicked} />

    <label class="field">
      <span>{m.image_folder()}</span>
      <select bind:value={folder} disabled={busy}>
        {#each tree.folders as path (path)}
          <option value={path}>{path || m.lists_project_folder()}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>{m.image_caption()}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={caption} oninput={() => (captionTouched = true)} autofocus disabled={busy} />
    </label>

    <label class="field">
      <span>{m.image_label()}</span>
      <input bind:value={label} oninput={() => (labelTouched = true)} disabled={busy} />
    </label>

    <label class="field">
      <span>{m.image_width()}</span>
      <select bind:value={width} disabled={busy}>
        {#each WIDTHS as share (share)}
          <option value={share}>{m.image_width_option({ percent: Math.round(share * 100) })}</option>
        {/each}
      </select>
    </label>

    <p class="hint">{m.image_hint({ file: project.file ?? "" })}</p>
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <Button onclick={() => (doc.imageDialog = false)} disabled={busy}>{m.new_project_cancel()}</Button>
      <Button type="submit" variant="primary" disabled={busy || !image}>{m.image_submit()}</Button>
    </footer>
  </form>
</Dialog>

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    width: 100%;
    margin-bottom: var(--space-5);
    padding: var(--space-7) var(--space-5);
    border: 2px dashed var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--font-sm);
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }

  .drop :global(svg) {
    color: var(--accent-strong);
  }

  .drop:hover:not(:disabled),
  .drop.over {
    border-color: var(--accent-strong);
    background: var(--hover);
    color: var(--text);
  }

  .drop:disabled {
    opacity: 0.6;
  }
</style>
