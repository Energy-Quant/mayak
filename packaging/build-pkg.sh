#!/usr/bin/env bash
# Собирает фронт (dist) + релизный бинарник и готовит папку для makepkg
# ВАЖНО: tauri встраивает dist/ ПРИ КОМПИЛЯЦИИ — без pnpm build бинарь увезёт старый UI
set -euo pipefail
UI=~/pantheon/ui/pantheon-ui
PKG=~/pantheon/packaging
cd "$UI" && pnpm build
cd "$UI/src-tauri" && cargo build --release --features custom-protocol
cp target/release/pantheon-ui "$PKG/pantheon-ui"
cp icons/icon.png "$PKG/icon.png"
cd "$PKG" && makepkg -f
echo "Готово: $PKG/pantheon-ui-bin-*.pkg.tar.zst"
