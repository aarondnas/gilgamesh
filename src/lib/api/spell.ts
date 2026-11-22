// Spell checking and the user's own dictionary (src-tauri/src/commands/spell.rs).
import { invoke } from "@tauri-apps/api/core";

export const spellApi = {
  /** Words the dictionary `language` does not know; downloads it on first use. */
  spellCheck: (language: string, words: string[]) => invoke<string[]>("spell_check", { language, words }),
  spellSuggest: (language: string, word: string) => invoke<string[]>("spell_suggest", { language, word }),
  /** The user's own words, one list for the installation, count in every language. */
  spellAdd: (word: string) => invoke<void>("spell_add", { word }),
  spellWords: () => invoke<string[]>("spell_words"),
  spellRemove: (word: string) => invoke<void>("spell_remove", { word }),
};
