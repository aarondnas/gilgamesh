<script lang="ts">
  import type { Engine } from "$lib/api";
  import { SPELL_LANGUAGES, spellLanguageForLocale, spellLanguageName, type SpellSetting } from "$lib/config/spelling";
  import { locale } from "$lib/state/locale.svelte";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { PDF_STANDARDS, project } from "$lib/state/project.svelte";
  import { treeFiles } from "$lib/util/paths";
  import SettingsPage from "./SettingsPage.svelte";

  const engines: { id: Engine; label: string }[] = [
    { id: "lualatex", label: "LuaLaTeX" },
    { id: "xelatex", label: "XeLaTeX" },
    { id: "pdflatex", label: "pdfLaTeX" },
  ];

  const texFiles = $derived(treeFiles(project.tree, (path) => path.endsWith(".tex")));
</script>

<SettingsPage>
  <section>
    <h1>{m.project_settings_title()}</h1>
    {#if !project.root}
      <p>{m.project_settings_none()}</p>
    {:else}
      <p>{m.project_settings_text({ file: "gilgamesh.json" })}</p>

      <label>
        <span>{m.project_settings_main()}</span>
        <select value={project.config.main ?? ""} onchange={(e) => doc.setMain(e.currentTarget.value)}>
          {#if !project.config.main}<option value="" disabled>—</option>{/if}
          {#each texFiles as file (file)}
            <option value={file}>{file}</option>
          {/each}
        </select>
      </label>

      <label>
        <span>{m.project_settings_engine()}</span>
        <select
          value={project.config.engine}
          onchange={(e) => {
            // Back to the engine in effect where the switch was declined.
            const select = e.currentTarget;
            void doc.setEngine(select.value as Engine).then(() => (select.value = project.config.engine));
          }}
        >
          {#each engines as engine (engine.id)}
            <option value={engine.id}>{engine.label}</option>
          {/each}
        </select>
      </label>

      <label>
        <span>{m.project_settings_pdf_standard()}</span>
        <select value={project.config.pdfStandard ?? ""} onchange={(e) => doc.setPdfStandard(e.currentTarget.value || null)}>
          <option value="">{m.project_settings_pdf_standard_none()}</option>
          {#each PDF_STANDARDS as standard (standard)}
            <option value={standard}>PDF/{standard}</option>
          {/each}
        </select>
        <small>{m.project_settings_pdf_standard_hint()}</small>
      </label>

      <label>
        <span>{m.project_settings_spell()}</span>
        <select value={project.config.spellLanguage} onchange={(e) => doc.setSpellLanguage(e.currentTarget.value as SpellSetting)}>
          <option value="auto">
            {m.project_settings_spell_auto({
              language: spellLanguageName(project.scan?.language ?? spellLanguageForLocale(locale.current), locale.current),
            })}
          </option>
          <option value="off">{m.project_settings_spell_off()}</option>
          {#each SPELL_LANGUAGES as code (code)}
            <option value={code}>{spellLanguageName(code, locale.current)}</option>
          {/each}
        </select>
        <small>{m.project_settings_spell_hint()}</small>
      </label>
    {/if}
  </section>
</SettingsPage>

<style>
  small {
    color: var(--text-muted);
    line-height: 1.5;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-6);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  select {
    max-width: 360px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font: inherit;
    font-weight: normal;
  }

  small {
    font-weight: normal;
  }
</style>
