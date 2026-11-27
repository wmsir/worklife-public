use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::settings::data_root_dir;
use crate::store::{
    atomic_write_json, atomic_write_text, now_iso, today_ymd, FILE_LOCK,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHistoryItem {
    pub at: String,
    pub event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBranchRecord {
    pub branch: String,
    #[serde(default)]
    pub ref_branch: String,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordTaskBranchInput {
    pub code: String,
    #[serde(default)]
    pub name: Option<String>,
    pub branch: String,
    #[serde(default)]
    pub ref_branch: String,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub code: String,
    #[serde(default)]
    pub card_id: Option<i64>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub sprint: String,
    #[serde(default)]
    pub sprint_start: String,
    #[serde(default)]
    pub sprint_end: String,
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub release_date: String,
    #[serde(default)]
    pub plan_test_date: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub progress: u8,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub branches: Vec<TaskBranchRecord>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub folder_name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub history: Vec<TaskHistoryItem>,
}

fn default_status() -> String {
    "进行中".to_string()
}

fn is_valid_ymd(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

fn is_release_date_before_today(release_date: &str, today: &str) -> bool {
    let rd = release_date.trim();
    is_valid_ymd(rd) && rd < today
}

fn is_pending_release_confirmation(rec: &TaskRecord, today: &str) -> bool {
    is_release_date_before_today(&rec.release_date, today)
        && rec.status != "已发版"
        && rec.status != "已关闭"
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSyncItem {
    pub code: String,
    #[serde(default)]
    pub card_id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sprint: Option<String>,
    #[serde(default)]
    pub sprint_start: Option<String>,
    #[serde(default)]
    pub sprint_end: Option<String>,
    #[serde(default)]
    pub plan_test_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksSyncResult {
    pub created: u32,
    pub updated: u32,
    pub tasks: Vec<TaskRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksBatchReleaseResult {
    pub confirmed: u32,
    pub confirmed_codes: Vec<String>,
    pub tasks: Vec<TaskRecord>,
}

pub fn tasks_root_dir(data_root: &Path) -> PathBuf {
    data_root.join("工作").join("任务")
}

fn sanitize_part(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn sanitize_folder_name(code: &str, name: &str) -> String {
    let clean_code = sanitize_part(code);
    let clean_name = sanitize_part(name);
    let raw = if clean_name.is_empty() {
        clean_code
    } else {
        format!("{clean_code}-{clean_name}")
    };
    let trimmed = raw
        .trim()
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    let truncated: String = trimmed.chars().take(80).collect();
    truncated
        .trim()
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string()
}

pub struct TaskScaffoldMeta<'a> {
    pub code: &'a str,
    pub name: &'a str,
    pub sprint: &'a str,
    pub start_date: &'a str,
    pub plan_test_date: &'a str,
    pub release_date: &'a str,
}

fn task_doc_prefix(code: &str, name: &str) -> String {
    let clean_code = sanitize_part(code);
    if !clean_code.is_empty() {
        return clean_code.chars().take(32).collect();
    }
    let clean_name = sanitize_part(name);
    if !clean_name.is_empty() {
        return clean_name.chars().take(24).collect();
    }
    "任务".to_string()
}

fn render_requirement_md_from_meta(meta: &TaskScaffoldMeta<'_>, card_id: Option<i64>, status: &str, branch: &str) -> String {
    let clean_code = meta.code.trim();
    let clean_name = meta.name.trim();
    let card_id_str = card_id.map(|id| id.to_string()).unwrap_or_default();
    let title = match (clean_code.is_empty(), clean_name.is_empty()) {
        (false, false) => format!("# {clean_code} {clean_name}"),
        (false, true) => format!("# {clean_code}"),
        (true, false) => format!("# {clean_name}"),
        (true, true) => "# 未命名任务".to_string(),
    };
    let commit_msg = if clean_code.is_empty() {
        if clean_name.is_empty() {
            "feat: 任务更新".to_string()
        } else {
            format!("feat: {clean_name}")
        }
    } else if clean_name.is_empty() {
        format!("#{clean_code}")
    } else {
        format!("#{clean_code} {clean_name}")
    };
    let code_cell = if clean_code.is_empty() {
        "（无任务号）"
    } else {
        clean_code
    };
    let tpl = r#"{title}

| 项目 | 内容 |
|---|---|
| 任务号 | {code_cell} |
| 卡片ID | {card_id} |
| 迭代 | {sprint} |
| 开始日期 | {start_date} |
| 计划提测 | {plan_test_date} |
| 发版日期 | {release_date} |
| 开发分支 | {branch} |
| 提交使用 | {commit_msg} |
| 状态 | {status} |

## 1. 需求描述
- 背景：
- 目标：
- 验收标准：

## 2. 影响范围
- [ ] 核心服务仓库
- [ ] 关联服务仓库（按实际修改填写）
- [ ] 涉及 DDL  - [ ] 涉及 DML  - [ ] 涉及配置文件  - [ ] 涉及开关

## 3. 修改方案
### 3.1 方案概述
### 3.2 详细设计（类/方法/流程）
### 3.3 接口变更
| 接口 | 变更类型 | 说明 |
|---|---|---|
### 3.4 数据库变更
```sql
-- DDL / DML
```
### 3.5 配置变更

## 4. 排期
| 阶段 | 计划日期 | 实际日期 | 备注 |
|---|---|---|---|
| 方案设计 | | | |
| 开发 | | | |
| 自测 | | | |
| 提测(UAT) | {plan_test_date} | | |
| 发版 | {release_date} | | |

## 5. 开发任务拆分
- [ ] 

## 6. 自测记录
| 用例 | 步骤 | 预期 | 结果 |
|---|---|---|---|

## 7. 代码提交
| 仓库 | 分支 | 目标环境 | MR 链接 | 状态 |
|---|---|---|---|---|

提交使用（复制即用）：
```
{commit_msg}
```

详细提交信息模板：
```
{commit_msg}
- 修改点1
- 修改点2
```

## 8. 发版记录
- UAT 发布日期：
- 生产发版日期：{release_date}
- 检查单：评审[ ] 设计[ ] 开发[ ] 测试[ ]
- 附件：设计附件[ ] 研发附件[ ] 测试附件[ ]

## 9. 问题与备注
"#;

    tpl.replace("{title}", &title)
        .replace("{code_cell}", code_cell)
        .replace("{card_id}", &card_id_str)
        .replace("{sprint}", meta.sprint.trim())
        .replace("{start_date}", meta.start_date.trim())
        .replace("{plan_test_date}", meta.plan_test_date.trim())
        .replace("{release_date}", meta.release_date.trim())
        .replace("{branch}", branch.trim())
        .replace("{commit_msg}", &commit_msg)
        .replace("{status}", status.trim())
}

fn render_requirement_md(rec: &TaskRecord) -> String {
    let meta = TaskScaffoldMeta {
        code: &rec.code,
        name: &rec.name,
        sprint: &rec.sprint,
        start_date: &rec.start_date,
        plan_test_date: &rec.plan_test_date,
        release_date: &rec.release_date,
    };
    render_requirement_md_from_meta(&meta, rec.card_id, &rec.status, &rec.branch)
}

fn render_query_sql_template(meta: &TaskScaffoldMeta<'_>) -> String {
    let code_disp = if meta.code.trim().is_empty() {
        "（无任务号）"
    } else {
        meta.code.trim()
    };
    let name_disp = if meta.name.trim().is_empty() {
        "未命名任务"
    } else {
        meta.name.trim()
    };
    let sprint_disp = if meta.sprint.trim().is_empty() {
        "-"
    } else {
        meta.sprint.trim()
    };
    let start_disp = if meta.start_date.trim().is_empty() {
        today_ymd()
    } else {
        meta.start_date.trim().to_string()
    };
    format!(
        r#"-- ============================================================
-- 任务查询 SQL 脚本
-- 任务号: {code_disp}
-- 任务名: {name_disp}
-- 所属迭代: {sprint_disp}
-- 创建日期: {start_disp}
-- ============================================================

-- 1. 核心业务主表排查查询
SELECT
    t.*
FROM biz_main_table t
WHERE 1 = 1
  -- AND t.order_no IN ('')
  AND t.created_at >= '{start_disp} 00:00:00'
ORDER BY t.id DESC
LIMIT 100;

-- 2. 关联明细与状态流转记录核查
SELECT
    d.id,
    d.biz_no,
    d.status,
    d.updated_at
FROM biz_detail_table d
WHERE d.biz_no IN ('')
ORDER BY d.updated_at DESC;

-- 3. 状态分布统计（上线/验证前后对比）
SELECT
    status,
    COUNT(*) AS total_cnt
FROM biz_main_table
WHERE created_at >= '{start_disp} 00:00:00'
GROUP BY status;

-- 4. 变更前备份 / 回滚验证脚本（按需取消注释并限定精确主键）
-- CREATE TABLE bak_biz_main_{code_tag} AS
-- SELECT * FROM biz_main_table WHERE id IN ();
"#,
        code_tag = sanitize_part(if meta.code.trim().is_empty() { "task" } else { meta.code.trim() })
            .replace('-', "_")
    )
}

fn render_design_template_md(meta: &TaskScaffoldMeta<'_>) -> String {
    let code_disp = if meta.code.trim().is_empty() { "（无任务号）" } else { meta.code.trim() };
    let name_disp = if meta.name.trim().is_empty() { "未命名任务" } else { meta.name.trim() };
    format!(
        r#"# 设计说明书 · {code_disp} {name_disp}

| 属性 | 内容 |
|---|---|
| 任务号 | {code_disp} |
| 需求名称 | {name_disp} |
| 所属版本/迭代 | {sprint} |
| 计划提测 | {plan_test} |
| 发版日期 | {release} |

## 1. 需求背景与业务目标
- 业务痛点 / 触发原因：
- 核心改造成果与验收指标：

## 2. 总体方案与交互/数据流设计
- 整体流程说明：
- 状态机 / 时序关键节点：

## 3. 详细技术设计
### 3.1 涉及工程模块与核心类改造
| 工程仓库 | 模块 / 类名 | 改造说明 | 影响评估 |
|---|---|---|---|
| | | | |

### 3.2 接口契约与字段变更
| 接口路径 / 方法 | 入参变更 | 出参变更 | 兼容性说明 |
|---|---|---|---|
| | | | |

### 3.3 数据库与缓存设计
- DDL / 索引变更：
- Redis / 本地缓存 Key 规范与过期策略：

### 3.4 配置项与灰度开关
| 配置项 / 开关 Key | 默认值 | 生效环境 | 降级策略 |
|---|---|---|---|
| | | | |

## 4. 风险评估与兼容性说明
- 存量数据兼容：
- 幂等性 / 并发控制：
- 异常兜底与监控告警：
"#,
        sprint = meta.sprint.trim(),
        plan_test = meta.plan_test_date.trim(),
        release = meta.release_date.trim(),
    )
}

fn render_dev_template_md(meta: &TaskScaffoldMeta<'_>) -> String {
    let code_disp = if meta.code.trim().is_empty() { "（无任务号）" } else { meta.code.trim() };
    let name_disp = if meta.name.trim().is_empty() { "未命名任务" } else { meta.name.trim() };
    format!(
        r#"# 开发自测与变更说明 · {code_disp} {name_disp}

| 属性 | 内容 |
|---|---|
| 任务号 | {code_disp} |
| 需求名称 | {name_disp} |
| 所属版本/迭代 | {sprint} |
| 自测日期 | {today} |

## 1. 代码变更清单
| 仓库名称 | 开发分支 | 合并环境 | 核心变更摘要 |
|---|---|---|---|
| | | SIT / UAT | |

## 2. 核心实现与逻辑说明
- 主要实现要点：
- 边界条件处理：

## 3. 开发编码自检清单
- [ ] 已确认空指针、集合越界、除零与并发锁边界校验
- [ ] 关键写操作已具备防重/幂等校验及事务回滚保障
- [ ] 敏感字段未打印明文日志，关键异常均有清晰日志定位
- [ ] 相关单元测试与本地/SIT 联调通过

## 4. 开发单元与接口自测记录
| 序号 | 自测场景 | 输入/前置条件 | 预期结果 | 实际结果 | 结论 |
|---|---|---|---|---|---|
| 1 | 正向主流程 | | | | [ ] 通过 |
| 2 | 参数校验/异常分支 | | | | [ ] 通过 |
| 3 | 幂等防重/边界条件 | | | | [ ] 通过 |

## 5. 上线步骤与回滚预案
- 发布前前置动作（SQL / 配置 / 开关）：
- 异常回滚步骤：
"#,
        sprint = meta.sprint.trim(),
        today = today_ymd(),
    )
}

fn render_test_template_md(meta: &TaskScaffoldMeta<'_>) -> String {
    let code_disp = if meta.code.trim().is_empty() { "（无任务号）" } else { meta.code.trim() };
    let name_disp = if meta.name.trim().is_empty() { "未命名任务" } else { meta.name.trim() };
    format!(
        r#"# 测试报告与用例记录 · {code_disp} {name_disp}

| 属性 | 内容 |
|---|---|
| 任务号 | {code_disp} |
| 需求名称 | {name_disp} |
| 所属版本/迭代 | {sprint} |
| 验证环境 | SIT / UAT |
| 计划提测 | {plan_test} |

## 1. 测试范围与环境说明
- 测试范围（新增功能 / 改造模块 / 回归范围）：
- 依赖服务与测试账号/基础数据准备：

## 2. 功能测试用例与执行结果
| 用例编号 | 模块/场景 | 前置条件 | 操作步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| TC-01 | 主流程正向验证 | | | | | [ ] Pass |
| TC-02 | 业务规则与字段校验 | | | | | [ ] Pass |
| TC-03 | 异常场景与报错提示 | | | | | [ ] Pass |
| TC-04 | 历史数据与关联回归 | | | | | [ ] Pass |

## 3. 数据库落库与日志核验
- 关键表字段落库核查结果：
- 异步消息 / 定时任务 / 回调通知验证：

## 4. 缺陷统计与遗留说明
- 发现缺陷数 / 已修复关闭数：
- 遗留风险与注意事项：

## 5. 测试准出结论
- [ ] 符合准出标准，建议通过验收并推进发版
"#,
        sprint = meta.sprint.trim(),
        plan_test = meta.plan_test_date.trim(),
    )
}

fn has_any_non_hidden_file(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with('.') && entry.path().is_file() {
            return true;
        }
    }
    false
}

fn find_first_sql_file(dir: &Path) -> Option<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return None;
    };
    let mut matches: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_file() {
                return None;
            }
            let ext = p.extension()?.to_str()?.to_ascii_lowercase();
            if ext == "sql" {
                let name = e.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    return Some((name, p));
                }
            }
            None
        })
        .collect();
    matches.sort_by(|a, b| a.0.cmp(&b.0));
    matches.into_iter().next()
}

pub fn ensure_task_scaffold(dir: &Path, meta: &TaskScaffoldMeta<'_>, card_id: Option<i64>, status: &str, branch: &str) -> Result<(), String> {
    let attach_root = dir.join("附件");
    let design_dir = attach_root.join("设计附件");
    let dev_dir = attach_root.join("开发附件");
    let test_dir = attach_root.join("测试附件");

    for d in [&design_dir, &dev_dir, &test_dir] {
        fs::create_dir_all(d)
            .map_err(|e| format!("创建附件子目录失败 {}: {e}", d.display()))?;
    }

    let prefix = task_doc_prefix(meta.code, meta.name);

    let md_path = dir.join("需求描述.md");
    if !md_path.exists() {
        let md = render_requirement_md_from_meta(meta, card_id, status, branch);
        atomic_write_text(&md_path, &md)?;
    }

    if find_first_sql_file(dir).is_none() {
        let sql_path = dir.join(format!("{prefix}-查询脚本.sql"));
        if !sql_path.exists() {
            let sql = render_query_sql_template(meta);
            atomic_write_text(&sql_path, &sql)?;
        }
    }

    if !has_any_non_hidden_file(&design_dir) {
        let p = design_dir.join(format!("{prefix}-设计说明书.md"));
        atomic_write_text(&p, &render_design_template_md(meta))?;
    }
    if !has_any_non_hidden_file(&dev_dir) {
        let p = dev_dir.join(format!("{prefix}-开发自测与变更说明.md"));
        atomic_write_text(&p, &render_dev_template_md(meta))?;
    }
    if !has_any_non_hidden_file(&test_dir) {
        let p = test_dir.join(format!("{prefix}-测试报告与用例.md"));
        atomic_write_text(&p, &render_test_template_md(meta))?;
    }

    Ok(())
}

fn find_task_dir(tasks_dir: &Path, code: &str) -> Option<(PathBuf, String)> {
    if !tasks_dir.exists() {
        return None;
    }
    let clean_code = sanitize_part(code);
    let prefix = format!("{code}-");
    let clean_prefix = format!("{clean_code}-");
    let entries = fs::read_dir(tasks_dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name == code
            || dir_name.starts_with(&prefix)
            || (!clean_code.is_empty()
                && (dir_name == clean_code || dir_name.starts_with(&clean_prefix)))
        {
            return Some((p, dir_name));
        }
        // Fallback: check task.json inside dir in case code contains special chars or custom folder
        let tj = p.join("task.json");
        if tj.exists() {
            if let Ok(raw) = fs::read_to_string(&tj) {
                if let Ok(rec) = serde_json::from_str::<TaskRecord>(&raw) {
                    if rec.code == code {
                        return Some((p, dir_name));
                    }
                }
            }
        }
    }
    None
}

fn read_or_init_task_json(dir: &Path, folder_name: &str) -> Result<TaskRecord, String> {
    let tj = dir.join("task.json");
    if tj.exists() {
        let raw = fs::read_to_string(&tj).map_err(|e| format!("读取 task.json 失败: {e}"))?;
        let mut rec: TaskRecord =
            serde_json::from_str(&raw).map_err(|e| format!("解析 task.json 失败: {e}"))?;
        if rec.folder_name.is_empty() {
            rec.folder_name = folder_name.to_string();
        }
        if rec.status.is_empty() {
            rec.status = "进行中".to_string();
        }
        return Ok(rec);
    }

    // 只有文件夹、没有 task.json：code = 目录名第一个 '-' 之前的部分
    let code = folder_name
        .split('-')
        .next()
        .unwrap_or(folder_name)
        .trim()
        .to_string();
    let name = folder_name
        .split_once('-')
        .map(|(_, rest)| rest.trim().to_string())
        .unwrap_or_default();
    let now = now_iso();
    let rec = TaskRecord {
        code,
        card_id: None,
        name,
        sprint: String::new(),
        sprint_start: String::new(),
        sprint_end: String::new(),
        start_date: today_ymd(),
        release_date: String::new(),
        plan_test_date: String::new(),
        status: "进行中".to_string(),
        progress: 0,
        repos: Vec::new(),
        branch: String::new(),
        branches: Vec::new(),
        tags: Vec::new(),
        notes: String::new(),
        folder_name: folder_name.to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
        history: vec![TaskHistoryItem {
            at: now,
            event: "补全创建".to_string(),
        }],
    };
    atomic_write_json(&tj, &rec)?;
    Ok(rec)
}

pub fn tasks_list_in_root(root: &Path) -> Result<Vec<TaskRecord>, String> {
    let tdir = tasks_root_dir(root);
    if !tdir.exists() {
        return Ok(Vec::new());
    }
    let mut list = Vec::new();
    let entries = fs::read_dir(&tdir).map_err(|e| format!("扫描任务目录失败: {e}"))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        if folder_name.starts_with('.') {
            continue;
        }
        match read_or_init_task_json(&p, &folder_name) {
            Ok(rec) => list.push(rec),
            Err(_) => continue,
        }
    }
    list.sort_by(|a, b| {
        b.start_date
            .cmp(&a.start_date)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| b.code.cmp(&a.code))
    });
    Ok(list)
}

pub fn tasks_sync_in_root(root: &Path, items: Vec<TaskSyncItem>) -> Result<TasksSyncResult, String> {
    let tdir = tasks_root_dir(root);
    fs::create_dir_all(&tdir).map_err(|e| format!("创建任务根目录失败: {e}"))?;

    let mut created = 0u32;
    let mut updated = 0u32;
    let now = now_iso();
    let today = today_ymd();

    for item in items {
        let code = item.code.trim().to_string();
        if code.is_empty() {
            continue;
        }
        let in_name = item.name.as_deref().unwrap_or("").trim().to_string();
        let in_sprint = item.sprint.as_deref().unwrap_or("").trim().to_string();
        let in_sp_start = item.sprint_start.as_deref().unwrap_or("").trim().to_string();
        let in_sp_end = item.sprint_end.as_deref().unwrap_or("").trim().to_string();
        let in_plan_test = item.plan_test_date.as_deref().unwrap_or("").trim().to_string();

        if let Some((existing_dir, folder_name)) = find_task_dir(&tdir, &code) {
            let mut rec = read_or_init_task_json(&existing_dir, &folder_name)?;
            if !in_name.is_empty() {
                rec.name = in_name;
            }
            if !in_sprint.is_empty() {
                rec.sprint = in_sprint;
            }
            if item.card_id.is_some() {
                rec.card_id = item.card_id;
            }
            if !in_sp_start.is_empty() {
                rec.sprint_start = in_sp_start.clone();
                if rec.start_date.trim().is_empty() {
                    rec.start_date = in_sp_start;
                }
            }
            if !in_sp_end.is_empty() {
                rec.sprint_end = in_sp_end.clone();
                if rec.release_date.trim().is_empty() {
                    rec.release_date = in_sp_end;
                    if is_pending_release_confirmation(&rec, &today) {
                        rec.status = "已发版".to_string();
                        rec.progress = 100;
                        rec.history.push(TaskHistoryItem {
                            at: now.clone(),
                            event: "发版日期早于当前日期，自动标为已发版".to_string(),
                        });
                    }
                }
            }
            if !in_plan_test.is_empty() {
                rec.plan_test_date = in_plan_test;
            }
            rec.updated_at = now.clone();
            atomic_write_json(&existing_dir.join("task.json"), &rec)?;

            let md_path = existing_dir.join("需求描述.md");
            if !md_path.exists() {
                let md = render_requirement_md(&rec);
                atomic_write_text(&md_path, &md)?;
            }
            let meta = TaskScaffoldMeta {
                code: &rec.code,
                name: &rec.name,
                sprint: &rec.sprint,
                start_date: &rec.start_date,
                plan_test_date: &rec.plan_test_date,
                release_date: &rec.release_date,
            };
            ensure_task_scaffold(&existing_dir, &meta, rec.card_id, &rec.status, &rec.branch)?;
            updated += 1;
        } else {
            let folder_name = sanitize_folder_name(&code, &in_name);
            let dir = tdir.join(&folder_name);
            fs::create_dir_all(dir.join("附件"))
                .map_err(|e| format!("创建任务文件夹失败: {e}"))?;

            let start_date = if !in_sp_start.is_empty() {
                in_sp_start.clone()
            } else {
                today.clone()
            };
            let release_date = in_sp_end.clone();
            let (status, create_event) = if is_release_date_before_today(&release_date, &today) {
                (
                    "已发版".to_string(),
                    "创建（发版日期早于当前日期，自动标为已发版）".to_string(),
                )
            } else {
                ("进行中".to_string(), "创建".to_string())
            };
            let progress = if status == "已发版" || status == "已关闭" {
                100
            } else {
                0
            };

            let rec = TaskRecord {
                code: code.clone(),
                card_id: item.card_id,
                name: in_name,
                sprint: in_sprint,
                sprint_start: in_sp_start,
                sprint_end: in_sp_end,
                start_date,
                release_date,
                plan_test_date: in_plan_test,
                status,
                progress,
                repos: Vec::new(),
                branch: String::new(),
                branches: Vec::new(),
                tags: Vec::new(),
                notes: String::new(),
                folder_name,
                created_at: now.clone(),
                updated_at: now.clone(),
                history: vec![TaskHistoryItem {
                    at: now.clone(),
                    event: create_event,
                }],
            };

            atomic_write_json(&dir.join("task.json"), &rec)?;
            let meta = TaskScaffoldMeta {
                code: &rec.code,
                name: &rec.name,
                sprint: &rec.sprint,
                start_date: &rec.start_date,
                plan_test_date: &rec.plan_test_date,
                release_date: &rec.release_date,
            };
            ensure_task_scaffold(&dir, &meta, rec.card_id, &rec.status, &rec.branch)?;
            created += 1;
        }
    }

    let tasks = tasks_list_in_root(root)?;
    Ok(TasksSyncResult {
        created,
        updated,
        tasks,
    })
}

pub fn task_update_in_root(
    root: &Path,
    code: &str,
    patch: Value,
) -> Result<TaskRecord, String> {
    let tdir = tasks_root_dir(root);
    let (dir, folder_name) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let mut rec = read_or_init_task_json(&dir, &folder_name)?;
    let obj = patch
        .as_object()
        .ok_or_else(|| "patch 必须是 JSON 对象".to_string())?;
    let now = now_iso();
    let today = today_ymd();
    let explicit_status = obj
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let explicit_progress = obj
        .get("progress")
        .and_then(|v| v.as_u64())
        .map(|n| n.min(100) as u8);

    if let Some(v) = obj.get("startDate").and_then(|v| v.as_str()) {
        rec.start_date = v.trim().to_string();
    }
    if let Some(v) = obj.get("releaseDate").and_then(|v| v.as_str()) {
        let new_val = v.trim().to_string();
        if new_val != rec.release_date {
            rec.release_date = new_val.clone();
            rec.history.push(TaskHistoryItem {
                at: now.clone(),
                event: format!(
                    "发版日期变更为 {}",
                    if new_val.is_empty() { "(空)" } else { &new_val }
                ),
            });
            if !explicit_status && is_pending_release_confirmation(&rec, &today) {
                rec.status = "已发版".to_string();
                if explicit_progress.is_none() {
                    rec.progress = 100;
                }
                rec.history.push(TaskHistoryItem {
                    at: now.clone(),
                    event: "发版日期早于当前日期，自动标为已发版".to_string(),
                });
            }
        }
    }
    if let Some(v) = obj.get("planTestDate").and_then(|v| v.as_str()) {
        rec.plan_test_date = v.trim().to_string();
    }
    if let Some(v) = obj.get("status").and_then(|v| v.as_str()) {
        let new_val = v.trim().to_string();
        if new_val != rec.status && !new_val.is_empty() {
            rec.status = new_val.clone();
            if explicit_progress.is_none() {
                if new_val == "已发版" || new_val == "已关闭" {
                    rec.progress = 100;
                } else if new_val == "未开始" {
                    rec.progress = 0;
                }
            }
            rec.history.push(TaskHistoryItem {
                at: now.clone(),
                event: format!("状态变更为 {new_val}"),
            });
        }
    }
    if let Some(p) = explicit_progress {
        if p != rec.progress {
            rec.progress = p;
            rec.history.push(TaskHistoryItem {
                at: now.clone(),
                event: format!("进度更新为 {p}%"),
            });
        }
    }
    if let Some(arr) = obj.get("repos").and_then(|v| v.as_array()) {
        rec.repos = arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(arr) = obj.get("branches") {
        if let Ok(parsed_branches) = serde_json::from_value::<Vec<TaskBranchRecord>>(arr.clone()) {
            rec.branches = parsed_branches
                .into_iter()
                .filter(|b| !b.branch.trim().is_empty())
                .collect();
            if !obj.contains_key("branch") {
                rec.branch = rec
                    .branches
                    .first()
                    .map(|b| b.branch.clone())
                    .unwrap_or_default();
            }
            rec.history.push(TaskHistoryItem {
                at: now.clone(),
                event: "更新分支记录".to_string(),
            });
        }
    }
    if let Some(v) = obj.get("branch").and_then(|v| v.as_str()) {
        rec.branch = v.trim().to_string();
    }
    if let Some(arr) = obj.get("tags").and_then(|v| v.as_array()) {
        rec.tags = arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(v) = obj.get("notes").and_then(|v| v.as_str()) {
        rec.notes = v.to_string();
    }

    rec.updated_at = now;
    atomic_write_json(&dir.join("task.json"), &rec)?;
    Ok(rec)
}

fn push_unique_strings(target: &mut Vec<String>, items: impl IntoIterator<Item = String>) {
    for raw in items {
        let item = raw.trim().to_string();
        if !item.is_empty() && !target.iter().any(|x| x == &item) {
            target.push(item);
        }
    }
}

fn short_repo_name(repo: &str) -> String {
    let trimmed = repo.trim();
    trimmed
        .split('/')
        .next_back()
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

pub fn task_record_branch_in_root(
    root: &Path,
    input: RecordTaskBranchInput,
) -> Result<TaskRecord, String> {
    let clean_code = input.code.trim().to_string();
    if clean_code.is_empty() {
        return Err("任务号不能为空".to_string());
    }
    let clean_branch = input.branch.trim().to_string();
    if clean_branch.is_empty() {
        return Err("分支名不能为空".to_string());
    }
    let clean_ref = input.ref_branch.trim().to_string();
    let source = input
        .source
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "create_branch".to_string());

    let tdir = tasks_root_dir(root);
    fs::create_dir_all(&tdir).map_err(|e| format!("创建任务根目录失败: {e}"))?;

    let (dir, folder_name) = match find_task_dir(&tdir, &clean_code) {
        Some(found) => found,
        None => {
            tasks_sync_in_root(
                root,
                vec![TaskSyncItem {
                    code: clean_code.clone(),
                    card_id: None,
                    name: input
                        .name
                        .clone()
                        .filter(|n| !n.trim().is_empty())
                        .or_else(|| Some(clean_code.clone())),
                    sprint: None,
                    sprint_start: None,
                    sprint_end: None,
                    plan_test_date: None,
                }],
            )?;
            find_task_dir(&tdir, &clean_code)
                .ok_or_else(|| format!("自动创建任务目录失败: {clean_code}"))?
        }
    };

    let mut rec = read_or_init_task_json(&dir, &folder_name)?;
    let now = now_iso();

    let mut clean_repos = Vec::new();
    push_unique_strings(&mut clean_repos, input.repos.iter().cloned());

    let mut short_repos = Vec::new();
    push_unique_strings(
        &mut short_repos,
        clean_repos.iter().map(|r| short_repo_name(r)),
    );

    if let Some(pos) = rec.branches.iter().position(|b| {
        b.branch == clean_branch
            && (b.ref_branch == clean_ref || b.ref_branch.is_empty() || clean_ref.is_empty())
    }) {
        let mut entry = rec.branches.remove(pos);
        push_unique_strings(&mut entry.repos, clean_repos.iter().cloned());
        if entry.ref_branch.is_empty() && !clean_ref.is_empty() {
            entry.ref_branch = clean_ref.clone();
        }
        entry.created_at = now.clone();
        if !source.is_empty() {
            entry.source = source.clone();
        }
        rec.branches.insert(0, entry);
    } else {
        rec.branches.insert(
            0,
            TaskBranchRecord {
                branch: clean_branch.clone(),
                ref_branch: clean_ref.clone(),
                repos: clean_repos.clone(),
                created_at: now.clone(),
                source: source.clone(),
            },
        );
    }

    rec.branch = clean_branch.clone();
    push_unique_strings(&mut rec.repos, short_repos.iter().cloned());
    push_unique_strings(&mut rec.tags, input.tags);

    let repo_summary = if short_repos.is_empty() {
        String::new()
    } else {
        format!(" ({})", short_repos.join(", "))
    };
    let ref_summary = if clean_ref.is_empty() {
        String::new()
    } else {
        format!(" ← {clean_ref}")
    };
    let event = if source == "submit_mr" {
        format!("提交 MR 记录分支 {clean_branch}{repo_summary}")
    } else {
        format!("创建分支 {clean_branch}{ref_summary}{repo_summary}")
    };
    rec.history.push(TaskHistoryItem {
        at: now.clone(),
        event,
    });
    rec.updated_at = now;

    atomic_write_json(&dir.join("task.json"), &rec)?;
    Ok(rec)
}

pub fn tasks_confirm_released_in_root(
    root: &Path,
    codes: Option<Vec<String>>,
) -> Result<TasksBatchReleaseResult, String> {
    let tdir = tasks_root_dir(root);
    if !tdir.exists() {
        return Ok(TasksBatchReleaseResult {
            confirmed: 0,
            confirmed_codes: Vec::new(),
            tasks: Vec::new(),
        });
    }
    let target_set: HashSet<String> = codes
        .unwrap_or_default()
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();
    let today = today_ymd();
    let now = now_iso();
    let mut confirmed = 0u32;
    let mut confirmed_codes = Vec::new();

    let entries = fs::read_dir(&tdir).map_err(|e| format!("扫描任务目录失败: {e}"))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        if folder_name.starts_with('.') {
            continue;
        }
        let mut rec = match read_or_init_task_json(&p, &folder_name) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let matched = if !target_set.is_empty() {
            target_set.contains(&rec.code) && rec.status != "已发版"
        } else {
            is_pending_release_confirmation(&rec, &today)
        };
        if matched {
            rec.status = "已发版".to_string();
            rec.progress = 100;
            rec.history.push(TaskHistoryItem {
                at: now.clone(),
                event: "一键确认已发版".to_string(),
            });
            rec.updated_at = now.clone();
            atomic_write_json(&p.join("task.json"), &rec)?;
            confirmed += 1;
            confirmed_codes.push(rec.code);
        }
    }

    let tasks = tasks_list_in_root(root)?;
    Ok(TasksBatchReleaseResult {
        confirmed,
        confirmed_codes,
        tasks,
    })
}

pub fn task_read_md_in_root(root: &Path, code: &str) -> Result<String, String> {
    let tdir = tasks_root_dir(root);
    let (dir, folder_name) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let md_path = dir.join("需求描述.md");
    if !md_path.exists() {
        let rec = read_or_init_task_json(&dir, &folder_name)?;
        let md = render_requirement_md(&rec);
        atomic_write_text(&md_path, &md)?;
        return Ok(md);
    }
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    fs::read_to_string(&md_path).map_err(|e| format!("读取需求描述失败: {e}"))
}

pub fn task_write_md_in_root(root: &Path, code: &str, content: &str) -> Result<(), String> {
    let tdir = tasks_root_dir(root);
    let (dir, _) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    atomic_write_text(&dir.join("需求描述.md"), content)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkspaceDoc {
    pub key: String,
    pub label: String,
    pub category: String,
    pub rel_path: String,
    pub abs_path: String,
    pub dir_abs_path: String,
    pub upload_abs_path: String,
    pub ext: String,
}

fn pick_preferred_attachment_files(dir: &Path) -> (Option<(String, PathBuf)>, Option<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return (None, None);
    };
    let mut all_files: Vec<(String, PathBuf, std::time::SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        all_files.push((name, p, mtime));
    }
    all_files.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));

    let editable = all_files
        .iter()
        .find(|(_, p, _)| {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            crate::project_fs::is_text_editable_ext(ext)
        })
        .map(|(n, p, _)| (n.clone(), p.clone()));

    let preferred_upload = all_files
        .iter()
        .find(|(_, p, _)| {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            matches!(ext.as_str(), "docx" | "doc" | "pdf" | "xlsx" | "xls" | "zip")
        })
        .or_else(|| all_files.first())
        .map(|(_, p, _)| p.clone());

    (editable, preferred_upload)
}

pub fn task_get_workspace_docs_in_root(
    root: &Path,
    code: &str,
) -> Result<Vec<TaskWorkspaceDoc>, String> {
    let tdir = tasks_root_dir(root);
    let (dir, folder_name) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let rec = read_or_init_task_json(&dir, &folder_name)?;
    let meta = TaskScaffoldMeta {
        code: &rec.code,
        name: &rec.name,
        sprint: &rec.sprint,
        start_date: &rec.start_date,
        plan_test_date: &rec.plan_test_date,
        release_date: &rec.release_date,
    };
    ensure_task_scaffold(&dir, &meta, rec.card_id, &rec.status, &rec.branch)?;

    let mut docs = Vec::new();

    let md_path = dir.join("需求描述.md");
    docs.push(TaskWorkspaceDoc {
        key: "req".to_string(),
        label: "需求描述.md".to_string(),
        category: "req".to_string(),
        rel_path: "需求描述.md".to_string(),
        abs_path: md_path.to_string_lossy().to_string(),
        dir_abs_path: dir.to_string_lossy().to_string(),
        upload_abs_path: md_path.to_string_lossy().to_string(),
        ext: "md".to_string(),
    });

    if let Some((sql_name, sql_path)) = find_first_sql_file(&dir) {
        docs.push(TaskWorkspaceDoc {
            key: "sql".to_string(),
            label: sql_name.clone(),
            category: "sql".to_string(),
            rel_path: sql_name,
            abs_path: sql_path.to_string_lossy().to_string(),
            dir_abs_path: dir.to_string_lossy().to_string(),
            upload_abs_path: sql_path.to_string_lossy().to_string(),
            ext: "sql".to_string(),
        });
    }

    let attach_categories = [
        ("design", "设计模板", "附件/设计附件"),
        ("dev", "开发模板", "附件/开发附件"),
        ("test", "测试模板", "附件/测试附件"),
    ];
    for (cat, label, rel_sub) in attach_categories {
        let sub_dir = dir.join(rel_sub.replace('/', std::path::MAIN_SEPARATOR_STR));
        let (editable_opt, upload_opt) = pick_preferred_attachment_files(&sub_dir);
        if let Some((fname, fpath)) = editable_opt {
            let ext = fpath
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("md")
                .to_ascii_lowercase();
            let up = upload_opt
                .unwrap_or_else(|| fpath.clone())
                .to_string_lossy()
                .to_string();
            docs.push(TaskWorkspaceDoc {
                key: cat.to_string(),
                label: label.to_string(),
                category: cat.to_string(),
                rel_path: format!("{rel_sub}/{fname}"),
                abs_path: fpath.to_string_lossy().to_string(),
                dir_abs_path: sub_dir.to_string_lossy().to_string(),
                upload_abs_path: up,
                ext,
            });
        } else if let Some(up_path) = upload_opt {
            docs.push(TaskWorkspaceDoc {
                key: cat.to_string(),
                label: label.to_string(),
                category: cat.to_string(),
                rel_path: String::new(),
                abs_path: up_path.to_string_lossy().to_string(),
                dir_abs_path: sub_dir.to_string_lossy().to_string(),
                upload_abs_path: up_path.to_string_lossy().to_string(),
                ext: up_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase(),
            });
        }
    }

    Ok(docs)
}

pub fn task_read_workspace_file_in_root(
    root: &Path,
    code: &str,
    rel_path: &str,
) -> Result<String, String> {
    let tdir = tasks_root_dir(root);
    let (dir, _) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let (target, _) = crate::project_fs::resolve_safe_subpath(&dir, rel_path)?;
    if !target.is_file() {
        return Err(format!("文件不存在: {rel_path}"));
    }
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !crate::project_fs::is_text_editable_ext(ext) {
        return Err(format!("不支持在线读取的文件类型: .{ext}"));
    }
    fs::read_to_string(&target).map_err(|e| format!("读取任务文档失败: {e}"))
}

pub fn task_write_workspace_file_in_root(
    root: &Path,
    code: &str,
    rel_path: &str,
    content: String,
) -> Result<(), String> {
    let tdir = tasks_root_dir(root);
    let (dir, _) = find_task_dir(&tdir, code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let (target, _) = crate::project_fs::resolve_safe_subpath(&dir, rel_path)?;
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !crate::project_fs::is_text_editable_ext(ext) {
        return Err(format!("不支持在线保存的文件类型: .{ext}"));
    }
    atomic_write_text(&target, &content)
}

#[tauri::command]
pub fn tasks_sync(app: AppHandle, items: Vec<TaskSyncItem>) -> Result<TasksSyncResult, String> {
    let root = data_root_dir(&app)?;
    tasks_sync_in_root(&root, items)
}

#[tauri::command]
pub fn tasks_list(app: AppHandle) -> Result<Vec<TaskRecord>, String> {
    let root = data_root_dir(&app)?;
    tasks_list_in_root(&root)
}

#[tauri::command]
pub fn task_create(app: AppHandle, code: String, name: String) -> Result<TaskRecord, String> {
    let clean_code = code.trim().to_string();
    let clean_name = name.trim().to_string();
    if clean_code.is_empty() && clean_name.is_empty() {
        return Err("任务号和任务名称不能同时为空".to_string());
    }
    let root = data_root_dir(&app)?;
    let resolved_code = if clean_code.is_empty() {
        let base = format!("自建-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
        let tdir = tasks_root_dir(&root);
        let mut candidate = base.clone();
        let mut n = 2usize;
        while find_task_dir(&tdir, &candidate).is_some() {
            candidate = format!("{base}-{n}");
            n += 1;
        }
        candidate
    } else {
        clean_code
    };
    let res = tasks_sync_in_root(
        &root,
        vec![TaskSyncItem {
            code: resolved_code.clone(),
            card_id: None,
            name: Some(clean_name),
            sprint: None,
            sprint_start: None,
            sprint_end: None,
            plan_test_date: None,
        }],
    )?;
    res.tasks
        .into_iter()
        .find(|t| t.code == resolved_code)
        .ok_or_else(|| "创建后读取任务记录失败".to_string())
}

#[tauri::command]
pub fn task_get_workspace_docs(
    app: AppHandle,
    code: String,
) -> Result<Vec<TaskWorkspaceDoc>, String> {
    let root = data_root_dir(&app)?;
    task_get_workspace_docs_in_root(&root, &code)
}

#[tauri::command]
pub fn task_read_workspace_file(
    app: AppHandle,
    code: String,
    rel_path: String,
) -> Result<String, String> {
    let root = data_root_dir(&app)?;
    task_read_workspace_file_in_root(&root, &code, &rel_path)
}

#[tauri::command]
pub fn task_write_workspace_file(
    app: AppHandle,
    code: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    task_write_workspace_file_in_root(&root, &code, &rel_path, content)
}

#[tauri::command]
pub fn task_update(app: AppHandle, code: String, patch: Value) -> Result<TaskRecord, String> {
    let root = data_root_dir(&app)?;
    task_update_in_root(&root, &code, patch)
}

#[tauri::command]
pub fn task_record_branch(
    app: AppHandle,
    input: RecordTaskBranchInput,
) -> Result<TaskRecord, String> {
    let root = data_root_dir(&app)?;
    task_record_branch_in_root(&root, input)
}

#[tauri::command]
pub fn tasks_confirm_released(
    app: AppHandle,
    codes: Option<Vec<String>>,
) -> Result<TasksBatchReleaseResult, String> {
    let root = data_root_dir(&app)?;
    tasks_confirm_released_in_root(&root, codes)
}

#[tauri::command]
pub fn task_read_md(app: AppHandle, code: String) -> Result<String, String> {
    let root = data_root_dir(&app)?;
    task_read_md_in_root(&root, &code)
}

#[tauri::command]
pub fn task_write_md(app: AppHandle, code: String, content: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    task_write_md_in_root(&root, &code, &content)
}

#[tauri::command]
pub fn task_open_folder(app: AppHandle, code: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let tdir = tasks_root_dir(&root);
    let (dir, _) = find_task_dir(&tdir, &code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开文件夹失败: {e}"))
}

#[tauri::command]
pub fn task_open_md(app: AppHandle, code: String) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    let tdir = tasks_root_dir(root.as_path());
    let (dir, folder_name) = find_task_dir(&tdir, &code)
        .ok_or_else(|| format!("未找到任务目录: {code}"))?;
    let md = dir.join("需求描述.md");
    if !md.exists() {
        let rec = read_or_init_task_json(&dir, &folder_name)?;
        atomic_write_text(&md, &render_requirement_md(&rec))?;
    }
    app.opener()
        .open_path(md.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开 Markdown 文件失败: {e}"))
}

#[tauri::command]
pub fn open_data_root(app: AppHandle) -> Result<(), String> {
    let root = data_root_dir(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建数据根目录失败: {e}"))?;
    app.opener()
        .open_path(root.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开数据根目录失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn test_sanitize_folder_name() {
        let s1 = sanitize_folder_name("TASK-0001", "测试/需求\\名称:*?\"<>|\r\n结尾... ");
        assert!(!s1.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\r', '\n']));
        assert!(!s1.ends_with('.'));
        assert!(!s1.ends_with(' '));
        assert!(s1.starts_with("TASK-0001-"));

        let long_name = "一".repeat(120);
        let s2 = sanitize_folder_name("CODE01", &long_name);
        assert!(s2.chars().count() <= 80);

        let s3 = sanitize_folder_name("CODE02", "   ");
        assert_eq!(s3, "CODE02");
    }

    #[test]
    fn test_tasks_sync_idempotent_and_preserves_user_edits() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        let res1 = tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: "TASK-0001".into(),
                card_id: Some(90465),
                name: Some("初始需求名称".into()),
                sprint: Some("2026-11迭代".into()),
                sprint_start: Some("2026-11-01".into()),
                sprint_end: Some("2026-11-28".into()),
                plan_test_date: None,
            }],
        )
        .unwrap();
        assert_eq!(res1.created, 1);
        assert_eq!(res1.updated, 0);

        // Edit startDate and releaseDate and 需求描述.md locally
        task_update_in_root(
            root,
            "TASK-0001",
            json!({
                "startDate": "2026-11-03",
                "releaseDate": "2026-12-05"
            }),
        )
        .unwrap();
        task_write_md_in_root(root, "TASK-0001", "# 我的自定义内容\n保留此行\n").unwrap();

        // Sync again with a renamed card name and different sprint dates
        let res2 = tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: "TASK-0001".into(),
                card_id: Some(90465),
                name: Some("改名后的需求名称".into()),
                sprint: Some("2026-12迭代".into()),
                sprint_start: Some("2026-12-01".into()),
                sprint_end: Some("2026-12-31".into()),
                plan_test_date: Some("2026-12-10".into()),
            }],
        )
        .unwrap();
        assert_eq!(res2.created, 0);
        assert_eq!(res2.updated, 1);

        // Must still only be ONE directory
        let dirs: Vec<_> = fs::read_dir(tasks_root_dir(root))
            .unwrap()
            .flatten()
            .filter(|e| e.path().is_dir())
            .collect();
        assert_eq!(dirs.len(), 1);
        assert_eq!(
            dirs[0].file_name().to_string_lossy(),
            "TASK-0001-初始需求名称"
        );

        // User-edited startDate, releaseDate, and md content must be preserved
        let tasks = tasks_list_in_root(root).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].name, "改名后的需求名称");
        assert_eq!(tasks[0].start_date, "2026-11-03");
        assert_eq!(tasks[0].release_date, "2026-12-05");
        assert_eq!(tasks[0].plan_test_date, "2026-12-10");
        let md = task_read_md_in_root(root, "TASK-0001").unwrap();
        assert!(md.contains("我的自定义内容"));
    }

    #[test]
    fn test_tasks_list_builds_minimal_json_when_missing() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let dir = tasks_root_dir(root).join("622416-无json的历史目录");
        fs::create_dir_all(&dir).unwrap();

        let list = tasks_list_in_root(root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].code, "622416");
        assert!(dir.join("task.json").exists());
    }

    #[test]
    fn test_past_release_date_auto_marked_released_on_sync_and_update() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        let sync_res = tasks_sync_in_root(
            root,
            vec![
                TaskSyncItem {
                    code: "PAST-001".into(),
                    card_id: None,
                    name: Some("历史上线需求".into()),
                    sprint: None,
                    sprint_start: Some("2019-12-01".into()),
                    sprint_end: Some("2020-01-01".into()),
                    plan_test_date: None,
                },
                TaskSyncItem {
                    code: "FUTURE-002".into(),
                    card_id: None,
                    name: Some("未来排期需求".into()),
                    sprint: None,
                    sprint_start: Some("2099-12-01".into()),
                    sprint_end: Some("2099-12-31".into()),
                    plan_test_date: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(sync_res.created, 2);

        let past = sync_res.tasks.iter().find(|t| t.code == "PAST-001").unwrap();
        assert_eq!(past.status, "已发版");
        let past_md = task_read_md_in_root(root, "PAST-001").unwrap();
        assert!(past_md.contains("| 状态 | 已发版 |"));

        let future = sync_res
            .tasks
            .iter()
            .find(|t| t.code == "FUTURE-002")
            .unwrap();
        assert_eq!(future.status, "进行中");

        // Changing releaseDate to past date auto-marks status as 已发版
        let updated = task_update_in_root(
            root,
            "FUTURE-002",
            json!({ "releaseDate": "2020-02-02" }),
        )
        .unwrap();
        assert_eq!(updated.status, "已发版");

        // Explicit status patch alongside past releaseDate respects user choice
        let reverted = task_update_in_root(
            root,
            "FUTURE-002",
            json!({ "releaseDate": "2020-02-03", "status": "进行中" }),
        )
        .unwrap();
        assert_eq!(reverted.status, "进行中");
    }

    #[test]
    fn test_tasks_confirm_released_batch_and_single() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        tasks_sync_in_root(
            root,
            vec![
                TaskSyncItem {
                    code: "OLD-A".into(),
                    card_id: None,
                    name: Some("待确认A".into()),
                    sprint: None,
                    sprint_start: None,
                    sprint_end: Some("2020-03-01".into()),
                    plan_test_date: None,
                },
                TaskSyncItem {
                    code: "OLD-B".into(),
                    card_id: None,
                    name: Some("待确认B".into()),
                    sprint: None,
                    sprint_start: None,
                    sprint_end: Some("2020-04-01".into()),
                    plan_test_date: None,
                },
                TaskSyncItem {
                    code: "NEXT-C".into(),
                    card_id: None,
                    name: Some("未来C".into()),
                    sprint: None,
                    sprint_start: None,
                    sprint_end: Some("2099-12-31".into()),
                    plan_test_date: None,
                },
            ],
        )
        .unwrap();

        // Simulate legacy unconfirmed records where status remained 进行中 despite past releaseDate
        task_update_in_root(root, "OLD-A", json!({ "status": "进行中" })).unwrap();
        task_update_in_root(root, "OLD-B", json!({ "status": "已提测" })).unwrap();

        // Single target confirmation confirms only OLD-A
        let single_res =
            tasks_confirm_released_in_root(root, Some(vec!["OLD-A".to_string()])).unwrap();
        assert_eq!(single_res.confirmed, 1);
        assert_eq!(single_res.confirmed_codes, vec!["OLD-A".to_string()]);
        assert_eq!(
            single_res
                .tasks
                .iter()
                .find(|t| t.code == "OLD-A")
                .unwrap()
                .status,
            "已发版"
        );
        assert_eq!(
            single_res
                .tasks
                .iter()
                .find(|t| t.code == "OLD-B")
                .unwrap()
                .status,
            "已提测"
        );

        // Batch confirmation (None) confirms remaining overdue OLD-B without touching future NEXT-C
        let batch_res = tasks_confirm_released_in_root(root, None).unwrap();
        assert_eq!(batch_res.confirmed, 1);
        assert_eq!(batch_res.confirmed_codes, vec!["OLD-B".to_string()]);
        assert_eq!(
            batch_res
                .tasks
                .iter()
                .find(|t| t.code == "OLD-B")
                .unwrap()
                .status,
            "已发版"
        );
        assert_eq!(
            batch_res
                .tasks
                .iter()
                .find(|t| t.code == "NEXT-C")
                .unwrap()
                .status,
            "进行中"
        );
    }

    #[test]
    fn test_task_record_branch_autocreates_merges_and_keeps_multiple() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        // 1. Recording a branch on a non-existent task auto-creates its folder & records branch + short repos + tags
        let rec1 = task_record_branch_in_root(
            root,
            RecordTaskBranchInput {
                code: "TASK-0001".into(),
                name: Some("分支记录测试".into()),
                branch: "TASK-0001-DEV-SIT".into(),
                ref_branch: "SIT".into(),
                repos: vec!["GROUP!TEAM/repo-a".into()],
                tags: vec!["A".into()],
                source: Some("create_branch".into()),
            },
        )
        .unwrap();
        assert_eq!(rec1.branch, "TASK-0001-DEV-SIT");
        assert_eq!(rec1.branches.len(), 1);
        assert_eq!(rec1.branches[0].ref_branch, "SIT");
        assert_eq!(rec1.branches[0].repos, vec!["GROUP!TEAM/repo-a".to_string()]);
        assert_eq!(rec1.repos, vec!["repo-a".to_string()]);
        assert_eq!(rec1.tags, vec!["A".to_string()]);

        // 2. Recording the same branch with another repo merges repos instead of duplicating entry
        let rec2 = task_record_branch_in_root(
            root,
            RecordTaskBranchInput {
                code: "TASK-0001".into(),
                name: None,
                branch: "TASK-0001-DEV-SIT".into(),
                ref_branch: "SIT".into(),
                repos: vec!["GROUP!TEAM/repo-b".into()],
                tags: vec!["B".into()],
                source: None,
            },
        )
        .unwrap();
        assert_eq!(rec2.branches.len(), 1);
        assert_eq!(
            rec2.branches[0].repos,
            vec!["GROUP!TEAM/repo-a".to_string(), "GROUP!TEAM/repo-b".to_string()]
        );
        assert_eq!(rec2.repos, vec!["repo-a".to_string(), "repo-b".to_string()]);
        assert_eq!(rec2.tags, vec!["A".to_string(), "B".to_string()]);

        // 3. Recording a second branch keeps both branches ordered newest-first
        let rec3 = task_record_branch_in_root(
            root,
            RecordTaskBranchInput {
                code: "TASK-0001".into(),
                name: None,
                branch: "TASK-0001-DEV-UAT".into(),
                ref_branch: "UAT".into(),
                repos: vec!["GROUP!TEAM/repo-c".into()],
                tags: vec![],
                source: Some("create_branch".into()),
            },
        )
        .unwrap();
        assert_eq!(rec3.branches.len(), 2);
        assert_eq!(rec3.branches[0].branch, "TASK-0001-DEV-UAT");
        assert_eq!(rec3.branches[1].branch, "TASK-0001-DEV-SIT");
        assert_eq!(rec3.branch, "TASK-0001-DEV-UAT");

        // 4. Removing the top branch via task_update_in_root syncs rec.branch to remaining top branch
        let remaining = vec![rec3.branches[1].clone()];
        let rec4 = task_update_in_root(
            root,
            "TASK-0001",
            json!({ "branches": remaining }),
        )
        .unwrap();
        assert_eq!(rec4.branches.len(), 1);
        assert_eq!(rec4.branch, "TASK-0001-DEV-SIT");
    }

    #[test]
    fn test_render_requirement_md_includes_hash_commit_msg() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let code = "TASK-0002";
        let name = "关于示例业务系统接口对接与流程优化需求的开发申请";

        tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: code.into(),
                card_id: Some(92164),
                name: Some(name.into()),
                sprint: None,
                sprint_start: None,
                sprint_end: None,
                plan_test_date: None,
            }],
        )
        .unwrap();

        let md = task_read_md_in_root(root, code).unwrap();
        let expected_commit = format!("#{code} {name}");
        assert!(md.contains(&format!("| 提交使用 | {expected_commit} |")));
        assert!(md.contains("提交使用（复制即用）："));
        assert!(md.contains(&format!("```\n{expected_commit}\n```")));
    }

    #[test]
    fn test_task_scaffold_creates_attachment_templates_and_sql() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: "TASK-8888".into(),
                card_id: Some(8888),
                name: Some("测试附件目录与SQL模板".into()),
                sprint: Some("20261218常规版本".into()),
                sprint_start: Some("2026-11-25".into()),
                sprint_end: Some("2026-12-18".into()),
                plan_test_date: None,
            }],
        )
        .unwrap();

        let docs = task_get_workspace_docs_in_root(root, "TASK-8888").unwrap();
        let keys: Vec<_> = docs.iter().map(|d| d.key.as_str()).collect();
        assert_eq!(keys, vec!["req", "sql", "design", "dev", "test"]);

        let sql_doc = docs.iter().find(|d| d.key == "sql").unwrap();
        assert!(sql_doc.rel_path.ends_with(".sql"));
        let sql_text = task_read_workspace_file_in_root(root, "TASK-8888", &sql_doc.rel_path).unwrap();
        assert!(sql_text.contains("TASK-8888"));

        let design_doc = docs.iter().find(|d| d.key == "design").unwrap();
        let design_text = task_read_workspace_file_in_root(root, "TASK-8888", &design_doc.rel_path).unwrap();
        assert!(design_text.contains("设计说明书"));

        // Edit SQL and verify re-sync preserves custom SQL edits
        task_write_workspace_file_in_root(
            root,
            "TASK-8888",
            &sql_doc.rel_path,
            "SELECT 42;\n".to_string(),
        )
        .unwrap();
        tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: "TASK-8888".into(),
                card_id: Some(8888),
                name: Some("测试附件目录与SQL模板".into()),
                sprint: None,
                sprint_start: None,
                sprint_end: None,
                plan_test_date: None,
            }],
        )
        .unwrap();
        let sql_after = task_read_workspace_file_in_root(root, "TASK-8888", &sql_doc.rel_path).unwrap();
        assert_eq!(sql_after, "SELECT 42;\n");
    }

    #[test]
    fn test_task_progress_clamp_and_status_sync() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        let synced = tasks_sync_in_root(
            root,
            vec![TaskSyncItem {
                code: "TASK-7777".into(),
                card_id: Some(7777),
                name: Some("进度滑块测试".into()),
                sprint: None,
                sprint_start: None,
                sprint_end: None,
                plan_test_date: None,
            }],
        )
        .unwrap();
        assert_eq!(synced.tasks[0].progress, 0);

        let updated = task_update_in_root(root, "TASK-7777", json!({ "progress": 65 })).unwrap();
        assert_eq!(updated.progress, 65);
        assert!(updated.history.iter().any(|h| h.event == "进度更新为 65%"));

        let clamped = task_update_in_root(root, "TASK-7777", json!({ "progress": 150 })).unwrap();
        assert_eq!(clamped.progress, 100);

        let done = task_update_in_root(root, "TASK-7777", json!({ "status": "已发版" })).unwrap();
        assert_eq!(done.progress, 100);

        let legacy_json = r#"{
            "code": "TASK-OLD",
            "name": "Legacy Task",
            "sprint": "",
            "sprintStart": "",
            "sprintEnd": "",
            "startDate": "2026-11-01",
            "releaseDate": "",
            "planTestDate": "",
            "status": "进行中",
            "repos": [],
            "branch": "",
            "tags": [],
            "notes": "",
            "folderName": "TASK-OLD",
            "createdAt": "2026-11-01T00:00:00",
            "updatedAt": "2026-11-01T00:00:00",
            "history": []
        }"#;
        let legacy: TaskRecord = serde_json::from_str(legacy_json).unwrap();
        assert_eq!(legacy.progress, 0);
    }
}
