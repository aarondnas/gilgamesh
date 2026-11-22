// Light or dark mode: `data-theme` on the page's root switches the design
// tokens in app.css (detached windows copy it, see `Popups`). "system"
// follows Windows, also when it changes there while the app runs.
import { settings, type ThemeSetting } from "./settings.svelte";

export type Theme = "light" | "dark";

const media = window.matchMedia("(prefers-color-scheme: dark)");

class ThemeStore {
  /** What Windows uses. */
  system = $state<Theme>(media.matches ? "dark" : "light");

  get preference(): ThemeSetting {
    return settings.data.theme ?? "system";
  }

  /** What is shown. */
  readonly current: Theme = $derived(this.preference === "system" ? this.system : this.preference);

  constructor() {
    media.addEventListener("change", (event) => (this.system = event.matches ? "dark" : "light"));
    $effect.root(() => {
      $effect(() => {
        document.documentElement.dataset.theme = this.current;
      });
    });
  }

  set(preference: ThemeSetting) {
    if (preference !== settings.data.theme) settings.update({ theme: preference });
  }
}

export const theme = new ThemeStore();
