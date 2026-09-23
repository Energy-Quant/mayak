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
pub fn list_sessions(only_running: bool) -> Result<Vec<serde_json::Value>, String> {    let running: std::collections::HashSet<String> = open()
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
            "SELECT id, name, description, session_type, updated_at, total_tokens, parent_session_id
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
                "parent_session_id": r.get::<_, Option<String>>(6)?,
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

/// content_json → структурированные блоки для человекочитаемого стрима субагента.
/// Колонка = content_json (JSON-массив Message API). Шум (turn-context, дампы skill) вычищаем.
fn content_blocks(raw: &str) -> Vec<serde_json::Value> {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        let t = raw.trim();
        if t.is_empty() || is_noise(t) {
            return vec![];
        }
        return vec![serde_json::json!({
            "kind": "text",
            "text": clip(t, 600),
        })];
    };
    let arr = match &parsed {
        serde_json::Value::Array(a) => a.as_slice(),
        other => std::slice::from_ref(other),
    };
    let mut out: Vec<serde_json::Value> = Vec::new();
    for b in arr {
        let Some(obj) = b.as_object() else { continue };
        match obj.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                let Some(t) = obj.get("text").and_then(|t| t.as_str()) else { continue };
                let cleaned = strip_noise(t);
                if cleaned.is_empty() {
                    continue;
                }
                out.push(serde_json::json!({ "kind": "text", "text": clip(&cleaned, 12_000) }));
            }
            Some("thinking") => {
                let Some(t) = obj.get("thinking").and_then(|t| t.as_str()) else { continue };
                let t = t.trim();
                if t.is_empty() || is_noise(t) {
                    continue;
                }
                // thinking: полная цепочка для раскрытия в UI (клип только как страховка)
                out.push(serde_json::json!({ "kind": "thinking", "text": clip(t, 8_000) }));
            }
            Some("toolRequest") | Some("tool_use") => {
                // goose: toolRequest.toolCall.value.name (вложенная структура)
                let name = obj
                    .get("toolCall")
                    .and_then(|c| c.get("value"))
                    .and_then(|v| v.get("name"))
                    .or_else(|| obj.get("kind"))
                    .or_else(|| obj.get("name"))
                    .or_else(|| obj.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                // load_skill → «load_skill quant-core» если есть аргументы
                let detail = obj
                    .get("toolCall")
                    .and_then(|c| c.get("value"))
                    .and_then(|v| v.get("arguments"))
                    .and_then(|a| a.get("name"))
                    .and_then(|v| v.as_str());
                let text = match detail {
                    Some(d) => format!("{name} {d}"),
                    None => name.to_string(),
                };
                out.push(serde_json::json!({ "kind": "tool", "text": text }));
            }
            Some("toolResponse") | Some("tool_result") => {
                let text = obj
                    .get("toolResult")
                    .and_then(|r| r.get("value"))
                    .and_then(|v| v.get("content"))
                    .and_then(|c| c.as_array())
                    .and_then(|items| {
                        items.iter().find_map(|i| {
                            i.get("text").and_then(|t| t.as_str()).map(String::from)
                        })
                    });
                let label = match text {
                    Some(t) => summarize_tool_output(&t),
                    None => "результат".to_string(),
                };
                out.push(serde_json::json!({ "kind": "tool_out", "text": label }));
            }
            Some("image") => {
                out.push(serde_json::json!({ "kind": "image", "text": "изображение" }));
            }
            Some(_) | None => {}
        }
    }
    out
}

fn clip(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n).collect();
    // не рубим посреди слова на границе clip
    if let Some(sp) = out.rfind(' ') {
        if sp > n.saturating_sub(40) {
            out.truncate(sp);
        }
    }
    format!("{out}…")
}

/// Системный шум runtime'а goose, который не нужен в live-виде
fn is_noise(t: &str) -> bool {
    let head = t.trim_start();
    head.contains("<turn-context>")
        || head.contains("</turn-context>")
        || head.starts_with("Current tasks and notes:")
        || (head.starts_with("Subagent ID:") && !head.contains("Задача") && !head.contains("СМОУК"))
}

/// Убрать шум из текста, оставить суть
fn strip_noise(t: &str) -> String {
    // полный turn-context-фантом → пусто
    if is_noise(t) {
        return String::new();
    }
    let mut s = t.to_string();
    // «Subagent ID: …» в начале задачи — служебная шапка
    if s.starts_with("Subagent ID:") {
        if let Some(pos) = s.find('\n') {
            s = s[pos + 1..].trim_start().to_string();
        } else {
            return String::new();
        }
    }
    // вырезать встроенный turn-context, если прилип к задаче
    if let Some(start) = s.find("<turn-context>") {
        let before = s[..start].trim();
        if let Some(end) = s[start..].find("</turn-context>") {
            let after = s[start + end + "</turn-context>".len()..].trim();
            let mut merged = String::new();
            if !before.is_empty() {
                merged.push_str(before);
            }
            if !after.is_empty() {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(after);
            }
            s = merged;
        } else {
            s = before.to_string();
        }
    }
    s.trim().to_string()
}

/// Результат инструмента → одна внятная строка (не дамп 400 строк)
fn summarize_tool_output(t: &str) -> String {
    let t = t.trim();
    // загрузка скилла / знаний
    if t.starts_with("# Loaded Skill") || t.starts_with("Loaded Skill") {
        let name = t
            .lines()
            .find_map(|l| {
                let l = l.trim_start_matches('#').trim();
                l.strip_prefix("Loaded Skill")
                    .map(|x| x.trim().trim_start_matches(':').trim().to_string())
            })
            .map(|rest| {
                // «quant-core (skill)» → quant-core
                rest.split([' ', '('])
                    .next()
                    .unwrap_or("skill")
                    .trim()
                    .trim_matches(|c: char| c == ':' || c == ')' || c == '(')
                    .to_string()
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "skill".into());
        return format!("⚙ загружен {name}");
    }
    if t.contains("<turn-context>") && t.len() > 80 {
        return "turn-context (скрыт)".into();
    }
    // одно короткое строковое значение — показать; длинный JSON/text — только мета
    if t.chars().count() <= 200 && !t.trim_start().starts_with('{') {
        return clip(t, 160);
    }
    let lines = t.lines().filter(|l| !l.trim().is_empty()).count();
    let bytes = t.len();
    format!("вывод · {lines} строк · {bytes} Б")
}

/// Последние сообщения субагента (для split-view live-вида)
pub fn list_subagent_messages(session_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let path = dirs::home_dir()
        .ok_or("no home")?
        .join(".local/share/goose/sessions/sessions.db");
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    // лимит на свежих (DESC), наружу — хронология (ASC)
    let mut stmt = conn
        .prepare(
            "SELECT role, content_json FROM (
                SELECT id, role, content_json FROM messages
                WHERE session_id=?1 ORDER BY id DESC LIMIT 80
             ) ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter_map(|(role, raw)| {
            let blocks = content_blocks(&raw);
            if blocks.is_empty() {
                return None; // шум полностью — не показываем
            }
            // content — convenience-строка для старого UI; blocks — для нового рендера
            let text = blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            Some(serde_json::json!({
                "role": role,
                "content": text,
                "blocks": blocks,
            }))
        })
        .collect();
    Ok(rows)
}

/// Стейджинг вложения: bytes → временный файл → путь для goose (как drop-файлы в оригинале).
/// Документы без OS-пути (paste из буфера / file input) иначе не дойдут до агента.
pub fn stage_attachment(name: &str, data: &[u8]) -> Result<String, String> {
    let base = dirs::cache_dir()
        .or_else(dirs::home_dir)
        .map(|h| h.join(".cache/goose/pantheon-attachments"))
        .ok_or("no cache dir")?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    let safe = if safe.is_empty() || safe == "." || safe == ".." {
        format!("attachment-{}", std::process::id())
    } else {
        safe
    };
    let path = base.join(format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        safe
    ));
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Планировщик goose: ~/.local/share/goose/schedule.json (Vec<ScheduledJob>)
pub fn get_scheduled_jobs() -> Result<Vec<serde_json::Value>, String> {
    use std::fs;
    let path = dirs::home_dir().ok_or("no home")?
        .join(".local/share/goose/schedule.json");
    if !path.exists() { return Ok(vec![]); }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Приложения goose: HTML-файлы в ~/.local/share/goose/apps
pub fn list_stored_apps() -> Result<Vec<String>, String> {
    use std::fs;
    let dir = dirs::home_dir().ok_or("no home")?.join(".local/share/goose/apps");
    let mut out = vec![];
    if dir.exists() {
        for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let p = e.map_err(|e| e.to_string())?.path();
            if p.extension().and_then(|s| s.to_str()) == Some("html") {
                out.push(p.file_stem().and_then(|s| s.to_str()).unwrap_or("?").to_string());
            }
        }
    }
    Ok(out)
}
