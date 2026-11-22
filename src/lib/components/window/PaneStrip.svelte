<script lang="ts" module>
  /** Makes the whole strip the handle a pane is dragged out of the window by, as a tab would be. */
  export interface StripGrip {
    draggable: boolean;
    dragging: boolean;
    onpointerdown: (event: PointerEvent) => void;
    ondragstart: (event: DragEvent) => void;
    ondblclick: (event: MouseEvent) => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade } from "svelte/transition";
  import { motionMs, prefersReducedMotion } from "$lib/util/motion";

  interface Props {
    /** The pane's tab or title (from `PaneFrame`). */
    tab: Snippet;
    /** Docking buttons at the far end (from `PaneFrame`). */
    actions: Snippet;
    /** Color of the content below, which the tab merges into. */
    background: string;
    /** The pane's own tools, e.g. zoom, at the right end before the docking buttons. */
    children: Snippet;
    /** For a pane without tabs: the strip itself is the handle. */
    grip?: StripGrip;
    /** Work for the pane is running, e.g. a build for the preview: a bar runs along the strip's lower edge, `label` names it. */
    busy?: boolean;
    label?: string;
  }

  let { tab, actions, background, children, grip, busy = false, label }: Props = $props();

  /** How long the whole bar lights up once the work is done; matches `.progress.done`. */
  const DONE_MS = 650;

  /** The work just ended: the bar fills and lights up once before it goes. */
  let done = $state(false);
  let wasBusy = false;
  $effect(() => {
    if (busy) {
      done = false;
    } else if (wasBusy) {
      done = true;
      const timer = setTimeout(() => (done = false), motionMs(DONE_MS));
      wasBusy = busy;
      return () => clearTimeout(timer);
    }
    wasBusy = busy;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="strip"
  class:grip={!!grip}
  class:dragging={grip?.dragging}
  style:--tab-bg={background}
  draggable={grip?.draggable}
  onpointerdown={grip?.onpointerdown}
  ondragstart={grip?.ondragstart}
  ondblclick={grip?.ondblclick}
>
  {@render tab()}
  <span class="spacer"></span>
  <div class="tools">{@render children()}</div>
  {@render actions()}
  {#if busy || done}
    <span
      class="progress"
      class:still={prefersReducedMotion()}
      class:done
      role="progressbar"
      aria-label={label}
      title={label}
      transition:fade={{ duration: motionMs(200) }}
    >
      <span class="run first"></span>
      <span class="run second"></span>
    </span>
  {/if}
</div>

<style>
  .strip {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    height: var(--toolbar-height);
    padding: 0 var(--space-3) 0 var(--space-2);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    user-select: none;
  }

  .strip.dragging {
    opacity: 0.6;
  }

  .strip > :global(.btn),
  .tools {
    align-self: center;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-3);
    border-right: 1px solid var(--border);
  }

  .spacer {
    flex: 1;
  }

  /*
   * On the strip's lower edge, over its line: a faint track, two bands of the
   * accent running through it one after the other, a long one and a short one.
   */
  .progress {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    z-index: 1;
    height: 3px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent-strong) 14%, transparent);
    pointer-events: none;
  }

  .run {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    background: linear-gradient(90deg, transparent, var(--accent-strong) 20%, var(--accent-strong) 80%, transparent);
    transform-origin: left center;
  }

  .run.first {
    animation: run-long 2.1s cubic-bezier(0.65, 0.815, 0.735, 0.395) infinite;
  }

  .run.second {
    animation: run-short 2.1s cubic-bezier(0.165, 0.84, 0.44, 1) 1.15s infinite;
  }

  @keyframes run-long {
    0% {
      transform: translateX(-35%) scaleX(0.35);
    }
    60%,
    100% {
      transform: translateX(100%) scaleX(0.9);
    }
  }

  @keyframes run-short {
    0% {
      transform: translateX(-100%) scaleX(0.5);
    }
    60%,
    100% {
      transform: translateX(107%) scaleX(0.1);
    }
  }

  /* Done: the runs give way to the whole bar, which fills and lights up once. */
  .progress.done {
    overflow: visible;
    background: var(--accent-strong);
    animation: finish 650ms ease-out both;
  }

  .progress.done .run {
    display: none;
  }

  @keyframes finish {
    0% {
      opacity: 0.6;
      box-shadow: 0 0 0 0 transparent;
    }
    25% {
      opacity: 1;
      box-shadow: 0 0 8px 1px color-mix(in srgb, var(--accent-strong) 70%, transparent);
    }
    100% {
      opacity: 0;
      box-shadow: 0 0 2px 0 transparent;
    }
  }

  /* Without motion: the track filled half, still. */
  .progress.still .run {
    animation: none;
    opacity: 0.6;
    transform: scaleX(0.5);
  }

  .progress.still .run.second {
    display: none;
  }
</style>
