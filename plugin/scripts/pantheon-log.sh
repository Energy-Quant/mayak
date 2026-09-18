#!/usr/bin/env bash
# pantheon-log.sh — SessionStart/PostToolUse/SessionEnd: аудит и регистрация runs
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pantheon-lib.sh
source "$LIB_DIR/pantheon-lib.sh"

payload="$(cat)"
event=$(printf '%s' "$payload" | jq -r '.event // empty')
session_id=$(printf '%s' "$payload" | jq -r '.session_id // empty')
[ -z "$session_id" ] && exit 0

pantheon_init_db

case "$event" in
  SessionStart)
    role=$(upsert_run "$session_id") ;;
  PostToolUse)
    tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
    detail=$(printf '%s' "$payload" | jq -r '.tool_input | (if has("path") then .path elif has("command") then (.command|.[0:160]) else "" end) // ""' 2>/dev/null)
    detail=$(printf '%s' "$detail" | sed "s/'/''/g" | tr '\n' ' ')
    role=$(upsert_run "$session_id" >/dev/null; resolve_role "$session_id")
    sqlite3 "$PANTHEON_DB" "INSERT INTO events(session_id,event,tool_name,detail)
      VALUES('$session_id','$event','${tool:-}','${detail:-}')" 2>/dev/null ;;
  SessionEnd)
    role=$(resolve_role "$session_id")
    sqlite3 "$PANTHEON_DB" "UPDATE runs SET status='done', finished_at=datetime('now') WHERE session_id='$session_id'" 2>/dev/null
    rm -f "$CACHE_DIR/role-$session_id" 2>/dev/null ;;
esac
exit 0
