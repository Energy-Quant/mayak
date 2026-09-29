#!/usr/bin/env bash
# pantheon-lib.sh — общие функции плагина Пантеон
# Пути и resolve роли сессии. Подключается: source "$(dirname "$0")/pantheon-lib.sh"

PANTHEON_DB="${PANTHEON_DB:-$HOME/.local/share/goose/pantheon.db}"
SESSIONS_DB="${SESSIONS_DB:-$HOME/.local/share/goose/sessions/sessions.db}"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/pantheon"

# ── сквозное логирование (единый формат с mayak-ui logger.ts) ──────────────
# 2026-09-29T21:40:12.345Z | ERROR | guard.sh | sid | event | detail
PANTHEON_LOG="${PANTHEON_LOG:-$HOME/.local/state/pantheon/guard.log}"

plog() { # plog <level> <module> <session_id> <event> [detail]
  local level="$1" mod="$2" sid="$3" event="$4" detail="${5:-}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.345Z" | sed 's/\.345Z/.'"$(date +%3N)"'Z/')
  printf '%s | %-5s | %-22s | %-12s | %s | %s\n'     "$ts" "${level^^}" "$mod" "${sid:- -}" "$event" "$detail" >> "$PANTHEON_LOG" 2>/dev/null || true
  case "$level" in
    warn|error) printf '%s | %-5s | %-22s | %-12s | %s | %s\n'       "$ts" "${level^^}" "$mod" "${sid:- -}" "$event" "$detail" >&2 || true ;;
  esac
}

pantheon_init_db() {
  mkdir -p "$(dirname "$PANTHEON_DB")" "$CACHE_DIR" 2>/dev/null
  if [ ! -f "$PANTHEON_DB" ]; then
    sqlite3 "$PANTHEON_DB" <<'SQL' 2>/dev/null
CREATE TABLE IF NOT EXISTS runs (
  session_id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  role TEXT NOT NULL DEFAULT 'adhoc',
  status TEXT DEFAULT 'running',
  task_summary TEXT,
  model TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  run_session_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  topic TEXT,
  project_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'actual'
);
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY,
  phase TEXT,
  current_plan TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS handoffs (
  id INTEGER PRIMARY KEY,
  from_role TEXT, to_role TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  event TEXT,
  tool_name TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
SQL
  fi
}

# jq-экстракция с дефолтом
jget() { # jget <json> <jq-path> <default>
  printf '%s' "$1" | jq -r "$2 // \"$3\"" 2>/dev/null || printf '%s' "$3"
}

# resolve_role <session_id> — определяет роль из pantheon.db → sessions.db
# Вывод: goose|oracle|librarian|adhoc; кэш в $CACHE_DIR/role-<sid>
resolve_role() {
  local sid="$1" cached r title rj mname
  [ -z "$sid" ] && { echo "adhoc"; return; }
  cached=$(cat "$CACHE_DIR/role-$sid" 2>/dev/null)
  [ -n "$cached" ] && { echo "$cached"; return; }

  # 1) явная регистрация
  r=$(sqlite3 "$PANTHEON_DB" "SELECT role FROM runs WHERE session_id='$sid' LIMIT 1" 2>/dev/null)
  # 2) sessions.db: тип сессии + recipe_json title + [PANTHEON:*] тег
  if [ -z "$r" ] && [ -f "$SESSIONS_DB" ]; then
    rj=$(sqlite3 "$SESSIONS_DB" "SELECT coalesce(recipe_json,'') FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
    if [ -n "$rj" ]; then
      title=$(printf '%s' "$rj" | jq -r '.title // empty' 2>/dev/null)
      case "$title" in
        "Agent: oracle")       r="oracle" ;;
        "Agent: librarian")    r="librarian" ;;
        "Agent: pantheon-conductor"|"Agent: goose") r="goose" ;;
        "Oracle Consultation") r="oracle" ;;
        "Librarian Research")  r="librarian" ;;
      esac
      if [ -z "$r" ]; then
        case "$rj" in
          *"[PANTHEON:oracle]"*)    r="oracle" ;;
          *"[PANTHEON:librarian]"*) r="librarian" ;;
          *"[PANTHEON:goose]"*)     r="goose" ;;
        esac
      fi
    fi
  fi
  # 3) основная сессия user = goose
  if [ -z "$r" ] && [ -f "$SESSIONS_DB" ]; then
    st=$(sqlite3 "$SESSIONS_DB" "SELECT session_type FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
    [ "$st" = "user" ] && r="goose"
  fi
  [ -z "$r" ] && r="adhoc"
  # кэшируем только подтверждённые роли (adhoc может смениться после регистрации в runs)
  [ "$r" != "adhoc" ] && printf '%s' "$r" > "$CACHE_DIR/role-$sid" 2>/dev/null
  echo "$r"
}

# upsert_run <sid> — регистрация/обновление run в pantheon.db
upsert_run() {
  local sid="$1" role parent stype rj summary model
  pantheon_init_db
  rm -f "$CACHE_DIR/role-$sid" 2>/dev/null   # инвалидация кэша перед пересчётом
  role=$(resolve_role "$sid")
  parent=$(sqlite3 "$SESSIONS_DB" "SELECT coalesce(parent_session_id,'') FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
  stype=$(sqlite3 "$SESSIONS_DB" "SELECT coalesce(session_type,'') FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
  rj=$(sqlite3 "$SESSIONS_DB" "SELECT coalesce(recipe_json,'') FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
  summary=$(printf '%s' "$rj" | jq -r '.description // .prompt // "—"' 2>/dev/null | head -c 200 | tr '\n' ' ')
  model=$(sqlite3 "$SESSIONS_DB" "SELECT json_extract(coalesce(model_config_json,'{}'),'$.model_name') FROM sessions WHERE id='$sid' LIMIT 1" 2>/dev/null)
  [ "$stype" = "user" ] && parent=""
  sqlite3 "$PANTHEON_DB" "INSERT INTO runs(session_id,parent_session_id,role,status,task_summary,model)
    VALUES('$sid','${parent:-}','${role:-adhoc}','running','$(printf '%s' "$summary" | sed "s/'/''/g")','${model:-}')
    ON CONFLICT(session_id) DO UPDATE SET role=excluded.role, status='running', model=excluded.model" 2>/dev/null
  echo "$role"
}
