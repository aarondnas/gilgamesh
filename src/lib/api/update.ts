// Updates of Gilgamesh itself (src-tauri/src/commands/update.rs).
import { invoke } from "@tauri-apps/api/core";

/** What is known about a new version of Gilgamesh (`UpdateStatus` in src-tauri/src/updates.rs). */
export interface UpdateStatus {
  /** The version running now. */
  current: string;
  /** A newer version on GitHub, if the last check found one. */
  available: { version: string; notes: string | null } | null;
  /** When the last check ended, in milliseconds since 1970. */
  checkedAt: number | null;
  checking: boolean;
  /** Downloading and installing; Gilgamesh ends when it is done. */
  installing: boolean;
  downloaded: number;
  total: number | null;
  /** Why the last check or install failed, from the backend (see `localize`). */
  error: string | null;
  /** This copy can update itself (an installed build, not one started from the sources). */
  canInstall: boolean;
  /**
   * Updates no longer come from GitHub with the known key, the new version has to come from the
   * website: `missing` – GitHub has no release (any more); `untrusted` – the update found is not
   * signed with the known key.
   */
  lost: "missing" | "untrusted" | null;
}

export const updateApi = {
  updateStatus: () => invoke<UpdateStatus>("update_status"),
  /** Asks GitHub for a newer version now. */
  updateCheck: () => invoke<UpdateStatus>("update_check"),
  /** Downloads and installs the update found; Gilgamesh ends and starts again. Only returns (rejects) if it failed. */
  updateInstall: () => invoke<void>("update_install"),
  /** This window saved its files before the install (`error` if it could not). */
  updateSaved: (error: string | null) => invoke<void>("update_saved", { error }),
};
