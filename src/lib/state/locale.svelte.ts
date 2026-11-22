// The language of the interface: the user's choice in the settings, else the
// system's. Paraglide reads it through `getLocale`.

import { baseLocale, extractLocaleFromNavigator, isLocale, locales, overwriteGetLocale, type Locale } from "$lib/paraglide/runtime";
import { settings } from "./settings.svelte";

/** Display name of a locale in its own language, e.g. "Deutsch" for `de`. */
export function localeName(locale: Locale): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/**
 * The UI language. Backed by `$state` so every `m.*()` call is reactive and
 * switching languages updates the UI in place, without Paraglide's page reload
 * (which would drop the editor's unsaved text and undo history).
 */
class LocaleStore {
  readonly available = locales;
  readonly system: Locale = extractLocaleFromNavigator() ?? baseLocale;
  /** Explicit user choice from the settings file, `null` to follow the OS language. */
  preference = $derived<Locale | null>(isLocale(settings.data.locale) ? settings.data.locale : null);

  current = $derived(this.preference ?? this.system);

  constructor() {
    $effect.root(() => {
      $effect(() => {
        document.documentElement.lang = this.current;
      });
    });
  }

  set(preference: Locale | null) {
    settings.update({ locale: preference });
  }
}

export const locale = new LocaleStore();

// Must run before the first message is rendered: Paraglide's own getLocale
// would persist the detected language and stop following the OS.
overwriteGetLocale(() => locale.current);
