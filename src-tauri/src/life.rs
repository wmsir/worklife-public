use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::settings::data_root_dir;
use crate::store::{
    atomic_write_json, atomic_write_json_unlocked, atomic_write_text, meta_dir, now_iso, FILE_LOCK,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    #[serde(default = "default_habit_icon")]
    pub icon: String,
    #[serde(default = "default_habit_color")]
    pub color: String,
    #[serde(default = "default_freq")]
    pub frequency: String, // "daily" | "weekly"
    #[serde(default = "default_target_per_week")]
    pub target_per_week: u8,
    #[serde(default)]
    pub reminder_time: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub checkins: Vec<String>,
}

fn default_habit_icon() -> String {
    "✅".to_string()
}

fn default_habit_color() -> String {
    "#10b981".to_string()
}

fn default_freq() -> String {
    "daily".to_string()
}

fn default_target_per_week() -> u8 {
    7
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Countdown {
    pub id: String,
    pub title: String,
    pub target_date: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub annual: bool,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_countdown_color")]
    pub color: String,
    #[serde(default)]
    pub created_at: String,
}

fn default_category() -> String {
    "重要日程".to_string()
}

fn default_countdown_color() -> String {
    "#6366f1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalSummary {
    pub date: String,
    pub mood: u8,
    pub energy: u8,
    pub tags: Vec<String>,
    pub preview: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub date: String,
    #[serde(default = "default_score")]
    pub mood: u8,
    #[serde(default = "default_score")]
    pub energy: u8,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub exists: bool,
    #[serde(default)]
    pub path: String,
}

fn default_score() -> u8 {
    4
}

fn habits_path(root: &Path) -> PathBuf {
    meta_dir(root).join("habits.json")
}

fn countdowns_path(root: &Path) -> PathBuf {
    meta_dir(root).join("countdowns.json")
}

fn journals_root_dir(root: &Path) -> PathBuf {
    root.join("生活").join("日记")
}

fn seed_habits() -> Vec<Habit> {
    let now = now_iso();
    vec![
        Habit {
            id: "habit-water".to_string(),
            name: "喝水 2L".to_string(),
            icon: "💧".to_string(),
            color: "#0ea5e9".to_string(),
            frequency: "daily".to_string(),
            target_per_week: 7,
            reminder_time: None,
            archived: false,
            created_at: now.clone(),
            checkins: Vec::new(),
        },
        Habit {
            id: "habit-sport".to_string(),
            name: "运动 30 分钟".to_string(),
            icon: "🏃".to_string(),
            color: "#10b981".to_string(),
            frequency: "daily".to_string(),
            target_per_week: 5,
            reminder_time: Some("19:30".to_string()),
            archived: false,
            created_at: now.clone(),
            checkins: Vec::new(),
        },
        Habit {
            id: "habit-read".to_string(),
            name: "阅读 / 学习".to_string(),
            icon: "📖".to_string(),
            color: "#6366f1".to_string(),
            frequency: "daily".to_string(),
            target_per_week: 7,
            reminder_time: Some("21:00".to_string()),
            archived: false,
            created_at: now.clone(),
            checkins: Vec::new(),
        },
        Habit {
            id: "habit-sleep".to_string(),
            name: "23:30 前早睡".to_string(),
            icon: "🌙".to_string(),
            color: "#8b5cf6".to_string(),
            frequency: "daily".to_string(),
            target_per_week: 7,
            reminder_time: Some("23:15".to_string()),
            archived: false,
            created_at: now,
            checkins: Vec::new(),
        },
    ]
}

pub fn load_habits_from_root(root: &Path) -> Result<Vec<Habit>, String> {
    let path = habits_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let seeded = seed_habits();
        atomic_write_json_unlocked(&path, &seeded)?;
        return Ok(seeded);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取习惯失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析习惯失败: {e}"))
}

pub fn toggle_habit_checkin_in_root(
    root: &Path,
    id: &str,
    date: &str,
) -> Result<Habit, String> {
    let d_trimmed = date.trim();
    NaiveDate::parse_from_str(d_trimmed, "%Y-%m-%d")
        .map_err(|e| format!("无效打卡日期 {d_trimmed}: {e}"))?;
    let mut habits = load_habits_from_root(root)?;
    let idx = habits
        .iter()
        .position(|h| h.id == id)
        .ok_or_else(|| format!("未找到习惯: {id}"))?;
    let mut set: BTreeSet<String> = habits[idx].checkins.iter().cloned().collect();
    if !set.remove(d_trimmed) {
        set.insert(d_trimmed.to_string());
    }
    habits[idx].checkins = set.into_iter().collect();
    let updated = habits[idx].clone();
    atomic_write_json(&habits_path(root), &habits)?;
    Ok(updated)
}

#[tauri::command]
pub fn list_habits(app: AppHandle) -> Result<Vec<Habit>, String> {
    let root = data_root_dir(&app)?;
    load_habits_from_root(&root)
}

#[tauri::command]
pub fn upsert_habit(app: AppHandle, mut habit: Habit) -> Result<Habit, String> {
    if habit.name.trim().is_empty() {
        return Err("习惯名称不能为空".to_string());
    }
    habit.name = habit.name.trim().to_string();
    if habit.icon.trim().is_empty() {
        habit.icon = default_habit_icon();
    }
    if habit.color.trim().is_empty() {
        habit.color = default_habit_color();
    }
    if habit.target_per_week == 0 {
        habit.target_per_week = 7;
    }
    let set: BTreeSet<String> = habit.checkins.into_iter().collect();
    habit.checkins = set.into_iter().collect();

    let root = data_root_dir(&app)?;
    let mut habits = load_habits_from_root(&root)?;
    if habit.id.trim().is_empty() {
        habit.id = Uuid::new_v4().to_string();
        if habit.created_at.trim().is_empty() {
            habit.created_at = now_iso();
        }
        habits.push(habit.clone());
    } else if let Some(pos) = habits.iter().position(|h| h.id == habit.id) {
        if habit.created_at.trim().is_empty() {
            habit.created_at = habits[pos].created_at.clone();
        }
        habits[pos] = habit.clone();
    } else {
        if habit.created_at.trim().is_empty() {
            habit.created_at = now_iso();
        }
        habits.push(habit.clone());
    }
    atomic_write_json(&habits_path(&root), &habits)?;
    Ok(habit)
}

#[tauri::command]
pub fn delete_habit(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let mut habits = load_habits_from_root(&root)?;
    let before = habits.len();
    habits.retain(|h| h.id != id);
    if habits.len() == before {
        return Err(format!("未找到习惯: {id}"));
    }
    atomic_write_json(&habits_path(&root), &habits)
}

#[tauri::command]
pub fn toggle_habit_checkin(
    app: AppHandle,
    id: String,
    date: String,
) -> Result<Habit, String> {
    let root = data_root_dir(&app)?;
    toggle_habit_checkin_in_root(&root, &id, &date)
}

pub fn load_countdowns_from_root(root: &Path) -> Result<Vec<Countdown>, String> {
    let path = countdowns_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let empty: Vec<Countdown> = Vec::new();
        atomic_write_json_unlocked(&path, &empty)?;
        return Ok(empty);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取倒数日失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析倒数日失败: {e}"))
}

#[tauri::command]
pub fn list_countdowns(app: AppHandle) -> Result<Vec<Countdown>, String> {
    let root = data_root_dir(&app)?;
    load_countdowns_from_root(&root)
}

#[tauri::command]
pub fn upsert_countdown(app: AppHandle, mut item: Countdown) -> Result<Countdown, String> {
    if item.title.trim().is_empty() {
        return Err("倒数日标题不能为空".to_string());
    }
    NaiveDate::parse_from_str(item.target_date.trim(), "%Y-%m-%d")
        .map_err(|e| format!("目标日期格式应为 YYYY-MM-DD: {e}"))?;
    item.title = item.title.trim().to_string();
    item.target_date = item.target_date.trim().to_string();
    if item.category.trim().is_empty() {
        item.category = default_category();
    }
    if item.color.trim().is_empty() {
        item.color = default_countdown_color();
    }

    let root = data_root_dir(&app)?;
    let mut items = load_countdowns_from_root(&root)?;
    if item.id.trim().is_empty() {
        item.id = Uuid::new_v4().to_string();
        if item.created_at.trim().is_empty() {
            item.created_at = now_iso();
        }
        items.push(item.clone());
    } else if let Some(pos) = items.iter().position(|x| x.id == item.id) {
        if item.created_at.trim().is_empty() {
            item.created_at = items[pos].created_at.clone();
        }
        items[pos] = item.clone();
    } else {
        if item.created_at.trim().is_empty() {
            item.created_at = now_iso();
        }
        items.push(item.clone());
    }
    atomic_write_json(&countdowns_path(&root), &items)?;
    Ok(item)
}

#[tauri::command]
pub fn delete_countdown(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let mut items = load_countdowns_from_root(&root)?;
    let before = items.len();
    items.retain(|x| x.id != id);
    if items.len() == before {
        return Err(format!("未找到倒数日: {id}"));
    }
    atomic_write_json(&countdowns_path(&root), &items)
}

fn validate_journal_date(date: &str) -> Result<String, String> {
    let trimmed = date.trim();
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|e| format!("日记日期必须是 YYYY-MM-DD 格式 ({trimmed}): {e}"))?;
    Ok(trimmed.to_string())
}

fn journal_file_path(root: &Path, date: &str) -> PathBuf {
    let month = &date[..7];
    journals_root_dir(root)
        .join(month)
        .join(format!("{date}.md"))
}

fn default_journal_body() -> String {
    "## 今日完成与小确幸\n- \n\n## 随笔与反思\n\n\n## 明日重点\n- \n".to_string()
}

fn parse_journal_markdown(raw: &str, fallback_date: &str) -> (String, u8, u8, Vec<String>, String) {
    let normalized = raw.replace("\r\n", "\n");
    let mut date = fallback_date.to_string();
    let mut mood: u8 = 4;
    let mut energy: u8 = 4;
    let mut tags: Vec<String> = Vec::new();
    let mut body = normalized.clone();

    if let Some(after_start) = normalized.strip_prefix("---\n") {
        if let Some(end_idx) = after_start.find("\n---\n") {
            let fm = &after_start[..end_idx];
            body = after_start[end_idx + 5..].trim_start_matches('\n').to_string();
            for line in fm.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    let key = k.trim();
                    let val = v.trim();
                    match key {
                        "date" if !val.is_empty() => date = val.to_string(),
                        "mood" => {
                            if let Ok(n) = val.parse::<u8>() {
                                mood = n.clamp(1, 5);
                            }
                        }
                        "energy" => {
                            if let Ok(n) = val.parse::<u8>() {
                                energy = n.clamp(1, 5);
                            }
                        }
                        "tags" => {
                            let inner = val.trim_start_matches('[').trim_end_matches(']');
                            tags = inner
                                .split(',')
                                .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                                .filter(|s| !s.is_empty())
                                .collect();
                        }
                        _ => {}
                    }
                }
            }
        } else if let Some(after_empty) = after_start.strip_suffix("\n---") {
            let _ = after_empty;
            body = String::new();
        }
    }

    (date, mood, energy, tags, body)
}

fn serialize_journal_markdown(entry: &JournalEntry) -> String {
    let tags_str = entry.tags.join(", ");
    format!(
        "---\ndate: {}\nmood: {}\nenergy: {}\ntags: [{}]\n---\n\n{}",
        entry.date,
        entry.mood.clamp(1, 5),
        entry.energy.clamp(1, 5),
        tags_str,
        entry.content.trim_start_matches('\n')
    )
}

fn extract_preview(body: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("##") || t == "-" || t == "*" {
            continue;
        }
        let cleaned = t.trim_start_matches(['-', '*', '#', ' ']);
        if cleaned.is_empty() {
            continue;
        }
        return cleaned.chars().take(80).collect();
    }
    String::new()
}

pub fn list_journals_in_root(root: &Path) -> Result<Vec<JournalSummary>, String> {
    let dir = journals_root_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in WalkDir::new(&dir).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if NaiveDate::parse_from_str(&stem, "%Y-%m-%d").is_err() {
            continue;
        }
        let raw = fs::read_to_string(path).unwrap_or_default();
        let (date, mood, energy, tags, body) = parse_journal_markdown(&raw, &stem);
        items.push(JournalSummary {
            date,
            mood,
            energy,
            tags,
            preview: extract_preview(&body),
            path: path.to_string_lossy().to_string(),
        });
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(items)
}

pub fn read_journal_in_root(root: &Path, date: &str) -> Result<JournalEntry, String> {
    let valid_date = validate_journal_date(date)?;
    let path = journal_file_path(root, &valid_date);
    if !path.exists() {
        return Ok(JournalEntry {
            date: valid_date,
            mood: 4,
            energy: 4,
            tags: Vec::new(),
            content: default_journal_body(),
            exists: false,
            path: path.to_string_lossy().to_string(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取日记失败: {e}"))?;
    let (parsed_date, mood, energy, tags, body) = parse_journal_markdown(&raw, &valid_date);
    Ok(JournalEntry {
        date: parsed_date,
        mood,
        energy,
        tags,
        content: body,
        exists: true,
        path: path.to_string_lossy().to_string(),
    })
}

pub fn save_journal_in_root(
    root: &Path,
    mut entry: JournalEntry,
) -> Result<JournalSummary, String> {
    let valid_date = validate_journal_date(&entry.date)?;
    entry.date = valid_date.clone();
    entry.mood = entry.mood.clamp(1, 5);
    entry.energy = entry.energy.clamp(1, 5);
    entry.tags = entry
        .tags
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let path = journal_file_path(root, &valid_date);
    let md = serialize_journal_markdown(&entry);
    atomic_write_text(&path, &md)?;
    Ok(JournalSummary {
        date: valid_date,
        mood: entry.mood,
        energy: entry.energy,
        tags: entry.tags,
        preview: extract_preview(&entry.content),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_journals(app: AppHandle) -> Result<Vec<JournalSummary>, String> {
    let root = data_root_dir(&app)?;
    list_journals_in_root(&root)
}

#[tauri::command]
pub fn read_journal(app: AppHandle, date: String) -> Result<JournalEntry, String> {
    let root = data_root_dir(&app)?;
    read_journal_in_root(&root, &date)
}

#[tauri::command]
pub fn save_journal(app: AppHandle, entry: JournalEntry) -> Result<JournalSummary, String> {
    let root = data_root_dir(&app)?;
    save_journal_in_root(&root, entry)
}

#[tauri::command]
pub fn open_journal_dir(app: AppHandle) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let dir = journals_root_dir(&root);
    fs::create_dir_all(&dir).map_err(|e| format!("创建日记目录失败: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开日记目录失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_habit_checkin_toggle_sorted_unique() {
        let dir = tempdir().unwrap();
        let habits = load_habits_from_root(dir.path()).unwrap();
        assert_eq!(habits.len(), 4);

        let h1 = toggle_habit_checkin_in_root(dir.path(), "habit-water", "2026-11-22").unwrap();
        assert_eq!(h1.checkins, vec!["2026-11-22"]);

        let h2 = toggle_habit_checkin_in_root(dir.path(), "habit-water", "2026-11-20").unwrap();
        assert_eq!(h2.checkins, vec!["2026-11-20", "2026-11-22"]);

        let h3 = toggle_habit_checkin_in_root(dir.path(), "habit-water", "2026-11-20").unwrap();
        assert_eq!(h3.checkins, vec!["2026-11-22"]);
    }

    #[test]
    fn test_journal_roundtrip_and_list() {
        let dir = tempdir().unwrap();
        let empty = read_journal_in_root(dir.path(), "2026-11-22").unwrap();
        assert!(!empty.exists);

        save_journal_in_root(
            dir.path(),
            JournalEntry {
                date: "2026-11-21".into(),
                mood: 3,
                energy: 4,
                tags: vec!["生活".into()],
                content: "## 今日完成与小确幸\n- 整理房间\n".into(),
                exists: false,
                path: String::new(),
            },
        )
        .unwrap();

        save_journal_in_root(
            dir.path(),
            JournalEntry {
                date: "2026-11-22".into(),
                mood: 5,
                energy: 5,
                tags: vec!["运动".into(), "复盘".into()],
                content: "## 今日完成与小确幸\n- 完成 5 公里夜跑\n".into(),
                exists: false,
                path: String::new(),
            },
        )
        .unwrap();

        let loaded = read_journal_in_root(dir.path(), "2026-11-22").unwrap();
        assert!(loaded.exists);
        assert_eq!(loaded.mood, 5);
        assert_eq!(loaded.tags, vec!["运动", "复盘"]);
        assert!(loaded.content.contains("5 公里夜跑"));

        let list = list_journals_in_root(dir.path()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].date, "2026-11-22");
        assert_eq!(list[0].preview, "完成 5 公里夜跑");
        assert_eq!(list[1].date, "2026-11-21");
    }
}
