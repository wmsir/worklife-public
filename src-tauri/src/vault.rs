use chrono::{DateTime, Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::settings::data_root_dir;
use crate::store::{
    atomic_write_json, atomic_write_json_unlocked, atomic_write_text, meta_dir, now_iso, FILE_LOCK,
};
use crate::worktime::calendar::{days_in_month, get_day_info};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_note_kind")]
    pub kind: String, // "note" | "snippet"
    #[serde(default = "default_note_area")]
    pub area: String, // "work" | "life"
    #[serde(default = "default_note_lang")]
    pub language: String,
    #[serde(default = "default_note_color")]
    pub color: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub copy_count: u32,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_note_kind() -> String {
    "note".to_string()
}

fn default_note_area() -> String {
    "work".to_string()
}

fn default_note_lang() -> String {
    "text".to_string()
}

fn default_note_color() -> String {
    "#ffffff".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceTransaction {
    pub id: String,
    pub date: String, // YYYY-MM-DD
    #[serde(default = "default_tx_kind")]
    pub kind: String, // "expense" | "income"
    pub amount: f64,
    #[serde(default = "default_tx_category")]
    pub category: String,
    #[serde(default = "default_tx_account")]
    pub account: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub created_at: String,
}

fn default_tx_kind() -> String {
    "expense".to_string()
}

fn default_tx_category() -> String {
    "其他".to_string()
}

fn default_tx_account() -> String {
    "微信".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringBill {
    pub id: String,
    pub name: String,
    pub amount: f64,
    #[serde(default = "default_tx_category")]
    pub category: String,
    #[serde(default = "default_due_day")]
    pub due_day: u8,
    #[serde(default = "default_tx_account")]
    pub account: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub last_recorded_month: Option<String>,
}

fn default_due_day() -> u8 {
    1
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceData {
    #[serde(default = "default_monthly_budget")]
    pub monthly_budget: f64,
    #[serde(default)]
    pub transactions: Vec<FinanceTransaction>,
    #[serde(default)]
    pub recurring_bills: Vec<RecurringBill>,
}

fn default_monthly_budget() -> f64 {
    5000.0
}

impl Default for FinanceData {
    fn default() -> Self {
        Self {
            monthly_budget: default_monthly_budget(),
            transactions: Vec::new(),
            recurring_bills: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReportSummary {
    pub key: String,
    pub title: String,
    pub updated_at: String,
    pub preview: String,
    pub path: String,
}

fn notes_path(root: &Path) -> PathBuf {
    meta_dir(root).join("notes.json")
}

fn finance_path(root: &Path) -> PathBuf {
    meta_dir(root).join("finance.json")
}

fn weekly_reports_dir(root: &Path) -> PathBuf {
    root.join("工作").join("周报")
}

fn finance_export_dir(root: &Path) -> PathBuf {
    root.join("生活").join("账单")
}

fn seed_notes() -> Vec<NoteItem> {
    let now = now_iso();
    vec![
        NoteItem {
            id: "note-seed-git".to_string(),
            title: "Git 常用提测排查命令".to_string(),
            content: "git fetch --all --prune\ngit checkout -b TASK-0001-dev origin/UAT\ngit log --oneline -n 10".to_string(),
            kind: "snippet".to_string(),
            area: "work".to_string(),
            language: "git".to_string(),
            color: "#eff6ff".to_string(),
            tags: vec!["Git".to_string(), "提测".to_string()],
            pinned: true,
            copy_count: 0,
            created_at: now.clone(),
            updated_at: now.clone(),
        },
        NoteItem {
            id: "note-seed-life".to_string(),
            title: "外出出行极简检查清单".to_string(),
            content: "- 身份证 / 驾照 / 医保卡\n- 手机充电器 / 充电宝 / 数据线\n- 钥匙 / 门禁卡 / 雨伞\n- 常备药品".to_string(),
            kind: "note".to_string(),
            area: "life".to_string(),
            language: "markdown".to_string(),
            color: "#ecfdf5".to_string(),
            tags: vec!["清单".to_string(), "出行".to_string()],
            pinned: false,
            copy_count: 0,
            created_at: now.clone(),
            updated_at: now,
        },
    ]
}

fn sort_notes(notes: &mut [NoteItem]) {
    notes.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
}

pub fn load_notes_from_root(root: &Path) -> Result<Vec<NoteItem>, String> {
    let path = notes_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let mut seeded = seed_notes();
        sort_notes(&mut seeded);
        atomic_write_json_unlocked(&path, &seeded)?;
        return Ok(seeded);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取便签失败: {e}"))?;
    let mut notes: Vec<NoteItem> =
        serde_json::from_str(&raw).map_err(|e| format!("解析便签失败: {e}"))?;
    sort_notes(&mut notes);
    Ok(notes)
}

pub fn upsert_note_in_root(root: &Path, mut note: NoteItem) -> Result<NoteItem, String> {
    if note.title.trim().is_empty() && note.content.trim().is_empty() {
        return Err("便签标题和内容不能同时为空".to_string());
    }
    note.title = if note.title.trim().is_empty() {
        note.content
            .lines()
            .find(|l| !l.trim().is_empty())
            .map(|l| l.trim().chars().take(30).collect())
            .unwrap_or_else(|| "未命名便签".to_string())
    } else {
        note.title.trim().to_string()
    };
    if note.kind != "snippet" {
        note.kind = "note".to_string();
    }
    if note.area != "life" {
        note.area = "work".to_string();
    }
    if note.language.trim().is_empty() {
        note.language = default_note_lang();
    }
    if note.color.trim().is_empty() {
        note.color = default_note_color();
    }
    note.tags = note
        .tags
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let now = now_iso();
    let mut notes = load_notes_from_root(root)?;
    if note.id.trim().is_empty() {
        note.id = Uuid::new_v4().to_string();
        if note.created_at.trim().is_empty() {
            note.created_at = now.clone();
        }
        note.updated_at = now;
        notes.push(note.clone());
    } else if let Some(pos) = notes.iter().position(|n| n.id == note.id) {
        if note.created_at.trim().is_empty() {
            note.created_at = notes[pos].created_at.clone();
        }
        note.copy_count = notes[pos].copy_count.max(note.copy_count);
        note.updated_at = now;
        notes[pos] = note.clone();
    } else {
        if note.created_at.trim().is_empty() {
            note.created_at = now.clone();
        }
        note.updated_at = now;
        notes.push(note.clone());
    }

    sort_notes(&mut notes);
    atomic_write_json(&notes_path(root), &notes)?;
    Ok(note)
}

pub fn delete_note_in_root(root: &Path, id: &str) -> Result<(), String> {
    let mut notes = load_notes_from_root(root)?;
    let before = notes.len();
    notes.retain(|n| n.id != id);
    if notes.len() == before {
        return Err(format!("未找到便签: {id}"));
    }
    atomic_write_json(&notes_path(root), &notes)
}

pub fn increment_note_copy_in_root(root: &Path, id: &str) -> Result<NoteItem, String> {
    let mut notes = load_notes_from_root(root)?;
    let pos = notes
        .iter()
        .position(|n| n.id == id)
        .ok_or_else(|| format!("未找到便签: {id}"))?;
    notes[pos].copy_count = notes[pos].copy_count.saturating_add(1);
    let updated = notes[pos].clone();
    atomic_write_json(&notes_path(root), &notes)?;
    Ok(updated)
}

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<NoteItem>, String> {
    let root = data_root_dir(&app)?;
    load_notes_from_root(&root)
}

#[tauri::command]
pub fn upsert_note(app: AppHandle, note: NoteItem) -> Result<NoteItem, String> {
    let root = data_root_dir(&app)?;
    upsert_note_in_root(&root, note)
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    delete_note_in_root(&root, &id)
}

#[tauri::command]
pub fn increment_note_copy(app: AppHandle, id: String) -> Result<NoteItem, String> {
    let root = data_root_dir(&app)?;
    increment_note_copy_in_root(&root, &id)
}

// ─────────────────────────────────────────────────────────────────────────────
// 个人轻记账与固定周期账单
// ─────────────────────────────────────────────────────────────────────────────

fn sort_transactions(list: &mut [FinanceTransaction]) {
    list.sort_by(|a, b| {
        b.date
            .cmp(&a.date)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
}

pub fn load_finance_from_root(root: &Path) -> Result<FinanceData, String> {
    let path = finance_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let init = FinanceData::default();
        atomic_write_json_unlocked(&path, &init)?;
        return Ok(init);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取账单数据失败: {e}"))?;
    let mut data: FinanceData =
        serde_json::from_str(&raw).map_err(|e| format!("解析账单数据失败: {e}"))?;
    sort_transactions(&mut data.transactions);
    Ok(data)
}

pub fn set_monthly_budget_in_root(root: &Path, budget: f64) -> Result<FinanceData, String> {
    if !budget.is_finite() || budget < 0.0 {
        return Err("月度预算必须为大于或等于 0 的有效数字".to_string());
    }
    let mut data = load_finance_from_root(root)?;
    data.monthly_budget = (budget * 100.0).round() / 100.0;
    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

pub fn upsert_transaction_in_root(
    root: &Path,
    mut tx: FinanceTransaction,
) -> Result<FinanceData, String> {
    let d_clean = tx.date.trim().to_string();
    NaiveDate::parse_from_str(&d_clean, "%Y-%m-%d")
        .map_err(|e| format!("交易日期格式应为 YYYY-MM-DD: {e}"))?;
    if !tx.amount.is_finite() || tx.amount <= 0.0 {
        return Err("金额必须大于 0".to_string());
    }
    tx.date = d_clean;
    tx.kind = if tx.kind == "income" {
        "income".to_string()
    } else {
        "expense".to_string()
    };
    tx.amount = (tx.amount * 100.0).round() / 100.0;
    tx.category = if tx.category.trim().is_empty() {
        default_tx_category()
    } else {
        tx.category.trim().to_string()
    };
    tx.account = if tx.account.trim().is_empty() {
        default_tx_account()
    } else {
        tx.account.trim().to_string()
    };
    tx.note = tx.note.trim().to_string();

    let mut data = load_finance_from_root(root)?;
    if tx.id.trim().is_empty() {
        tx.id = Uuid::new_v4().to_string();
        if tx.created_at.trim().is_empty() {
            tx.created_at = now_iso();
        }
        data.transactions.push(tx);
    } else if let Some(pos) = data.transactions.iter().position(|t| t.id == tx.id) {
        if tx.created_at.trim().is_empty() {
            tx.created_at = data.transactions[pos].created_at.clone();
        }
        data.transactions[pos] = tx;
    } else {
        if tx.created_at.trim().is_empty() {
            tx.created_at = now_iso();
        }
        data.transactions.push(tx);
    }

    sort_transactions(&mut data.transactions);
    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

pub fn delete_transaction_in_root(root: &Path, id: &str) -> Result<FinanceData, String> {
    let mut data = load_finance_from_root(root)?;
    let before = data.transactions.len();
    data.transactions.retain(|t| t.id != id);
    if data.transactions.len() == before {
        return Err(format!("未找到记账明细: {id}"));
    }
    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

pub fn upsert_recurring_bill_in_root(
    root: &Path,
    mut bill: RecurringBill,
) -> Result<FinanceData, String> {
    if bill.name.trim().is_empty() {
        return Err("固定账单名称不能为空".to_string());
    }
    if !(1..=31).contains(&bill.due_day) {
        return Err("每月扣款日必须在 1 到 31 之间".to_string());
    }
    if !bill.amount.is_finite() || bill.amount <= 0.0 {
        return Err("固定账单金额必须大于 0".to_string());
    }
    bill.name = bill.name.trim().to_string();
    bill.amount = (bill.amount * 100.0).round() / 100.0;
    bill.category = if bill.category.trim().is_empty() {
        default_tx_category()
    } else {
        bill.category.trim().to_string()
    };
    bill.account = if bill.account.trim().is_empty() {
        default_tx_account()
    } else {
        bill.account.trim().to_string()
    };
    bill.note = bill.note.trim().to_string();

    let mut data = load_finance_from_root(root)?;
    if bill.id.trim().is_empty() {
        bill.id = Uuid::new_v4().to_string();
        data.recurring_bills.push(bill);
    } else if let Some(pos) = data.recurring_bills.iter().position(|b| b.id == bill.id) {
        if bill.last_recorded_month.is_none() {
            bill.last_recorded_month = data.recurring_bills[pos].last_recorded_month.clone();
        }
        data.recurring_bills[pos] = bill;
    } else {
        data.recurring_bills.push(bill);
    }

    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

pub fn delete_recurring_bill_in_root(root: &Path, id: &str) -> Result<FinanceData, String> {
    let mut data = load_finance_from_root(root)?;
    let before = data.recurring_bills.len();
    data.recurring_bills.retain(|b| b.id != id);
    if data.recurring_bills.len() == before {
        return Err(format!("未找到固定账单: {id}"));
    }
    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

pub fn record_recurring_bill_for_month_in_root(
    root: &Path,
    bill_id: &str,
    month: &str,
) -> Result<FinanceData, String> {
    let ym = month.trim().to_string();
    let probe = format!("{ym}-01");
    let first = NaiveDate::parse_from_str(&probe, "%Y-%m-%d")
        .map_err(|e| format!("月份格式应为 YYYY-MM: {e}"))?;
    use chrono::Datelike;
    let max_d = days_in_month(first.year(), first.month());

    let mut data = load_finance_from_root(root)?;
    let pos = data
        .recurring_bills
        .iter()
        .position(|b| b.id == bill_id)
        .ok_or_else(|| format!("未找到固定账单: {bill_id}"))?;

    let bill = &mut data.recurring_bills[pos];
    let clamped_day = (bill.due_day as u32).clamp(1, max_d);
    let tx_date = format!("{:04}-{:02}-{:02}", first.year(), first.month(), clamped_day);
    let note = if bill.note.trim().is_empty() {
        format!("固定账单 · {}", bill.name)
    } else {
        format!("{} ({})", bill.name, bill.note.trim())
    };
    let tx = FinanceTransaction {
        id: Uuid::new_v4().to_string(),
        date: tx_date,
        kind: "expense".to_string(),
        amount: bill.amount,
        category: bill.category.clone(),
        account: bill.account.clone(),
        note,
        created_at: now_iso(),
    };
    bill.last_recorded_month = Some(ym);
    data.transactions.push(tx);
    sort_transactions(&mut data.transactions);
    atomic_write_json(&finance_path(root), &data)?;
    Ok(data)
}

fn csv_escape(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

pub fn export_finance_csv_in_root(
    root: &Path,
    month: Option<&str>,
) -> Result<String, String> {
    let data = load_finance_from_root(root)?;
    let filter_ym = month.map(str::trim).filter(|s| !s.is_empty());
    let rows: Vec<&FinanceTransaction> = data
        .transactions
        .iter()
        .filter(|tx| match filter_ym {
            Some(ym) => tx.date.starts_with(ym),
            None => true,
        })
        .collect();

    let mut out = String::from("\u{FEFF}日期,类型,分类,金额,账户,备注\r\n");
    for tx in rows {
        let kind_cn = if tx.kind == "income" { "收入" } else { "支出" };
        out.push_str(&format!(
            "{},{},{},{:.2},{},{}\r\n",
            csv_escape(&tx.date),
            kind_cn,
            csv_escape(&tx.category),
            tx.amount,
            csv_escape(&tx.account),
            csv_escape(&tx.note),
        ));
    }

    let suffix = filter_ym
        .map(|s| {
            s.chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "全部".to_string());
    let path = finance_export_dir(root).join(format!("账单_{suffix}.csv"));
    atomic_write_text(&path, &out)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_finance_data(app: AppHandle) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    load_finance_from_root(&root)
}

#[tauri::command]
pub fn set_monthly_budget(app: AppHandle, budget: f64) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    set_monthly_budget_in_root(&root, budget)
}

#[tauri::command]
pub fn upsert_transaction(
    app: AppHandle,
    tx: FinanceTransaction,
) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    upsert_transaction_in_root(&root, tx)
}

#[tauri::command]
pub fn delete_transaction(app: AppHandle, id: String) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    delete_transaction_in_root(&root, &id)
}

#[tauri::command]
pub fn upsert_recurring_bill(
    app: AppHandle,
    bill: RecurringBill,
) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    upsert_recurring_bill_in_root(&root, bill)
}

#[tauri::command]
pub fn delete_recurring_bill(app: AppHandle, id: String) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    delete_recurring_bill_in_root(&root, &id)
}

#[tauri::command]
pub fn record_recurring_bill_for_month(
    app: AppHandle,
    bill_id: String,
    month: String,
) -> Result<FinanceData, String> {
    let root = data_root_dir(&app)?;
    record_recurring_bill_for_month_in_root(&root, &bill_id, &month)
}

#[tauri::command]
pub fn export_finance_csv(app: AppHandle, month: Option<String>) -> Result<String, String> {
    let root = data_root_dir(&app)?;
    export_finance_csv_in_root(&root, month.as_deref())
}

// ─────────────────────────────────────────────────────────────────────────────
// 工作周报 / 月报本地归档
// ─────────────────────────────────────────────────────────────────────────────

pub fn sanitize_report_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches(".md").trim();
    if trimmed.is_empty() || trimmed.contains("..") {
        return Err("周报标识不能为空或包含非法路径片段".to_string());
    }
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ if c.is_control() => '-',
            _ => c,
        })
        .collect();
    let final_key = cleaned.trim_matches(['.', ' ']).to_string();
    if final_key.is_empty() {
        return Err("周报标识包含非法字符".to_string());
    }
    Ok(final_key)
}

fn extract_report_meta(raw: &str, fallback_title: &str) -> (String, String) {
    let mut title = String::new();
    let mut preview = String::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if title.is_empty() && t.starts_with('#') {
            title = t.trim_start_matches('#').trim().to_string();
            continue;
        }
        if !t.starts_with('#') && !t.starts_with("---") && preview.is_empty() {
            let clean = t.trim_start_matches(['-', '*', '>', ' ']).trim();
            if !clean.is_empty() {
                preview = clean.chars().take(100).collect();
                break;
            }
        }
    }
    if title.is_empty() {
        title = fallback_title.to_string();
    }
    (title, preview)
}

pub fn list_weekly_reports_in_root(root: &Path) -> Result<Vec<WeeklyReportSummary>, String> {
    let dir = weekly_reports_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取周报目录失败: {e}"))?;
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let (title, preview) = extract_report_meta(&raw, stem);
        let updated_at = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .map(|st| {
                let dt: DateTime<Local> = st.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_else(now_iso);
        items.push(WeeklyReportSummary {
            key: stem.to_string(),
            title,
            updated_at,
            preview,
            path: path.to_string_lossy().to_string(),
        });
    }
    items.sort_by(|a, b| b.key.cmp(&a.key));
    Ok(items)
}

pub fn read_weekly_report_in_root(root: &Path, key: &str) -> Result<String, String> {
    let safe = sanitize_report_key(key)?;
    let path = weekly_reports_dir(root).join(format!("{safe}.md"));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取周报失败: {e}"))
}

pub fn save_weekly_report_in_root(
    root: &Path,
    key: &str,
    content: &str,
) -> Result<WeeklyReportSummary, String> {
    let safe = sanitize_report_key(key)?;
    let path = weekly_reports_dir(root).join(format!("{safe}.md"));
    atomic_write_text(&path, content)?;
    let (title, preview) = extract_report_meta(content, &safe);
    Ok(WeeklyReportSummary {
        key: safe,
        title,
        updated_at: now_iso(),
        preview,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_weekly_reports(app: AppHandle) -> Result<Vec<WeeklyReportSummary>, String> {
    let root = data_root_dir(&app)?;
    list_weekly_reports_in_root(&root)
}

#[tauri::command]
pub fn read_weekly_report(app: AppHandle, key: String) -> Result<String, String> {
    let root = data_root_dir(&app)?;
    read_weekly_report_in_root(&root, &key)
}

#[tauri::command]
pub fn save_weekly_report(
    app: AppHandle,
    key: String,
    content: String,
) -> Result<WeeklyReportSummary, String> {
    let root = data_root_dir(&app)?;
    save_weekly_report_in_root(&root, &key, &content)
}

#[tauri::command]
pub fn open_weekly_reports_dir(app: AppHandle) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let dir = weekly_reports_dir(&root);
    fs::create_dir_all(&dir).map_err(|e| format!("创建周报目录失败: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开周报目录失败: {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// 中国日历月度节假日与调休查询
// ─────────────────────────────────────────────────────────────────────────────

pub fn build_calendar_month_info(year: i32, month: u32) -> Result<HashMap<String, Value>, String> {
    if !(1..=12).contains(&month) {
        return Err(format!("无效月份: {month}"));
    }
    let first = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| format!("无效年月: {year}-{month}"))?;
    let last_day = days_in_month(year, month);
    let last = NaiveDate::from_ymd_opt(year, month, last_day)
        .ok_or_else(|| format!("无效月末日期: {year}-{month}-{last_day}"))?;

    let start = first - Duration::days(7);
    let end = last + Duration::days(7);
    let mut map = HashMap::new();
    let mut curr = start;
    while curr <= end {
        map.insert(curr.format("%Y-%m-%d").to_string(), get_day_info(curr));
        curr += Duration::days(1);
    }
    Ok(map)
}

#[tauri::command]
pub fn get_calendar_month_info(year: i32, month: u32) -> Result<HashMap<String, Value>, String> {
    build_calendar_month_info(year, month)
}

#[tauri::command]
pub fn get_today_cn_info() -> Value {
    get_day_info(Local::now().date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_notes_upsert_pin_sort_and_copy_count() {
        let dir = tempdir().unwrap();
        let initial = load_notes_from_root(dir.path()).unwrap();
        assert_eq!(initial.len(), 2);
        assert!(initial[0].pinned);

        let created = upsert_note_in_root(
            dir.path(),
            NoteItem {
                id: String::new(),
                title: "排查 SQL".into(),
                content: "SELECT * FROM prpcmain;".into(),
                kind: "snippet".into(),
                area: "work".into(),
                language: "sql".into(),
                color: "#eff6ff".into(),
                tags: vec!["SQL".into()],
                pinned: false,
                copy_count: 0,
                created_at: String::new(),
                updated_at: String::new(),
            },
        )
        .unwrap();
        assert_eq!(created.copy_count, 0);

        let copied = increment_note_copy_in_root(dir.path(), &created.id).unwrap();
        assert_eq!(copied.copy_count, 1);

        let all = load_notes_from_root(dir.path()).unwrap();
        assert_eq!(all.len(), 3);
        // Seeded pinned note remains ahead of unpinned note
        assert!(all[0].pinned);
    }

    #[test]
    fn test_finance_transactions_budget_and_recurring_bill_month_clamp() {
        let dir = tempdir().unwrap();
        let d0 = set_monthly_budget_in_root(dir.path(), 6800.5).unwrap();
        assert!((d0.monthly_budget - 6800.5).abs() < 1e-6);

        let d1 = upsert_transaction_in_root(
            dir.path(),
            FinanceTransaction {
                id: String::new(),
                date: "2026-02-10".into(),
                kind: "expense".into(),
                amount: 38.5,
                category: "餐饮".into(),
                account: "微信".into(),
                note: "午餐".into(),
                created_at: String::new(),
            },
        )
        .unwrap();
        assert_eq!(d1.transactions.len(), 1);

        let d2 = upsert_recurring_bill_in_root(
            dir.path(),
            RecurringBill {
                id: "bill-rent".into(),
                name: "房租".into(),
                amount: 2500.0,
                category: "居住".into(),
                due_day: 31,
                account: "银行卡".into(),
                note: String::new(),
                active: true,
                last_recorded_month: None,
            },
        )
        .unwrap();
        assert_eq!(d2.recurring_bills.len(), 1);

        // Feb 2026 has 28 days -> due_day 31 clamps to 2026-02-28
        let d3 = record_recurring_bill_for_month_in_root(dir.path(), "bill-rent", "2026-02")
            .unwrap();
        assert_eq!(d3.transactions.len(), 2);
        assert_eq!(d3.transactions[0].date, "2026-02-28");
        assert_eq!(d3.recurring_bills[0].last_recorded_month.as_deref(), Some("2026-02"));

        let csv_path = export_finance_csv_in_root(dir.path(), Some("2026-02")).unwrap();
        let csv_text = fs::read_to_string(csv_path).unwrap();
        assert!(csv_text.contains("2026-02-28"));
        assert!(csv_text.contains("2500.00"));
    }

    #[test]
    fn test_weekly_report_roundtrip_and_sanitize() {
        let dir = tempdir().unwrap();
        assert!(sanitize_report_key("../bad").is_err());
        assert_eq!(sanitize_report_key("2026/W47").unwrap(), "2026-W47");

        let saved = save_weekly_report_in_root(
            dir.path(),
            "2026-W47",
            "# 第47周工作周报\n\n- 完成单文件瘦身与离线功能升级\n",
        )
        .unwrap();
        assert_eq!(saved.title, "第47周工作周报");
        assert_eq!(saved.preview, "完成单文件瘦身与离线功能升级");

        let content = read_weekly_report_in_root(dir.path(), "2026-W47").unwrap();
        assert!(content.contains("单文件瘦身"));

        let list = list_weekly_reports_in_root(dir.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, "2026-W47");
    }

    #[test]
    fn test_calendar_month_info_includes_holidays_and_padding() {
        let map = build_calendar_month_info(2026, 2).unwrap();
        // Padding days included
        assert!(map.contains_key("2026-01-26"));
        assert!(map.contains_key("2026-03-04"));
        // 2026-02-14 Saturday in-lieu workday
        assert_eq!(map["2026-02-14"]["is_workday"], serde_json::json!(true));
        assert_eq!(map["2026-02-14"]["day_type"], serde_json::json!("in_lieu"));
        // 2026-02-17 Spring Festival holiday
        assert_eq!(map["2026-02-17"]["is_workday"], serde_json::json!(false));
        assert_eq!(map["2026-02-17"]["day_type"], serde_json::json!("holiday"));
    }
}
