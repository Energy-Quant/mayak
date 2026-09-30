#!/usr/bin/env bash
# guard-run.sh — точка входа PreToolUse guard'а.
# P7: предпочитает pantheon-guard (Rust), fallback — guard.sh (bash).
# Причина перехода: bash-парсинг хрупок к инъекциям (спецсимволы, &&, backtick в кавычках).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Rust-бинарь: рядом со скриптом или в target/guard-rs
CANDIDATES=(
  "$DIR/pantheon-guard"
  "$DIR/../guard-rs/target/release/pantheon-guard"
  "$HOME/pantheon/plugin/guard-rs/target/release/pantheon-guard"
)

for bin in "${CANDIDATES[@]}"; do
  if [ -x "$bin" ]; then
    exec "$bin"
  fi
done

# fallback: bash-версия (медленнее, но работает без сборки)
exec bash "$DIR/guard.sh"
