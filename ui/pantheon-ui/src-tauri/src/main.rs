//! pantheon-ui — Tauri 2 клиент Пантеона (rev 2)
//! sidecar: goose serve (ACP) — подключение на стороне фронтенда (@aaif/goose-acp-client)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod db;
mod pantheon;

use pantheon::{AgentChainToml, ChainStep};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Serialize)]
pub struct Catalog {
    pub providers: Vec<String>,
    pub models_by_provider: HashMap<String, Vec<CatalogModel>>,
}

#[derive(Serialize, Clone)]
pub struct CatalogModel {
    pub name: String,
    pub context_limit: Option<i64>,
}

/// Провайдеры: из config.yaml goose; модели — живой каталог /models провайдера.
#[tauri::command]
async fn get_provider_catalog() -> Result<Catalog, String> {
    let home = dirs::home_dir().ok_or("no home")?;
    let raw = std::fs::read_to_string(home.join(".config/goose/config.yaml"))
        .map_err(|e| format!("config.yaml: {e}"))?;
    let val: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| format!("yaml: {e}"))?;
    let ext = val.get("extensions").and_then(|v| v.as_mapping());
    let mut providers: Vec<String> = ext
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| {
                    let en = v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false);
                    if en {
                        k.as_str().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    providers.sort();

    // живой каталог: провайдеры с base_url + ключом из keyring/env — через goose CLI
    // (goose сессии знают provider_inventory; для v1 опрашиваем opencode_go напрямую)
    let mut models_by_provider = HashMap::new();
    let key = std::env::var("OPENCODE_API_KEY").ok().or_else(|| {
        std::process::Command::new("secret-tool")
            .args(["search", "--all", "service", "goose"])
            .output()
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                s.lines()
                    .find(|l| l.starts_with("secret = "))
                    .and_then(|l| {
                        let j = l.trim_start_matches("secret = ");
                        serde_json::from_str::<serde_json::Value>(j).ok()
                    })
                    .and_then(|j| j.get("OPENCODE_API_KEY")?.as_str().map(String::from))
            })
    });
    if let Some(key) = key {
        if let Ok(body) = tokio::task::spawn_blocking(move || {
            std::process::Command::new("curl")
                .args([
                    "-sS", "-m", "15",
                    "https://opencode.ai/zen/go/v1/models",
                    "-H", &format!("Authorization: Bearer {key}"),
                ])
                .output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        {
            if let Ok(j) = serde_json::from_str::<serde_json::Value>(&body) {
                let list: Vec<CatalogModel> = j
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|m| {
                                Some(CatalogModel {
                                    name: m.get("id")?.as_str()?.to_string(),
                                    context_limit: m.get("context_limit").and_then(|c| c.as_i64()),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                models_by_provider.insert("opencode_go".to_string(), list);
            }
        }
    }
    Ok(Catalog { providers, models_by_provider })
}

#[derive(Serialize)]
pub struct ValidationResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub error: Option<String>,
    pub latency_ms: u128,
}

/// Валидация ступени цепочки: мини-запрос к модели (ловит 403/region/невалидные имена)
#[tauri::command]
async fn validate_chain_step(step: ChainStep) -> Result<ValidationResult, String> {
    let started = Instant::now();
    // ключ: единый путь с каталогом — keyring goose
    let key = std::process::Command::new("secret-tool")
        .args(["search", "--all", "service", "goose"])
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            s.lines()
                .find(|l| l.starts_with("secret = "))
                .and_then(|l| serde_json::from_str::<serde_json::Value>(l.trim_start_matches("secret = ")).ok())
                .and_then(|j| j.get("OPENCODE_API_KEY")?.as_str().map(String::from))
        })
        .ok_or("OPENCODE_API_KEY не найден в keyring (service=goose)")?;

    let body = serde_json::json!({
        "model": step.model,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 8
    });
    let url = "https://opencode.ai/zen/go/v1/chat/completions";
    let out = tokio::task::spawn_blocking(move || {
        std::process::Command::new("curl")
            .args([
                "-sS", "-m", "30", "-o", "/dev/null", "-w", "%{http_code}",
                url,
                "-H", &format!("Authorization: Bearer {key}"),
                "-H", "Content-Type: application/json",
                "-H", "x-opencode-session: pantheon-ui-validate",
                "-d", &body.to_string(),
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?;

    let stdout = out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let status: Option<u16> = stdout.trim().parse().ok();
    let ok = status == Some(200);
    Ok(ValidationResult {
        ok,
        status,
        error: (!ok).then(|| match status {
            Some(403) => "403: модель недоступна (mimo-ловушка)".into(),
            Some(400) => "400: region/параметры — проверить Privacy=Global".into(),
            _ => format!("HTTP {status:?}"),
        }),
        latency_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
fn get_agent_chains() -> Result<Vec<serde_json::Value>, String> {
    let chains = pantheon::load_chains()?;
    Ok(chains
        .into_iter()
        .map(|(role, c)| {
            serde_json::json!({
                "role": role,
                "primary": c.primary,
                "fallbacks": c.fallbacks,
            })
        })
        .collect())
}

#[tauri::command]
fn save_agent_chain(role: String, chain: AgentChainToml) -> Result<(), String> {
    pantheon::save_chain(&role, &chain)
}

#[tauri::command]
fn get_recent_runs() -> Result<Vec<db::RunRow>, String> {
    db::recent_runs()
}

#[tauri::command]
fn get_config_summary() -> Result<serde_json::Value, String> {
    let s = config::read_summary()?;
    Ok(serde_json::json!({
        "active_provider": s.active_provider,
        "goose_model": s.goose_model,
        "goose_provider": s.goose_provider,
        "goose_mode": s.goose_mode,
        "extensions": s.extensions,
    }))
}

#[tauri::command]
fn toggle_extension(name: String, enabled: bool) -> Result<(), String> {
    config::toggle_extension(&name, enabled)
}

#[tauri::command]
fn set_active_model(provider: String, model: String) -> Result<(), String> {
    config::set_active_model(&provider, &model)
}

#[tauri::command]
fn set_goose_mode(mode: String) -> Result<(), String> {
    config::set_goose_mode(&mode)
}

/// История сессий (паритет: История сессий + список ЧАТЫ)
#[tauri::command]
fn list_sessions(only_running: Option<bool>) -> Result<Vec<serde_json::Value>, String> {
    db::list_sessions(only_running.unwrap_or(false))
}

/// Рецепты: файлы ~/.config/goose/recipes/*.yaml
#[tauri::command]
fn list_recipes() -> Result<Vec<serde_json::Value>, String> {
    let dir = dirs::home_dir()
        .ok_or("no home")?
        .join(".config/goose/recipes");
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "yaml" || x == "yml").unwrap_or(false) {
                let raw = std::fs::read_to_string(&p).unwrap_or_default();
                let title = raw
                    .lines()
                    .find(|l| l.starts_with("title:"))
                    .map(|l| l.trim_start_matches("title:").trim().to_string())
                    .unwrap_or_default();
                let description = raw
                    .lines()
                    .find(|l| l.starts_with("description:"))
                    .map(|l| l.trim_start_matches("description:").trim().to_string())
                    .unwrap_or_default();
                out.push(serde_json::json!({
                    "file": p.file_name().unwrap_or_default().to_string_lossy(),
                    "title": title,
                    "description": description,
                    "path": p.to_string_lossy(),
                }));
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn get_artifacts() -> Result<Vec<serde_json::Value>, String> {    let conn = db::open()?;
    let mut stmt = conn
        .prepare("SELECT kind, path, coalesce(topic,''), created_at FROM artifacts
                  ORDER BY created_at DESC LIMIT 30")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "kind": r.get::<_, String>(0)?,
                "path": r.get::<_, String>(1)?,
                "topic": r.get::<_, String>(2)?,
                "created_at": r.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_provider_catalog,
            validate_chain_step,
            get_agent_chains,
            save_agent_chain,
            get_recent_runs,
            get_artifacts,
            get_config_summary,
            toggle_extension,
            set_active_model,
            set_goose_mode,
            list_sessions,
            list_recipes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pantheon-ui");
}
