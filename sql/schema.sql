-- pantheon.db — состояние Пантеона (~/.local/share/goose/pantheon.db)
CREATE TABLE IF NOT EXISTS runs (
  session_id TEXT PRIMARY KEY, parent_session_id TEXT,
  role TEXT NOT NULL DEFAULT 'adhoc', status TEXT DEFAULT 'running',
  task_summary TEXT, model TEXT,
  started_at TEXT DEFAULT (datetime('now')), finished_at TEXT);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY, run_session_id TEXT, kind TEXT NOT NULL,
  path TEXT NOT NULL, topic TEXT, project_path TEXT,
  created_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'actual');
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY, phase TEXT, current_plan TEXT, notes TEXT,
  updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT,
  updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY, from_role TEXT,
  to_role TEXT, payload TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, session_id TEXT,
  event TEXT, tool_name TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
