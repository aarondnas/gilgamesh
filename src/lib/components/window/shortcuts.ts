// Window-wide keyboard and drop handling, shared by the main window and detached panes.
import { carriesFiles } from "$lib/util/dropped-files";
import { doc } from "$lib/state/document.svelte";
import { build } from "$lib/state/build.svelte";

/**
 * Text fields keep their own undo; only elsewhere does Ctrl+Z reach the editor.
 * No `instanceof HTMLElement`: elements of a detached window come from another realm.
 */
function isTextField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (typeof element?.tagName !== "string") return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

export function handleShortcut(event: KeyboardEvent) {
  // Shortcuts handled inside the editor call preventDefault.
  if (event.defaultPrevented || !event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if ((key === "z" || key === "y") && isTextField(event.target)) return;
  const actions: Record<string, () => unknown> = {
    n: () => doc.newProject(),
    o: () => doc.openProject(),
    s: () => doc.save(),
    enter: () => build.compile(),
    z: () => (event.shiftKey ? doc.redo() : doc.undo()),
    y: () => doc.redo(),
  };
  const action = actions[key];
  if (action) {
    event.preventDefault();
    void action();
  }
}

/**
 * Ctrl + wheel, and touchpad pinches, which arrive as such: the editor and
 * the PDF preview zoom by them themselves; anywhere else the webview would
 * zoom the whole window. Needs a listener that is not passive.
 */
function refuseZoom(event: WheelEvent) {
  if (event.ctrlKey) event.preventDefault();
}

/**
 * How far a Ctrl + wheel event zooms, in pixels (out for positive), and
 * whether it is a mouse wheel notch: a notch arrives as one step of about 100
 * pixels (more with display scaling), a touchpad pinch as many small ones.
 * The webview reports a pinch by the factor s as 100 · ln(1/s) pixels.
 */
export function zoomWheel(event: WheelEvent, pageHeight: number): { delta: number; notch: boolean } {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1);
  return { delta, notch: Math.abs(delta) >= 40 };
}

/** Keeps the webview from zooming `view` (see `refuseZoom`). */
export function refuseZoomIn(view: Window) {
  view.addEventListener("wheel", refuseZoom, { passive: false });
}

/**
 * The webview's own context menu (save as, print, inspect, share) has nothing
 * for the app: it stays only where text is edited, in fields and the editor,
 * for cut, copy and paste. The app's own menus prevent it themselves.
 */
export function refuseContextMenu(event: MouseEvent) {
  // Duck-typed: in a detached window the target comes from another document's realm.
  const target = event.target as Element | null;
  if (target?.closest?.("input, textarea, [contenteditable='true'], .cm-content")) return;
  event.preventDefault();
}

/** The explorer handles file drops itself; elsewhere they show "not allowed". */
export function refuseFiles(event: DragEvent) {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}
