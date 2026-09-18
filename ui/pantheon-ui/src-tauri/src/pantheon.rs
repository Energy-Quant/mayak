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

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}
