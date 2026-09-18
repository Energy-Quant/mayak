#!/usr/bin/env bash
# Собирает релизный бинарник и готовит папку для makepkg
set -euo pipefail
UI=~/pantheon/ui/pantheon-ui/src-tauri
PKG=~/pantheon/packaging
cd "$UI" && cargo build --release
cp target/release/pantheon-ui "$PKG/pantheon-ui"
cp icons/icon.png "$PKG/icon.png"
cd "$PKG" && makepkg -f
echo "Готово: $PKG/pantheon-ui-bin-*.pkg.tar.zst"
