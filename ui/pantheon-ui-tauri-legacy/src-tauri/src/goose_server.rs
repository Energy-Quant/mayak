//! goose_server.rs — спавн `goose serve` (sidecar) + readiness, по схеме desktop gooseServe.ts
//!
//! Origin: release-frontend Tauri шлёт `tauri://localhost` (Linux custom protocol).
//! Goose по умолчанию пускает только loopback http(s)/null/file → WS handshake 403.
//! Поэтому всегда передаём `--allowed-origin` (exact-список ЗАМЕНЯЕТ loopback!).
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct ServeInfo {
    pub port: u16,
    pub http_base: String, // http://127.0.0.1:<port>
    pub ws_url: String,    // ws://127.0.0.1:<port>/acp?token=<secret>
    pub pid: u32,
}

struct State {
    child: Option<Child>,
    info: Option<ServeInfo>,
    secret: String,
}

static STATE: Mutex<State> = Mutex::new(State {
    child: None,
    info: None,
    secret: String::new(),
});

fn free_port() -> std::io::Result<u16> {
    let l = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let p = l.local_addr()?.port();
    Ok(p)
}

/// readiness-проба: TCP + HTTP GET /status
fn status_ok(port: u16) -> bool {
    match std::net::TcpStream::connect(("127.0.0.1", port)) {
        Ok(mut s) => {
            if s
                .write_all(format!("GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").as_bytes())
                .is_err()
            {
                return false;
            }
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        Err(_) => false,
    }
}

/// Origins, которые обязаны проходить в exact-list goose.
/// `--allowed-origin` (хотя бы один) ВЫКЛЮЧАЕТ loopback-дефолт — перечисляем всё.
fn base_origins() -> Vec<String> {
    [
        // release (Linux custom protocol / wry workaround)
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
        // opaque / file origins (WebKit может дать null)
        "null",
        "file://",
        // dev vite / preview (без порта точный матч не пройдёт — порт добавит фронт)
        "http://localhost",
        "http://127.0.0.1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

pub fn start(dir: Option<String>, origins: Option<Vec<String>>) -> Result<ServeInfo, String> {
    let mut lock = STATE.lock().unwrap();

    // живой здоровый sidecar — переиспользуем (retry без спавна зомби)
    if let Some(info) = lock.info.clone() {
        let alive = lock
            .child
            .as_mut()
            .map(|c| matches!(c.try_wait(), Ok(None)))
            .unwrap_or(false);
        if alive && status_ok(info.port) {
            return Ok(info);
        }
        if let Some(mut c) = lock.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        lock.info = None;
        lock.secret.clear();
    }

    let home = dirs::home_dir().ok_or("no home")?;
    // goose serve умеет только desktop-бинарь (в CLI нет подкоманды serve)
    let candidates = [
        PathBuf::from("/opt/goose-desktop/resources/bin/goose"),
        home.join(".local/bin/goose"), // fallback (может не иметь serve)
    ];
    let goose_path = candidates.iter().find(|p| p.exists()).cloned()
        .ok_or("goose binary не найден ни в /opt/goose-desktop, ни ~/.local/bin")?;
    let working_dir = dir.unwrap_or_else(|| home.to_string_lossy().to_string());
    let port = free_port().map_err(|e| e.to_string())?;
    // токен URL-safe: [a-z0-9-] без кодирования
    let secret = format!(
        "sk-pantheon-{:x}{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        0x517cc1b7
    );

    // лог sidecar'а: диагностика падений промпта/ACP (append — не ронять историю)
    let log_dir = home.join(".local/state/pantheon-ui");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("goose-serve.log");
    let stderr_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    // exact-origin list: base + с фронта (window.location.origin несёт порт dev-vite)
    let mut allowed: Vec<String> = base_origins();
    if let Some(extra) = origins {
        for o in extra {
            let o = o.trim().to_string();
            if !o.is_empty() && !allowed.contains(&o) {
                allowed.push(o);
            }
        }
    }

    let mut args: Vec<String> = vec![
        "serve".into(),
        "--platform".into(),
        "desktop".into(),
        "--enable-scheduler".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
    ];
    for o in &allowed {
        args.push("--allowed-origin".into());
        args.push(o.clone());
    }

    let child = Command::new(&goose_path)
        .args(&args)
        .env("GOOSE_SERVER__SECRET_KEY", &secret)
        .env("NO_COLOR", "1")
        .current_dir(&working_dir)
        .stdout(Stdio::null())
        .stderr(stderr_log)
        .spawn()
        .map_err(|e| format!("spawn goose serve: {e}"))?;
    let pid = child.id();
    lock.child = Some(child);

    for _ in 0..50 {
        if status_ok(port) {
            let info = ServeInfo {
                port,
                http_base: format!("http://127.0.0.1:{port}"),
                ws_url: format!("ws://127.0.0.1:{port}/acp?token={secret}"),
                pid,
            };
            lock.info = Some(info.clone());
            lock.secret = secret;
            return Ok(info);
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    // readiness не дождались — убить, чтобы не копить зомби
    if let Some(mut c) = lock.child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
    lock.info = None;
    Err("goose serve не поднялся за 25с".into())
}

pub fn stop() -> Result<(), String> {
    let mut lock = STATE.lock().unwrap();
    if let Some(mut child) = lock.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    lock.info = None;
    lock.secret.clear();
    Ok(())
}
