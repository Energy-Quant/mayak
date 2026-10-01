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
  pantheon_interview(title?, questions) — create an interactive interview (survey) for the user
  pantheon_interview_submit(interview_id, answers_text) — record the user's answers (audit)
Только stdlib. Запуск: python3 pantheon_state.py (goose стартует сам как stdio extension).
"""
import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get("PANTHEON_DB", os.path.expanduser("~/.local/share/goose/pantheon.db"))

# ── сквозное логирование (единый формат с mayak-ui logger.ts) ──────────────
# 2026-09-29T21:40:12.345Z | ERROR | pantheon_state.py | sid | event | detail
_LOG_PATH = os.path.expanduser("~/.local/state/pantheon/guard.log")
_LOG_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}
_LOG_THRESHOLD = _LOG_LEVELS.get(os.environ.get("MAYAK_LOG", "info").lower(), 20)


def _log(level: str, event: str, detail: str = "", session_id: str = "-") -> None:
    if _LOG_LEVELS.get(level, 20) < _LOG_THRESHOLD:
        return
    import datetime
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")
    line = f"{ts} | {level.upper():5} | pantheon_state.py | {session_id:12} | {event} | {detail}\n"
    try:
        os.makedirs(os.path.dirname(_LOG_PATH), exist_ok=True)
        with open(_LOG_PATH, "a") as f:
            f.write(line)
    except Exception:
        pass
    if _LOG_LEVELS.get(level, 20) >= 30:
        sys.stderr.write(line)

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
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY, session_id TEXT, spec_json TEXT, answers_json TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
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


def _validate_interview_spec(args):
    """Validate rawInput for pantheon_interview and return a normalized spec dict.

    Raises ValueError with a human-readable message on any problem.
    """
    questions = args.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError(
            "поле `questions` обязательно и должно содержать минимум 1 вопрос "
            "(array, minItems: 1)")
    norm_questions = []
    for i, q in enumerate(questions, 1):
        if not isinstance(q, dict):
            raise ValueError(f"вопрос #{i}: должен быть объектом {{question, options, …}}")
        text = q.get("question")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"вопрос #{i}: пустое поле `question` (string, required)")
        options = q.get("options")
        if not isinstance(options, list) or not options:
            raise ValueError(
                f"вопрос #{i} («{text.strip()[:50]}»): нужен минимум 1 вариант "
                "`options` (array, minItems: 1)")
        norm_options = []
        for j, opt in enumerate(options, 1):
            if not isinstance(opt, dict):
                raise ValueError(f"вопрос #{i}, вариант #{j}: должен быть объектом {{label, description?}}")
            label = opt.get("label")
            if not isinstance(label, str) or not label.strip():
                raise ValueError(f"вопрос #{i}, вариант #{j}: пустое поле `label` (string, required)")
            norm_opt = {"label": label.strip()}
            desc = opt.get("description")
            if isinstance(desc, str) and desc.strip():
                norm_opt["description"] = desc.strip()
            norm_options.append(norm_opt)
        norm_q = {
            "question": text.strip(),
            "multiple": bool(q.get("multiple", False)),
            "allowCustom": bool(q.get("allowCustom", True)),
            "options": norm_options,
        }
        subtitle = q.get("subtitle")
        if isinstance(subtitle, str) and subtitle.strip():
            norm_q["subtitle"] = subtitle.strip()
        norm_questions.append(norm_q)
    spec = {"questions": norm_questions}
    title = args.get("title")
    if isinstance(title, str) and title.strip():
        spec["title"] = title.strip()
    return spec


def tool_interview_create(args):
    spec = _validate_interview_spec(args)
    sid = args.get("session_id") or "-"
    conn = db()
    cur = conn.execute(
        "INSERT INTO interviews(session_id, spec_json, status) VALUES(?, ?, 'pending')",
        (sid, json.dumps(spec, ensure_ascii=False)))
    conn.commit()
    interview_id = cur.lastrowid
    conn.close()
    _log("info", "mcp.interview.create",
         f"id={interview_id} questions={len(spec['questions'])}", sid)
    return {
        "ok": True,
        "interview_id": interview_id,
        "message": ("Интервью показано пользователю. "
                    "Прекрати генерацию и жди ответа — он придёт отдельным сообщением."),
    }


def tool_interview_submit(args):
    interview_id = args.get("interview_id")
    if not isinstance(interview_id, int):
        raise ValueError("поле `interview_id` обязательно (integer)")
    answers_text = args.get("answers_text")
    if not isinstance(answers_text, str) or not answers_text.strip():
        raise ValueError("поле `answers_text` обязательно (non-empty string)")
    # Store as JSON: reuse raw JSON answers when possible, otherwise wrap plain text.
    try:
        parsed = json.loads(answers_text)
        answers_json = json.dumps(parsed, ensure_ascii=False) if isinstance(parsed, (dict, list)) \
            else json.dumps({"text": answers_text}, ensure_ascii=False)
    except (json.JSONDecodeError, ValueError):
        answers_json = json.dumps({"text": answers_text}, ensure_ascii=False)
    conn = db()
    row = conn.execute("SELECT id FROM interviews WHERE id=?", (interview_id,)).fetchone()
    if row is None:
        conn.close()
        raise ValueError(f"интервью id={interview_id} не найдено")
    conn.execute("UPDATE interviews SET answers_json=?, status='done' WHERE id=?",
                 (answers_json, interview_id))
    conn.commit()
    sid = conn.execute("SELECT session_id FROM interviews WHERE id=?",
                       (interview_id,)).fetchone()
    conn.close()
    _log("info", "mcp.interview.submit", f"id={interview_id} status=done",
         sid["session_id"] if sid else "-")
    return {"ok": True, "interview_id": interview_id, "status": "done"}


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
    "pantheon_interview": (tool_interview_create, {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "questions": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "subtitle": {"type": "string"},
                        "multiple": {"type": "boolean", "default": False},
                        "allowCustom": {"type": "boolean", "default": True},
                        "options": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "description": {"type": "string"},
                                },
                                "required": ["label"],
                            },
                        },
                    },
                    "required": ["question", "options"],
                },
            },
        },
        "required": ["questions"],
    }),
    "pantheon_interview_submit": (tool_interview_submit, {
        "type": "object",
        "properties": {"interview_id": {"type": "integer"},
                       "answers_text": {"type": "string"}},
        "required": ["interview_id", "answers_text"],
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
        sid = args.get("session_id") or args.get("run_session_id") or "-"
        _log("info", "mcp.tools/call.start", f"tool={name}", sid)
        if name not in TOOLS:
            _log("warn", "mcp.tools/call", f"unknown tool={name}", sid)
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": f"Unknown tool: {name}"}], "isError": True}}
        try:
            result = TOOLS[name][0](args)
            _log("info", "mcp.tools/call.end", f"tool={name} ok=1", sid)
            return {"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=1)}]}}
        except Exception as e:  # noqa: BLE001
            _log("error", "mcp.tools/call.end", f"tool={name} ok=0 {e}", sid)
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
    "pantheon_interview": ("Создать интерактивное интервью (опрос) для пользователя: 1–3 вопроса "
                           "с вариантами ответов. После вызова ПРЕКРАТИ генерацию и жди ответа "
                           "пользователя отдельным сообщением."),
    "pantheon_interview_submit": "Зафиксировать ответы пользователя на интервью (interview_id, answers_text) — аудит",
}


def main():
    _log("info", "mcp.ready", f"db={DB_PATH}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _log("warn", "mcp.bad-json", line[:120])
            continue
        resp = handle(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
