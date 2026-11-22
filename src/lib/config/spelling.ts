/**
 * Languages with a spelling dictionary (Latin-script European languages).
 * The backend accepts the same codes; dictionaries are downloaded on first use.
 */
export const SPELL_LANGUAGES = [
  "de",
  "de-AT",
  "de-CH",
  "en",
  "en-GB",
  "fr",
  "es",
  "it",
  "nl",
  "pt-BR",
  "pt-PT",
  "pl",
  "sv",
  "da",
  "nb",
  "cs",
  "hu",
  "ro",
  "hr",
  "sl",
  "sk",
  "et",
  "lt",
  "lv",
  "ca",
  "tr",
] as const;

/**
 * The dictionary for a UI language, used while a document names no language
 * of its own. Languages without one (Russian, Chinese, …) fall back to English.
 */
export function spellLanguageForLocale(locale: string): string {
  // The Portuguese UI is written in European Portuguese.
  if (locale === "pt") return "pt-PT";
  return SPELL_LANGUAGES.includes(locale as never) ? locale : "en";
}

/** "auto" follows the document's babel/polyglossia language, "off" disables checking. */
export type SpellSetting = "auto" | "off" | (typeof SPELL_LANGUAGES)[number];

export function isSpellSetting(value: unknown): value is SpellSetting {
  return value === "auto" || value === "off" || SPELL_LANGUAGES.includes(value as never);
}

/** "Deutsch (Österreich)" etc. in the UI language. */
export function spellLanguageName(code: string, uiLocale: string): string {
  const name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1);
}
