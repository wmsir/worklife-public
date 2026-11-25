use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::AppHandle;
use uuid::Uuid;

use crate::settings::data_root_dir;

pub static FILE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub fn now_iso() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn today_ymd() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    atomic_write_text_unlocked(path, content)
}

pub fn atomic_write_text_unlocked(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入临时文件失败 {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("原子重命名失败 {}: {e}", path.display())
    })
}

pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
    atomic_write_text(path, &json)
}

pub fn atomic_write_json_unlocked<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
    atomic_write_text_unlocked(path, &json)
}

pub fn meta_dir(data_root: &Path) -> PathBuf {
    data_root.join(".lifework")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub kind: String, // "work" | "life"
    pub icon: String,
    pub color: String,
    pub builtin: bool,
    pub created_at: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: u8, // 1=高, 2=中, 3=低
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub task_code: Option<String>,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub done_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_repeat")]
    pub repeat: String, // "none" | "daily" | "workdays" | "weekly" | "monthly"
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    #[serde(default)]
    pub pomodoros: u32,
    #[serde(default)]
    pub spawned_next: bool,
}

fn default_priority() -> u8 {
    2
}

fn default_repeat() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleTodoResult {
    pub todo: Todo,
    pub spawned: Option<Todo>,
}

pub fn next_repeat_date(base_date: &str, repeat: &str) -> Option<String> {
    let base = NaiveDate::parse_from_str(base_date.trim(), "%Y-%m-%d")
        .unwrap_or_else(|_| Local::now().date_naive());
    match repeat.trim() {
        "daily" => Some((base + Duration::days(1)).format("%Y-%m-%d").to_string()),
        "workdays" => {
            let mut cur = base + Duration::days(1);
            while matches!(cur.weekday(), Weekday::Sat | Weekday::Sun) {
                cur += Duration::days(1);
            }
            Some(cur.format("%Y-%m-%d").to_string())
        }
        "weekly" => Some((base + Duration::days(7)).format("%Y-%m-%d").to_string()),
        "monthly" => {
            let (y, m) = if base.month() == 12 {
                (base.year() + 1, 1)
            } else {
                (base.year(), base.month() + 1)
            };
            let mut day = base.day();
            while day >= 28 {
                if let Some(dt) = NaiveDate::from_ymd_opt(y, m, day) {
                    return Some(dt.format("%Y-%m-%d").to_string());
                }
                day -= 1;
            }
            NaiveDate::from_ymd_opt(y, m, base.day().min(28))
                .map(|dt| dt.format("%Y-%m-%d").to_string())
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTodosQuery {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub date_from: Option<String>,
    #[serde(default)]
    pub date_to: Option<String>,
    #[serde(default = "default_true")]
    pub include_done: bool,
}

fn default_true() -> bool {
    true
}

fn projects_path(root: &Path) -> PathBuf {
    meta_dir(root).join("projects.json")
}

fn todos_path(root: &Path) -> PathBuf {
    meta_dir(root).join("todos.json")
}

pub fn projects_workspace_root(data_root: &Path) -> PathBuf {
    data_root.join("项目")
}

pub fn sanitize_fs_segment(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' | '\0' => '_',
            c if c.is_control() => '_',
            other => other,
        })
        .collect();
    let trimmed = cleaned
        .trim()
        .trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        return String::new();
    }
    let truncated: String = trimmed.chars().take(64).collect();
    let final_trim = truncated
        .trim()
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if final_trim.is_empty() || final_trim == "." || final_trim == ".." {
        return String::new();
    }
    let stem_upper = final_trim
        .split('.')
        .next()
        .unwrap_or(&final_trim)
        .to_ascii_uppercase();
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem_upper.as_str()) {
        format!("_{final_trim}")
    } else {
        final_trim
    }
}

fn norm_parent_key(parent_id: &Option<String>) -> Option<String> {
    parent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn ensure_project_folder_names(projects: &mut [Project]) -> bool {
    let mut changed = false;
    let mut used_by_parent: HashMap<Option<String>, HashSet<String>> = HashMap::new();

    for p in projects.iter() {
        let p_key = norm_parent_key(&p.parent_id);
        let f = p.folder_name.trim();
        if !f.is_empty() {
            used_by_parent
                .entry(p_key)
                .or_default()
                .insert(f.to_ascii_lowercase());
        }
    }

    for p in projects.iter_mut() {
        if !p.folder_name.trim().is_empty() {
            continue;
        }
        let p_key = norm_parent_key(&p.parent_id);
        let base = if p.id == "work" && p_key.is_none() {
            "工作".to_string()
        } else if p.id == "life" && p_key.is_none() {
            "生活".to_string()
        } else {
            let s = sanitize_fs_segment(&p.name);
            if s.is_empty() {
                "未命名项目".to_string()
            } else {
                s
            }
        };

        let set = used_by_parent.entry(p_key).or_default();
        let mut candidate = base.clone();
        let mut idx = 2usize;
        while set.contains(&candidate.to_ascii_lowercase()) {
            candidate = format!("{base}-{idx}");
            idx += 1;
        }
        set.insert(candidate.to_ascii_lowercase());
        p.folder_name = candidate;
        changed = true;
    }

    changed
}

pub fn collect_descendant_project_ids(projects: &[Project], root_id: &str) -> HashSet<String> {
    let mut result = HashSet::new();
    let mut stack = vec![root_id.to_string()];
    while let Some(cur) = stack.pop() {
        if !result.insert(cur.clone()) {
            continue;
        }
        for p in projects {
            if norm_parent_key(&p.parent_id).as_deref() == Some(cur.as_str()) {
                stack.push(p.id.clone());
            }
        }
    }
    result
}

pub fn resolve_project_dir_in_root(
    root: &Path,
    projects: &[Project],
    project_id: &str,
) -> Result<PathBuf, String> {
    let by_id: HashMap<&str, &Project> = projects.iter().map(|p| (p.id.as_str(), p)).collect();
    let mut segments = Vec::new();
    let mut cur_id = Some(project_id.trim());
    let mut visited = HashSet::new();

    while let Some(cid) = cur_id {
        if cid.is_empty() {
            break;
        }
        if !visited.insert(cid.to_string()) {
            return Err("项目层级存在循环引用".to_string());
        }
        let proj = by_id
            .get(cid)
            .ok_or_else(|| format!("未找到项目: {cid}"))?;
        let seg = if !proj.folder_name.trim().is_empty() {
            sanitize_fs_segment(&proj.folder_name)
        } else {
            sanitize_fs_segment(&proj.name)
        };
        if seg.is_empty() {
            return Err(format!("项目「{}」目录名无效", proj.name));
        }
        segments.push(seg);
        cur_id = proj
            .parent_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
    }

    if segments.is_empty() {
        return Err(format!("未找到项目: {project_id}"));
    }
    segments.reverse();
    let mut dir = projects_workspace_root(root);
    for seg in segments {
        dir.push(seg);
    }
    Ok(dir)
}

fn seed_projects() -> Vec<Project> {
    let now = now_iso();
    vec![
        Project {
            id: "work".to_string(),
            name: "工作".to_string(),
            kind: "work".to_string(),
            icon: "Briefcase".to_string(),
            color: "#2563eb".to_string(),
            builtin: true,
            created_at: now.clone(),
            parent_id: None,
            folder_name: "工作".to_string(),
        },
        Project {
            id: "life".to_string(),
            name: "生活".to_string(),
            kind: "life".to_string(),
            icon: "Heart".to_string(),
            color: "#10b981".to_string(),
            builtin: true,
            created_at: now,
            parent_id: None,
            folder_name: "生活".to_string(),
        },
    ]
}

pub fn load_projects_from_root(root: &Path) -> Result<Vec<Project>, String> {
    let path = projects_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let seeded = seed_projects();
        atomic_write_json_unlocked(&path, &seeded)?;
        return Ok(seeded);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取项目失败: {e}"))?;
    let mut projects: Vec<Project> =
        serde_json::from_str(&raw).map_err(|e| format!("解析项目失败: {e}"))?;
    if ensure_project_folder_names(&mut projects) {
        let _ = atomic_write_json_unlocked(&path, &projects);
    }
    Ok(projects)
}

pub fn load_todos_from_root(root: &Path) -> Result<Vec<Todo>, String> {
    let path = todos_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let empty: Vec<Todo> = Vec::new();
        atomic_write_json_unlocked(&path, &empty)?;
        return Ok(empty);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取待办失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析待办失败: {e}"))
}

pub fn save_todos_to_root(root: &Path, todos: &[Todo]) -> Result<(), String> {
    let path = todos_path(root);
    atomic_write_json(&path, &todos)
}

pub fn create_project_in_root(root: &Path, input: CreateProjectInput) -> Result<Project, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let parent_id = norm_parent_key(&input.parent_id);
    let mut projects = load_projects_from_root(root)?;

    let (parent_dir, inherited_kind) = if let Some(ref pid) = parent_id {
        let parent = projects
            .iter()
            .find(|p| &p.id == pid)
            .ok_or_else(|| format!("上级项目不存在: {pid}"))?
            .clone();
        let p_dir = resolve_project_dir_in_root(root, &projects, pid)?;
        (p_dir, Some(parent.kind))
    } else {
        (projects_workspace_root(root), None)
    };

    let raw_kind = input.kind.trim();
    let kind = if raw_kind.is_empty() {
        inherited_kind.unwrap_or_else(|| "life".to_string())
    } else if raw_kind == "work" {
        "work".to_string()
    } else {
        "life".to_string()
    };

    let base_folder = {
        let s = sanitize_fs_segment(&name);
        if s.is_empty() {
            "新项目".to_string()
        } else {
            s
        }
    };
    let sibling_names: HashSet<String> = projects
        .iter()
        .filter(|p| norm_parent_key(&p.parent_id) == parent_id)
        .map(|p| p.folder_name.to_ascii_lowercase())
        .collect();

    let mut folder_name = base_folder.clone();
    let mut idx = 2usize;
    while sibling_names.contains(&folder_name.to_ascii_lowercase())
        || parent_dir.join(&folder_name).exists()
    {
        folder_name = format!("{base_folder}-{idx}");
        idx += 1;
    }

    let proj_dir = parent_dir.join(&folder_name);
    fs::create_dir_all(&proj_dir).map_err(|e| format!("创建项目目录失败: {e}"))?;

    let proj = Project {
        id: Uuid::new_v4().to_string(),
        name,
        kind: kind.clone(),
        icon: if input.icon.trim().is_empty() {
            if kind == "work" {
                "FolderKanban".into()
            } else {
                "Sparkles".into()
            }
        } else {
            input.icon
        },
        color: if input.color.trim().is_empty() {
            if kind == "work" {
                "#2563eb".into()
            } else {
                "#10b981".into()
            }
        } else {
            input.color
        },
        builtin: false,
        created_at: now_iso(),
        parent_id,
        folder_name,
    };
    projects.push(proj.clone());
    atomic_write_json(&projects_path(root), &projects)?;
    Ok(proj)
}

pub fn update_project_in_root(root: &Path, project: Project) -> Result<Project, String> {
    let mut projects = load_projects_from_root(root)?;
    let idx = projects
        .iter()
        .position(|p| p.id == project.id)
        .ok_or_else(|| format!("未找到项目: {}", project.id))?;
    let existing = projects[idx].clone();

    let old_parent = norm_parent_key(&existing.parent_id);
    let new_parent = norm_parent_key(&project.parent_id);
    if existing.builtin && new_parent != old_parent {
        return Err("内置顶级项目不可变更所属上级".to_string());
    }
    if new_parent != old_parent {
        if let Some(ref npid) = new_parent {
            if !projects.iter().any(|p| &p.id == npid) {
                return Err(format!("目标上级项目不存在: {npid}"));
            }
            let descendants = collect_descendant_project_ids(&projects, &project.id);
            if descendants.contains(npid) {
                return Err("不能将项目移动到自身或子项目下面".to_string());
            }
        }
    }

    let mut updated = project;
    updated.name = updated.name.trim().to_string();
    if updated.name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    updated.builtin = existing.builtin;
    updated.created_at = existing.created_at.clone();
    updated.parent_id = new_parent.clone();
    updated.folder_name = existing.folder_name.clone();

    if new_parent != old_parent {
        let old_dir = resolve_project_dir_in_root(root, &projects, &updated.id).ok();
        let target_parent_dir = if let Some(ref npid) = new_parent {
            resolve_project_dir_in_root(root, &projects, npid)?
        } else {
            projects_workspace_root(root)
        };
        let sibling_names: HashSet<String> = projects
            .iter()
            .filter(|p| p.id != updated.id && norm_parent_key(&p.parent_id) == new_parent)
            .map(|p| p.folder_name.to_ascii_lowercase())
            .collect();
        let base_folder = if !updated.folder_name.is_empty() {
            updated.folder_name.clone()
        } else {
            sanitize_fs_segment(&updated.name)
        };
        let mut next_folder = base_folder.clone();
        let mut sfx = 2usize;
        while sibling_names.contains(&next_folder.to_ascii_lowercase())
            || target_parent_dir.join(&next_folder).exists()
        {
            next_folder = format!("{base_folder}-{sfx}");
            sfx += 1;
        }
        if let Some(od) = old_dir {
            if od.exists() {
                fs::create_dir_all(&target_parent_dir)
                    .map_err(|e| format!("创建目标父目录失败: {e}"))?;
                fs::rename(&od, target_parent_dir.join(&next_folder))
                    .map_err(|e| format!("移动项目目录失败: {e}"))?;
            }
        }
        updated.folder_name = next_folder;
    }

    projects[idx] = updated.clone();
    atomic_write_json(&projects_path(root), &projects)?;
    Ok(updated)
}

pub fn delete_project_in_root(root: &Path, id: &str) -> Result<Vec<String>, String> {
    let mut projects = load_projects_from_root(root)?;
    if !projects.iter().any(|p| p.id == id) {
        return Err(format!("未找到项目: {id}"));
    }
    let removed_ids = collect_descendant_project_ids(&projects, id);
    if projects
        .iter()
        .any(|p| removed_ids.contains(&p.id) && p.builtin)
    {
        return Err("内置项目不可删除".to_string());
    }

    let target_dir = resolve_project_dir_in_root(root, &projects, id).ok();
    let folder_label = projects
        .iter()
        .find(|p| p.id == id)
        .map(|p| p.folder_name.clone())
        .unwrap_or_else(|| "deleted".to_string());

    projects.retain(|p| !removed_ids.contains(&p.id));
    atomic_write_json(&projects_path(root), &projects)?;

    let mut todos = load_todos_from_root(root)?;
    todos.retain(|t| !removed_ids.contains(&t.project_id));
    save_todos_to_root(root, &todos)?;

    if let Some(dir) = target_dir {
        if dir.exists() {
            let is_empty = fs::read_dir(&dir)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
            if is_empty {
                let _ = fs::remove_dir(&dir);
            } else {
                let trash_dir = meta_dir(root).join("trash");
                let _ = fs::create_dir_all(&trash_dir);
                let ts = Local::now().format("%Y%m%d-%H%M%S").to_string();
                let safe_name = sanitize_fs_segment(&folder_label);
                let dest = trash_dir.join(format!("{ts}-{safe_name}"));
                let _ = fs::rename(&dir, dest);
            }
        }
    }

    Ok(removed_ids.into_iter().collect())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let root = data_root_dir(&app)?;
    load_projects_from_root(&root)
}

#[tauri::command]
pub fn create_project(app: AppHandle, input: CreateProjectInput) -> Result<Project, String> {
    let root = data_root_dir(&app)?;
    create_project_in_root(&root, input)
}

#[tauri::command]
pub fn update_project(app: AppHandle, project: Project) -> Result<Project, String> {
    let root = data_root_dir(&app)?;
    update_project_in_root(&root, project)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    delete_project_in_root(&root, &id)?;
    Ok(())
}

#[tauri::command]
pub fn list_todos(app: AppHandle, query: Option<ListTodosQuery>) -> Result<Vec<Todo>, String> {
    let root = data_root_dir(&app)?;
    let todos = load_todos_from_root(&root)?;
    let q = query.unwrap_or(ListTodosQuery {
        project_id: None,
        date_from: None,
        date_to: None,
        include_done: true,
    });
    let filtered = todos
        .into_iter()
        .filter(|t| {
            if let Some(pid) = &q.project_id {
                if !pid.is_empty() && &t.project_id != pid {
                    return false;
                }
            }
            if !q.include_done && t.done {
                return false;
            }
            if q.date_from.is_some() || q.date_to.is_some() {
                match &t.date {
                    None => return false,
                    Some(d) => {
                        if let Some(df) = &q.date_from {
                            if d.as_str() < df.as_str() {
                                return false;
                            }
                        }
                        if let Some(dt) = &q.date_to {
                            if d.as_str() > dt.as_str() {
                                return false;
                            }
                        }
                    }
                }
            }
            true
        })
        .collect();
    Ok(filtered)
}

fn normalize_todo_fields(todo: &mut Todo) {
    if todo.priority == 0 {
        todo.priority = 2;
    }
    if todo.repeat.trim().is_empty() {
        todo.repeat = "none".to_string();
    }
    if todo.repeat == "none" {
        todo.spawned_next = false;
    }
    for sub in &mut todo.subtasks {
        if sub.id.trim().is_empty() {
            sub.id = Uuid::new_v4().to_string();
        }
        sub.title = sub.title.trim().to_string();
    }
    todo.subtasks.retain(|s| !s.title.is_empty());
    let mut seen_tags = HashSet::new();
    todo.tags.retain(|t| {
        let trimmed = t.trim().to_string();
        !trimmed.is_empty() && seen_tags.insert(trimmed)
    });
    todo.tags = todo.tags.iter().map(|t| t.trim().to_string()).collect();
}

#[tauri::command]
pub fn upsert_todo(app: AppHandle, mut todo: Todo) -> Result<Todo, String> {
    if todo.title.trim().is_empty() {
        return Err("待办标题不能为空".to_string());
    }
    normalize_todo_fields(&mut todo);
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    if todo.id.trim().is_empty() {
        todo.id = Uuid::new_v4().to_string();
        if todo.created_at.trim().is_empty() {
            todo.created_at = now_iso();
        }
        todos.push(todo.clone());
    } else if let Some(pos) = todos.iter().position(|t| t.id == todo.id) {
        if todo.created_at.trim().is_empty() {
            todo.created_at = todos[pos].created_at.clone();
        }
        todos[pos] = todo.clone();
    } else {
        if todo.created_at.trim().is_empty() {
            todo.created_at = now_iso();
        }
        todos.push(todo.clone());
    }
    save_todos_to_root(&root, &todos)?;
    Ok(todo)
}

#[tauri::command]
pub fn delete_todo(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    let before = todos.len();
    todos.retain(|t| t.id != id);
    if todos.len() == before {
        return Err(format!("未找到待办: {id}"));
    }
    save_todos_to_root(&root, &todos)?;
    Ok(())
}

pub fn toggle_todo_in_root(root: &Path, id: &str) -> Result<ToggleTodoResult, String> {
    let mut todos = load_todos_from_root(root)?;
    let idx = todos
        .iter()
        .position(|t| t.id == id)
        .ok_or_else(|| format!("未找到待办: {id}"))?;
    todos[idx].done = !todos[idx].done;
    todos[idx].done_at = if todos[idx].done { Some(now_iso()) } else { None };

    let mut spawned: Option<Todo> = None;
    if todos[idx].done && !todos[idx].spawned_next && todos[idx].repeat != "none" {
        let base_str = todos[idx].date.clone().unwrap_or_else(today_ymd);
        if let Some(next_date) = next_repeat_date(&base_str, &todos[idx].repeat) {
            todos[idx].spawned_next = true;
            let mut next_todo = todos[idx].clone();
            next_todo.id = Uuid::new_v4().to_string();
            next_todo.date = Some(next_date);
            next_todo.done = false;
            next_todo.done_at = None;
            next_todo.spawned_next = false;
            next_todo.pomodoros = 0;
            next_todo.created_at = now_iso();
            for sub in &mut next_todo.subtasks {
                sub.done = false;
            }
            todos.push(next_todo.clone());
            spawned = Some(next_todo);
        }
    }

    let updated = todos[idx].clone();
    save_todos_to_root(root, &todos)?;
    Ok(ToggleTodoResult {
        todo: updated,
        spawned,
    })
}

#[tauri::command]
pub fn toggle_todo(app: AppHandle, id: String) -> Result<ToggleTodoResult, String> {
    let root = data_root_dir(&app)?;
    toggle_todo_in_root(&root, &id)
}

#[tauri::command]
pub fn toggle_subtask(
    app: AppHandle,
    todo_id: String,
    subtask_id: String,
) -> Result<Todo, String> {
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    let idx = todos
        .iter()
        .position(|t| t.id == todo_id)
        .ok_or_else(|| format!("未找到待办: {todo_id}"))?;
    let sub = todos[idx]
        .subtasks
        .iter_mut()
        .find(|s| s.id == subtask_id)
        .ok_or_else(|| format!("未找到子任务: {subtask_id}"))?;
    sub.done = !sub.done;
    let updated = todos[idx].clone();
    save_todos_to_root(&root, &todos)?;
    Ok(updated)
}

#[tauri::command]
pub fn increment_todo_pomodoro(app: AppHandle, todo_id: String) -> Result<Todo, String> {
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    let idx = todos
        .iter()
        .position(|t| t.id == todo_id)
        .ok_or_else(|| format!("未找到待办: {todo_id}"))?;
    todos[idx].pomodoros = todos[idx].pomodoros.saturating_add(1);
    let updated = todos[idx].clone();
    save_todos_to_root(&root, &todos)?;
    Ok(updated)
}

#[tauri::command]
pub fn batch_reschedule_todos(
    app: AppHandle,
    ids: Vec<String>,
    new_date: Option<String>,
) -> Result<Vec<Todo>, String> {
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    let target_set: HashSet<String> = ids.into_iter().collect();
    let normalized_date = new_date.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });
    let mut updated = Vec::new();
    for t in &mut todos {
        if target_set.contains(&t.id) {
            t.date = normalized_date.clone();
            updated.push(t.clone());
        }
    }
    save_todos_to_root(&root, &todos)?;
    Ok(updated)
}

#[tauri::command]
pub fn clear_done_todos(app: AppHandle, project_id: Option<String>) -> Result<usize, String> {
    let root = data_root_dir(&app)?;
    let mut todos = load_todos_from_root(&root)?;
    let before = todos.len();
    let filter_pid = project_id.filter(|s| !s.trim().is_empty());
    todos.retain(|t| {
        if !t.done {
            return true;
        }
        if let Some(pid) = &filter_pid {
            &t.project_id != pid
        } else {
            false
        }
    });
    let removed = before.saturating_sub(todos.len());
    save_todos_to_root(&root, &todos)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_repeat_dates_workdays_and_monthly_clamp() {
        assert_eq!(
            next_repeat_date("2026-11-20", "workdays"),
            Some("2026-11-23".to_string())
        );
        assert_eq!(
            next_repeat_date("2026-01-31", "monthly"),
            Some("2026-02-28".to_string())
        );
        assert_eq!(
            next_repeat_date("2026-12-15", "monthly"),
            Some("2027-01-15".to_string())
        );
        assert_eq!(next_repeat_date("2026-11-22", "none"), None);
    }

    #[test]
    fn test_toggle_repeating_todo_spawns_once_only() {
        let dir = tempdir().unwrap();
        let initial = Todo {
            id: "t1".into(),
            project_id: "life".into(),
            title: "晨练".into(),
            note: String::new(),
            date: Some("2026-11-22".into()),
            time: Some("07:00".into()),
            priority: 2,
            done: false,
            task_code: None,
            template_id: None,
            created_at: "2026-11-22T07:00:00".into(),
            done_at: None,
            tags: vec!["健康".into()],
            repeat: "daily".into(),
            subtasks: vec![Subtask {
                id: "s1".into(),
                title: "热身".into(),
                done: true,
            }],
            pomodoros: 2,
            spawned_next: false,
        };
        save_todos_to_root(dir.path(), &[initial]).unwrap();

        let r1 = toggle_todo_in_root(dir.path(), "t1").unwrap();
        assert!(r1.todo.done);
        assert!(r1.todo.spawned_next);
        let spawned = r1.spawned.expect("first completion should spawn next");
        assert_eq!(spawned.date.as_deref(), Some("2026-11-23"));
        assert!(!spawned.done);
        assert_eq!(spawned.pomodoros, 0);
        assert!(!spawned.subtasks[0].done);

        // Uncheck then re-check -> must not spawn duplicate
        let r2 = toggle_todo_in_root(dir.path(), "t1").unwrap();
        assert!(!r2.todo.done);
        assert!(r2.spawned.is_none());

        let r3 = toggle_todo_in_root(dir.path(), "t1").unwrap();
        assert!(r3.todo.done);
        assert!(r3.spawned.is_none());

        let all = load_todos_from_root(dir.path()).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_project_hierarchy_create_update_cycle_guard_and_cascade_delete() {
        let dir = tempdir().unwrap();

        // 1. Legacy projects.json without parentId / folderName backfills cleanly
        let legacy = serde_json::json!([
            {
                "id": "work",
                "name": "工作",
                "kind": "work",
                "icon": "Briefcase",
                "color": "#2563eb",
                "builtin": true,
                "createdAt": "2026-10-01T09:00:00"
            },
            {
                "id": "p-summary",
                "name": "工作总结",
                "kind": "work",
                "icon": "FolderKanban",
                "color": "#2563eb",
                "builtin": false,
                "createdAt": "2026-10-02T09:00:00"
            }
        ]);
        fs::create_dir_all(meta_dir(dir.path())).unwrap();
        fs::write(
            projects_path(dir.path()),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();

        let loaded = load_projects_from_root(dir.path()).unwrap();
        let summary_root = loaded.iter().find(|p| p.id == "p-summary").unwrap();
        assert_eq!(summary_root.folder_name, "工作总结");
        assert_eq!(summary_root.parent_id, None);

        // 2. Create child & grandchild sub-projects -> creates real nested directories
        let child = create_project_in_root(
            dir.path(),
            CreateProjectInput {
                name: "2026年总结".into(),
                kind: String::new(),
                icon: String::new(),
                color: String::new(),
                parent_id: Some("p-summary".into()),
            },
        )
        .unwrap();
        assert_eq!(child.kind, "work");
        assert_eq!(child.parent_id.as_deref(), Some("p-summary"));
        assert_eq!(child.folder_name, "2026年总结");

        let grandchild = create_project_in_root(
            dir.path(),
            CreateProjectInput {
                name: "Q4复盘".into(),
                kind: "work".into(),
                icon: String::new(),
                color: String::new(),
                parent_id: Some(child.id.clone()),
            },
        )
        .unwrap();

        let gc_dir = dir
            .path()
            .join("项目")
            .join("工作总结")
            .join("2026年总结")
            .join("Q4复盘");
        assert!(gc_dir.is_dir());

        // Add todos to summary, child, grandchild
        save_todos_to_root(
            dir.path(),
            &[
                Todo {
                    id: "t-root".into(),
                    project_id: "p-summary".into(),
                    title: "Root todo".into(),
                    note: String::new(),
                    date: None,
                    time: None,
                    priority: 2,
                    done: false,
                    task_code: None,
                    template_id: None,
                    created_at: "2026-11-23T09:00:00".into(),
                    done_at: None,
                    tags: vec![],
                    repeat: "none".into(),
                    subtasks: vec![],
                    pomodoros: 0,
                    spawned_next: false,
                },
                Todo {
                    id: "t-child".into(),
                    project_id: child.id.clone(),
                    title: "Child todo".into(),
                    note: String::new(),
                    date: None,
                    time: None,
                    priority: 2,
                    done: false,
                    task_code: None,
                    template_id: None,
                    created_at: "2026-11-23T09:00:00".into(),
                    done_at: None,
                    tags: vec![],
                    repeat: "none".into(),
                    subtasks: vec![],
                    pomodoros: 0,
                    spawned_next: false,
                },
                Todo {
                    id: "t-grand".into(),
                    project_id: grandchild.id.clone(),
                    title: "Grandchild todo".into(),
                    note: String::new(),
                    date: None,
                    time: None,
                    priority: 2,
                    done: false,
                    task_code: None,
                    template_id: None,
                    created_at: "2026-11-23T09:00:00".into(),
                    done_at: None,
                    tags: vec![],
                    repeat: "none".into(),
                    subtasks: vec![],
                    pomodoros: 0,
                    spawned_next: false,
                },
            ],
        )
        .unwrap();

        // 3. Reject cyclic parent_id update
        let mut cyclic = summary_root.clone();
        cyclic.parent_id = Some(grandchild.id.clone());
        let cycle_err = update_project_in_root(dir.path(), cyclic);
        assert!(cycle_err.is_err());

        // 4. Cascade delete child -> removes child, grandchild, and their todos; preserves summary & t-root
        let removed = delete_project_in_root(dir.path(), &child.id).unwrap();
        assert_eq!(removed.len(), 2);
        let remaining_projects = load_projects_from_root(dir.path()).unwrap();
        assert!(remaining_projects.iter().any(|p| p.id == "p-summary"));
        assert!(!remaining_projects.iter().any(|p| p.id == child.id));
        assert!(!remaining_projects.iter().any(|p| p.id == grandchild.id));

        let remaining_todos = load_todos_from_root(dir.path()).unwrap();
        assert_eq!(remaining_todos.len(), 1);
        assert_eq!(remaining_todos[0].id, "t-root");
    }
}
