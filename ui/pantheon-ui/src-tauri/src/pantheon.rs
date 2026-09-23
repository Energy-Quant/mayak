//! pantheon.rs — pantheon.toml: чтение/запись fallback-цепочек (rev 2)
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChainStep {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentChainToml {
    pub primary: ChainStep,
    #[serde(default)]
    pub fallbacks: Vec<ChainStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PantheonToml {
    #[serde(default)]
    agents: std::collections::HashMap<String, AgentChainToml>,
}

pub fn pantheon_toml_path() -> PathBuf {
    dirs::home_dir()
        .expect("home dir")
        .join(".config/goose/pantheon.toml")
}

pub const ROLES: [&str; 3] = ["goose", "oracle", "librarian"];

pub fn load_chains() -> Result<Vec<(String, AgentChainToml)>, String> {
    let path = pantheon_toml_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("не удалось прочитать {}: {e}", path.display()))?;
    let parsed: PantheonToml = toml::from_str(&raw).map_err(|e| format!("toml: {e}"))?;
    let mut out: Vec<(String, AgentChainToml)> = parsed
        .agents
        .into_iter()
        .filter(|(k, _)| ROLES.contains(&k.as_str()))
        .collect();
    out.sort_by_key(|(k, _)| ROLES.iter().position(|r| r == k).unwrap_or(99));
    Ok(out)
}

pub fn save_chain(role: &str, chain: &AgentChainToml) -> Result<(), String> {
    if !ROLES.contains(&role) {
        return Err(format!("неизвестная роль: {role}"));
    }
    let path = pantheon_toml_path();
    let raw = fs::read_to_string(&path).unwrap_or_default();
    let mut parsed: PantheonToml = toml::from_str(&raw).unwrap_or_default();
    parsed.agents.insert(role.to_string(), chain.clone());
    let ser = toml::to_string_pretty(&parsed).map_err(|e| format!("toml ser: {e}"))?;
    // атомарная запись
    let tmp = path.with_extension("toml.tmp");
    fs::write(&tmp, ser).map_err(|e| format!("write: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    // аудит в kv (обходит MCP — прямой sqlite)
    crate::db::kv_set(
        &format!("chain-edit:{}", chrono_now()),
        &format!("{role}: primary={}/{} fallbacks={:?}",
                 chain.primary.provider, chain.primary.model, chain.fallbacks),
    );
    Ok(())
}

// ── Панель «Пантеон»: обзор pantheon.db ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct PantheonRun {
    pub session_id: String,
    pub role: String,
    pub status: String,
    pub model: Option<String>,
    pub started_at: String,
    pub task_summary: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PantheonArtifact {
    pub path: String,
    pub kind: String,
    pub topic: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RoleStat {
    pub role: String,
    pub runs: i64,
    /// runs не содержит токен-колонок (schema.sql) — null; поле для совместимости контракта
    pub tokens: Option<i64>,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PantheonOverview {
    pub runs: Vec<PantheonRun>,
    pub artifacts: Vec<PantheonArtifact>,
    pub role_stats: Vec<RoleStat>,
}

/// Один вызов = вся панель: последние 20 runs, последние 40 artifacts, агрегаты по ролям.
#[tauri::command]
pub fn get_pantheon_overview() -> Result<PantheonOverview, String> {
    let conn = crate::db::open()?;

    let mut runs = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT session_id, role, coalesce(status,''), model, coalesce(started_at,''), task_summary
                 FROM runs ORDER BY started_at DESC LIMIT 20",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt
            .query_map([], |r| {
                Ok(PantheonRun {
                    session_id: r.get(0)?,
                    role: r.get(1)?,
                    status: r.get(2)?,
                    model: r.get(3)?,
                    started_at: r.get(4)?,
                    task_summary: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in it.flatten() {
            runs.push(row);
        }
    }

    let mut artifacts = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT path, kind, topic, coalesce(created_at,'') FROM artifacts
                 ORDER BY created_at DESC LIMIT 40",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt
            .query_map([], |r| {
                Ok(PantheonArtifact {
                    path: r.get(0)?,
                    kind: r.get(1)?,
                    topic: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in it.flatten() {
            artifacts.push(row);
        }
    }

    let mut role_stats = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT role, COUNT(*), GROUP_CONCAT(DISTINCT model)
                 FROM runs GROUP BY role ORDER BY COUNT(*) DESC",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt
            .query_map([], |r| {
                let models_raw: Option<String> = r.get(2)?;
                Ok(RoleStat {
                    role: r.get(0)?,
                    runs: r.get(1)?,
                    tokens: None, // в runs нет usage-колонок (см. schema.sql)
                    models: models_raw
                        .map(|s| {
                            s.split(',')
                                .map(|m| m.trim().to_string())
                                .filter(|m| !m.is_empty())
                                .collect()
                        })
                        .unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?;
        for row in it.flatten() {
            role_stats.push(row);
        }
    }

    Ok(PantheonOverview { runs, artifacts, role_stats })
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}
