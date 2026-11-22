<!--
  A modal dialog. With `open`, it follows a value of the app's state: it shows
  when the value turns true, after `onopen` (awaited if it returns a promise)
  has filled in the form, and closes when it turns false. Without `open`, the
  owner shows and closes it through the bound `dialog` element.

  It also sets the look shared by the dialogs' content: title (`h1`), fields
  (`.field` with an input or select), hints, errors and the button row
  (`footer`). These rules have no specificity, so a dialog's own styles win.
-->
<script lang="ts">
  import { untrack, type Snippet } from "svelte";

  interface Props {
    /** Follows this value; leave it out to show and close the dialog through `dialog`. */
    open?: boolean;
    /** Prepares the content before the dialog shows; not tracked as a dependency. */
    onopen?: () => void | Promise<void>;
    /** Also on Esc, which closes the native dialog: mirror it into the state. */
    onclose?: () => void;
    oncancel?: (event: Event) => void;
    /** Width in px, at most the window's less a margin. */
    width: number;
    /** A class of the owner's for the dialog element, e.g. to size it. */
    class?: string;
    dialog?: HTMLDialogElement;
    children: Snippet;
  }

  let { open, onopen, onclose, oncancel, width, class: className = "", dialog = $bindable(), children }: Props = $props();

  // Only opening and closing may re-run this; `onopen` writes the form state, which must not become a dependency.
  $effect(() => {
    if (open === undefined) return;
    if (open) {
      untrack(async () => {
        await onopen?.();
        if (open && dialog && !dialog.open) dialog.showModal();
      });
    } else if (dialog?.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="dialog {className}" style:--dialog-width="{width}px" {onclose} {oncancel}>
  {@render children()}
</dialog>

<style>
  dialog {
    width: min(var(--dialog-width), 100% - 2 * var(--space-6));
    max-height: calc(100% - 2 * var(--space-6));
    padding: var(--space-7);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.2);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.3);
  }

  :global(:where(.dialog) :where(h1)) {
    margin: 0 0 var(--space-6);
    font-size: var(--font-lg);
    font-weight: 600;
  }

  :global(:where(.dialog) :where(.field)) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  :global(:where(.dialog) :where(input:not([type="checkbox"], [type="radio"], [type="file"]), select)) {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    font-weight: normal;
  }

  :global(:where(.dialog) :where(input:focus, select:focus)) {
    border-color: var(--accent-strong);
  }
  :global(:where(.dialog) :where(.hint)) {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--font-sm);
  }

  :global(:where(.dialog) :where(.error)) {
    margin: var(--space-3) 0 0;
    color: var(--error);
    font-size: var(--font-sm);
  }

  :global(:where(.dialog) :where(footer)) {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-7);
  }
</style>
