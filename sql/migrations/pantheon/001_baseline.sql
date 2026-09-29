-- Миграция 001: базовая схема (базовая линия, user_version=1)
-- Это отражение schema.sql на момент введения миграций.

PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS runs (
  session_id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  role TEXT NOT NULL DEFAULT 'adhoc',
  status TEXT DEFAULT 'running',
  task_summary TEXT,
  model TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  topic TEXT,
  run_session_id TEXT,
  project_path TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT,
  detail TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
