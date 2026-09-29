#!/usr/bin/env bash
# ┌─ LEGACY: сборка Tauri-версии (pantheon-ui-tauri-legacy) ─────────────┐
# │ Активный UI = mayak-ui (GPUIX). Этот скрипт оставлен как reference.  │
# │ Для mayak-ui будет свой build-pkg (шаг 9 плана).                      │
# └───────────────────────────────────────────────────────────────────────┘
# ВАЖНО: tauri встраивает dist/ ПРИ КОМПИЛЯЦИИ — без pnpm build бинарь увезёт старый UI
set -euo pipefail
UI=~/pantheon/ui/pantheon-ui-tauri-legacy
PKG=~/pantheon/packaging
cd "$UI" && pnpm build
cd "$UI/src-tauri" && cargo build --release --features custom-protocol
cp target/release/pantheon-ui "$PKG/pantheon-ui"
cp icons/icon.png "$PKG/icon.png"
cd "$PKG" && makepkg -f
echo "Готово: $PKG/pantheon-ui-bin-*.pkg.tar.zst"
