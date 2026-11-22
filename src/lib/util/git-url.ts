// Addresses of Git remotes, checked before the backend checks them again
// (`is_remote_url` in src-tauri/src/git/mod.rs).

/** `https://…`, `ssh://…`, `git://…` or scp-like SSH (`git@github.com:me/thesis.git`). */
export function isRemoteUrl(value: string): boolean {
  return /^(https?|ssh|git|git\+ssh):\/\/\S+$/.test(value) || /^[^\s/:@]+@[^\s/:]+:[^\s/]\S*$/.test(value);
}
