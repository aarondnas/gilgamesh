<script lang="ts">
  import { m } from "$lib/paraglide/messages";
  import SettingsPage from "./SettingsPage.svelte";

  /** One shortcut: alternative key combinations, each a list of keys pressed together. */
  interface Shortcut {
    keys: string[][];
    text: string;
  }

  // Keep in sync with the handlers in +page.svelte, EditorPane, PdfPane, ProjectSidebar
  // and the CodeMirror defaults (basicSetup) the editor relies on.
  const groups: { title: string; shortcuts: Shortcut[] }[] = $derived.by(() => {
    const ctrl = m.key_ctrl();
    const shift = m.key_shift();
    const alt = m.key_alt();
    const enter = m.key_enter();
    const zoom = (reset: string): Shortcut[] => [
      { keys: [[ctrl, m.key_plus()]], text: m.shortcut_zoom_in() },
      { keys: [[ctrl, m.key_minus()]], text: m.shortcut_zoom_out() },
      { keys: [[ctrl, m.key_wheel()]], text: m.shortcut_zoom_wheel() },
      { keys: [[ctrl, "0"]], text: reset },
    ];
    return [
      {
        title: m.shortcuts_group_general(),
        shortcuts: [
          { keys: [[ctrl, "N"]], text: m.shortcut_new_project() },
          { keys: [[ctrl, "O"]], text: m.shortcut_open_project() },
          { keys: [[ctrl, "S"]], text: m.shortcut_save() },
          { keys: [[ctrl, enter]], text: m.shortcut_compile() },
          { keys: [[ctrl, "Z"]], text: m.shortcut_undo() },
          {
            keys: [
              [ctrl, "Y"],
              [ctrl, shift, "Z"],
            ],
            text: m.shortcut_redo(),
          },
        ],
      },
      {
        title: m.shortcuts_group_editor(),
        shortcuts: [
          { keys: [[ctrl, alt, "J"]], text: m.shortcut_sync_to_pdf() },
          ...zoom(m.shortcut_zoom_reset()),
          { keys: [[ctrl, "F"]], text: m.shortcut_find() },
          { keys: [["F3"], [ctrl, "G"]], text: m.shortcut_find_next() },
          { keys: [[ctrl, alt, "G"]], text: m.shortcut_go_to_line() },
          { keys: [[ctrl, "D"]], text: m.shortcut_select_next() },
          { keys: [[ctrl, m.key_space()]], text: m.shortcut_complete() },
          { keys: [[ctrl, "/"]], text: m.shortcut_comment() },
          {
            keys: [
              [alt, "↑"],
              [alt, "↓"],
            ],
            text: m.shortcut_move_line(),
          },
          {
            keys: [
              [shift, alt, "↑"],
              [shift, alt, "↓"],
            ],
            text: m.shortcut_copy_line(),
          },
          { keys: [[ctrl, shift, "K"]], text: m.shortcut_delete_line() },
        ],
      },
      {
        title: m.shortcuts_group_pdf(),
        shortcuts: [{ keys: [[m.key_double_click()]], text: m.shortcut_sync_from_pdf() }, ...zoom(m.shortcut_zoom_fit())],
      },
      {
        title: m.shortcuts_group_explorer(),
        shortcuts: [
          { keys: [[enter]], text: m.shortcut_open_file() },
          { keys: [["F2"]], text: m.shortcut_rename() },
          { keys: [[m.key_delete()]], text: m.shortcut_delete() },
        ],
      },
    ];
  });
</script>

<SettingsPage>
  <section>
    <h1>{m.shortcuts_title()}</h1>
    <p>{m.shortcuts_text()}</p>

    {#each groups as group (group.title)}
      <h2>{group.title}</h2>
      <table>
        <tbody>
          {#each group.shortcuts as shortcut (shortcut.text)}
            <tr>
              <td class="keys">
                {#each shortcut.keys as combination, i (i)}
                  {#if i > 0}<span class="or">{m.shortcuts_or()}</span>{/if}
                  <span class="combination">
                    {#each combination as key, j (j)}
                      {#if j > 0}+{/if}<kbd>{key}</kbd>
                    {/each}
                  </span>
                {/each}
              </td>
              <td>{shortcut.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/each}
  </section>
</SettingsPage>

<style>
  h2 {
    margin: var(--space-7) 0 var(--space-3);
    font-size: var(--font-base);
    font-weight: 600;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  .keys {
    width: 45%;
    white-space: nowrap;
  }

  .combination {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .or {
    margin: 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--font-xs);
  }
</style>
