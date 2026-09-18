//! db.rs — rusqlite доступ к pantheon.db (только чтение + kv-аудит)
use rusqlite::Connection;
use std::fs;

pub fn db_path() -> std::path::PathBuf {
    dirs::home_dir()
        .expect("home dir")
        .join(".local/share/goose/pantheon.db")
}

pub fn open() -> Result<Connection, String> {
    let path = db_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS runs (
            session_id TEXT PRIMARY KEY, parent_session_id TEXT,
            role TEXT NOT NULL DEFAULT 'adhoc', status TEXT DEFAULT 'running',
            task_summary TEXT, model TEXT,
            started_at TEXT DEFAULT (datetime('now')), finished_at TEXT);
         CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT,
            updated_at TEXT DEFAULT (datetime('now')));",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(serde::Serialize)]
pub struct RunRow {
    pub session_id: String,
    pub role: String,
    pub status: String,
    pub task_summary: Option<String>,
    pub model: Option<String>,
}

pub fn recent_runs() -> Result<Vec<RunRow>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT session_id, role, status, task_summary, model FROM runs
                  ORDER BY started_at DESC LIMIT 15")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RunRow {
                session_id: r.get(0)?,
                role: r.get(1)?,
                status: r.get(2)?,
                task_summary: r.get(3)?,
                model: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// История сессий из sessions.db goose (read-only); running — из pantheon.db
pub fn list_sessions(only_running: bool) -> Result<Vec<serde_json::Value>, String> {
    let running: std::collections::HashSet<String> = open()
        .map(|c| {
            c.prepare("SELECT session_id FROM runs WHERE status='running'")
                .and_then(|mut s| {
                    s.query_map([], |r| r.get::<_, String>(0))
                        .map(|it| it.filter_map(|x| x.ok()).collect())
                })
                .unwrap_or_default()
        })
        .unwrap_or_default();
    let path = dirs::home_dir()
        .ok_or("no home")?
        .join(".local/share/goose/sessions/sessions.db");
    let conn = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, session_type, updated_at, total_tokens
             FROM sessions WHERE archived_at IS NULL
             ORDER BY updated_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let stype: String = r.get(3)?;
            let name: String = r.get(1)?;
            let desc: String = r.get(2)?;
            let sid: String = r.get(0)?;
            let is_running = running.contains(&sid);
            Ok(serde_json::json!({
                "id": sid,
                "title": if name.is_empty() {
                    if desc.is_empty() { "Без названия".to_string() }
                    else { desc.chars().take(60).collect() }
                } else { name },
                "session_type": stype,
                "updated_at": r.get::<_, String>(4)?,
                "total_tokens": r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                "running": is_running,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|r| !only_running || r["running"] == serde_json::json!(true))
        .collect();
    Ok(rows)
}

pub fn kv_set(key: &str, value: &str) {
    if let Ok(conn) = open() {
        let _ = conn.execute(
            "INSERT INTO kv(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
            rusqlite::params![key, value],
        );
    }
}
