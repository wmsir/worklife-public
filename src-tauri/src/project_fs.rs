use chrono::{DateTime, Local};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::settings::data_root_dir;
use crate::store::{
    atomic_write_text, load_projects_from_root, resolve_project_dir_in_root, sanitize_fs_segment,
    Project, FILE_LOCK,
};

const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFsEntry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: String,
    pub ext: String,
    pub is_text_editable: bool,
    pub linked_project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFsListing {
    pub project_id: String,
    pub root_abs_path: String,
    pub current_rel_path: String,
    pub entries: Vec<ProjectFsEntry>,
}

pub fn is_text_editable_ext(ext: &str) -> bool {
    matches!(
        ext.trim().to_ascii_lowercase().as_str(),
        "md" | "markdown"
            | "txt"
            | "json"
            | "yml"
            | "yaml"
            | "toml"
            | "ini"
            | "csv"
            | "sql"
            | "xml"
            | "log"
            | "html"
            | "css"
            | "js"
            | "ts"
    )
}

fn is_valid_single_segment(seg: &str) -> bool {
    if seg.is_empty() || seg == "." || seg == ".." {
        return false;
    }
    if seg.chars().any(|c| {
        matches!(
            c,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' | '\0'
        ) || c.is_control()
    }) {
        return false;
    }
    true
}

pub fn resolve_safe_subpath(project_root: &Path, rel_path: &str) -> Result<(PathBuf, String), String> {
    let norm = rel_path.replace('\\', "/");
    let trimmed = norm.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Ok((project_root.to_path_buf(), String::new()));
    }
    let mut parts = Vec::new();
    let mut joined = project_root.to_path_buf();
    for raw_seg in trimmed.split('/') {
        let seg = raw_seg.trim();
        if !is_valid_single_segment(seg) {
            return Err(format!("非法相对路径片段: {seg}"));
        }
        parts.push(seg.to_string());
        joined.push(seg);
    }
    Ok((joined, parts.join("/")))
}

fn format_modified_at(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = DateTime::from(t);
            dt.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_default()
}

fn build_entry(
    path: &Path,
    rel_path: String,
    child_proj_map: Option<&HashMap<String, String>>,
) -> Result<ProjectFsEntry, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取文件属性失败 {}: {e}", path.display()))?;
    let is_dir = meta.is_dir();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let ext = if is_dir {
        String::new()
    } else {
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    };
    let linked_project_id = if is_dir {
        child_proj_map.and_then(|m| m.get(&name.to_ascii_lowercase()).cloned())
    } else {
        None
    };

    Ok(ProjectFsEntry {
        name,
        rel_path,
        is_dir,
        size: if is_dir { 0 } else { meta.len() },
        modified_at: format_modified_at(&meta),
        is_text_editable: !is_dir && is_text_editable_ext(&ext),
        ext,
        linked_project_id,
    })
}

fn child_project_folder_map(projects: &[Project], parent_id: &str) -> HashMap<String, String> {
    projects
        .iter()
        .filter(|p| p.parent_id.as_deref() == Some(parent_id) && !p.folder_name.trim().is_empty())
        .map(|p| (p.folder_name.to_ascii_lowercase(), p.id.clone()))
        .collect()
}

fn ensure_project_root_dir(root: &Path, project_id: &str) -> Result<(Vec<Project>, PathBuf), String> {
    let projects = load_projects_from_root(root)?;
    let proj_dir = resolve_project_dir_in_root(root, &projects, project_id)?;
    fs::create_dir_all(&proj_dir).map_err(|e| format!("初始化项目目录失败: {e}"))?;
    Ok((projects, proj_dir))
}

pub fn project_fs_list_in_root(
    root: &Path,
    project_id: &str,
    rel_path: Option<&str>,
) -> Result<ProjectFsListing, String> {
    let (projects, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (target_dir, norm_rel) = resolve_safe_subpath(&proj_dir, rel_path.unwrap_or(""))?;
    if !target_dir.exists() {
        return Err(format!("目录不存在: {}", target_dir.display()));
    }
    if !target_dir.is_dir() {
        return Err("目标路径不是目录".to_string());
    }

    let child_map = if norm_rel.is_empty() {
        Some(child_project_folder_map(&projects, project_id))
    } else {
        None
    };

    let mut entries = Vec::new();
    let rd = fs::read_dir(&target_dir).map_err(|e| format!("读取目录内容失败: {e}"))?;
    for item in rd.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let child_rel = if norm_rel.is_empty() {
            name
        } else {
            format!("{norm_rel}/{name}")
        };
        if let Ok(entry) = build_entry(&item.path(), child_rel, child_map.as_ref()) {
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });

    Ok(ProjectFsListing {
        project_id: project_id.to_string(),
        root_abs_path: proj_dir.to_string_lossy().to_string(),
        current_rel_path: norm_rel,
        entries,
    })
}

pub fn project_fs_create_folder_in_root(
    root: &Path,
    project_id: &str,
    parent_rel_path: Option<&str>,
    folder_name: &str,
) -> Result<ProjectFsEntry, String> {
    let (projects, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (parent_dir, parent_rel) = resolve_safe_subpath(&proj_dir, parent_rel_path.unwrap_or(""))?;
    if !parent_dir.is_dir() {
        return Err("父目录不存在".to_string());
    }

    let raw_input = folder_name.replace('\\', "/");
    let raw_segments: Vec<&str> = raw_input
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if raw_segments.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }

    let mut clean_segments = Vec::with_capacity(raw_segments.len());
    for raw_seg in raw_segments {
        let seg = sanitize_fs_segment(raw_seg);
        if seg.is_empty() {
            return Err("文件夹名称包含无效字符".to_string());
        }
        clean_segments.push(seg);
    }

    let sub_rel = clean_segments.join("/");
    let full_rel = if parent_rel.is_empty() {
        sub_rel
    } else {
        format!("{parent_rel}/{sub_rel}")
    };
    let (target_dir, safe_rel) = resolve_safe_subpath(&proj_dir, &full_rel)?;
    if target_dir.exists() {
        return Err(format!("同名文件或文件夹已存在: {sub}", sub = clean_segments.join("/")));
    }

    fs::create_dir_all(&target_dir).map_err(|e| format!("创建文件夹失败: {e}"))?;
    let child_map = if parent_rel.is_empty() && clean_segments.len() == 1 {
        Some(child_project_folder_map(&projects, project_id))
    } else {
        None
    };
    build_entry(&target_dir, safe_rel, child_map.as_ref())
}

pub fn project_fs_create_file_in_root(
    root: &Path,
    project_id: &str,
    parent_rel_path: Option<&str>,
    file_name: &str,
    content: Option<&str>,
) -> Result<ProjectFsEntry, String> {
    let (_, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (parent_dir, parent_rel) = resolve_safe_subpath(&proj_dir, parent_rel_path.unwrap_or(""))?;
    if !parent_dir.is_dir() {
        return Err("父目录不存在".to_string());
    }

    let mut clean_name = sanitize_fs_segment(file_name);
    if clean_name.is_empty() {
        return Err("文件名不能为空或包含非法字符".to_string());
    }
    if Path::new(&clean_name).extension().is_none() {
        clean_name.push_str(".md");
    }

    let full_rel = if parent_rel.is_empty() {
        clean_name.clone()
    } else {
        format!("{parent_rel}/{clean_name}")
    };
    let (target_file, safe_rel) = resolve_safe_subpath(&proj_dir, &full_rel)?;
    if target_file.exists() {
        return Err(format!("文件或目录已存在: {clean_name}"));
    }

    let ext = target_file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body = match content {
        Some(c) if !c.is_empty() => c.to_string(),
        _ if ext == "md" || ext == "markdown" => {
            let stem = target_file
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&clean_name);
            format!("# {stem}\n\n")
        }
        _ => String::new(),
    };

    atomic_write_text(&target_file, &body)?;
    build_entry(&target_file, safe_rel, None)
}

pub fn project_fs_read_file_in_root(
    root: &Path,
    project_id: &str,
    rel_path: &str,
) -> Result<String, String> {
    let (_, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (target_file, norm_rel) = resolve_safe_subpath(&proj_dir, rel_path)?;
    if norm_rel.is_empty() || !target_file.exists() || !target_file.is_file() {
        return Err(format!("文件不存在: {rel_path}"));
    }
    let meta = fs::metadata(&target_file).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err("文件超过 2MB，请使用外部程序打开查看".to_string());
    }
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    fs::read_to_string(&target_file).map_err(|e| format!("读取文本内容失败（可能非 UTF-8 编码）: {e}"))
}

pub fn project_fs_write_file_in_root(
    root: &Path,
    project_id: &str,
    rel_path: &str,
    content: &str,
) -> Result<ProjectFsEntry, String> {
    let (_, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (target_file, safe_rel) = resolve_safe_subpath(&proj_dir, rel_path)?;
    if safe_rel.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    if target_file.is_dir() {
        return Err("目标路径是目录，不能作为文件写入".to_string());
    }
    atomic_write_text(&target_file, content)?;
    build_entry(&target_file, safe_rel, None)
}

pub fn project_fs_import_files_in_root(
    root: &Path,
    project_id: &str,
    parent_rel_path: Option<&str>,
    source_paths: &[String],
) -> Result<Vec<ProjectFsEntry>, String> {
    let (_, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (parent_dir, parent_rel) = resolve_safe_subpath(&proj_dir, parent_rel_path.unwrap_or(""))?;
    if !parent_dir.is_dir() {
        return Err("目标目录不存在".to_string());
    }

    let mut imported = Vec::new();
    for raw_src in source_paths {
        let trimmed = raw_src.trim();
        if trimmed.is_empty() {
            continue;
        }
        let src_path = Path::new(trimmed);
        if !src_path.is_file() {
            return Err(format!("源文件不存在或不是文件: {trimmed}"));
        }
        let orig_name = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("imported_file");
        let clean_name = sanitize_fs_segment(orig_name);
        let safe_name = if clean_name.is_empty() {
            "imported_file".to_string()
        } else {
            clean_name
        };

        let stem = Path::new(&safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&safe_name)
            .to_string();
        let ext_part = Path::new(&safe_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();

        let mut dest_name = safe_name.clone();
        let mut idx = 1usize;
        while parent_dir.join(&dest_name).exists() {
            dest_name = format!("{stem} ({idx}){ext_part}");
            idx += 1;
        }

        let dest_rel = if parent_rel.is_empty() {
            dest_name
        } else {
            format!("{parent_rel}/{dest_name}")
        };
        let (dest_path, safe_rel) = resolve_safe_subpath(&proj_dir, &dest_rel)?;
        fs::copy(src_path, &dest_path)
            .map_err(|e| format!("复制文件 {trimmed} 失败: {e}"))?;
        imported.push(build_entry(&dest_path, safe_rel, None)?);
    }

    Ok(imported)
}

fn check_linked_child_project<'a>(
    projects: &'a [Project],
    project_id: &str,
    rel_path: &str,
) -> Option<&'a Project> {
    if rel_path.contains('/') || rel_path.is_empty() {
        return None;
    }
    projects.iter().find(|p| {
        p.parent_id.as_deref() == Some(project_id)
            && p.folder_name.eq_ignore_ascii_case(rel_path)
    })
}

pub fn project_fs_rename_in_root(
    root: &Path,
    project_id: &str,
    rel_path: &str,
    new_name: &str,
) -> Result<ProjectFsEntry, String> {
    let (projects, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (old_path, old_rel) = resolve_safe_subpath(&proj_dir, rel_path)?;
    if old_rel.is_empty() || !old_path.exists() {
        return Err(format!("文件或目录不存在: {rel_path}"));
    }
    if old_path.is_dir() {
        if let Some(child) = check_linked_child_project(&projects, project_id, &old_rel) {
            return Err(format!(
                "「{}」是子项目的专属目录，请在子项目卡片或侧边栏右键菜单中直接重命名该子项目",
                child.name
            ));
        }
    }

    let clean_new = sanitize_fs_segment(new_name);
    if clean_new.is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err("新名称无效或不能包含路径分隔符".to_string());
    }

    let parent_rel = old_rel
        .rsplit_once('/')
        .map(|(p, _)| p)
        .unwrap_or("");
    let new_rel = if parent_rel.is_empty() {
        clean_new.clone()
    } else {
        format!("{parent_rel}/{clean_new}")
    };
    let (new_path, safe_new_rel) = resolve_safe_subpath(&proj_dir, &new_rel)?;
    if new_path == old_path {
        return build_entry(&new_path, safe_new_rel, None);
    }
    if new_path.exists() {
        return Err(format!("目标名称已存在: {clean_new}"));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {e}"))?;
    build_entry(&new_path, safe_new_rel, None)
}

pub fn project_fs_delete_in_root(
    root: &Path,
    project_id: &str,
    rel_path: &str,
) -> Result<(), String> {
    let (projects, proj_dir) = ensure_project_root_dir(root, project_id)?;
    let (target_path, norm_rel) = resolve_safe_subpath(&proj_dir, rel_path)?;
    if norm_rel.is_empty() || !target_path.exists() {
        return Err(format!("文件或目录不存在: {rel_path}"));
    }
    if target_path.is_dir() {
        if let Some(child) = check_linked_child_project(&projects, project_id, &norm_rel) {
            return Err(format!(
                "「{}」是子项目的专属目录，请通过删除子项目来移除",
                child.name
            ));
        }
        fs::remove_dir_all(&target_path).map_err(|e| format!("删除文件夹失败: {e}"))?;
    } else {
        fs::remove_file(&target_path).map_err(|e| format!("删除文件失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn project_fs_list(
    app: AppHandle,
    project_id: String,
    rel_path: Option<String>,
) -> Result<ProjectFsListing, String> {
    let root = data_root_dir(&app)?;
    project_fs_list_in_root(&root, &project_id, rel_path.as_deref())
}

#[tauri::command]
pub fn project_fs_create_folder(
    app: AppHandle,
    project_id: String,
    parent_rel_path: Option<String>,
    folder_name: String,
) -> Result<ProjectFsEntry, String> {
    let root = data_root_dir(&app)?;
    project_fs_create_folder_in_root(&root, &project_id, parent_rel_path.as_deref(), &folder_name)
}

#[tauri::command]
pub fn project_fs_create_file(
    app: AppHandle,
    project_id: String,
    parent_rel_path: Option<String>,
    file_name: String,
    content: Option<String>,
) -> Result<ProjectFsEntry, String> {
    let root = data_root_dir(&app)?;
    project_fs_create_file_in_root(
        &root,
        &project_id,
        parent_rel_path.as_deref(),
        &file_name,
        content.as_deref(),
    )
}

#[tauri::command]
pub fn project_fs_read_file(
    app: AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<String, String> {
    let root = data_root_dir(&app)?;
    project_fs_read_file_in_root(&root, &project_id, &rel_path)
}

#[tauri::command]
pub fn project_fs_write_file(
    app: AppHandle,
    project_id: String,
    rel_path: String,
    content: String,
) -> Result<ProjectFsEntry, String> {
    let root = data_root_dir(&app)?;
    project_fs_write_file_in_root(&root, &project_id, &rel_path, &content)
}

#[tauri::command]
pub fn project_fs_import_files(
    app: AppHandle,
    project_id: String,
    parent_rel_path: Option<String>,
    source_paths: Vec<String>,
) -> Result<Vec<ProjectFsEntry>, String> {
    let root = data_root_dir(&app)?;
    project_fs_import_files_in_root(
        &root,
        &project_id,
        parent_rel_path.as_deref(),
        &source_paths,
    )
}

#[tauri::command]
pub fn project_fs_rename(
    app: AppHandle,
    project_id: String,
    rel_path: String,
    new_name: String,
) -> Result<ProjectFsEntry, String> {
    let root = data_root_dir(&app)?;
    project_fs_rename_in_root(&root, &project_id, &rel_path, &new_name)
}

#[tauri::command]
pub fn project_fs_delete(
    app: AppHandle,
    project_id: String,
    rel_path: String,
) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    project_fs_delete_in_root(&root, &project_id, &rel_path)
}

#[tauri::command]
pub fn project_fs_open(
    app: AppHandle,
    project_id: String,
    rel_path: Option<String>,
) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let (_, proj_dir) = ensure_project_root_dir(&root, &project_id)?;
    let (target_path, _) = resolve_safe_subpath(&proj_dir, rel_path.as_deref().unwrap_or(""))?;
    if !target_path.exists() {
        return Err(format!("路径不存在: {}", target_path.display()));
    }
    app.opener()
        .open_path(target_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开本地路径失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{create_project_in_root, CreateProjectInput};
    use tempfile::tempdir;

    #[test]
    fn test_project_fs_folders_files_import_rename_delete_and_security() {
        let dir = tempdir().unwrap();

        // Create parent "工作总结" and child sub-project "季度复盘"
        let parent = create_project_in_root(
            dir.path(),
            CreateProjectInput {
                name: "工作总结".into(),
                kind: "work".into(),
                icon: String::new(),
                color: String::new(),
                parent_id: None,
            },
        )
        .unwrap();

        let child = create_project_in_root(
            dir.path(),
            CreateProjectInput {
                name: "季度复盘".into(),
                kind: String::new(),
                icon: String::new(),
                color: String::new(),
                parent_id: Some(parent.id.clone()),
            },
        )
        .unwrap();

        // 1. Nested folders (multi-level input)
        let nested_dir =
            project_fs_create_folder_in_root(dir.path(), &parent.id, None, "2026年/Q4").unwrap();
        assert_eq!(nested_dir.rel_path, "2026年/Q4");
        assert!(nested_dir.is_dir);

        // 2. Create, read, and write Markdown document (auto-appends .md)
        let md_entry =
            project_fs_create_file_in_root(dir.path(), &parent.id, Some("2026年/Q4"), "年终总结", None)
                .unwrap();
        assert_eq!(md_entry.name, "年终总结.md");
        assert!(md_entry.is_text_editable);

        let initial_txt =
            project_fs_read_file_in_root(dir.path(), &parent.id, &md_entry.rel_path).unwrap();
        assert!(initial_txt.contains("# 年终总结"));

        project_fs_write_file_in_root(
            dir.path(),
            &parent.id,
            &md_entry.rel_path,
            "# 年终总结\n- 核心产出\n",
        )
        .unwrap();
        let edited_txt =
            project_fs_read_file_in_root(dir.path(), &parent.id, &md_entry.rel_path).unwrap();
        assert!(edited_txt.contains("核心产出"));

        // 3. Import external file twice -> collision-safe auto-renaming
        let ext_src = dir.path().join("external_notes.txt");
        fs::write(&ext_src, "hello import").unwrap();
        let imp1 = project_fs_import_files_in_root(
            dir.path(),
            &parent.id,
            Some("2026年/Q4"),
            &[ext_src.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(imp1[0].name, "external_notes.txt");

        let imp2 = project_fs_import_files_in_root(
            dir.path(),
            &parent.id,
            Some("2026年/Q4"),
            &[ext_src.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(imp2[0].name, "external_notes (1).txt");

        // 4. Listing at project root marks child sub-project folder with linkedProjectId
        let root_listing = project_fs_list_in_root(dir.path(), &parent.id, None).unwrap();
        let linked = root_listing
            .entries
            .iter()
            .find(|e| e.name == "季度复盘")
            .expect("child subproject folder visible");
        assert_eq!(linked.linked_project_id.as_deref(), Some(child.id.as_str()));

        // Guard: linked sub-project folder cannot be renamed or deleted via raw FS commands
        assert!(project_fs_rename_in_root(dir.path(), &parent.id, "季度复盘", "改名").is_err());
        assert!(project_fs_delete_in_root(dir.path(), &parent.id, "季度复盘").is_err());

        // 5. Rename and delete normal file & folder
        let renamed = project_fs_rename_in_root(
            dir.path(),
            &parent.id,
            &imp2[0].rel_path,
            "external_notes_v2.txt",
        )
        .unwrap();
        assert_eq!(renamed.name, "external_notes_v2.txt");

        project_fs_delete_in_root(dir.path(), &parent.id, &renamed.rel_path).unwrap();
        project_fs_delete_in_root(dir.path(), &parent.id, "2026年").unwrap();
        let after_listing = project_fs_list_in_root(dir.path(), &parent.id, None).unwrap();
        assert!(!after_listing.entries.iter().any(|e| e.name == "2026年"));

        // 6. Path traversal strictly rejected
        assert!(project_fs_list_in_root(dir.path(), &parent.id, Some("../工作")).is_err());
        assert!(project_fs_create_folder_in_root(dir.path(), &parent.id, Some("a/../../b"), "x").is_err());
        assert!(project_fs_read_file_in_root(dir.path(), &parent.id, "C:\\Windows\\win.ini").is_err());
    }
}
