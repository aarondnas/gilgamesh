<script lang="ts">
  import type { Component } from "svelte";
  import Download from "@lucide/svelte/icons/download";
  import FolderCog from "@lucide/svelte/icons/folder-cog";
  import Info from "@lucide/svelte/icons/info";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import Languages from "@lucide/svelte/icons/languages";
  import PackageIcon from "@lucide/svelte/icons/package";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Palette from "@lucide/svelte/icons/palette";
  import Ruler from "@lucide/svelte/icons/ruler";
  import SpellCheck from "@lucide/svelte/icons/spell-check";
  import Sun from "@lucide/svelte/icons/sun";
  import { m } from "$lib/paraglide/messages";
  import type { Locale } from "$lib/paraglide/runtime";
  import { doc, type SettingsSection } from "$lib/state/document.svelte";
  import { locale, localeName } from "$lib/state/locale.svelte";
  import type { ThemeSetting } from "$lib/state/settings.svelte";
  import { theme } from "$lib/state/theme.svelte";
  import { UNITS, units, type Unit } from "$lib/state/units.svelte";
  import { SYSTEM_NAME } from "$lib/util/platform";
  import AboutSettings from "./AboutSettings.svelte";
  import DictionaryManager from "./DictionaryManager.svelte";
  import PackageManager from "./PackageManager.svelte";
  import ProjectSettings from "./ProjectSettings.svelte";
  import SettingsPage from "./SettingsPage.svelte";
  import ShortcutList from "./ShortcutList.svelte";
  import UpdateSettings from "./UpdateSettings.svelte";
  import TabUnderline from "../ui/TabUnderline.svelte";
  import { tabSlide } from "../ui/tab-motion";

  const options: { value: Locale | null; label: string }[] = $derived([
    { value: null, label: m.settings_language_system({ language: localeName(locale.system) }) },
    ...locale.available.map((l) => ({ value: l, label: localeName(l) })),
  ]);

  const themes: { value: ThemeSetting; label: string; icon: Component }[] = $derived([
    {
      value: "system",
      label: m.theme_system({ mode: theme.system === "dark" ? m.theme_dark() : m.theme_light(), system: SYSTEM_NAME }),
      icon: Monitor,
    },
    { value: "light", label: m.theme_light(), icon: Sun },
    { value: "dark", label: m.theme_dark(), icon: Moon },
  ]);

  const unitNames: Record<Unit, () => string> = { cm: m.unit_cm, mm: m.unit_mm, in: m.unit_in };

  const unitOptions: { value: Unit | null; label: string }[] = $derived([
    { value: null, label: m.settings_units_system({ unit: unitNames[units.system](), system: SYSTEM_NAME }) },
    ...UNITS.map((u) => ({ value: u, label: unitNames[u]() })),
  ]);

  const sections: { id: SettingsSection; label: string; icon: Component }[] = $derived([
    { id: "language", label: m.ribbon_language(), icon: Languages },
    { id: "units", label: m.settings_units(), icon: Ruler },
    { id: "proofing", label: m.settings_proofing(), icon: SpellCheck },
    { id: "shortcuts", label: m.ribbon_shortcuts(), icon: Keyboard },
    { id: "project", label: m.ribbon_project(), icon: FolderCog },
    { id: "packages", label: m.ribbon_packages(), icon: PackageIcon },
    { id: "appearance", label: m.settings_appearance(), icon: Palette },
    { id: "updates", label: m.settings_updates(), icon: Download },
    { id: "about", label: m.settings_about(), icon: Info },
  ]);

  const index = $derived(sections.findIndex((s) => s.id === doc.settingsSection));
  let strip = $state<HTMLElement | null>(null);
  /** A tab's content slides in from where the tab lies. */
  const slideIn = tabSlide(() => index);
</script>

<div class="pane">
  <div class="sections" role="tablist" bind:this={strip}>
    {#each sections as section (section.id)}
      <button
        role="tab"
        class:active={doc.settingsSection === section.id}
        aria-selected={doc.settingsSection === section.id}
        onclick={() => (doc.settingsSection = section.id)}
      >
        <section.icon size={15} />
        {section.label}
      </button>
    {/each}
    <TabUnderline {strip} {index} />
  </div>

  <div class="content">
    {#key doc.settingsSection}
      <div class="section-view" in:slideIn>
        {#if doc.settingsSection === "packages"}
          <PackageManager />
        {:else if doc.settingsSection === "project"}
          <ProjectSettings />
        {:else if doc.settingsSection === "shortcuts"}
          <ShortcutList />
        {:else if doc.settingsSection === "updates"}
          <SettingsPage><UpdateSettings /></SettingsPage>
        {:else if doc.settingsSection === "about"}
          <SettingsPage><AboutSettings /></SettingsPage>
        {:else if doc.settingsSection === "proofing"}
          <SettingsPage><DictionaryManager /></SettingsPage>
        {:else if doc.settingsSection === "units"}
          <SettingsPage>
            <section>
              <h1>{m.settings_units_title()}</h1>
              <p>{m.settings_units_text({ system: SYSTEM_NAME })}</p>

              <div class="options" role="radiogroup">
                {#each unitOptions as option (option.value ?? "system")}
                  <label class="option" class:selected={units.preference === option.value}>
                    <input type="radio" name="unit" checked={units.preference === option.value} onchange={() => units.set(option.value)} />
                    <span>{option.label}</span>
                  </label>
                {/each}
              </div>
            </section>
          </SettingsPage>
        {:else if doc.settingsSection === "appearance"}
          <SettingsPage>
            <section>
              <h1>{m.settings_appearance()}</h1>
              <p>{m.settings_appearance_text()}</p>

              <div class="options" role="radiogroup">
                {#each themes as option (option.value)}
                  <label class="option" class:selected={theme.preference === option.value}>
                    <input type="radio" name="theme" checked={theme.preference === option.value} onchange={() => theme.set(option.value)} />
                    <option.icon size={16} />
                    <span>{option.label}</span>
                  </label>
                {/each}
              </div>
            </section>
          </SettingsPage>
        {:else}
          <SettingsPage>
            <section>
              <h1>{m.settings_language_title()}</h1>
              <p>{m.settings_language_text()}</p>

              <div class="options" role="radiogroup">
                {#each options as option (option.value ?? "system")}
                  <label class="option" class:selected={locale.preference === option.value}>
                    <input
                      type="radio"
                      name="locale"
                      checked={locale.preference === option.value}
                      onchange={() => locale.set(option.value)}
                    />
                    <span lang={option.value ?? undefined}>{option.label}</span>
                  </label>
                {/each}
              </div>
            </section>
          </SettingsPage>
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
  }

  .sections {
    position: relative;
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-6) 0;
    border-bottom: 1px solid var(--border);
  }

  .sections button {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: -1px;
    padding: var(--space-4) var(--space-5);
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--font-md);
    transition: color 150ms ease;
  }

  .sections button:hover {
    color: var(--text);
  }

  .sections button.active {
    color: var(--accent-strong);
    font-weight: 600;
  }

  .content {
    flex: 1;
    min-height: 0;
    /* The new tab's content slides in from the side without a scrollbar flashing up. */
    overflow: hidden;
  }

  .section-view {
    height: 100%;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .option.selected {
    border-color: var(--accent-strong);
    box-shadow: 0 0 0 1px var(--accent-strong);
    background: var(--hover);
  }
</style>
