#!/usr/bin/env bash
# End-to-end test of Gilgamesh on Linux, driven through WebDriver (see README.md).
#
# Sets up a world of its own and starts the app in it: a fresh user (own HOME,
# Git without name and e-mail), a local Git server, stand-ins for Claude Desktop,
# Claude Code and Codex, and for the programs that open printer settings and URLs.
#
# Usage: tests/e2e-linux/run.sh [--fresh-tex] [test name filter ...]
#   --fresh-tex  install TinyTeX through the app's Packages page (downloads it)
#                instead of copying $E2E_TEX_SOURCE (default: the app's own TeX)
# Environment: E2E_DIR (default ~/gilgamesh-e2e) is wiped and rebuilt on every run.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
REAL_HOME="$HOME"
APP="$REPO/src-tauri/target/debug/gilgamesh"
T="${E2E_DIR:-$REAL_HOME/gilgamesh-e2e}"
TEX_SOURCE="${E2E_TEX_SOURCE:-$REAL_HOME/.local/share/com.aaron.gilgamesh/tex}"

FRESH_TEX=""
if [ "${1:-}" = "--fresh-tex" ]; then FRESH_TEX=1; shift; fi
[ -d "$TEX_SOURCE" ] || FRESH_TEX=1

for tool in tauri-driver WebKitWebDriver git node python3 pdfinfo pdftoppm lpstat cargo; do
  command -v "$tool" >/dev/null || { echo "missing: $tool (see README.md)" >&2; exit 2; }
done
[ -x "$APP" ] || { echo "build the app first: npx tauri build --debug --no-bundle" >&2; exit 2; }

pkill -f tauri-driver 2>/dev/null; pkill -f WebKitWebDriver 2>/dev/null; pkill -f "git daemon" 2>/dev/null
pkill -f "$APP" 2>/dev/null
sleep 1

# The Claude Desktop extension as Gilgamesh writes it (on Linux only the tests need one).
mkdir -p "$T.tmp"
( cd "$REPO/src-tauri" && GILGAMESH_E2E_BUNDLE="$T.tmp/gilgamesh.mcpb" \
    cargo test --quiet --lib writes_extension_for_end_to_end_tests -- --ignored >/dev/null 2>&1 ) \
  || { echo "could not write the extension bundle" >&2; exit 2; }

rm -rf "$T"
mkdir -p "$T/home" "$T/projects" "$T/remote" "$T/shots" "$T/seed" "$T/fakebin"
mv "$T.tmp/gilgamesh.mcpb" "$T/gilgamesh.mcpb" && rmdir "$T.tmp"
export HOME="$T/home"
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_CURRENT_DESKTOP
export LANG=C.UTF-8

# TeX: a copy, so packages installed or removed here leave the original alone.
if [ -z "$FRESH_TEX" ]; then
  mkdir -p "$HOME/.local/share/com.aaron.gilgamesh"
  cp -a "$TEX_SOURCE" "$HOME/.local/share/com.aaron.gilgamesh/tex"
fi

# Settings of a user who said yes to installing missing packages; English UI.
mkdir -p "$HOME/.config/com.aaron.gilgamesh"
cat > "$HOME/.config/com.aaron.gilgamesh/settings.json" <<JSON
{ "locale": "en", "projectLocation": "$T/projects", "autoInstallPackages": true,
  "autoInstallAsked": true, "checkUpdates": false, "theme": "light" }
JSON

# Claude Desktop "installed": its config folder with another server and preferences.
mkdir -p "$HOME/.config/Claude"
echo '{"mcpServers":{"other":{"command":"/usr/bin/true"}},"preferences":{"keep":1}}' > "$HOME/.config/Claude/claude_desktop_config.json"
# Claude Code "installed": a `claude` that does what `claude mcp add/remove` does to ~/.claude.json.
mkdir -p "$HOME/.local/bin"
cp "$HERE/fake-claude.mjs" "$HOME/.local/bin/fake-claude.mjs"
printf '#!/bin/sh\nexec node "$HOME/.local/bin/fake-claude.mjs" "$@"\n' > "$HOME/.local/bin/claude"
chmod +x "$HOME/.local/bin/claude"
echo '{"numStartups":3,"mcpServers":{"other":{"type":"stdio","command":"/usr/bin/true","args":[]}}}' > "$HOME/.claude.json"
# Codex "installed".
mkdir -p "$HOME/.codex"
printf 'model = "o3"\n\n[mcp_servers.other]\ncommand = "/usr/bin/true"\n' > "$HOME/.codex/config.toml"

# Programs the app starts to show something to the user: they only log their call.
# powershell.exe is how URLs are opened under WSL; it would open a Windows browser.
LAUNCHED="$T/launched.log"
for program in system-config-printer gnome-control-center systemsettings kcmshell5 kcmshell6 xdg-open gio gnome-open kde-open powershell.exe; do
  # Under WSL the URL comes in OPEN_RS_TARGET (the `open` crate's PowerShell command).
  printf '#!/bin/sh\necho "$(basename "$0") ${OPEN_RS_TARGET:-$*}" >> "%s"\n' "$LAUNCHED" > "$T/fakebin/$program"
  chmod +x "$T/fakebin/$program"
done
export PATH="$T/fakebin:$PATH"

# Git server: an empty repository to publish to, and one with a project to clone.
git init -q --bare -b main "$T/remote/paper.git"
git init -q --bare -b main "$T/remote/sample.git"
(
  cd "$T/seed" && git init -q -b main &&
    printf '\\documentclass{article}\n\\begin{document}\nSample project from the server.\n\\end{document}\n' > main.tex &&
    git add main.tex && git -c user.name=Seed -c user.email=seed@example.com commit -qm "Seed" && git push -q "$T/remote/sample.git" main
)
git daemon --reuseaddr --base-path="$T/remote" --export-all --enable=receive-pack --listen=127.0.0.1 --port=9418 "$T/remote" \
  > "$T/git-daemon.log" 2>&1 &
DAEMON=$!

tauri-driver > "$T/tauri-driver.log" 2>&1 &
DRIVER=$!
for _ in $(seq 1 50); do curl -s localhost:4444/status >/dev/null 2>&1 && break; sleep 0.2; done

APP="$APP" T="$T" REAL_HOME="$REAL_HOME" MESSAGES="$REPO/messages/en.json" FRESH_TEX="$FRESH_TEX" \
  BUNDLE="$T/gilgamesh.mcpb" LAUNCHED="$LAUNCHED" node "$HERE/e2e.mjs" "$@"
STATUS=$?

kill $DRIVER $DAEMON 2>/dev/null
pkill -f WebKitWebDriver 2>/dev/null
echo "Screenshots of failures and the final state: $T/shots"
exit $STATUS
