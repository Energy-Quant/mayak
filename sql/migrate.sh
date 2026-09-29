#!/usr/bin/env bash
# migrate.sh — применить миграции к pantheon.db и sessions.db по user_version
# Использование: ./migrate.sh
set -euo pipefail

PANTHEON_DB="${PANTHEON_DB:-$HOME/.local/share/goose/pantheon.db}"
SESSIONS_DB="${SESSIONS_DB:-$HOME/.local/share/goose/sessions/sessions.db}"
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
PANTHEON_LOG="${PANTHEON_LOG:-$HOME/.local/state/pantheon/guard.log}"

mkdir -p "$(dirname "$PANTHEON_LOG")"

plog() {
  printf '%s | %-5s | %-22s | %-12s | %s | %s\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")" "${1^^}" "migrate.sh" "-" "$2" "${3:-}" \
    >> "$PANTHEON_LOG" 2>/dev/null || true
}

apply() { # apply <db> <dir> <dbname>
  local db="$1" dir="$2" name="$3"
  [ -f "$db" ] || { echo "⚠ $name не найден: $db — пропускаю"; return 0; }
  local current
  current=$(sqlite3 "$db" "PRAGMA user_version;" 2>/dev/null || echo 0)
  echo "── $name (v$current) ──"
  for f in "$dir"/[0-9]*.sql; do
    [ -f "$f" ] || continue
    local ver
    ver=$(grep -oP 'user_version\s*=\s*\K[0-9]+' "$f" | head -1)
    [ -z "$ver" ] && continue
    if [ "$ver" -gt "$current" ]; then
      echo "  применяю $(basename "$f") → v$ver"
      sqlite3 "$db" < "$f"
      plog "info" "migration.applied" "db=$name file=$(basename "$f") ver=$ver"
    else
      echo "  пропускаю $(basename "$f") (уже v$ver)"
    fi
  done
  echo "  итог: v$(sqlite3 "$db" "PRAGMA user_version;")"
}

apply "$PANTHEON_DB" "$DIR/pantheon" "pantheon.db"
apply "$SESSIONS_DB" "$DIR/sessions" "sessions.db"
echo "Миграции применены."
