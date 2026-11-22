// How a row of tabs changes: the shown tab's line glides to the new one (see
// `TabUnderline.svelte`), and the new tab's content slides in from where the
// tab lies. Used by the ribbon, the settings and the project sidebar; nothing
// moves for users who asked their system to reduce animations.
import { cubicOut } from "svelte/easing";
import { fly } from "svelte/transition";
import { motionMs } from "$lib/util/motion";

/** A tab's content sliding in from the right (`direction` 1) or the left (-1). */
export function slideFrom(node: Element, direction: number) {
  return fly(node, { x: 24 * direction, duration: motionMs(220), easing: cubicOut });
}

/**
 * An intro transition for a tab's content: in from the right for a tab to the
 * right of the one shown before, from the left otherwise. `index` is the
 * shown tab's position, read when the content comes in.
 */
export function tabSlide(index: () => number) {
  let last = index();
  return (node: Element) => {
    const now = index();
    const direction = now >= last ? 1 : -1;
    last = now;
    return slideFrom(node, direction);
  };
}
