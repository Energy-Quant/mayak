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

pub fn kv_set(key: &str, value: &str) {
    if let Ok(conn) = open() {
        let _ = conn.execute(
            "INSERT INTO kv(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
            rusqlite::params![key, value],
        );
    }
}
