//! pantheon-ui — Tauri 2 клиент Пантеона (rev 2)
//! sidecar: goose serve (ACP) — подключение на стороне фронтенда (@aaif/goose-acp-client)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
                    en.then(|| k.as_str().to_string())
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
fn get_artifacts() -> Result<Vec<serde_json::Value>, String> {
    let conn = db::open()?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running pantheon-ui");
}
