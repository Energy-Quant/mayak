#!/usr/bin/env bash
# ci-fixtures.sh — bootstrap a minimal Mayak environment for CI.
#
# The smoke/unit tests read real config + SQLite DBs (sessions.db, config.yaml,
# pantheon.toml, agents/*.md, opencode-go-models.json). In a fresh CI runner none
# exist, so the suite fails before reaching assertions. This script creates
# lightweight fixtures so the suite runs hermetically.
#
# Human-edited files (config.yaml, pantheon.toml, agents, recipes, catalog) are
# written ONLY if missing — safe to run locally without clobbering real config.
# Comments: English. Idempotent.
set -euo pipefail

H="${HOME}"
echo "==> Bootstrapping CI fixtures in $H"

mkdir -p "$H/.local/share/goose/sessions" \
         "$H/.config/goose/recipes" \
         "$H/.config/goose/prompts" \
         "$H/.agents/agents" \
         "$H/.local/state/mayak-ui"

# ── sessions.db (read-only consumers) ──
SESS="$H/.local/share/goose/sessions/sessions.db"
if [ ! -f "$SESS" ]; then
  sqlite3 "$SESS" <<'SQL'
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, name TEXT, description TEXT, session_type TEXT,
  parent_session_id TEXT, content_json TEXT, total_tokens INTEGER,
  recipe_json TEXT, archived_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sessions (id, name, session_type, updated_at)
  VALUES ('ci-main', 'CI session', 'user', datetime('now'));
SQL
fi

# ── pantheon.db (idempotent seed) ──
PANTH="$H/.local/share/goose/pantheon.db"
sqlite3 "$PANTH" <<'SQL'
CREATE TABLE IF NOT EXISTS runs (
  session_id TEXT PRIMARY KEY, parent_session_id TEXT,
  role TEXT NOT NULL DEFAULT 'adhoc', status TEXT DEFAULT 'running',
  task_summary TEXT, model TEXT,
  started_at TEXT DEFAULT (datetime('now')), ended_at TEXT
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, detail TEXT, session_id TEXT, tool_name TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS artifacts (path TEXT PRIMARY KEY, kind TEXT, topic TEXT, run_session_id TEXT, project_path TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS interviews (id INTEGER PRIMARY KEY, session_id TEXT, spec_json TEXT, answers_json TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
INSERT OR IGNORE INTO runs (session_id, role, status) VALUES ('ci-main', 'goose', 'done');
SQL

# ── config.yaml (only if missing) ──
if [ ! -f "$H/.config/goose/config.yaml" ]; then
  printf 'extensions:\n  opencode_go:\n    enabled: true\n' > "$H/.config/goose/config.yaml"
fi

# ── pantheon.toml (only if missing) ──
if [ ! -f "$H/.config/goose/pantheon.toml" ]; then
  cat > "$H/.config/goose/pantheon.toml" <<'TOML'
[agents.goose]
primary = { provider = "opencode_go", model = "mimo-v2.6-flash" }
fallbacks = []

[agents.oracle]
primary = { provider = "opencode_go", model = "mimo-v2.6-pro" }
fallbacks = []

[agents.librarian]
primary = { provider = "opencode_go", model = "mimo-v2.6-flash" }
fallbacks = []
TOML
fi

# ── agent frontmatter (only if missing) ──
for a in oracle librarian; do
  if [ ! -f "$H/.agents/agents/$a.md" ]; then
    printf -- '---\nname: %s\ndescription: CI fixture agent.\nmodel: mimo-v2.6-pro\n---\n\n# %s (CI fixture)\n' "$a" "$a" > "$H/.agents/agents/$a.md"
  fi
done

# ── recipes (only if missing) ──
for r in oracle-consult librarian-research; do
  if [ ! -f "$H/.config/goose/recipes/$r.yaml" ]; then
    cat > "$H/.config/goose/recipes/$r.yaml" <<EOF
id: $r
title: CI $r
settings:
  goose_provider: opencode_go
  goose_model: mimo-v2.6-pro
  max_turns: 1000
EOF
  fi
done

# ── model catalog (only if missing) ──
if [ ! -f "$H/.config/goose/opencode-go-models.json" ]; then
  cat > "$H/.config/goose/opencode-go-models.json" <<'JSON'
{
  "models": [
    { "id": "mimo-v2.6-flash", "context_limit": 1000000, "price_in_per_1m": 0.1, "price_out_per_1m": 0.3 },
    { "id": "mimo-v2.6-pro",   "context_limit": 1000000, "price_in_per_1m": 0.5, "price_out_per_1m": 1.5 }
  ]
}
JSON
fi

echo "==> CI fixtures ready (sessions.db, pantheon.db, config.yaml, pantheon.toml, agents, recipes, catalog)"
