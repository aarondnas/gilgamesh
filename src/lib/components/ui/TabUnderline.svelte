<script lang="ts">
  import { prefersReducedMotion } from "$lib/util/motion";

  interface Props {
    /** The row of tabs (elements with `role="tab"`); it must be positioned (`position: relative`). */
    strip: HTMLElement | null;
    /** Which of them is shown. */
    index: number;
  }

  /** The line under the shown tab, gliding from tab to tab. */
  let { strip, index }: Props = $props();

  let place = $state<{ left: number; width: number } | null>(null);

  $effect(() => {
    const tab = strip?.querySelectorAll<HTMLElement>('[role="tab"]')[index];
    if (!strip || !tab) return;
    const measure = () => (place = { left: tab.offsetLeft, width: tab.offsetWidth });
    measure();
    // Tab widths change with the language and the window size.
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  });
</script>

{#if place}
  <span class="underline" class:still={prefersReducedMotion()} style:left="{place.left}px" style:width="{place.width}px"></span>
{/if}

<style>
  .underline {
    position: absolute;
    bottom: -1px;
    height: 2px;
    background: var(--accent-strong);
    pointer-events: none;
    transition:
      left 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .underline.still {
    transition: none;
  }
</style>
