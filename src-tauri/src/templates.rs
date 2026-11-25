use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::settings::data_root_dir;
use crate::store::{
    atomic_write_json, atomic_write_json_unlocked, load_todos_from_root, meta_dir, now_iso,
    save_todos_to_root, Todo, FILE_LOCK,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStep {
    pub title: String,
    pub offset_days: i32,
    #[serde(default = "default_duration")]
    pub duration_days: i32,
    #[serde(default)]
    pub time: Option<String>,
}

fn default_duration() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub kind: String, // "work" | "life"
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub workdays_only: bool,
    pub steps: Vec<TemplateStep>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTemplateInput {
    pub template_id: String,
    pub project_id: String,
    pub start_date: String,
    #[serde(default)]
    pub task_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTemplateResult {
    pub created: Vec<Todo>,
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStepItem {
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    pub duration_days: i32,
    pub time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTemplateResult {
    pub steps: Vec<PreviewStepItem>,
    pub end_date: String,
}

fn templates_path(root: &Path) -> PathBuf {
    meta_dir(root).join("templates.json")
}

fn is_weekend(d: NaiveDate) -> bool {
    matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

fn next_workday_if_weekend(mut d: NaiveDate) -> NaiveDate {
    while is_weekend(d) {
        d += Duration::days(1);
    }
    d
}

pub fn add_offset_days(start: NaiveDate, offset: i32, workdays_only: bool) -> NaiveDate {
    if !workdays_only {
        return start + Duration::days(offset as i64);
    }
    let mut cur = next_workday_if_weekend(start);
    if offset > 0 {
        for _ in 0..offset {
            cur += Duration::days(1);
            cur = next_workday_if_weekend(cur);
        }
    } else if offset < 0 {
        for _ in 0..(-offset) {
            cur -= Duration::days(1);
            while is_weekend(cur) {
                cur -= Duration::days(1);
            }
        }
    }
    cur
}

pub fn expand_template_steps(
    tmpl: &Template,
    start_date_str: &str,
) -> Result<(Vec<PreviewStepItem>, String), String> {
    let parsed = NaiveDate::parse_from_str(start_date_str.trim(), "%Y-%m-%d")
        .map_err(|e| format!("无效开始日期 {start_date_str}: {e}"))?;
    let base = if tmpl.workdays_only {
        next_workday_if_weekend(parsed)
    } else {
        parsed
    };

    let mut out = Vec::with_capacity(tmpl.steps.len());
    let mut max_end = base;

    for s in &tmpl.steps {
        let dur = s.duration_days.max(1);
        let step_start = add_offset_days(base, s.offset_days, tmpl.workdays_only);
        let step_end = add_offset_days(step_start, dur - 1, tmpl.workdays_only);
        if step_end > max_end {
            max_end = step_end;
        }
        let title = if dur > 1 {
            format!("{}（共{}天，至{}）", s.title, dur, step_end.format("%m-%d"))
        } else {
            s.title.clone()
        };
        out.push(PreviewStepItem {
            title,
            start_date: step_start.format("%Y-%m-%d").to_string(),
            end_date: step_end.format("%Y-%m-%d").to_string(),
            duration_days: dur,
            time: s.time.clone(),
        });
    }

    Ok((out, max_end.format("%Y-%m-%d").to_string()))
}

pub fn seed_templates() -> Vec<Template> {
    vec![
        Template {
            id: "work-standard".to_string(),
            name: "工作-标准需求排期".to_string(),
            kind: "work".to_string(),
            description: "标准研发需求全流程排期（按工作日自动顺延周末）".to_string(),
            workdays_only: true,
            steps: vec![
                TemplateStep { title: "需求分析与方案设计".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "设计评审".into(), offset_days: 1, duration_days: 1, time: None },
                TemplateStep { title: "开发".into(), offset_days: 2, duration_days: 3, time: None },
                TemplateStep { title: "开发自测".into(), offset_days: 5, duration_days: 1, time: None },
                TemplateStep { title: "提交MR/UAT更新".into(), offset_days: 6, duration_days: 1, time: None },
                TemplateStep { title: "测试审核/检查单".into(), offset_days: 7, duration_days: 1, time: None },
                TemplateStep { title: "UAT验收".into(), offset_days: 8, duration_days: 1, time: None },
                TemplateStep { title: "发版".into(), offset_days: 9, duration_days: 1, time: None },
            ],
        },
        Template {
            id: "work-hotfix".to_string(),
            name: "工作-紧急缺陷修复".to_string(),
            kind: "work".to_string(),
            description: "线上/测试紧急缺陷快速修复与发版排期".to_string(),
            workdays_only: true,
            steps: vec![
                TemplateStep { title: "定位分析".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "修复与自测".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "提交MR".into(), offset_days: 1, duration_days: 1, time: None },
                TemplateStep { title: "UAT验证".into(), offset_days: 1, duration_days: 1, time: None },
                TemplateStep { title: "发版".into(), offset_days: 2, duration_days: 1, time: None },
            ],
        },
        Template {
            id: "life-daily".to_string(),
            name: "生活-每日例行".to_string(),
            kind: "life".to_string(),
            description: "每天保持节奏的健康与复盘习惯".to_string(),
            workdays_only: false,
            steps: vec![
                TemplateStep { title: "晨练".into(), offset_days: 0, duration_days: 1, time: Some("07:00".into()) },
                TemplateStep { title: "早餐".into(), offset_days: 0, duration_days: 1, time: Some("08:00".into()) },
                TemplateStep { title: "阅读".into(), offset_days: 0, duration_days: 1, time: Some("21:00".into()) },
                TemplateStep { title: "复盘明日计划".into(), offset_days: 0, duration_days: 1, time: Some("22:00".into()) },
            ],
        },
        Template {
            id: "life-weekly".to_string(),
            name: "生活-每周计划".to_string(),
            kind: "life".to_string(),
            description: "建议以周一作为开始日期套用本模板".to_string(),
            workdays_only: false,
            steps: vec![
                TemplateStep { title: "整理本周计划".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "运动".into(), offset_days: 2, duration_days: 1, time: None },
                TemplateStep { title: "家务".into(), offset_days: 4, duration_days: 1, time: None },
                TemplateStep { title: "采购".into(), offset_days: 5, duration_days: 1, time: None },
                TemplateStep { title: "休息复盘".into(), offset_days: 6, duration_days: 1, time: None },
            ],
        },
        Template {
            id: "life-travel".to_string(),
            name: "生活-出行前准备清单".to_string(),
            kind: "life".to_string(),
            description: "出差/旅行前检查证件、电子设备与居家安全".to_string(),
            workdays_only: false,
            steps: vec![
                TemplateStep { title: "核对身份证/车票/机票与酒店".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "收拾衣物、洗漱用品与充电器".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "检查门窗水电并关闭闲置电源".into(), offset_days: 1, duration_days: 1, time: Some("08:30".into()) },
                TemplateStep { title: "出发前确认天气与通勤路线".into(), offset_days: 1, duration_days: 1, time: Some("09:00".into()) },
            ],
        },
        Template {
            id: "life-monthly-finance".to_string(),
            name: "生活-月度账单与整理".to_string(),
            kind: "life".to_string(),
            description: "每月底固定核对账单、备份文件与生活复盘".to_string(),
            workdays_only: false,
            steps: vec![
                TemplateStep { title: "核对信用卡与房租/房贷账单".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "备份重要文件与照片到网盘".into(), offset_days: 0, duration_days: 1, time: None },
                TemplateStep { title: "整理电脑桌面与下载目录".into(), offset_days: 1, duration_days: 1, time: None },
                TemplateStep { title: "月度复盘与下月预算".into(), offset_days: 1, duration_days: 1, time: Some("21:00".into()) },
            ],
        },
    ]
}

pub fn load_templates_from_root(root: &Path) -> Result<Vec<Template>, String> {
    let path = templates_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let seeded = seed_templates();
        atomic_write_json_unlocked(&path, &seeded)?;
        return Ok(seeded);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取模板失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析模板失败: {e}"))
}

pub fn apply_template_in_root(
    root: &Path,
    input: ApplyTemplateInput,
) -> Result<ApplyTemplateResult, String> {
    let templates = load_templates_from_root(root)?;
    let tmpl = templates
        .into_iter()
        .find(|t| t.id == input.template_id)
        .ok_or_else(|| format!("未找到模板: {}", input.template_id))?;

    let (items, end_date) = expand_template_steps(&tmpl, &input.start_date)?;
    let now = now_iso();
    let task_code = input.task_code.filter(|s| !s.trim().is_empty());

    let mut created = Vec::with_capacity(items.len());
    for item in items {
        let title = if let Some(code) = &task_code {
            format!("[{}] {}", code, item.title)
        } else {
            item.title
        };
        created.push(Todo {
            id: Uuid::new_v4().to_string(),
            project_id: input.project_id.clone(),
            title,
            note: if item.duration_days > 1 {
                format!("排期周期: {} ~ {}", item.start_date, item.end_date)
            } else {
                String::new()
            },
            date: Some(item.start_date),
            time: item.time,
            priority: 2,
            done: false,
            task_code: task_code.clone(),
            template_id: Some(tmpl.id.clone()),
            created_at: now.clone(),
            done_at: None,
            tags: Vec::new(),
            repeat: "none".to_string(),
            subtasks: Vec::new(),
            pomodoros: 0,
            spawned_next: false,
        });
    }

    let mut todos = load_todos_from_root(root)?;
    todos.extend(created.clone());
    save_todos_to_root(root, &todos)?;

    Ok(ApplyTemplateResult { created, end_date })
}

#[tauri::command]
pub fn list_templates(app: AppHandle) -> Result<Vec<Template>, String> {
    let root = data_root_dir(&app)?;
    load_templates_from_root(&root)
}

#[tauri::command]
pub fn upsert_template(app: AppHandle, mut template: Template) -> Result<Template, String> {
    if template.name.trim().is_empty() {
        return Err("模板名称不能为空".to_string());
    }
    let root = data_root_dir(&app)?;
    let mut list = load_templates_from_root(&root)?;
    if template.id.trim().is_empty() {
        template.id = Uuid::new_v4().to_string();
        list.push(template.clone());
    } else if let Some(pos) = list.iter().position(|t| t.id == template.id) {
        list[pos] = template.clone();
    } else {
        list.push(template.clone());
    }
    atomic_write_json(&templates_path(&root), &list)?;
    Ok(template)
}

#[tauri::command]
pub fn delete_template(app: AppHandle, id: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let mut list = load_templates_from_root(&root)?;
    let before = list.len();
    list.retain(|t| t.id != id);
    if list.len() == before {
        return Err(format!("未找到模板: {id}"));
    }
    atomic_write_json(&templates_path(&root), &list)?;
    Ok(())
}

#[tauri::command]
pub fn preview_template(
    app: AppHandle,
    template_id: String,
    start_date: String,
) -> Result<PreviewTemplateResult, String> {
    let root = data_root_dir(&app)?;
    let list = load_templates_from_root(&root)?;
    let tmpl = list
        .into_iter()
        .find(|t| t.id == template_id)
        .ok_or_else(|| format!("未找到模板: {template_id}"))?;
    let (steps, end_date) = expand_template_steps(&tmpl, &start_date)?;
    Ok(PreviewTemplateResult { steps, end_date })
}

#[tauri::command]
pub fn apply_template(
    app: AppHandle,
    input: ApplyTemplateInput,
) -> Result<ApplyTemplateResult, String> {
    let root = data_root_dir(&app)?;
    apply_template_in_root(&root, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_workday_offset_friday_to_monday() {
        // 2026-11-20 is Friday
        let fri = NaiveDate::from_ymd_opt(2026, 11, 20).unwrap();
        assert_eq!(fri.weekday(), Weekday::Fri);
        let next = add_offset_days(fri, 1, true);
        assert_eq!(next, NaiveDate::from_ymd_opt(2026, 11, 23).unwrap());
    }

    #[test]
    fn test_workday_start_on_saturday_shifts_to_monday() {
        // 2026-11-21 is Saturday
        let sat = NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
        assert_eq!(sat.weekday(), Weekday::Sat);
        let start = add_offset_days(sat, 0, true);
        assert_eq!(start, NaiveDate::from_ymd_opt(2026, 11, 23).unwrap());
    }

    #[test]
    fn test_apply_template_work_standard_duration_and_end_date() {
        let tmp = tempdir().unwrap();
        // 2026-11-21 is Saturday -> shifts to Monday 2026-11-23 (workday 0)
        // offset 9 workdays later:
        // 0:11-23(M), 1:24(T), 2:25(W), 3:26(Th), 4:27(F), 5:30(M), 6:12-01(T), 7:02(W), 8:03(Th), 9:04(F)
        let res = apply_template_in_root(
            tmp.path(),
            ApplyTemplateInput {
                template_id: "work-standard".into(),
                project_id: "work".into(),
                start_date: "2026-11-21".into(),
                task_code: Some("TASK-0001".into()),
            },
        )
        .unwrap();
        assert_eq!(res.created.len(), 8);
        assert_eq!(res.end_date, "2026-12-04");
        // step 2 ("开发") starts 11-25 (W), duration 3 workdays -> ends 11-27 (F)
        assert_eq!(res.created[2].date.as_deref(), Some("2026-11-25"));
        assert!(res.created[2].title.contains("（共3天，至11-27）"));
    }
}
