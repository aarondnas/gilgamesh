// Events the backend sends to the page.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { localize } from "./localize";
import type { McpCall } from "./mcp";
import type { ProjectChanges } from "./project";
import type { InstallProgress } from "./tex";
import type { OpenRequest } from "./window";

/** Only the events sent to this window: a plain `listen` would also get the other windows'. */
const onWindowEvent = <T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> =>
  getCurrentWebviewWindow().listen<T>(event, (e) => cb(e.payload));

export const events = {
  /** A line of tlmgr's output, or a note of the app's own (see `localize`). */
  onTexLog: (cb: (line: string) => void): Promise<UnlistenFn> => listen<string>("tex:log", (e) => cb(localize(e.payload))),
  onInstallProgress: (cb: (p: InstallProgress) => void): Promise<UnlistenFn> =>
    listen<InstallProgress>("tex:install-progress", (e) => cb(e.payload)),
  /** Changes to this window's project from outside the app (see `watch.rs`). */
  onProjectChanges: (cb: (changes: ProjectChanges) => void) => onWindowEvent("project-changes", cb),
  /** Another window or program changed the settings file (see `settings::changed`); the writer is left out. */
  onSettingsChanged: (cb: () => void) => onWindowEvent("settings-changed", cb),
  /** A tool call from an AI assistant for this window (see `mcp/host.rs`). */
  onMcpCall: (cb: (call: McpCall) => void) => onWindowEvent("mcp-call", cb),
  /** An update is about to be installed: save everything, then answer with `updateSaved` (see `updates.rs`). */
  onUpdateSave: (cb: () => void) => onWindowEvent("update-save", cb),
  /** The app was started again for a file while running, and this window is to show it (see `window::second_start`). */
  onOpenRequest: (cb: (request: OpenRequest) => void) => onWindowEvent("open-request", cb),
};
