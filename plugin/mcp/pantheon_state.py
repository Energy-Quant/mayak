#!/usr/bin/env python3
"""pantheon_state.py — MCP stdio-сервер состояния Пантеона.

БД: ~/.local/share/goose/pantheon.db (runs, artifacts, projects, kv, events, handoffs).
Инструменты:
  pantheon_get_state(project_path?)   — сводка: фаза проекта, планы, недавние артефакты и runs
  pantheon_list_artifacts(kind?, topic?, project_path?) — выборка артефактов
  pantheon_upsert_artifact(path, kind, topic?, run_session_id?, project_path?) — регистрация артефакта
  pantheon_log_event(kind, detail?)   — событие в kv/events
  pantheon_register_run(session_id, role, task_summary?, model?) — явная регистрация роли
  pantheon_kv_get(key) / pantheon_kv_set(key, value)
Только stdlib. Запуск: python3 pantheon_state.py (goose стартует сам как stdio extension).
"""
import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get("PANTHEON_DB", os.path.expanduser("~/.local/share/goose/pantheon.db"))

SCHEMA = """
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
"""


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def rows_to_dicts(cur):
    return [dict(r) for r in cur.fetchall()]


# ── Инструменты ──────────────────────────────────────────────────────

def tool_get_state(args):
    conn = db()
    out = {}
    if args.get("project_path"):
        out["project"] = rows_to_dicts(conn.execute(
            "SELECT * FROM projects WHERE path=?", (args["project_path"],)))
        out["artifacts"] = rows_to_dicts(conn.execute(
            "SELECT kind, path, topic, created_at, status FROM artifacts "
            "WHERE project_path=? ORDER BY created_at DESC LIMIT 20", (args["project_path"],)))
    out["recent_runs"] = rows_to_dicts(conn.execute(
        "SELECT session_id, role, status, task_summary, model, started_at, finished_at "
        "FROM runs ORDER BY started_at DESC LIMIT 15"))
    out["plans"] = rows_to_dicts(conn.execute(
        "SELECT path, topic, created_at, status FROM artifacts WHERE kind='plan' "
        "ORDER BY created_at DESC LIMIT 10"))
    out["digests"] = rows_to_dicts(conn.execute(
        "SELECT path, topic, created_at, status FROM artifacts WHERE kind='digest' "
        "ORDER BY created_at DESC LIMIT 10"))
    out["kv"] = rows_to_dicts(conn.execute(
        "SELECT key, value, updated_at FROM kv ORDER BY updated_at DESC LIMIT 20"))
    conn.close()
    return out


def tool_list_artifacts(args):
    conn = db()
    q = "SELECT kind, path, topic, project_path, created_at, status FROM artifacts WHERE 1=1"
    p = []
    if args.get("kind"):
        q += " AND kind=?"; p.append(args["kind"])
    if args.get("topic"):
        q += " AND topic LIKE ?"; p.append(f"%{args['topic']}%")
    if args.get("project_path"):
        q += " AND project_path=?"; p.append(args["project_path"])
    q += " ORDER BY created_at DESC LIMIT 50"
    res = rows_to_dicts(conn.execute(q, p))
    conn.close()
    return {"artifacts": res}


def tool_upsert_artifact(args):
    conn = db()
    conn.execute(
        "INSERT INTO artifacts(run_session_id, kind, path, topic, project_path) "
        "VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        (args.get("run_session_id"), args["kind"], args["path"],
         args.get("topic"), args.get("project_path")))
    conn.commit()
    row = conn.execute("SELECT id FROM artifacts WHERE path=? ORDER BY id DESC LIMIT 1",
                       (args["path"],)).fetchone()
    conn.close()
    return {"artifact_id": row["id"] if row else None}


def tool_log_event(args):
    conn = db()
    conn.execute("INSERT INTO events(session_id, event, detail) VALUES(?,?,?)",
                 (args.get("session_id"), args["kind"], args.get("detail")))
    if args.get("project_path"):
        conn.execute("INSERT INTO projects(path, updated_at) VALUES(?, datetime('now')) "
                     "ON CONFLICT(path) DO UPDATE SET updated_at=datetime('now')",
                     (args["project_path"],))
    conn.commit()
    conn.close()
    return {"ok": True}


def tool_register_run(args):
    conn = db()
    conn.execute(
        "INSERT INTO runs(session_id, role, status, task_summary, model) VALUES(?,?, 'running', ?, ?) "
        "ON CONFLICT(session_id) DO UPDATE SET role=excluded.role, task_summary=excluded.task_summary, "
        "model=excluded.model",
        (args["session_id"], args["role"], args.get("task_summary"), args.get("model")))
    conn.commit()
    conn.close()
    return {"ok": True}


def tool_kv_set(args):
    conn = db()
    conn.execute("INSERT INTO kv(key, value) VALUES(?,?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
                 (args["key"], args.get("value")))
    conn.commit(); conn.close()
    return {"ok": True}


def tool_kv_get(args):
    conn = db()
    row = conn.execute("SELECT value FROM kv WHERE key=?", (args["key"],)).fetchone()
    conn.close()
    return {"key": args["key"], "value": row["value"] if row else None}


TOOLS = {
    "pantheon_get_state": (tool_get_state, {
        "type": "object",
        "properties": {"project_path": {"type": "string"}},
    }),
    "pantheon_list_artifacts": (tool_list_artifacts, {
        "type": "object",
        "properties": {"kind": {"type": "string", "enum": ["plan", "digest", "analysis"]},
                        "topic": {"type": "string"}, "project_path": {"type": "string"}},
    }),
    "pantheon_upsert_artifact": (tool_upsert_artifact, {
        "type": "object",
        "properties": {"path": {"type": "string"}, "kind": {"type": "string"},
                        "topic": {"type": "string"}, "run_session_id": {"type": "string"},
                        "project_path": {"type": "string"}},
        "required": ["path", "kind"],
    }),
    "pantheon_log_event": (tool_log_event, {
        "type": "object",
        "properties": {"kind": {"type": "string"}, "detail": {"type": "string"},
                        "session_id": {"type": "string"}, "project_path": {"type": "string"}},
        "required": ["kind"],
    }),
    "pantheon_register_run": (tool_register_run, {
        "type": "object",
        "properties": {"session_id": {"type": "string"}, "role": {"type": "string"},
                        "task_summary": {"type": "string"}, "model": {"type": "string"}},
        "required": ["session_id", "role"],
    }),
    "pantheon_kv_set": (tool_kv_set, {
        "type": "object",
        "properties": {"key": {"type": "string"}, "value": {"type": "string"}},
        "required": ["key"],
    }),
    "pantheon_kv_get": (tool_kv_get, {
        "type": "object",
        "properties": {"key": {"type": "string"}},
        "required": ["key"],
    }),
}


def handle(msg):
    method = msg.get("method")
    mid = msg.get("id")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "pantheon-state", "version": "1.0.0"}}}
    if method == "notifications/initialized" or mid is None:
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": [
            {"name": n, "description": TOOL_DOCS.get(n, n), "inputSchema": s}
            for n, (_, s) in TOOLS.items()]}}
    if method == "tools/call":
        name = msg["params"]["name"]
        args = msg["params"].get("arguments", {})
        if name not in TOOLS:
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": f"Unknown tool: {name}"}], "isError": True}}
        try:
            result = TOOLS[name][0](args)
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=1)}]}}
        except Exception as e:  # noqa: BLE001
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": f"Error: {e}"}], "isError": True}}
    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": -32601, "message": f"Method not found: {method}"}}


TOOL_DOCS = {
    "pantheon_get_state": "Сводка состояния Пантеона: фаза проекта, планы, дайджесты, недавние runs, kv",
    "pantheon_list_artifacts": "Список артефактов (plan/digest/analysis) с фильтрами",
    "pantheon_upsert_artifact": "Зарегистрировать артефакт (path, kind: plan|digest|analysis, topic)",
    "pantheon_log_event": "Записать событие (kind, detail)",
    "pantheon_register_run": "Явно зарегистрировать роль сессии (session_id, role)",
    "pantheon_kv_set": "Записать ключ-значение",
    "pantheon_kv_get": "Прочитать ключ-значение",
}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        resp = handle(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
