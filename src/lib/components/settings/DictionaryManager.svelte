<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { api, errorMessage } from "$lib/api";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages";
  import { doc } from "$lib/state/document.svelte";
  import { locale } from "$lib/state/locale.svelte";
  import { prefersReducedMotion } from "$lib/util/motion";
  import Button from "../ui/Button.svelte";

  /** One list for the whole installation: every language accepts these words. */
  let words = $state<string[]>([]);
  let input = $state("");
  let error = $state<string | null>(null);

  const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

  /** "Ärger" files under A, "Øre" under O; digits and signs under #. */
  function letterOf(word: string): string {
    const first = word
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .charAt(0)
      .toUpperCase();
    return /[A-Z]/.test(first) ? first : first === "Ø" ? "O" : "#";
  }

  /** The words by first letter, in dictionary order, as in the index. */
  const groups = $derived.by(() => {
    const byLetter = new Map<string, string[]>();
    const sorted = [...words].sort((a, b) => a.localeCompare(b, locale.current, { sensitivity: "base" }));
    for (const word of sorted) {
      const letter = letterOf(word);
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), word]);
    }
    return LETTERS.filter((l) => byLetter.has(l)).map((letter) => ({ letter, words: byLetter.get(letter)! }));
  });

  let groupRows: Record<string, HTMLTableRowElement> = {};

  function jump(letter: string) {
    groupRows[letter]?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  onMount(load);

  async function load() {
    error = null;
    try {
      words = await api.spellWords();
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const word = input.trim();
    if (!word) return;
    try {
      await api.spellAdd(word);
      input = "";
      await load();
      doc.editor?.refreshSpelling(true);
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function remove(word: string) {
    try {
      await api.spellRemove(word);
      await load();
      doc.editor?.refreshSpelling(true);
    } catch (err) {
      error = errorMessage(err);
    }
  }
</script>

<section>
  <h1>{m.dictionary_title()}</h1>
  <p>{m.dictionary_text()}</p>

  <div class="controls">
    <form onsubmit={add}>
      <input bind:value={input} placeholder={m.dictionary_placeholder()} />
      <Button type="submit" disabled={!input.trim()}>{m.dictionary_add()}</Button>
    </form>
  </div>

  {#if error}<p class="error">{error}</p>{/if}

  {#if words.length === 0}
    <p class="empty">{m.dictionary_empty()}</p>
  {:else}
    <!-- Thumb index of a dictionary: letters with words jump there. -->
    <nav class="index">
      {#each LETTERS as letter (letter)}
        {@const present = groups.some((g) => g.letter === letter)}
        <button disabled={!present} title={present ? m.dictionary_jump({ letter }) : undefined} onclick={() => jump(letter)}>
          {letter}
        </button>
      {/each}
    </nav>

    <table>
      <thead>
        <tr><th colspan="2">{m.dictionary_words({ count: words.length })}</th></tr>
      </thead>
      {#each groups as group (group.letter)}
        <tbody>
          <tr class="letter" bind:this={groupRows[group.letter]}>
            <th colspan="2" scope="rowgroup">{group.letter}</th>
          </tr>
          {#each group.words as word (word)}
            <tr class="word">
              <td>{word}</td>
              <td class="action">
                <button title={m.dictionary_remove({ word })} aria-label={m.dictionary_remove({ word })} onclick={() => remove(word)}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  {/if}
</section>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-5);
    margin: var(--space-5) 0;
  }

  form {
    display: flex;
    gap: var(--space-3);
  }

  input {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font: inherit;
    font-weight: normal;
  }

  /* Stays in view while the list scrolls, like the tabs on a dictionary's edge. */
  .index {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-4) 0;
    background: var(--surface);
  }

  .index button {
    min-width: 22px;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--accent-strong);
    font: inherit;
    font-size: var(--font-sm);
    font-weight: 600;
    transition: background-color 150ms ease;
  }

  .index button:hover:not(:disabled) {
    background: var(--hover);
  }

  .index button:disabled {
    color: var(--border);
    font-weight: normal;
  }

  table {
    width: 100%;
    margin-bottom: var(--space-8);
    border-collapse: collapse;
    font-size: var(--font-base);
  }

  thead th {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--font-sm);
    font-weight: 600;
    text-align: left;
  }

  .letter th {
    padding: var(--space-5) var(--space-4) var(--space-2);
    border-bottom: 1px solid var(--border);
    color: var(--accent-strong);
    font-size: var(--font-base);
    font-weight: 600;
    text-align: left;
  }

  /* Lands below the sticky index when jumped to. */
  .letter {
    scroll-margin-top: 48px;
  }

  .word td {
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--surface-2);
  }

  .word:hover td {
    background: var(--hover);
  }

  .action {
    width: 1%;
    text-align: right;
  }

  .action button {
    display: flex;
    padding: var(--space-1);
    border: none;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .word:hover .action button,
  .action button:focus-visible {
    opacity: 1;
  }

  .action button:hover {
    color: var(--error);
  }

  .empty {
    font-size: var(--font-sm);
  }

  .error {
    color: var(--error);
    font-size: var(--font-sm);
  }
</style>
