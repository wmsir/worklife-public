use chrono::{DateTime, Datelike, Local, NaiveDateTime, Timelike};
use crc32fast::Hasher as CrcHasher;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::settings::data_root_dir;
use crate::sidecar::emit_app_log;
use crate::store::{atomic_write_json, atomic_write_json_unlocked, meta_dir, now_iso, FILE_LOCK};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static AUTO_BACKUP_BUSY: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTask {
    pub id: String,
    pub name: String,
    pub source_dir: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_mode")]
    pub mode: String, // "mirror" | "zip"
    #[serde(default = "default_target_type")]
    pub target_type: String, // "local_sync" | "webdav"
    #[serde(default)]
    pub local_target_dir: String,
    #[serde(default)]
    pub webdav_url: String,
    #[serde(default)]
    pub webdav_user: String,
    #[serde(default)]
    pub webdav_pass: String,
    #[serde(default)]
    pub webdav_remote_dir: String,
    #[serde(default = "default_excludes")]
    pub exclude_patterns: Vec<String>,
    #[serde(default = "default_keep_versions")]
    pub keep_versions: u32,
    #[serde(default)]
    pub auto_interval_minutes: u32,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub last_summary: Option<String>,
}

fn default_mode() -> String {
    "zip".to_string()
}

fn default_target_type() -> String {
    "local_sync".to_string()
}

fn default_excludes() -> Vec<String> {
    vec![
        "node_modules".to_string(),
        ".git".to_string(),
        "target".to_string(),
        "*.tmp".to_string(),
        "Thumbs.db".to_string(),
        ".DS_Store".to_string(),
    ]
}

fn default_keep_versions() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub started_at: String,
    pub finished_at: String,
    pub mode: String,
    pub target_type: String,
    pub status: String, // "success" | "failed"
    pub files_copied: usize,
    pub files_skipped: usize,
    pub total_bytes: u64,
    pub artifact_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    #[serde(default)]
    pub tasks: Vec<BackupTask>,
    #[serde(default)]
    pub history: Vec<BackupRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub task_id: String,
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

fn backup_config_path(root: &Path) -> PathBuf {
    meta_dir(root).join("backup.json")
}

fn webdav_state_path(root: &Path, task_id: &str) -> PathBuf {
    meta_dir(root).join(format!("webdav_state_{}.json", safe_task_name(task_id)))
}

fn seed_backup_config() -> BackupConfig {
    BackupConfig {
        tasks: vec![BackupTask {
            id: "backup-lifework-all".to_string(),
            name: "LifeWork 全部数据".to_string(),
            source_dir: "$DATA_ROOT".to_string(),
            enabled: false,
            mode: "zip".to_string(),
            target_type: "local_sync".to_string(),
            local_target_dir: String::new(),
            webdav_url: String::new(),
            webdav_user: String::new(),
            webdav_pass: String::new(),
            webdav_remote_dir: "LifeWorkBackups".to_string(),
            exclude_patterns: default_excludes(),
            keep_versions: 10,
            auto_interval_minutes: 0,
            last_run_at: None,
            last_status: None,
            last_summary: None,
        }],
        history: Vec::new(),
    }
}

pub fn load_backup_config_from_root(root: &Path) -> Result<BackupConfig, String> {
    let path = backup_config_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let seeded = seed_backup_config();
        atomic_write_json_unlocked(&path, &seeded)?;
        return Ok(seeded);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取备份配置失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析备份配置失败: {e}"))
}

pub fn save_backup_config_to_root(root: &Path, cfg: &BackupConfig) -> Result<(), String> {
    atomic_write_json(&backup_config_path(root), cfg)
}

pub fn resolve_source_dir(raw: &str, data_root: &Path) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "$DATA_ROOT" {
        data_root.to_path_buf()
    } else {
        PathBuf::from(trimmed)
    }
}

pub fn safe_task_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || c.is_control()
                || c.is_whitespace()
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "backup".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn match_pattern(candidate: &str, pattern: &str) -> bool {
    let c = candidate.to_lowercase();
    let p = pattern.trim().to_lowercase();
    if p.is_empty() {
        return false;
    }
    if let Some(suffix) = p.strip_prefix('*') {
        return c.ends_with(suffix);
    }
    if let Some(prefix) = p.strip_suffix('*') {
        return c.starts_with(prefix);
    }
    c == p
}

pub fn should_exclude(rel_path: &Path, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }
    for comp in rel_path.components() {
        if let Component::Normal(os) = comp {
            let s = os.to_string_lossy();
            for pat in patterns {
                if match_pattern(&s, pat) {
                    return true;
                }
            }
        }
    }
    let full_slash = rel_path
        .components()
        .filter_map(|c| match c {
            Component::Normal(os) => Some(os.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    for pat in patterns {
        if match_pattern(&full_slash, pat) {
            return true;
        }
    }
    false
}

fn canonicalize_loose(path: &Path) -> PathBuf {
    if let Ok(c) = fs::canonicalize(path) {
        return c;
    }
    let mut missing = Vec::new();
    let mut cur = path;
    while !cur.exists() {
        if let Some(name) = cur.file_name() {
            missing.push(name.to_os_string());
        }
        match cur.parent() {
            Some(parent) => cur = parent,
            None => break,
        }
    }
    let mut base = fs::canonicalize(cur).unwrap_or_else(|_| cur.to_path_buf());
    for part in missing.into_iter().rev() {
        base.push(part);
    }
    base
}

pub fn ensure_not_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    let s = canonicalize_loose(src);
    let d = canonicalize_loose(dst);
    if d == s || d.starts_with(&s) {
        return Err(format!(
            "目标目录 ({}) 不能等于或位于源文件夹 ({}) 内部，防止无限递归备份",
            dst.display(),
            src.display()
        ));
    }
    Ok(())
}

fn dos_datetime_from_system_time(st: SystemTime) -> (u16, u16) {
    let dt: DateTime<Local> = DateTime::from(st);
    let year = dt.year().clamp(1980, 2107) as u16;
    let dos_date = ((year - 1980) << 9) | ((dt.month() as u16) << 5) | (dt.day() as u16);
    let dos_time =
        ((dt.hour() as u16) << 11) | ((dt.minute() as u16) << 5) | ((dt.second() as u16) / 2);
    (dos_time, dos_date)
}

struct ZipCdEntry {
    name_bytes: Vec<u8>,
    crc32: u32,
    comp_size: u32,
    uncomp_size: u32,
    dos_time: u16,
    dos_date: u16,
    lfh_offset: u32,
}

const MAX_ZIP32_BYTES: u64 = 3_800_000_000;

pub fn create_zip_from_dir<F>(
    src: &Path,
    zip_path: &Path,
    excludes: &[String],
    mut on_progress: F,
) -> Result<(usize, usize, u64), String>
where
    F: FnMut(usize, usize, &str),
{
    if !src.is_dir() {
        return Err(format!("源目录不存在或不是文件夹: {}", src.display()));
    }
    if let Some(parent) = zip_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目标目录失败 {}: {e}", parent.display()))?;
    }

    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut skipped_count = 0usize;
    let mut planned_raw_bytes = 0u64;

    let mut it = WalkDir::new(src).into_iter();
    while let Some(res) = it.next() {
        let entry = match res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path == src {
            continue;
        }
        let Ok(rel) = path.strip_prefix(src) else {
            continue;
        };
        if should_exclude(rel, excludes) {
            if entry.file_type().is_dir() {
                it.skip_current_dir();
            } else {
                skipped_count += 1;
            }
            continue;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                planned_raw_bytes = planned_raw_bytes.saturating_add(meta.len());
                if planned_raw_bytes > MAX_ZIP32_BYTES {
                    return Err(
                        "待打包文件总大小超过 3.8 GB，请改用「增量镜像同步」模式或通过排除规则过滤大目录"
                            .to_string(),
                    );
                }
            }
            let slash_name = rel
                .components()
                .filter_map(|c| match c {
                    Component::Normal(os) => Some(os.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/");
            files.push((path.to_path_buf(), slash_name));
        }
    }

    let tmp_zip = PathBuf::from(format!("{}.tmp", zip_path.to_string_lossy()));
    let write_res = (|| -> Result<(usize, usize, u64), String> {
        let out_file = File::create(&tmp_zip)
            .map_err(|e| format!("创建临时压缩包失败 {}: {e}", tmp_zip.display()))?;
        let mut w = BufWriter::new(out_file);
        let mut cd_entries: Vec<ZipCdEntry> = Vec::with_capacity(files.len());
        let mut total_uncomp = 0u64;
        let total_files = files.len();

        for (idx, (fpath, rel_name)) in files.iter().enumerate() {
            on_progress(idx + 1, total_files, rel_name);
            let meta = fs::metadata(fpath)
                .map_err(|e| format!("读取文件元数据失败 {}: {e}", fpath.display()))?;
            let mtime = meta.modified().unwrap_or(SystemTime::now());
            let (dos_time, dos_date) = dos_datetime_from_system_time(mtime);
            let name_bytes = rel_name.as_bytes().to_vec();
            let name_len = u16::try_from(name_bytes.len())
                .map_err(|_| format!("文件名过长，无法写入 ZIP: {rel_name}"))?;

            let lfh_pos = w.stream_position().map_err(|e| format!("ZIP 定位失败: {e}"))?;
            let lfh_offset = u32::try_from(lfh_pos)
                .map_err(|_| "ZIP 体积超过 4GB 上限，请改用增量镜像同步模式".to_string())?;

            // Local File Header (30 bytes)
            w.write_all(&0x0403_4b50u32.to_le_bytes())
                .and_then(|_| w.write_all(&20u16.to_le_bytes())) // version needed 2.0
                .and_then(|_| w.write_all(&0x0800u16.to_le_bytes())) // UTF-8 filename flag
                .and_then(|_| w.write_all(&8u16.to_le_bytes())) // DEFLATE
                .and_then(|_| w.write_all(&dos_time.to_le_bytes()))
                .and_then(|_| w.write_all(&dos_date.to_le_bytes()))
                .and_then(|_| w.write_all(&0u32.to_le_bytes())) // crc placeholder
                .and_then(|_| w.write_all(&0u32.to_le_bytes())) // comp size placeholder
                .and_then(|_| w.write_all(&0u32.to_le_bytes())) // uncomp size placeholder
                .and_then(|_| w.write_all(&name_len.to_le_bytes()))
                .and_then(|_| w.write_all(&0u16.to_le_bytes())) // extra len
                .and_then(|_| w.write_all(&name_bytes))
                .map_err(|e| format!("写入 ZIP 文件头失败: {e}"))?;

            let data_start = w.stream_position().map_err(|e| format!("ZIP 定位失败: {e}"))?;
            w.flush().map_err(|e| format!("ZIP 刷新失败: {e}"))?;

            let mut reader = BufReader::new(
                File::open(fpath).map_err(|e| format!("打开源文件失败 {}: {e}", fpath.display()))?,
            );
            let mut crc_hasher = CrcHasher::new();
            let mut uncomp_u64 = 0u64;
            let mut buf = [0u8; 65536];

            let mut enc = DeflateEncoder::new(&mut w, Compression::default());
            loop {
                let n = reader
                    .read(&mut buf)
                    .map_err(|e| format!("读取源文件失败 {}: {e}", fpath.display()))?;
                if n == 0 {
                    break;
                }
                crc_hasher.update(&buf[..n]);
                uncomp_u64 = uncomp_u64.saturating_add(n as u64);
                enc.write_all(&buf[..n])
                    .map_err(|e| format!("压缩文件失败 {rel_name}: {e}"))?;
            }
            enc.finish()
                .map_err(|e| format!("完成压缩流失败 {rel_name}: {e}"))?;
            w.flush().map_err(|e| format!("ZIP 刷新失败: {e}"))?;

            let data_end = w.stream_position().map_err(|e| format!("ZIP 定位失败: {e}"))?;
            let comp_size = u32::try_from(data_end - data_start)
                .map_err(|_| "单个压缩文件超过 4GB 上限".to_string())?;
            let uncomp_size = u32::try_from(uncomp_u64)
                .map_err(|_| "单个源文件超过 4GB 上限".to_string())?;
            let crc32 = crc_hasher.finalize();

            // Backpatch CRC32 + sizes into Local File Header
            w.seek(SeekFrom::Start(lfh_pos + 14))
                .and_then(|_| w.write_all(&crc32.to_le_bytes()))
                .and_then(|_| w.write_all(&comp_size.to_le_bytes()))
                .and_then(|_| w.write_all(&uncomp_size.to_le_bytes()))
                .and_then(|_| w.seek(SeekFrom::Start(data_end)))
                .map_err(|e| format!("回填 ZIP 头校验信息失败: {e}"))?;

            total_uncomp = total_uncomp.saturating_add(uncomp_u64);
            cd_entries.push(ZipCdEntry {
                name_bytes,
                crc32,
                comp_size,
                uncomp_size,
                dos_time,
                dos_date,
                lfh_offset,
            });
        }

        let cd_offset_pos = w.stream_position().map_err(|e| format!("ZIP 定位失败: {e}"))?;
        let cd_offset = u32::try_from(cd_offset_pos)
            .map_err(|_| "ZIP 中央目录偏移超过 4GB 上限".to_string())?;

        for item in &cd_entries {
            let name_len = item.name_bytes.len() as u16;
            w.write_all(&0x0201_4b50u32.to_le_bytes())
                .and_then(|_| w.write_all(&20u16.to_le_bytes())) // version made by
                .and_then(|_| w.write_all(&20u16.to_le_bytes())) // version needed
                .and_then(|_| w.write_all(&0x0800u16.to_le_bytes())) // UTF-8 flag
                .and_then(|_| w.write_all(&8u16.to_le_bytes())) // DEFLATE
                .and_then(|_| w.write_all(&item.dos_time.to_le_bytes()))
                .and_then(|_| w.write_all(&item.dos_date.to_le_bytes()))
                .and_then(|_| w.write_all(&item.crc32.to_le_bytes()))
                .and_then(|_| w.write_all(&item.comp_size.to_le_bytes()))
                .and_then(|_| w.write_all(&item.uncomp_size.to_le_bytes()))
                .and_then(|_| w.write_all(&name_len.to_le_bytes()))
                .and_then(|_| w.write_all(&0u16.to_le_bytes())) // extra
                .and_then(|_| w.write_all(&0u16.to_le_bytes())) // comment
                .and_then(|_| w.write_all(&0u16.to_le_bytes())) // disk start
                .and_then(|_| w.write_all(&0u16.to_le_bytes())) // internal attrs
                .and_then(|_| w.write_all(&0u32.to_le_bytes())) // external attrs
                .and_then(|_| w.write_all(&item.lfh_offset.to_le_bytes()))
                .and_then(|_| w.write_all(&item.name_bytes))
                .map_err(|e| format!("写入 ZIP 中央目录失败: {e}"))?;
        }

        let cd_end = w.stream_position().map_err(|e| format!("ZIP 定位失败: {e}"))?;
        let cd_size = u32::try_from(cd_end - cd_offset_pos)
            .map_err(|_| "ZIP 中央目录大小超过上限".to_string())?;
        let entry_cnt = u16::try_from(cd_entries.len())
            .map_err(|_| "文件数量超过 65535 个 ZIP32 限制".to_string())?;

        // EOCD (22 bytes)
        w.write_all(&0x0605_4b50u32.to_le_bytes())
            .and_then(|_| w.write_all(&0u16.to_le_bytes())) // disk num
            .and_then(|_| w.write_all(&0u16.to_le_bytes())) // cd disk
            .and_then(|_| w.write_all(&entry_cnt.to_le_bytes()))
            .and_then(|_| w.write_all(&entry_cnt.to_le_bytes()))
            .and_then(|_| w.write_all(&cd_size.to_le_bytes()))
            .and_then(|_| w.write_all(&cd_offset.to_le_bytes()))
            .and_then(|_| w.write_all(&0u16.to_le_bytes())) // comment len
            .map_err(|e| format!("写入 ZIP 结束标志失败: {e}"))?;

        w.flush().map_err(|e| format!("写入 ZIP 刷新失败: {e}"))?;
        drop(w);

        let zip_bytes = fs::metadata(&tmp_zip).map(|m| m.len()).unwrap_or(total_uncomp);
        Ok((files.len(), skipped_count, zip_bytes))
    })();

    match write_res {
        Ok(stats) => {
            if zip_path.exists() {
                let _ = fs::remove_file(zip_path);
            }
            fs::rename(&tmp_zip, zip_path).map_err(|e| {
                let _ = fs::remove_file(&tmp_zip);
                format!("保存 ZIP 快照失败 {}: {e}", zip_path.display())
            })?;
            Ok(stats)
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp_zip);
            Err(e)
        }
    }
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn mirror_local_dir<F>(
    src: &Path,
    dst: &Path,
    excludes: &[String],
    mut on_progress: F,
) -> Result<(usize, usize, u64), String>
where
    F: FnMut(usize, usize, &str),
{
    if !src.is_dir() {
        return Err(format!("源目录不存在或不是文件夹: {}", src.display()));
    }
    ensure_not_recursive(src, dst)?;
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败 {}: {e}", dst.display()))?;

    let mut files: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut skipped = 0usize;
    let mut it = WalkDir::new(src).into_iter();
    while let Some(res) = it.next() {
        let entry = match res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if p == src {
            continue;
        }
        let Ok(rel) = p.strip_prefix(src) else {
            continue;
        };
        if should_exclude(rel, excludes) {
            if entry.file_type().is_dir() {
                it.skip_current_dir();
            } else {
                skipped += 1;
            }
            continue;
        }
        if entry.file_type().is_file() {
            files.push((p.to_path_buf(), rel.to_path_buf()));
        }
    }

    let total = files.len();
    let mut copied = 0usize;
    let mut copied_bytes = 0u64;

    for (idx, (src_file, rel)) in files.iter().enumerate() {
        on_progress(idx + 1, total, &rel.to_string_lossy());
        let dst_file = dst.join(rel);
        let src_meta = fs::metadata(src_file)
            .map_err(|e| format!("读取源文件信息失败 {}: {e}", src_file.display()))?;
        let src_len = src_meta.len();
        let src_mt = mtime_secs(&src_meta);

        let unchanged = if let Ok(dst_meta) = fs::metadata(&dst_file) {
            dst_meta.is_file()
                && dst_meta.len() == src_len
                && (src_mt - mtime_secs(&dst_meta)).abs() <= 2
        } else {
            false
        };

        if unchanged {
            skipped += 1;
            continue;
        }

        if let Some(parent) = dst_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
        }
        fs::copy(src_file, &dst_file).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {e}",
                src_file.display(),
                dst_file.display()
            )
        })?;
        copied += 1;
        copied_bytes = copied_bytes.saturating_add(src_len);
    }

    Ok((copied, skipped, copied_bytes))
}

fn cleanup_local_zip_retention(dst: &Path, safe_prefix: &str, keep_versions: u32) -> usize {
    if keep_versions == 0 || !dst.is_dir() {
        return 0;
    }
    let prefix = format!("{safe_prefix}_");
    let mut zips: Vec<(String, PathBuf)> = fs::read_dir(dst)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".zip") && e.path().is_file() {
                Some((name, e.path()))
            } else {
                None
            }
        })
        .collect();
    zips.sort_by(|a, b| b.0.cmp(&a.0));
    let mut removed = 0;
    for (_, path) in zips.into_iter().skip(keep_versions as usize) {
        if fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub fn percent_encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.as_bytes() {
        let is_unreserved =
            b.is_ascii_alphanumeric() || matches!(*b, b'-' | b'_' | b'.' | b'~');
        if is_unreserved {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub fn split_webdav_segments(path_like: &str) -> Vec<String> {
    path_like
        .split(['/', '\\'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != ".")
        .map(|s| s.to_string())
        .collect()
}

pub fn build_webdav_url(
    base_url: &str,
    remote_dir: &str,
    rel_parts: &[&str],
) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty()
        || (!base.starts_with("http://") && !base.starts_with("https://"))
    {
        return Err("WebDAV 地址必须以 http:// 或 https:// 开头".to_string());
    }
    let mut url = base.to_string();
    for seg in split_webdav_segments(remote_dir) {
        url.push('/');
        url.push_str(&percent_encode_segment(&seg));
    }
    for part in rel_parts {
        for seg in split_webdav_segments(part) {
            url.push('/');
            url.push_str(&percent_encode_segment(&seg));
        }
    }
    Ok(url)
}

fn curl_bin() -> PathBuf {
    let win_curl = PathBuf::from(r"C:\Windows\System32\curl.exe");
    if win_curl.exists() {
        win_curl
    } else {
        PathBuf::from("curl.exe")
    }
}

fn curl_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\r' | '\n' => {}
            _ => out.push(c),
        }
    }
    out
}

fn run_curl(
    args: &[&str],
    user: &str,
    pass: &str,
    extra_config: &str,
) -> Result<(u16, String, String), String> {
    let mut cmd = Command::new(curl_bin());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.arg("--silent")
        .arg("--show-error")
        .arg("--config")
        .arg("-")
        .arg("--write-out")
        .arg("\n%{http_code}");
    for a in args {
        cmd.arg(a);
    }

    let mut cfg_text = String::new();
    if !user.trim().is_empty() || !pass.is_empty() {
        cfg_text.push_str(&format!(
            "user = \"{}:{}\"\n",
            curl_escape(user.trim()),
            curl_escape(pass)
        ));
    }
    if !extra_config.is_empty() {
        cfg_text.push_str(extra_config);
        if !extra_config.ends_with('\n') {
            cfg_text.push('\n');
        }
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动系统 curl.exe: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(cfg_text.as_bytes())
            .map_err(|e| format!("向 curl 传递配置失败: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待 curl 响应失败: {e}"))?;

    let stdout_raw = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_raw = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() && stdout_raw.trim().is_empty() {
        return Err(if stderr_raw.is_empty() {
            format!("curl 请求失败 (exit={:?})", output.status.code())
        } else {
            stderr_raw
        });
    }

    let trimmed = stdout_raw.trim_end_matches(&['\r', '\n'][..]);
    let (body, code_str) = match trimmed.rfind('\n') {
        Some(pos) => (&trimmed[..pos], trimmed[pos + 1..].trim()),
        None => ("", trimmed.trim()),
    };
    let status_code = code_str.parse::<u16>().unwrap_or(0);
    if !output.status.success() && status_code == 0 {
        return Err(if stderr_raw.is_empty() {
            "WebDAV 网络连接失败".to_string()
        } else {
            stderr_raw
        });
    }
    Ok((status_code, body.to_string(), stderr_raw))
}

fn webdav_propfind(
    url: &str,
    user: &str,
    pass: &str,
    depth: &str,
    timeout_secs: u32,
) -> Result<(u16, String), String> {
    let t_str = timeout_secs.to_string();
    let (code, body, err) = run_curl(
        &[
            "-X",
            "PROPFIND",
            "-H",
            &format!("Depth: {depth}"),
            "--connect-timeout",
            "15",
            "--max-time",
            &t_str,
            url,
        ],
        user,
        pass,
        "",
    )?;
    if code == 0 {
        return Err(if err.is_empty() {
            "WebDAV 连接失败".to_string()
        } else {
            err
        });
    }
    Ok((code, body))
}

pub fn webdav_ensure_dirs(
    base_url: &str,
    user: &str,
    pass: &str,
    dir_segments: &[String],
) -> Result<(), String> {
    let base = base_url.trim().trim_end_matches('/');
    let mut cur = base.to_string();
    for seg in dir_segments {
        cur.push('/');
        cur.push_str(&percent_encode_segment(seg));
        let (code, _, err) = run_curl(
            &[
                "-X",
                "MKCOL",
                "--connect-timeout",
                "15",
                "--max-time",
                "30",
                &cur,
            ],
            user,
            pass,
            "",
        )?;
        // 200/201=created, 204/301/405/409/403=already exists (some servers return 301/405/409 for existing dir)
        if !matches!(code, 200 | 201 | 204 | 301 | 405) {
            if code == 401 {
                return Err("WebDAV 认证失败 (401)，请检查用户名与应用密码".to_string());
            }
            if matches!(code, 403 | 409) {
                // Probe with PROPFIND Depth 0 in case server returns 403/409 on MKCOL for existing dir
                if let Ok((pcode, _)) = webdav_propfind(&cur, user, pass, "0", 15) {
                    if matches!(pcode, 200 | 207) {
                        continue;
                    }
                }
            }
            return Err(format!("WebDAV 创建目录失败 {cur} (HTTP {code}): {err}"));
        }
    }
    Ok(())
}

fn webdav_put_file(
    url: &str,
    user: &str,
    pass: &str,
    local_file: &Path,
) -> Result<(), String> {
    let path_str = curl_escape(&local_file.to_string_lossy().replace('\\', "/"));
    let extra = format!("upload-file = \"{path_str}\"\n");
    let (code, body, err) = run_curl(
        &[
            "-X",
            "PUT",
            "--connect-timeout",
            "15",
            "--max-time",
            "600",
            url,
        ],
        user,
        pass,
        &extra,
    )?;
    if !matches!(code, 200 | 201 | 204) {
        return Err(format!(
            "WebDAV 上传失败 (HTTP {code}): {} {}",
            err,
            body.chars().take(180).collect::<String>()
        ));
    }
    Ok(())
}

fn extract_href_filenames(xml: &str, safe_prefix: &str) -> Vec<String> {
    let lower = xml.to_lowercase();
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    let prefix = format!("{safe_prefix}_");

    let mut pos = 0usize;
    while let Some(lt) = lower[pos..].find('<') {
        let tag_start = pos + lt;
        let Some(gt_rel) = lower[tag_start..].find('>') else {
            break;
        };
        let tag_name = lower[tag_start + 1..tag_start + gt_rel].trim();
        let is_href_open =
            !tag_name.starts_with('/') && (tag_name == "href" || tag_name.ends_with(":href"));
        let content_start = tag_start + gt_rel + 1;
        if is_href_open {
            if let Some(close_rel) = lower[content_start..].find("</") {
                let raw_href = xml[content_start..content_start + close_rel].trim();
                let no_query = raw_href.split('?').next().unwrap_or(raw_href);
                let last_seg = no_query
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("");
                let decoded = percent_decode(last_seg);
                if decoded.starts_with(&prefix)
                    && decoded.ends_with(".zip")
                    && seen.insert(decoded.clone())
                {
                    results.push(decoded);
                }
                pos = content_start + close_rel;
                continue;
            }
        }
        pos = content_start;
    }
    results.sort_by(|a, b| b.cmp(a));
    results
}

fn webdav_cleanup_zip_retention(
    base_url: &str,
    user: &str,
    pass: &str,
    remote_dir: &str,
    safe_prefix: &str,
    keep_versions: u32,
) {
    if keep_versions == 0 {
        return;
    }
    let Ok(dir_url) = build_webdav_url(base_url, remote_dir, &[]) else {
        return;
    };
    let Ok((code, body)) = webdav_propfind(&dir_url, user, pass, "1", 30) else {
        return;
    };
    if !matches!(code, 200 | 207) {
        return;
    }
    let names = extract_href_filenames(&body, safe_prefix);
    for old_name in names.into_iter().skip(keep_versions as usize) {
        if let Ok(del_url) = build_webdav_url(base_url, remote_dir, &[&old_name]) {
            let _ = run_curl(
                &["-X", "DELETE", "--connect-timeout", "15", "--max-time", "30", &del_url],
                user,
                pass,
                "",
            );
        }
    }
}

pub fn test_webdav_connection_blocking(
    url: &str,
    user: &str,
    pass: &str,
    remote_dir: &str,
) -> Result<String, String> {
    let base_check = build_webdav_url(url, "", &[])?;
    let (code, _) = webdav_propfind(&base_check, user, pass, "0", 20)?;
    match code {
        401 => Err("认证失败 (HTTP 401)，请核对 WebDAV 账号与独立应用密码".to_string()),
        403 => Err("无访问权限 (HTTP 403)，请检查目录权限或应用授权".to_string()),
        404 => Err(format!("WebDAV 地址不存在 (HTTP 404): {base_check}")),
        200 | 207 => {
            if remote_dir.trim().is_empty() {
                Ok(format!("连接成功 (HTTP {code})"))
            } else {
                let sub_url = build_webdav_url(url, remote_dir, &[])?;
                match webdav_propfind(&sub_url, user, pass, "0", 20) {
                    Ok((200 | 207, _)) => Ok(format!(
                        "连接成功 (HTTP {code})，远端备份目录已就绪"
                    )),
                    Ok((404, _)) => Ok(format!(
                        "WebDAV 服务连接正常 (HTTP {code})，远端目录将在首次备份时自动创建"
                    )),
                    Ok((sc, _)) => Ok(format!(
                        "根服务连接正常 (HTTP {code})，子目录检查返回 HTTP {sc}"
                    )),
                    Err(e) => Err(e),
                }
            }
        }
        other => Err(format!("WebDAV 返回异常状态码 HTTP {other}")),
    }
}

fn mirror_webdav_dir<F>(
    data_root: &Path,
    task: &BackupTask,
    src: &Path,
    mut on_progress: F,
) -> Result<(usize, usize, u64), String>
where
    F: FnMut(usize, usize, &str),
{
    if !src.is_dir() {
        return Err(format!("源目录不存在或不是文件夹: {}", src.display()));
    }
    let state_file = webdav_state_path(data_root, &task.id);
    let mut state: HashMap<String, (u64, i64)> = if state_file.exists() {
        fs::read_to_string(&state_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    let mut files: Vec<(PathBuf, String, u64, i64)> = Vec::new();
    let mut skipped = 0usize;
    let mut it = WalkDir::new(src).into_iter();
    while let Some(res) = it.next() {
        let entry = match res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if p == src {
            continue;
        }
        let Ok(rel) = p.strip_prefix(src) else {
            continue;
        };
        if should_exclude(rel, &task.exclude_patterns) {
            if entry.file_type().is_dir() {
                it.skip_current_dir();
            } else {
                skipped += 1;
            }
            continue;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let rel_slash = rel
                    .components()
                    .filter_map(|c| match c {
                        Component::Normal(os) => Some(os.to_string_lossy().to_string()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("/");
                files.push((p.to_path_buf(), rel_slash, meta.len(), mtime_secs(&meta)));
            }
        }
    }

    let remote_base_segs = split_webdav_segments(&task.webdav_remote_dir);
    webdav_ensure_dirs(
        &task.webdav_url,
        &task.webdav_user,
        &task.webdav_pass,
        &remote_base_segs,
    )?;

    let mut ensured_dirs: HashSet<String> = HashSet::new();
    let mut copied = 0usize;
    let mut uploaded_bytes = 0u64;
    let total = files.len();

    for (idx, (fpath, rel_slash, len, mt)) in files.iter().enumerate() {
        on_progress(idx + 1, total, rel_slash);
        if state.get(rel_slash).copied() == Some((*len, *mt)) {
            skipped += 1;
            continue;
        }

        if let Some((parent_rel, _)) = rel_slash.rsplit_once('/') {
            if !parent_rel.is_empty() && ensured_dirs.insert(parent_rel.to_string()) {
                let mut segs = remote_base_segs.clone();
                segs.extend(split_webdav_segments(parent_rel));
                webdav_ensure_dirs(&task.webdav_url, &task.webdav_user, &task.webdav_pass, &segs)?;
            }
        }

        let put_url = build_webdav_url(&task.webdav_url, &task.webdav_remote_dir, &[rel_slash])?;
        webdav_put_file(&put_url, &task.webdav_user, &task.webdav_pass, fpath)?;
        state.insert(rel_slash.clone(), (*len, *mt));
        copied += 1;
        uploaded_bytes = uploaded_bytes.saturating_add(*len);
    }

    let _ = atomic_write_json(&state_file, &state);
    Ok((copied, skipped, uploaded_bytes))
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_048_576 {
        format!("{:.2} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn emit_progress(
    app: &AppHandle,
    task_id: &str,
    phase: &str,
    current: usize,
    total: usize,
    current_file: &str,
) {
    let _ = app.emit(
        "backup-progress",
        BackupProgress {
            task_id: task_id.to_string(),
            phase: phase.to_string(),
            current,
            total,
            current_file: current_file.to_string(),
        },
    );
}

fn execute_backup_blocking(
    app: Option<&AppHandle>,
    data_root: &Path,
    task: &BackupTask,
) -> BackupRecord {
    let started_at = now_iso();
    let src = resolve_source_dir(&task.source_dir, data_root);
    let stamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safe_prefix = safe_task_name(&task.name);

    let outcome: Result<(usize, usize, u64, String, String), String> = (|| {
        if task.source_dir.trim().is_empty() {
            return Err("未配置源文件夹路径".to_string());
        }
        if !src.is_dir() {
            return Err(format!("源文件夹不存在: {}", src.display()));
        }

        match (task.target_type.as_str(), task.mode.as_str()) {
            ("local_sync", "zip") => {
                let dst = Path::new(task.local_target_dir.trim());
                if task.local_target_dir.trim().is_empty() {
                    return Err("未配置本地网盘同步目标目录".to_string());
                }
                ensure_not_recursive(&src, dst)?;
                let artifact = format!("{safe_prefix}_{stamp}.zip");
                let zip_path = dst.join(&artifact);
                let (copied, skipped, bytes) =
                    create_zip_from_dir(&src, &zip_path, &task.exclude_patterns, |cur, tot, f| {
                        if let Some(ah) = app {
                            emit_progress(ah, &task.id, "正在打包压缩", cur, tot, f);
                        }
                    })?;
                let pruned = cleanup_local_zip_retention(dst, &safe_prefix, task.keep_versions);
                let extra = if pruned > 0 {
                    format!("（已自动清理 {pruned} 份旧版本）")
                } else {
                    String::new()
                };
                let msg = format!(
                    "已生成快照 {artifact}（包含 {copied} 个文件，{}）{extra}",
                    format_bytes(bytes)
                );
                Ok((copied, skipped, bytes, artifact, msg))
            }
            ("local_sync", "mirror") => {
                let dst = Path::new(task.local_target_dir.trim());
                if task.local_target_dir.trim().is_empty() {
                    return Err("未配置本地网盘同步目标目录".to_string());
                }
                let (copied, skipped, bytes) =
                    mirror_local_dir(&src, dst, &task.exclude_patterns, |cur, tot, f| {
                        if let Some(ah) = app {
                            emit_progress(ah, &task.id, "正在增量同步", cur, tot, f);
                        }
                    })?;
                let msg = format!(
                    "同步完成：新增/更新 {copied} 个文件（{}），跳过未变更/排除 {skipped} 项",
                    format_bytes(bytes)
                );
                Ok((copied, skipped, bytes, dst.to_string_lossy().to_string(), msg))
            }
            ("webdav", "zip") => {
                if task.webdav_url.trim().is_empty() {
                    return Err("未配置 WebDAV 服务地址".to_string());
                }
                let artifact = format!("{safe_prefix}_{stamp}.zip");
                let tmp_zip =
                    std::env::temp_dir().join(format!("lw-backup-{}.zip", Uuid::new_v4()));
                let zip_res =
                    create_zip_from_dir(&src, &tmp_zip, &task.exclude_patterns, |cur, tot, f| {
                        if let Some(ah) = app {
                            emit_progress(ah, &task.id, "正在打包压缩", cur, tot, f);
                        }
                    });
                let (copied, skipped, bytes) = match zip_res {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = fs::remove_file(&tmp_zip);
                        return Err(e);
                    }
                };

                if let Some(ah) = app {
                    emit_progress(ah, &task.id, "正在上传 WebDAV", 1, 1, &artifact);
                }
                let upload_res = (|| -> Result<(), String> {
                    let dirs = split_webdav_segments(&task.webdav_remote_dir);
                    webdav_ensure_dirs(
                        &task.webdav_url,
                        &task.webdav_user,
                        &task.webdav_pass,
                        &dirs,
                    )?;
                    let put_url = build_webdav_url(
                        &task.webdav_url,
                        &task.webdav_remote_dir,
                        &[&artifact],
                    )?;
                    webdav_put_file(&put_url, &task.webdav_user, &task.webdav_pass, &tmp_zip)?;
                    Ok(())
                })();
                let _ = fs::remove_file(&tmp_zip);
                upload_res?;

                webdav_cleanup_zip_retention(
                    &task.webdav_url,
                    &task.webdav_user,
                    &task.webdav_pass,
                    &task.webdav_remote_dir,
                    &safe_prefix,
                    task.keep_versions,
                );
                let msg = format!(
                    "已上传 WebDAV 快照 {artifact}（包含 {copied} 个文件，{}）",
                    format_bytes(bytes)
                );
                Ok((copied, skipped, bytes, artifact, msg))
            }
            ("webdav", "mirror") => {
                if task.webdav_url.trim().is_empty() {
                    return Err("未配置 WebDAV 服务地址".to_string());
                }
                let (copied, skipped, bytes) =
                    mirror_webdav_dir(data_root, task, &src, |cur, tot, f| {
                        if let Some(ah) = app {
                            emit_progress(ah, &task.id, "正在增量上传 WebDAV", cur, tot, f);
                        }
                    })?;
                let msg = format!(
                    "WebDAV 增量同步完成：上传 {copied} 个文件（{}），跳过 {skipped} 项",
                    format_bytes(bytes)
                );
                Ok((copied, skipped, bytes, task.webdav_remote_dir.clone(), msg))
            }
            (tt, m) => Err(format!("不支持的备份组合: targetType={tt}, mode={m}")),
        }
    })();

    let finished_at = now_iso();
    match outcome {
        Ok((files_copied, files_skipped, total_bytes, artifact_name, message)) => BackupRecord {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            started_at,
            finished_at,
            mode: task.mode.clone(),
            target_type: task.target_type.clone(),
            status: "success".to_string(),
            files_copied,
            files_skipped,
            total_bytes,
            artifact_name,
            message,
        },
        Err(err) => BackupRecord {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            task_name: task.name.clone(),
            started_at,
            finished_at,
            mode: task.mode.clone(),
            target_type: task.target_type.clone(),
            status: "failed".to_string(),
            files_copied: 0,
            files_skipped: 0,
            total_bytes: 0,
            artifact_name: String::new(),
            message: err,
        },
    }
}

#[tauri::command]
pub fn get_backup_config(app: AppHandle) -> Result<BackupConfig, String> {
    let root = data_root_dir(&app)?;
    load_backup_config_from_root(&root)
}

#[tauri::command]
pub fn upsert_backup_task(app: AppHandle, mut task: BackupTask) -> Result<BackupConfig, String> {
    if task.name.trim().is_empty() {
        return Err("备份任务名称不能为空".to_string());
    }
    task.name = task.name.trim().to_string();
    task.source_dir = task.source_dir.trim().to_string();
    task.local_target_dir = task.local_target_dir.trim().to_string();
    task.webdav_url = task.webdav_url.trim().to_string();
    task.webdav_user = task.webdav_user.trim().to_string();
    task.webdav_remote_dir = task.webdav_remote_dir.trim().to_string();
    task.exclude_patterns = task
        .exclude_patterns
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let root = data_root_dir(&app)?;
    let mut cfg = load_backup_config_from_root(&root)?;
    if task.id.trim().is_empty() {
        task.id = Uuid::new_v4().to_string();
        cfg.tasks.push(task);
    } else if let Some(pos) = cfg.tasks.iter().position(|t| t.id == task.id) {
        // Preserve runtime status fields when editing settings
        task.last_run_at = cfg.tasks[pos].last_run_at.clone();
        task.last_status = cfg.tasks[pos].last_status.clone();
        task.last_summary = cfg.tasks[pos].last_summary.clone();
        cfg.tasks[pos] = task;
    } else {
        cfg.tasks.push(task);
    }
    save_backup_config_to_root(&root, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn delete_backup_task(app: AppHandle, id: String) -> Result<BackupConfig, String> {
    let root = data_root_dir(&app)?;
    let mut cfg = load_backup_config_from_root(&root)?;
    let before = cfg.tasks.len();
    cfg.tasks.retain(|t| t.id != id);
    if cfg.tasks.len() == before {
        return Err(format!("未找到备份任务: {id}"));
    }
    save_backup_config_to_root(&root, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn clear_backup_history(app: AppHandle) -> Result<BackupConfig, String> {
    let root = data_root_dir(&app)?;
    let mut cfg = load_backup_config_from_root(&root)?;
    cfg.history.clear();
    save_backup_config_to_root(&root, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub async fn test_webdav_connection(
    url: String,
    user: String,
    pass: String,
    remote_dir: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        test_webdav_connection_blocking(&url, &user, &pass, &remote_dir)
    })
    .await
    .map_err(|e| format!("测试任务异常: {e}"))?
}

async fn run_single_backup_inner(app: AppHandle, id: String) -> Result<BackupRecord, String> {
    let root = data_root_dir(&app)?;
    let cfg = load_backup_config_from_root(&root)?;
    let task = cfg
        .tasks
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("未找到备份任务: {id}"))?;

    emit_app_log(&app, format!("☁️ [网盘备份] 开始执行任务「{}」...", task.name));
    let app_clone = app.clone();
    let root_clone = root.clone();
    let record = tokio::task::spawn_blocking(move || {
        execute_backup_blocking(Some(&app_clone), &root_clone, &task)
    })
    .await
    .map_err(|e| format!("备份线程异常: {e}"))?;

    let mut fresh_cfg = load_backup_config_from_root(&root)?;
    if let Some(t) = fresh_cfg.tasks.iter_mut().find(|t| t.id == id) {
        t.last_run_at = Some(record.finished_at.clone());
        t.last_status = Some(record.status.clone());
        t.last_summary = Some(record.message.clone());
    }
    fresh_cfg.history.insert(0, record.clone());
    if fresh_cfg.history.len() > 100 {
        fresh_cfg.history.truncate(100);
    }
    save_backup_config_to_root(&root, &fresh_cfg)?;

    let log_prefix = if record.status == "success" {
        "✅"
    } else {
        "❌"
    };
    emit_app_log(
        &app,
        format!("{log_prefix} [网盘备份] {}: {}", record.task_name, record.message),
    );
    let _ = app.emit("backup-done", &record);
    Ok(record)
}

#[tauri::command]
pub async fn run_backup_task(app: AppHandle, id: String) -> Result<BackupRecord, String> {
    run_single_backup_inner(app, id).await
}

#[tauri::command]
pub fn open_local_path(app: AppHandle, path: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let resolved = resolve_source_dir(&path, &root);
    fs::create_dir_all(&resolved)
        .map_err(|e| format!("目录不存在且无法创建 {}: {e}", resolved.display()))?;
    app.opener()
        .open_path(resolved.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开目录失败: {e}"))
}

fn task_is_due(task: &BackupTask, now: NaiveDateTime) -> bool {
    if !task.enabled || task.auto_interval_minutes == 0 {
        return false;
    }
    let Some(last_str) = &task.last_run_at else {
        return true;
    };
    let Ok(last_dt) = NaiveDateTime::parse_from_str(last_str, "%Y-%m-%dT%H:%M:%S") else {
        return true;
    };
    let elapsed_mins = (now - last_dt).num_minutes();
    elapsed_mins >= task.auto_interval_minutes as i64
}

pub async fn tick_auto_backups(app: AppHandle) {
    if AUTO_BACKUP_BUSY
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let due_ids: Vec<String> = match data_root_dir(&app).and_then(|r| load_backup_config_from_root(&r)) {
        Ok(cfg) => {
            let now = Local::now().naive_local();
            cfg.tasks
                .into_iter()
                .filter(|t| task_is_due(t, now))
                .map(|t| t.id)
                .collect()
        }
        Err(_) => Vec::new(),
    };

    for id in due_ids {
        let _ = run_single_backup_inner(app.clone(), id).await;
    }

    AUTO_BACKUP_BUSY.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    #[test]
    fn test_percent_encode_utf8_chinese() {
        assert_eq!(percent_encode_segment("abc-123_~.zip"), "abc-123_~.zip");
        assert_eq!(percent_encode_segment("测试"), "%E6%B5%8B%E8%AF%95");
        let url = build_webdav_url(
            "https://dav.jianguoyun.com/dav/",
            "/我的备份/生活/",
            &["快照 1.zip"],
        )
        .unwrap();
        assert_eq!(
            url,
            "https://dav.jianguoyun.com/dav/%E6%88%91%E7%9A%84%E5%A4%87%E4%BB%BD/%E7%94%9F%E6%B4%BB/%E5%BF%AB%E7%85%A7%201.zip"
        );
    }

    #[test]
    fn test_mirror_backup_incremental_and_excludes() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir_all(src.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(src.join("docs")).unwrap();
        fs::write(src.join("node_modules/pkg/index.js"), "ignored").unwrap();
        fs::write(src.join("temp.tmp"), "ignored tmp").unwrap();
        fs::write(src.join("docs/笔记.md"), "hello v1").unwrap();

        let excludes = default_excludes();
        let (c1, s1, _) = mirror_local_dir(&src, &dst, &excludes, |_, _, _| {}).unwrap();
        assert_eq!(c1, 1);
        assert_eq!(s1, 1);
        assert!(dst.join("docs/笔记.md").exists());
        assert!(!dst.join("node_modules").exists());
        assert!(!dst.join("temp.tmp").exists());

        // Second run: unchanged file should be skipped
        let (c2, s2, b2) = mirror_local_dir(&src, &dst, &excludes, |_, _, _| {}).unwrap();
        assert_eq!(c2, 0);
        assert_eq!(s2, 2);
        assert_eq!(b2, 0);

        // Edit file length -> third run copies changed file
        fs::write(src.join("docs/笔记.md"), "hello v2 updated").unwrap();
        let (c3, _, _) = mirror_local_dir(&src, &dst, &excludes, |_, _, _| {}).unwrap();
        assert_eq!(c3, 1);

        // Recursive guard: destination inside source must fail
        let inside = src.join("sub_backup");
        assert!(ensure_not_recursive(&src, &inside).is_err());
    }

    #[test]
    fn test_zip_backup_utf8_and_retention() {
        let tmp = tempdir().unwrap();
        let data_root = tmp.path().join("data");
        let src = tmp.path().join("src");
        let dst = tmp.path().join("sync");
        fs::create_dir_all(&data_root).unwrap();
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("测试记录.txt"), "生命在于折腾").unwrap();

        let excludes = default_excludes();
        for name in [
            "我的文档_20261122_100001.zip",
            "我的文档_20261122_100002.zip",
            "我的文档_20261122_100003.zip",
        ] {
            let zp = dst.join(name);
            let (cnt, _, bytes) = create_zip_from_dir(&src, &zp, &excludes, |_, _, _| {}).unwrap();
            assert_eq!(cnt, 1);
            assert!(bytes > 0);
            let raw = fs::read(&zp).unwrap();
            assert_eq!(&raw[0..4], &0x0403_4b50u32.to_le_bytes());
            assert!(raw
                .windows("测试记录.txt".len())
                .any(|w| w == "测试记录.txt".as_bytes()));
            assert_eq!(
                &raw[raw.len() - 22..raw.len() - 18],
                &0x0605_4b50u32.to_le_bytes()
            );
        }

        let pruned = cleanup_local_zip_retention(&dst, "我的文档", 2);
        assert_eq!(pruned, 1);
        let remaining: Vec<String> = fs::read_dir(&dst)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining.len(), 2);
        assert!(!remaining.contains(&"我的文档_20261122_100001.zip".to_string()));
        assert!(remaining.contains(&"我的文档_20261122_100002.zip".to_string()));
        assert!(remaining.contains(&"我的文档_20261122_100003.zip".to_string()));
    }

    #[test]
    fn test_webdav_curl_against_local_mock() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen_requests = Arc::new(Mutex::new(Vec::<(String, Option<String>, usize)>::new()));
        let seen_clone = seen_requests.clone();

        let server_thread = std::thread::spawn(move || {
            for stream_res in listener.incoming().take(3) {
                let mut stream = stream_res.unwrap();
                let mut buf_reader = BufReader::new(stream.try_clone().unwrap());
                let mut req_line = String::new();
                buf_reader.read_line(&mut req_line).unwrap();
                let mut auth_header: Option<String> = None;
                let mut content_len = 0usize;
                loop {
                    let mut hline = String::new();
                    buf_reader.read_line(&mut hline).unwrap();
                    let trimmed = hline.trim();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some((k, v)) = trimmed.split_once(':') {
                        if k.eq_ignore_ascii_case("authorization") {
                            auth_header = Some(v.trim().to_string());
                        } else if k.eq_ignore_ascii_case("content-length") {
                            content_len = v.trim().parse::<usize>().unwrap_or(0);
                        }
                    }
                }
                let mut body_buf = vec![0u8; content_len];
                if content_len > 0 {
                    buf_reader.read_exact(&mut body_buf).unwrap();
                }
                seen_clone.lock().unwrap().push((
                    req_line.trim().to_string(),
                    auth_header,
                    body_buf.len(),
                ));

                let resp = if req_line.starts_with("PROPFIND") {
                    "HTTP/1.1 207 Multi-Status\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"
                } else {
                    "HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                stream.write_all(resp.as_bytes()).unwrap();
                stream.flush().unwrap();
            }
        });

        let base_url = format!("http://{addr}/dav");
        // 1. Test connection -> issues PROPFIND /dav (and /dav/TestDir)
        let msg = test_webdav_connection_blocking(&base_url, "meng", "secret", "TestDir").unwrap();
        assert!(msg.contains("成功"));

        // 2. Upload a real file via PUT
        let tmp = tempdir().unwrap();
        let fpath = tmp.path().join("sample.txt");
        fs::write(&fpath, "hello webdav").unwrap();
        let put_url = build_webdav_url(&base_url, "TestDir", &["sample.txt"]).unwrap();
        webdav_put_file(&put_url, "meng", "secret", &fpath).unwrap();

        server_thread.join().unwrap();
        let reqs = seen_requests.lock().unwrap();
        assert_eq!(reqs.len(), 3);
        assert!(reqs[0].0.starts_with("PROPFIND /dav "));
        assert!(reqs[1].0.starts_with("PROPFIND /dav/TestDir "));
        assert!(reqs[2].0.starts_with("PUT /dav/TestDir/sample.txt "));
        assert_eq!(reqs[2].2, 12);
        // Basic "meng:secret" => bWVuZzpzZWNyZXQ=
        assert!(reqs[2]
            .1
            .as_deref()
            .unwrap_or("")
            .starts_with("Basic bWVuZzpzZWNyZXQ="));
    }
}
