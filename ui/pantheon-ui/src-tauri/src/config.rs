//! config.rs — чтение/точечная запись ~/.config/goose/config.yaml (с бэкапом)
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub fn config_path() -> PathBuf {
    dirs::home_dir()
        .expect("home")
        .join(".config/goose/config.yaml")
}

#[derive(Serialize, Deserialize)]
pub struct ExtensionEntry {
    pub name: String,
    pub enabled: bool,
    pub description: String,
    pub bundled: bool,
}

#[derive(Serialize)]
pub struct GooseConfigSummary {
    pub active_provider: String,
    pub goose_model: String,
    pub goose_provider: String,
    pub goose_mode: String,
    pub extensions: Vec<ExtensionEntry>,
}

pub fn read_summary() -> Result<GooseConfigSummary, String> {
    let raw = fs::read_to_string(config_path()).map_err(|e| e.to_string())?;
    let v: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    let extensions = v
        .get("extensions")
        .and_then(|m| m.as_mapping())
        .map(|m| {
            m.iter()
                .map(|(k, e)| ExtensionEntry {
                    name: k.as_str().unwrap_or("?").to_string(),
                    enabled: e.get("enabled").and_then(|b| b.as_bool()).unwrap_or(false),
                    description: e
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string(),
                    bundled: e.get("bundled").and_then(|b| b.as_bool()).unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(GooseConfigSummary {
        active_provider: v
            .get("active_provider")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        goose_model: v
            .get("GOOSE_MODEL")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        goose_provider: v
            .get("GOOSE_PROVIDER")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        goose_mode: v
            .get("GOOSE_MODE")
            .and_then(|s| s.as_str())
            .unwrap_or("auto")
            .to_string(),
        extensions,
    })
}

/// Точечный toggle расширения: yaml перезаписывается, бэкап обязателен
pub fn toggle_extension(name: &str, enabled: bool) -> Result<(), String> {
    let path = config_path();
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let backup = path.with_extension(format!(
        "yaml.bak-pantheon-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    fs::write(&backup, &raw).map_err(|e| e.to_string())?;

    let mut v: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    let ext = v
        .get_mut("extensions")
        .and_then(|m| m.as_mapping_mut())
        .ok_or("нет секции extensions")?;
    let key = serde_yaml::Value::String(name.to_string());
    let entry = ext
        .get_mut(&key)
        .ok_or(format!("расширение {name} не найдено"))?;
    entry["enabled"] = serde_yaml::Value::Bool(enabled);
    let out = serde_yaml::to_string(&v).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}

/// Смена активной модели/провайдера (Настройки→Модели, паритет)
pub fn set_active_model(provider: &str, model: &str) -> Result<(), String> {
    let path = config_path();
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let backup = path.with_extension(format!(
        "yaml.bak-pantheon-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    fs::write(&backup, &raw).map_err(|e| e.to_string())?;

    let mut v: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    v["GOOSE_PROVIDER"] = serde_yaml::Value::String(provider.to_string());
    v["GOOSE_MODEL"] = serde_yaml::Value::String(model.to_string());
    v["active_provider"] = serde_yaml::Value::String(provider.to_string());
    let out = serde_yaml::to_string(&v).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}

/// Режимы чата (Настройки→Чат): auto | approve | manual | chat
pub fn set_goose_mode(mode: &str) -> Result<(), String> {
    if !["auto", "approve", "manual", "chat"].contains(&mode) {
        return Err(format!("неизвестный режим: {mode}"));
    }
    let path = config_path();
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut v: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    v["GOOSE_MODE"] = serde_yaml::Value::String(mode.to_string());
    let out = serde_yaml::to_string(&v).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(())
}
