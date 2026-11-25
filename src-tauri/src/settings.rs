use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::store::atomic_write_json;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRec {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub data_root: String,
    #[serde(default)]
    pub cookies: Vec<CookieRec>,
    pub worktime: Value,
    #[serde(default)]
    pub last_user: Option<Value>,
    #[serde(default)]
    pub portable: bool,
    #[serde(default)]
    pub data_root_resolved: String,
}

pub const PORTABLE_DATA_DIR: &str = "LifeWorkData";

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|p| p.to_path_buf())
}

pub fn portable_base() -> Option<PathBuf> {
    let candidate = std::env::var_os("LIFEWORK_PORTABLE_DIR")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty() && p.is_dir())
        .or_else(|| {
            let d = exe_dir()?;
            if d.join("portable.flag").exists() {
                Some(d)
            } else {
                None
            }
        })?;
    if std::fs::create_dir_all(candidate.join(PORTABLE_DATA_DIR)).is_ok() {
        Some(candidate)
    } else {
        None
    }
}

pub fn resolve_data_root_with_base(raw: &str, base: Option<&Path>) -> PathBuf {
    let p = Path::new(raw);
    if p.is_relative() {
        if let Some(b) = base {
            return b.join(p);
        }
    }
    p.to_path_buf()
}

pub fn default_data_root() -> String {
    if portable_base().is_some() {
        return PORTABLE_DATA_DIR.to_string();
    }
    if Path::new("D:\\").exists() {
        "D:\\LifeWork".to_string()
    } else {
        let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        PathBuf::from(profile)
            .join("Documents")
            .join("LifeWork")
            .to_string_lossy()
            .to_string()
    }
}

pub fn default_worktime_config() -> Value {
    json!({
        "ip": "devops.example.local",
        "space_id": "1",
        "role_name": "开发",
        "branch_ref": "master",
        "branch_default_reviewers": {},
        "wechat_config": {
            "enabled": false,
            "mode": "webservice",
            "url": "",
            "sys_flag": "",
            "sys_id": "",
            "sys_id_pass": "",
            "user_type": "2",
            "target_erp": "",
            "webhook_url": "",
            "auto_notify_report": true,
            "auto_notify_mr": true,
            "template_report": crate::worktime::constants::DEFAULT_TEMPLATE_REPORT,
            "template_mr": crate::worktime::constants::DEFAULT_TEMPLATE_MR,
            "template_test": crate::worktime::constants::DEFAULT_TEMPLATE_TEST,
            "template_miss": crate::worktime::constants::DEFAULT_TEMPLATE_MISS
        },
        "miss_check_members": [],
        "branch_projects": [],
        "uat_default_handler": {
            "userName": "",
            "sex": 1,
            "name": "",
            "email": "",
            "erp": "",
            "orgTierCode": "",
            "orgTierName": "",
            "positionName": "",
            "isLeader": false,
            "type": 1,
            "role": "member"
        }
    })
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            data_root: default_data_root(),
            cookies: Vec::new(),
            worktime: default_worktime_config(),
            last_user: None,
            portable: false,
            data_root_resolved: String::new(),
        }
    }
}

fn enrich(mut s: Settings) -> Settings {
    let base = portable_base();
    s.portable = base.is_some();
    s.data_root_resolved = resolve_data_root_with_base(&s.data_root, base.as_deref())
        .to_string_lossy()
        .to_string();
    s
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(base) = portable_base() {
        let dir = base.join(PORTABLE_DATA_DIR);
        if std::fs::create_dir_all(&dir).is_ok() {
            return Ok(dir.join("settings.json"));
        }
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {e}"))?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings_sync(app: &AppHandle) -> Result<Settings, String> {
    let path = settings_file(app)?;
    if !path.exists() {
        let def = Settings::default();
        atomic_write_json(&path, &def)?;
        return Ok(def);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取设置失败: {e}"))?;
    let mut cfg: Settings = serde_json::from_str(&raw).map_err(|e| format!("解析设置失败: {e}"))?;
    if cfg.data_root.trim().is_empty() {
        cfg.data_root = default_data_root();
    }
    if cfg.worktime.is_null() {
        cfg.worktime = default_worktime_config();
    }
    Ok(cfg)
}

pub fn save_settings_sync(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_file(app)?;
    atomic_write_json(&path, settings)
}

pub fn data_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cfg = load_settings_sync(app)?;
    Ok(resolve_data_root_with_base(
        &cfg.data_root,
        portable_base().as_deref(),
    ))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    load_settings_sync(&app).map(enrich)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    save_settings_sync(&app, &settings)?;
    let _ = crate::worktime::api_config::sync_from_settings_worktime(&app, &settings.worktime);
    Ok(enrich(settings))
}

#[tauri::command]
pub fn choose_data_root(app: AppHandle, path: String) -> Result<Settings, String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("目录路径不能为空".to_string());
    }
    let mut cfg = load_settings_sync(&app)?;
    cfg.data_root = trimmed;
    save_settings_sync(&app, &cfg)?;
    Ok(enrich(cfg))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::resolve_data_root_with_base;
    use std::path::{Path, PathBuf};

    #[test]
    fn test_resolve_data_root_relative_and_absolute() {
        assert_eq!(
            resolve_data_root_with_base("LifeWorkData", Some(Path::new(r"C:\x"))),
            PathBuf::from(r"C:\x\LifeWorkData")
        );
        assert_eq!(
            resolve_data_root_with_base(r"D:\LifeWork", Some(Path::new(r"C:\x"))),
            PathBuf::from(r"D:\LifeWork")
        );
        assert_eq!(
            resolve_data_root_with_base("LifeWorkData", None),
            PathBuf::from("LifeWorkData")
        );
    }
}
