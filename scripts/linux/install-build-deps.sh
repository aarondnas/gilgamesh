#!/usr/bin/env sh
# Installs the system libraries needed to build Gilgamesh on Linux (Tauri 2: WebKitGTK 4.1, GTK 3,
# librsvg for icons, patchelf for the AppImage). Rust and Node.js are installed separately
# (https://rustup.rs, https://nodejs.org). Used by the CI as well.
#
# Usage: scripts/linux/install-build-deps.sh   (asks for sudo if not run as root)
set -eu

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

if command -v apt-get >/dev/null 2>&1; then
  # Debian 12+, Ubuntu 22.04+, Linux Mint 21+
  $SUDO apt-get update
  $SUDO apt-get install -y \
    build-essential curl wget file patchelf \
    libwebkit2gtk-4.1-dev librsvg2-dev libxdo-dev libssl-dev
elif command -v dnf >/dev/null 2>&1; then
  # Fedora 38+
  $SUDO dnf install -y \
    gcc gcc-c++ make curl wget file patchelf \
    webkit2gtk4.1-devel librsvg2-devel libxdo-devel openssl-devel
elif command -v pacman >/dev/null 2>&1; then
  # Arch Linux, Manjaro
  $SUDO pacman -S --needed --noconfirm \
    base-devel curl wget file patchelf \
    webkit2gtk-4.1 librsvg xdotool openssl
elif command -v zypper >/dev/null 2>&1; then
  # openSUSE Tumbleweed / Leap 15.6+
  $SUDO zypper install -y -t pattern devel_basis
  $SUDO zypper install -y \
    curl wget file patchelf \
    webkit2gtk3-devel librsvg-devel libopenssl-devel
else
  echo "Unknown package manager. Install the Tauri 2 prerequisites by hand:" >&2
  echo "https://v2.tauri.app/start/prerequisites/#linux" >&2
  exit 1
fi
