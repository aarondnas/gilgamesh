// The main windows (src-tauri/src/commands/window.rs).
import { invoke } from "@tauri-apps/api/core";

/** What a new main window does first (see `window/mod.rs`). */
export type WindowStart = { action: "open"; root: string } | { action: "new" } | { action: "import"; archive: string };

export const windowApi = {
  windowOpenMain: (start: WindowStart | null) => invoke<void>("window_open_main", { start }),
  /** `null` if this window may open the project; otherwise the window showing it, now in front. */
  projectClaim: (root: string) => invoke<string | null>("project_claim", { root }),
};
