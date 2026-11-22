<script lang="ts">
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import FileArchive from "@lucide/svelte/icons/file-archive";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import RecentProjects from "./RecentProjects.svelte";
  import Button from "../ui/Button.svelte";
</script>

<div class="start">
  <section>
    <h1>{m.start_title()}</h1>
    <p>{m.start_text()}</p>

    <div class="actions">
      <Button variant="primary" size="md" onclick={() => doc.newProject()}>
        <FolderPlus size={16} />
        {m.start_new()}
      </Button>
      <Button size="md" onclick={() => doc.openProject()}>
        <FolderOpen size={16} />
        {m.start_open()}
      </Button>
      <Button size="md" onclick={() => doc.importProject()}>
        <FileArchive size={16} />
        {m.start_import()}
      </Button>
      <Button size="md" title={m.file_git_hint()} onclick={() => (doc.gitProject = "either")}>
        <GitBranch size={16} />
        {m.git_project_title()}
      </Button>
    </div>

    {#if doc.error}<p class="error">{doc.error}</p>{/if}

    <RecentProjects />
  </section>
</div>

<style>
  .start {
    display: flex;
    justify-content: center;
    height: 100%;
    overflow-y: auto;
    background: var(--surface);
  }

  section {
    width: min(560px, 100% - 2 * var(--space-6));
    margin-top: var(--space-8);
  }

  h1 {
    margin: 0 0 var(--space-4);
    font-size: var(--font-lg);
    font-weight: 600;
  }

  p {
    color: var(--text-muted);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: var(--space-7) 0;
  }

  .error {
    color: var(--error);
    font-size: var(--font-sm);
  }
</style>
