//! limits.rs — лимиты подписки OpenCode Go (5ч / неделя / месяц), живые.
//! Источник: GET https://opencode.ai/zen/go/v1/usage
//!   {"usage":{"rolling":{status,percent,resetsAt},"weekly":{...},"monthly":{...}}}
//! rolling = скользящее окно 5 часов.
use serde::Serialize;
use std::fs;
use std::time::Duration;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub status: String,
    pub percent: u8,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub rolling: UsageWindow,
    pub weekly: UsageWindow,
    pub monthly: UsageWindow,
}

fn api_key() -> Option<String> {
    if let Ok(k) = std::env::var("OPENCODE_API_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }
    // тот же ключ, что у goose: ~/.config/goose/secrets.yaml (key: value)
    let path = dirs::home_dir()?.join(".config/goose/secrets.yaml");
    let text = fs::read_to_string(path).ok()?;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('#') {
            continue;
        }
        if let Some(rest) = t.strip_prefix("OPENCODE_API_KEY") {
            let v = rest.trim_start_matches([':', ' ', '"', '\'']).trim_matches(['"', '\'']);
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn empty_window() -> UsageWindow {
    UsageWindow { status: "unknown".into(), percent: 0, resets_at: None }
}

#[tauri::command]
pub fn get_opencode_usage() -> Result<UsageReport, String> {
    let key = api_key().ok_or("OPENCODE_API_KEY не найден (env или ~/.config/goose/secrets.yaml)")?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .build();
    let resp = agent
        .get("https://opencode.ai/zen/go/v1/usage")
        .set("Authorization", &format!("Bearer {key}"))
        // обязательные заголовки провайдера: UA (иначе Cloudflare 1010), session-id (иначе 400)
        .set("User-Agent", "goose/1.51.0")
        .set("x-opencode-session", "pantheon-ui-limits")
        .call()
        .map_err(|e| format!("usage request: {e}"))?;

    let v: serde_json::Value = resp.into_json().map_err(|e| format!("usage parse: {e}"))?;
    let u = v.get("usage").cloned().unwrap_or_default();

    let win = |k: &str| -> UsageWindow {
        u.get(k)
            .map(|w| UsageWindow {
                status: w.get("status").and_then(|s| s.as_str()).unwrap_or("ok").to_string(),
                percent: w.get("percent").and_then(|p| p.as_u64()).unwrap_or(0).min(100) as u8,
                resets_at: w.get("resetsAt").and_then(|r| r.as_str()).map(|s| s.to_string()),
            })
            .unwrap_or_else(empty_window)
    };

    Ok(UsageReport {
        rolling: win("rolling"),
        weekly: win("weekly"),
        monthly: win("monthly"),
    })
}
