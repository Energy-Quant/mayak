//! pantheon-guard — PreToolUse enforcement Пантеона (P7: замена guard.sh на Rust).
//!
//! Вход: JSON-пейлоад hook'а на stdin.
//! Выход: {"decision":"block","reason":...} (на stdout) или allow (пустой stdout, exit 0).
//!
//! Политика (байт-в-байт как guard.sh):
//!   - goose/adhoc → allow
//!   - oracle write/edit: ТОЛЬКО .pantheon/{plans,analysis}/*.md
//!   - librarian write/edit: ТОЛЬКО .pantheon/digests/*.md
//!   - shell (oracle/librarian): read-only whitelist, без ` $() & ;редиректов
//!     глубокие проверки git/sqlite3/python/sed
//!
//! Почему Rust: bash-парсинг хрупок к спецсимволам (инъекции через &&, backtick
//! в кавычках, unicode-пробелы). Здесь — явный парсинг без shell-glob.

use rusqlite::Connection;
use serde_json::Value;
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const READ_CMDS: &[&str] = &[
    "ls","cat","head","tail","wc","tree","rg","grep","find","fd","jq","file","stat","du","df",
    "which","env","printenv","date","uname","uptime","whoami","id","git","sqlite3","curl","wget",
    "python3","python","cargo","rustc","npm","pnpm","sed","awk","cut","sort","uniq","diff","cmp",
    "basename","dirname","realpath","readlink","md5sum","sha256sum","tar","unzip","zipinfo","ping",
    "ip","ss","ps","echo","printf","test","true","type","command","nvidia-smi","sensors","free",
    "psql","mongo","kubectl","helm","terraform","ansible","make","just","go","node","deno","bun",
    "dotnet","java","javac","gcc","g++","clang","rustup","west","meson","cmake","ninja","pkg-config",
    "ldd","nm","objdump","readelf","strings","xxd","hexdump","od","base64","openssl","gpg","man",
    "tldr","gh","docker","podman","systemctl","journalctl","hyprctl","busctl","loginctl","notify-send",
];

const GIT_SAFE: &[&str] = &[
    "log","diff","show","status","blame","branch","tag","remote","rev-parse","ls-files","ls-remote",
    "describe","shortlog","grep","cat-file","config","stash","list","worktree","mergetool","--version",
];

fn log(level: &str, event: &str, sid: &str, detail: &str) {
    let log_path = dirs_state().join("guard.log");
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let ts = chrono_lite();
    let line = format!(
        "{ts} | {level:<5} | guard-rs                 | {sid:<12} | {event} | {detail}\n"
    );
    use std::io::Write as _;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = f.write_all(line.as_bytes());
    }
    if level == "WARN" || level == "ERROR" {
        eprint!("{line}");
    }
}

fn dirs_state() -> PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".local/state/pantheon")
}

/// UTC timestamp в формате, совместимом с logger.ts
fn chrono_lite() -> String {
    // без chrono — считаем от UNIX epoch
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // ручной разбор: дни → дата (упрощённо, для лога достаточно)
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_millis())
        .unwrap_or(0);
    format!("{secs}.{ms:03}Z")
}

fn pantheon_db() -> PathBuf {
    env::var("PANTHEON_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home).join(".local/share/goose/pantheon.db")
        })
}

fn sessions_db() -> PathBuf {
    env::var("SESSIONS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home).join(".local/share/goose/sessions/sessions.db")
        })
}

fn cache_dir() -> PathBuf {
    env::var("XDG_RUNTIME_DIR")
        .map(|d| PathBuf::from(d).join("pantheon"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/pantheon"))
}

/// resolve_role — паритет pantheon-lib.sh: кэш → runs → recipe title → [PANTHEON:*] → user=goose
fn resolve_role(sid: &str) -> String {
    if sid.is_empty() {
        return "adhoc".into();
    }
    // кэш
    let cached = fs::read_to_string(cache_dir().join(format!("role-{sid}"))).unwrap_or_default();
    if !cached.trim().is_empty() {
        return cached.trim().to_string();
    }
    // 1) явная регистрация в pantheon.db
    if let Ok(conn) = Connection::open(pantheon_db()) {
        let mut stmt = match conn.prepare("SELECT role FROM runs WHERE session_id=?1 LIMIT 1") {
            Ok(s) => s,
            Err(_) => return "adhoc".into(),
        };
        let role: String = stmt
            .query_row([sid], |r| r.get(0))
            .unwrap_or_default();
        if !role.is_empty() {
            return role;
        }
    }
    // 2) sessions.db: recipe_json title / [PANTHEON:*]
    if Path::new(&sessions_db()).exists() {
        if let Ok(conn) = Connection::open(sessions_db()) {
            let mut stmt = match conn
                .prepare("SELECT coalesce(recipe_json,'') FROM sessions WHERE id=?1 LIMIT 1")
            {
                Ok(s) => s,
                Err(_) => return "adhoc".into(),
            };
            let rj: String = stmt
                .query_row([sid], |r| r.get(0))
                .unwrap_or_default();
            if !rj.is_empty() {
                // title из JSON
                if let Ok(v) = serde_json::from_str::<Value>(&rj) {
                    let title = v["title"].as_str().unwrap_or("");
                    let role = match title {
                        "Agent: oracle" | "Oracle Consultation" => "oracle",
                        "Agent: librarian" | "Librarian Research" => "librarian",
                        "Agent: pantheon-conductor" | "Agent: goose" => "goose",
                        _ => "",
                    };
                    if !role.is_empty() {
                        return role.into();
                    }
                }
                // [PANTHEON:*] тег
                if rj.contains("[PANTHEON:oracle]") {
                    return "oracle".into();
                }
                if rj.contains("[PANTHEON:librarian]") {
                    return "librarian".into();
                }
                if rj.contains("[PANTHEON:goose]") {
                    return "goose".into();
                }
            }
            // 3) session_type=user → goose
            let mut stmt2 = match conn
                .prepare("SELECT session_type FROM sessions WHERE id=?1 LIMIT 1")
            {
                Ok(s) => s,
                Err(_) => return "adhoc".into(),
            };
            let stype: String = stmt2
                .query_row([sid], |r| r.get(0))
                .unwrap_or_default();
            if stype == "user" {
                return "goose".into();
            }
        }
    }
    "adhoc".into()
}

fn block(reason: &str, sid: &str, tool: &str) -> ! {
    log("WARN", "blocked", sid, &format!("tool={tool} reason={reason}"));
    let out = serde_json::json!({ "decision": "block", "reason": reason });
    println!("{out}");
    std::process::exit(0);
}

/// Политика write/edit: только каталог артефактов роли
fn check_write(path: &str, role: &str, sid: &str, tool: &str) {
    let p = path;
    let re_ok = match role {
        "oracle" => {
            (p.contains("/.pantheon/plans/") || p.contains("/.pantheon/analysis/"))
                && p.ends_with(".md")
                && !p.contains("/..")
        }
        "librarian" => {
            path.contains("/.pantheon/digests/")
                && path.ends_with(".md")
                && !path.contains("/..")
        }
        _ => return,
    };
    if !re_ok {
        block(
            &format!(
                "[PANTHEON] {role} может писать ТОЛЬКО в свой каталог .pantheon/*.md. Получено: {path}. Policy: попроси conductor."
            ),
            sid,
            tool,
        );
    }
}

/// Сегментация команды по | ; && || (без учёта кавычек — bash и так не спасает)
fn split_segments(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = cmd.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // && || ;
        if i + 1 < chars.len() && chars[i] == '&' && chars[i + 1] == '&' {
            out.push(std::mem::take(&mut cur));
            i += 2;
            continue;
        }
        if i + 1 < chars.len() && chars[i] == '|' && chars[i + 1] == '|' {
            out.push(std::mem::take(&mut cur));
            i += 2;
            continue;
        }
        if chars[i] == ';' || chars[i] == '|' {
            out.push(std::mem::take(&mut cur));
            i += 1;
            continue;
        }
        cur.push(chars[i]);
        i += 1;
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

/// Политика shell: read-only
fn check_shell(cmd: &str, _role: &str, sid: &str, tool: &str) {
    // запрет подстановок
    if cmd.contains('`') || cmd.contains("$(") {
        block(
            "[PANTHEON] shell: подстановки команд (` ` $() ) запрещены (read-only).",
            sid,
            tool,
        );
    }
    // запрет фонового запуска & (не &&)
    {
        let bytes: Vec<char> = cmd.chars().collect();
        for i in 0..bytes.len() {
            if bytes[i] == '&' {
                let prev = if i > 0 { Some(bytes[i - 1]) } else { None };
                let next = if i + 1 < bytes.len() { Some(bytes[i + 1]) } else { None };
                if prev != Some('&') && next != Some('&') {
                    block(
                        "[PANTHEON] shell: фоновый запуск '&' запрещён.",
                        sid,
                        tool,
                    );
                }
            }
        }
    }

    for seg in split_segments(cmd) {
        let seg = seg.trim();
        if seg.is_empty() {
            continue;
        }
        // редиректы: всё кроме /dev/null — мутация
        {
            // нормализуем пробелы вокруг > и >> к /dev/null
            let cleaned = seg
                .replace(">/dev/null", ">/dev/null")
                .replace("> /dev/null", ">/dev/null")
                .replace(">>/dev/null", ">/dev/null")
                .replace(">> /dev/null", ">/dev/null");
            let cleaned = cleaned.replace(">/dev/null", "");
            if cleaned.contains('>') {
                block(
                    "[PANTHEON] shell: перенаправление в файл запрещено (read-only, только /dev/null).",
                    sid,
                    tool,
                );
            }
        }
        // первое слово сегмента
        let first = seg.split_whitespace().next().unwrap_or("");
        if first.is_empty() {
            continue;
        }
        if !READ_CMDS.contains(&first) {
            block(
                &format!("[PANTHEON] shell: команда '{first}' вне read-only whitelist."),
                sid,
                tool,
            );
        }
        // глубокие проверки
        match first {
            "git" => {
                let sub = seg.split_whitespace().nth(1).unwrap_or("");
                if !GIT_SAFE.contains(&sub) && !sub.starts_with("--") {
                    block(
                        &format!("[PANTHEON] shell: git {sub} запрещён (read-only: log/diff/show/...)."),
                        sid,
                        tool,
                    );
                }
            }
            "sqlite3" => {
                let upper = seg.to_uppercase();
                for kw in [
                    "INSERT","UPDATE","DELETE","DROP","CREATE","ALTER","ATTACH","DETACH","REPLACE","VACUUM",
                ] {
                    if upper.contains(kw) {
                        block(
                            "[PANTHEON] shell: sqlite3-мутация запрещена (только SELECT).",
                            sid,
                            tool,
                        );
                    }
                }
            }
            "python3" | "python" => {
                if seg.contains("open(") && (seg.contains("'w'") || seg.contains("\"w\"")
                    || seg.contains("'a'") || seg.contains("\"a\"")
                    || seg.contains("'x'") || seg.contains("\"x\""))
                    || seg.contains("mode='w'") || seg.contains("mode=\"w\"")
                    || seg.contains("mode='a'") || seg.contains("mode=\"a\"")
                    || seg.contains("mode='x'") || seg.contains("mode=\"x\"")
                {
                    block(
                        "[PANTHEON] shell: python-запись файлов запрещена (read-only).",
                        sid,
                        tool,
                    );
                }
                for kw in [
                    "shutil", "os.remove", "os.unlink", "os.rename", "os.mkdir", "os.makedirs",
                    "os.rmdir", "subprocess", "write_text", "write_bytes",
                ] {
                    if seg.contains(kw) {
                        block(
                            "[PANTHEON] shell: python-мутации (shutil/os/subprocess/write_*) запрещены.",
                            sid,
                            tool,
                        );
                    }
                }
            }
            "sed" => {
                // sed -i
                for w in seg.split_whitespace() {
                    if w == "-i" || (w.starts_with('-') && w.contains('i') && !w.starts_with("--")) {
                        block(
                            "[PANTHEON] shell: sed -i запрещён (read-only).",
                            sid,
                            tool,
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

fn main() {
    let mut payload = String::new();
    if std::io::stdin().read_to_string(&mut payload).is_err() {
        return;
    }
    let v: Value = match serde_json::from_str(&payload) {
        Ok(v) => v,
        Err(e) => {
            log("WARN", "bad-payload", "-", &e.to_string());
            return;
        }
    };

    let sid = v["session_id"].as_str().unwrap_or("").to_string();
    let tool = v["tool_name"].as_str().unwrap_or("").to_string();
    if sid.is_empty() {
        return;
    }

    let role = resolve_role(&sid);
    log("DEBUG", "check", &sid, &format!("tool={tool} role={role}"));

    // goose/adhoc — без ограничений
    if role == "goose" || role == "adhoc" {
        return;
    }

    // write/edit
    if tool == "developer__write" || tool == "developer__edit" {
        let mut path = v["tool_input"]["path"].as_str().unwrap_or("").to_string();
        let wdir = v["working_dir"].as_str().unwrap_or("");
        if !path.starts_with('/') && !wdir.is_empty() {
            path = format!("{wdir}/{path}");
        }
        check_write(&path, &role, &sid, &tool);
    }

    // shell
    if tool == "developer__shell" {
        let cmd = v["tool_input"]["command"].as_str().unwrap_or("");
        check_shell(cmd, &role, &sid, &tool);
    }

    log("DEBUG", "allowed", &sid, &format!("tool={tool} role={role}"));
}
