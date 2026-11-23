// The main windows (src-tauri/src/commands/window.rs).
import { invoke } from "@tauri-apps/api/core";

/** What a new main window does first (see `window/mod.rs`); `file` is relative to `root`. */
export type WindowStart = { action: "open"; root: string; file?: string } | { action: "new" } | { action: "import"; archive: string };

/** A project and file the running app was asked to open, e.g. a `.tex` file "opened with Gilgamesh". */
export interface OpenRequest {
  root: string;
  /** Relative to `root`, with `/`. */
  file: string | null;
  /** This window already shows `root`: only the file is opened. */
  shown: boolean;
}

export const windowApi = {
  windowOpenMain: (start: WindowStart | null) => invoke<void>("window_open_main", { start }),
  /** `null` if this window may open the project; otherwise the window showing it, now in front. */
  projectClaim: (root: string) => invoke<string | null>("project_claim", { root }),
};
