<script lang="ts">
  import AppWindow from "@lucide/svelte/icons/app-window";
  import SquareArrowOutUpRight from "@lucide/svelte/icons/square-arrow-out-up-right";
  import { m } from "$lib/paraglide/messages";
  import Button from "../ui/Button.svelte";
  import Dialog from "../ui/Dialog.svelte";

  interface Props {
    title: string;
    /** Called with the user's choice; not at all when the dialog is cancelled. */
    onchoose: (inNewWindow: boolean) => void;
  }

  let { title, onchoose }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  /** Asks whether to open something here or in a new main window. */
  export function ask() {
    dialog?.showModal();
  }

  function choose(inNewWindow: boolean) {
    dialog?.close();
    onchoose(inNewWindow);
  }
</script>

<Dialog bind:dialog width={420} class="window-choice">
  <h1>{title}</h1>
  <div class="choices">
    <button class="choice" onclick={() => choose(false)}>
      <AppWindow size={26} strokeWidth={1.5} />
      {m.ribbon_in_this_window()}
    </button>
    <button class="choice" onclick={() => choose(true)}>
      <SquareArrowOutUpRight size={26} strokeWidth={1.5} />
      {m.ribbon_in_new_window()}
    </button>
  </div>
  <footer>
    <Button onclick={() => dialog?.close()}>{m.new_project_cancel()}</Button>
  </footer>
</Dialog>

<style>
  :global(dialog.window-choice[open]) {
    animation: pop-in 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  .choice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--font-base);
    transition:
      border-color 150ms ease,
      background-color 150ms ease;
  }

  .choice :global(svg) {
    color: var(--accent-strong);
  }

  .choice:hover,
  .choice:focus-visible {
    border-color: var(--accent-strong);
    background: var(--hover);
    outline: none;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-6);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(dialog.window-choice[open]) {
      animation: none;
    }
  }
</style>
