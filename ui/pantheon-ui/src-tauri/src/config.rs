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
    pub providers: Vec<String>,
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
    let providers = v
        .get("providers")
        .and_then(|m| m.as_mapping())
        .map(|m| {
            m.iter()
                .filter(|(_, e)| e.get("enabled").and_then(|b| b.as_bool()).unwrap_or(false))
                .map(|(k, _)| k.as_str().unwrap_or("?").to_string())
                .collect()
        })
        .unwrap_or_default();
    Ok(GooseConfigSummary {
        providers,
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

/// Режимы чата (Настройки→Чат/Интерфейс): auto | approve | manual | chat | chat_only
pub fn set_goose_mode(mode: &str) -> Result<(), String> {
    if !["auto", "approve", "manual", "chat", "chat_only"].contains(&mode) {
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

// ── Программы: промпты ~/.config/goose/prompts ──

/// Канонический набор промптов goose (порядок показа в UI)
pub const PROMPT_FILES: &[&str] = &[
    "system.md",
    "compaction.md",
    "subagent_system.md",
    "apps_create.md",
    "apps_iterate.md",
    "permission_judge.md",
    "tiny_model_system.md",
];

#[derive(Serialize)]
pub struct PromptFileInfo {
    pub name: String,
    pub exists: bool,
}

pub fn prompts_dir() -> PathBuf {
    dirs::home_dir().expect("home").join(".config/goose/prompts")
}

fn check_prompt_name(name: &str) -> Result<(), String> {
    if PROMPT_FILES.contains(&name) {
        Ok(())
    } else {
        Err(format!("недопустимое имя файла: {name}"))
    }
}

/// Список промпт-файлов (канонические имена + факт наличия на диске)
#[tauri::command]
pub fn list_prompt_files() -> Result<Vec<PromptFileInfo>, String> {
    let dir = prompts_dir();
    Ok(PROMPT_FILES
        .iter()
        .map(|n| PromptFileInfo {
            name: (*n).to_string(),
            exists: dir.join(n).is_file(),
        })
        .collect())
}

/// Чтение промпта; отсутствующий файл = пустая строка (можно создать через save)
#[tauri::command]
pub fn read_prompt_file(name: String) -> Result<String, String> {
    check_prompt_name(&name)?;
    let p = prompts_dir().join(&name);
    if !p.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// Запись промпта; при существующем файле бэкап <имя>.bak
#[tauri::command]
pub fn save_prompt_file(name: String, content: String) -> Result<(), String> {
    check_prompt_name(&name)?;
    let dir = prompts_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(&name);
    if p.is_file() {
        let bak = dir.join(format!("{name}.bak"));
        fs::copy(&p, &bak).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

// ── Приложение: пути конфига и лимиты ──

#[derive(Serialize)]
pub struct ConfigPaths {
    pub config_path: String,
    pub config_dir: String,
    pub prompts_dir: String,
}

#[derive(Serialize)]
pub struct ConfigLimits {
    pub goose_max_turns: Option<u64>,
    pub goose_auto_compact_threshold: Option<f64>,
}

#[tauri::command]
pub fn get_config_paths() -> Result<ConfigPaths, String> {
    let p = config_path();
    Ok(ConfigPaths {
        config_path: p.to_string_lossy().to_string(),
        config_dir: p
            .parent()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default(),
        prompts_dir: prompts_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_config_limits() -> Result<ConfigLimits, String> {
    let raw = fs::read_to_string(config_path()).map_err(|e| e.to_string())?;
    let v: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(ConfigLimits {
        goose_max_turns: v.get("GOOSE_MAX_TURNS").and_then(|x| x.as_u64()),
        goose_auto_compact_threshold: v
            .get("GOOSE_AUTO_COMPACT_THRESHOLD")
            .and_then(|x| x.as_f64()),
    })
}

/// Открыть каталог конфига в файловом менеджере (xdg-open)
#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    let dir = config_path()
        .parent()
        .ok_or("нет каталога конфига")?
        .to_path_buf();
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
