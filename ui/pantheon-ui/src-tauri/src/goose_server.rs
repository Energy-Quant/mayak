//! goose_server.rs — спавн `goose serve` (sidecar) + readiness, по схеме desktop gooseServe.ts
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[derive(Serialize)]
pub struct ServeInfo {
    pub port: u16,
    pub http_base: String, // http://127.0.0.1:<port>
    pub ws_url: String,    // ws://127.0.0.1:<port>/acp?token=<secret>
    pub pid: u32,
}

static PROCESS: Mutex<Option<Child>> = Mutex::new(None);

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

pub fn start(dir: Option<String>) -> Result<ServeInfo, String> {
    let mut lock = PROCESS.lock().unwrap();
    if lock
        .as_mut()
        .map(|c| c.try_wait().map(|s| s.is_some()).unwrap_or(true))
        .unwrap_or(false)
    {
        *lock = None; // умерший процесс — сбрасываем
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
    let secret = format!("sk-pantheon-{:x}{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), 0x517cc1b7);

    let child = Command::new(&goose_path)
        .args([
            "serve",
            "--platform",
            "desktop",
            "--enable-scheduler",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .env("GOOSE_SERVER__SECRET_KEY", &secret)
        .env("NO_COLOR", "1")
        .current_dir(&working_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn goose serve: {e}"))?;
    let pid = child.id();
    *lock = Some(child);

    for _ in 0..50 {
        if status_ok(port) {
            return Ok(ServeInfo {
                port,
                http_base: format!("http://127.0.0.1:{port}"),
                ws_url: format!("ws://127.0.0.1:{port}/acp?token={secret}"),
                pid,
            });
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    *lock = None;
    Err("goose serve не поднялся за 25с".into())
}

pub fn stop() -> Result<(), String> {
    let mut lock = PROCESS.lock().unwrap();
    if let Some(child) = lock.as_mut() {
        let _ = child.kill();
        *lock = None;
    }
    Ok(())
}
