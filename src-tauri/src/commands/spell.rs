//! Spell checking and the user's own dictionary.

use tauri::State;

use super::{AppState, CmdResult};

/// Words the dictionary `language` (e.g. "de", "en-GB") does not know.
#[tauri::command]
pub async fn spell_check(state: State<'_, AppState>, language: String, words: Vec<String>) -> CmdResult<Vec<String>> {
    state.spell.check(&state.paths, &language, words).await
}

#[tauri::command]
pub async fn spell_suggest(state: State<'_, AppState>, language: String, word: String) -> CmdResult<Vec<String>> {
    state.spell.suggest(&state.paths, &language, &word).await
}

#[tauri::command]
pub async fn spell_words(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    Ok(state.spell.words(&state.paths).await)
}

#[tauri::command]
pub async fn spell_remove(state: State<'_, AppState>, word: String) -> CmdResult<()> {
    state.spell.remove(&state.paths, &word).await
}

/// Accepts `word` in every language; the user's words are one list for the installation.
#[tauri::command]
pub async fn spell_add(state: State<'_, AppState>, word: String) -> CmdResult<()> {
    state.spell.add(&state.paths, &word).await
}
