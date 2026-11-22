// Compiles the messages for the tests where no dev server or build has done
// so yet (a fresh checkout) or they are out of date, with the app's options
// (scripts/paraglide.mjs). Left alone otherwise: rewriting them would reload
// a running `tauri dev`.
import { compileParaglide } from "../scripts/paraglide.mjs";

export default async function setup() {
  await compileParaglide();
}
