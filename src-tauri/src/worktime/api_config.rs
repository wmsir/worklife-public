use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const QUERY_VALUE_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b'=')
    .add(b'?');

fn default_param_value_type() -> String {
    "string".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiParamSpec {
    pub key: String,
    pub location: String,
    #[serde(default = "default_param_value_type")]
    pub value_type: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub source_key: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub linked_rule: String,
}

use crate::settings::{data_root_dir, load_settings_sync, save_settings_sync};
use crate::sidecar::{emit_app_log, Sidecar};
use crate::store::{atomic_write_json_unlocked, meta_dir, now_iso, FILE_LOCK};

use super::client::val_as_i64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiEndpointRule {
    pub key: String,
    pub group: String,
    pub name: String,
    pub method: String,
    pub path_template: String,
    pub description: String,
    #[serde(default)]
    pub query_params_doc: String,
    #[serde(default)]
    pub body_params_doc: String,
    #[serde(default)]
    pub placeholders: Vec<String>,
    #[serde(default)]
    pub params: Vec<ApiParamSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoTagRule {
    pub repo_keyword: String,
    pub tag_name: String,
    pub tag_id: i64,
    #[serde(default)]
    pub example_project: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFlowStepRule {
    pub id: i64,
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub desc: String,
}

fn default_keep_alive_interval_secs() -> u64 {
    1200
}

fn default_keep_alive_mouse_nudge() -> bool {
    true
}

fn default_keep_alive_mouse_nudge_interval_secs() -> u64 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiParamRules {
    pub connect_check_timeout_ms: u64,
    pub request_timeout_secs: u64,
    pub upload_timeout_secs: u64,
    pub max_retries: usize,
    #[serde(default = "default_keep_alive_interval_secs")]
    pub keep_alive_interval_secs: u64,
    #[serde(default = "default_keep_alive_mouse_nudge")]
    pub keep_alive_mouse_nudge: bool,
    #[serde(default = "default_keep_alive_mouse_nudge_interval_secs")]
    pub keep_alive_mouse_nudge_interval_secs: u64,
    pub time_work: f64,
    pub max_daily_hours: f64,
    pub dynamic_preferred_hours: f64,
    pub default_role_code: i64,
    pub default_qa_role_code: i64,
    pub work_item_type_code: i64,
    pub skip_sprint_id: i64,
    pub card_page_size: i64,
    pub declare_status: i64,
    pub default_declare_desc: String,
    pub monthly_workdays_factor: f64,
    pub default_member_rate: f64,
    pub default_reviewer_id: String,
    pub default_reviewer_name: String,
    pub approve_score: i64,
    pub merge_strategy: String,
    pub auto_approve_keyword: String,
    pub plan_test_date_field: String,
    pub status_flow_action: String,
    pub checklist_pass_result: i64,
    pub plan_date_trigger_statuses: Vec<i64>,
    pub test_audit_status_id: i64,
    pub uat_verify_status_id: i64,
    pub wechat_soap_namespace: String,
    pub wechat_webhook_prefix: String,
    pub builtin_reviewers: BTreeMap<String, i64>,
    pub member_rates: BTreeMap<String, f64>,
    pub repo_to_tag_mapping: Vec<RepoTagRule>,
    pub status_flow_steps: Vec<StatusFlowStepRule>,
}

impl Default for ApiParamRules {
    fn default() -> Self {
        let builtin_reviewers = BTreeMap::new();
        let member_rates = BTreeMap::new();
        let repo_to_tag_mapping = Vec::new();

        let status_flow_steps = vec![
            StatusFlowStepRule {
                id: 50,
                key: "design".to_string(),
                name: "方案设计".to_string(),
                desc: "需求分析与方案设计".to_string(),
            },
            StatusFlowStepRule {
                id: 60,
                key: "design_review".to_string(),
                name: "设计评审".to_string(),
                desc: "设计评审文档".to_string(),
            },
            StatusFlowStepRule {
                id: 70,
                key: "dev".to_string(),
                name: "开发".to_string(),
                desc: "进入开发阶段 (需设置计划提测日期)".to_string(),
            },
            StatusFlowStepRule {
                id: 90,
                key: "dev_test".to_string(),
                name: "开发自测".to_string(),
                desc: "编码实现与单元自测".to_string(),
            },
            StatusFlowStepRule {
                id: 130,
                key: "uat_update".to_string(),
                name: "UAT更新".to_string(),
                desc: "部署更新至UAT验证环境".to_string(),
            },
            StatusFlowStepRule {
                id: 110,
                key: "test_audit".to_string(),
                name: "测试审核".to_string(),
                desc: "测试审核验收 (需研发附件)".to_string(),
            },
            StatusFlowStepRule {
                id: 140,
                key: "uat_verify".to_string(),
                name: "UAT验收".to_string(),
                desc: "转测试/业务验收 (自动转经办人)".to_string(),
            },
        ];

        Self {
            connect_check_timeout_ms: 2500,
            request_timeout_secs: 15,
            upload_timeout_secs: 30,
            max_retries: 2,
            keep_alive_interval_secs: 1200,
            keep_alive_mouse_nudge: true,
            keep_alive_mouse_nudge_interval_secs: 0,
            time_work: 7.0,
            max_daily_hours: 12.0,
            dynamic_preferred_hours: 8.5,
            default_role_code: 1011,
            default_qa_role_code: 1012,
            work_item_type_code: 1001,
            skip_sprint_id: 101,
            card_page_size: 200,
            declare_status: 2,
            default_declare_desc: "任务开发自己测试".to_string(),
            monthly_workdays_factor: 21.75,
            default_member_rate: 0.9,
            default_reviewer_id: String::new(),
            default_reviewer_name: String::new(),
            approve_score: 2,
            merge_strategy: "DEFAULT".to_string(),
            auto_approve_keyword: String::new(),
            plan_test_date_field: "dateKey1".to_string(),
            status_flow_action: "statusFlow".to_string(),
            checklist_pass_result: 2,
            plan_date_trigger_statuses: vec![70, 90],
            test_audit_status_id: 110,
            uat_verify_status_id: 140,
            wechat_soap_namespace: "http://service.wechat.wbs.com/".to_string(),
            wechat_webhook_prefix: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key="
                .to_string(),
            builtin_reviewers,
            member_rates,
            repo_to_tag_mapping,
            status_flow_steps,
        }
    }
}

impl ApiParamRules {
    pub fn member_rate_for(&self, name: &str) -> f64 {
        self.member_rates
            .get(name.trim())
            .copied()
            .unwrap_or(self.default_member_rate)
    }

    pub fn lookup_reviewer_id(&self, name: &str) -> Option<i64> {
        self.builtin_reviewers.get(name.trim()).copied()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiConfig {
    pub scheme: String,
    pub ip: String,
    pub port: String,
    pub login_path: String,
    pub space_id: i64,
    #[serde(default)]
    pub endpoints: Vec<ApiEndpointRule>,
    #[serde(default)]
    pub rules: ApiParamRules,
    #[serde(default)]
    pub updated_at: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            scheme: "http".to_string(),
            ip: "devops.example.local".to_string(),
            port: "8880".to_string(),
            login_path: "/".to_string(),
            space_id: 1,
            endpoints: default_endpoints(),
            rules: ApiParamRules::default(),
            updated_at: String::new(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn p(
    key: &str,
    location: &str,
    value_type: &str,
    value: &str,
    required: bool,
    description: &str,
    linked_rule: &str,
) -> ApiParamSpec {
    ApiParamSpec {
        key: key.to_string(),
        location: location.to_string(),
        value_type: value_type.to_string(),
        value: value.to_string(),
        source_key: key.to_string(),
        enabled: true,
        required,
        description: description.to_string(),
        linked_rule: linked_rule.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn ep(
    key: &str,
    group: &str,
    name: &str,
    method: &str,
    path_template: &str,
    description: &str,
    query_params_doc: &str,
    body_params_doc: &str,
    placeholders: &[&str],
    params: Vec<ApiParamSpec>,
) -> ApiEndpointRule {
    ApiEndpointRule {
        key: key.to_string(),
        group: group.to_string(),
        name: name.to_string(),
        method: method.to_string(),
        path_template: path_template.to_string(),
        description: description.to_string(),
        query_params_doc: query_params_doc.to_string(),
        body_params_doc: body_params_doc.to_string(),
        placeholders: placeholders.iter().map(|s| (*s).to_string()).collect(),
        params,
    }
}

pub fn default_endpoints() -> Vec<ApiEndpointRule> {
    vec![
        // 1. 认证与保活 (4)
        ep(
            "login_page",
            "auth",
            "WebView2 扫码/账号登录页",
            "WEB",
            "{host}{loginPath}",
            "点击侧栏登录按钮且内网连通检查通过后打开的内置浏览器页面；支持完全自定义完整 URL。",
            "无固定 Query，可直接在 pathTemplate 中附带参数（如 /#/login?redirect=/）",
            "WebView 网页表单/企业微信扫码登录后自动捕获域下 Cookie（如 SESSION）",
            &["host", "loginPath"],
            vec![
                p("host", "path", "string", "{host}", true, "基础协议+IP+端口（由上方服务器配置生成）", ""),
                p("loginPath", "path", "string", "{loginPath}", false, "登录入口相对路径（可含 hash/query）", ""),
            ],
        ),
        ep(
            "user_info",
            "auth",
            "获取当前登录用户信息",
            "GET",
            "/devops-api/arch/api/v1/user/info?appCode=arch",
            "校验 Cookie 是否有效并获取当前登录人姓名、userErp、组织机构等基础身份信息。",
            "appCode=arch (固定应用编码)",
            "无请求体",
            &[],
            vec![p(
                "appCode",
                "query",
                "string",
                "arch",
                true,
                "DevOps 应用编码（固定默认 arch）",
                "",
            )],
        ),
        ep(
            "keep_alive",
            "auth",
            "后台会话保活心跳",
            "GET",
            "/devops-api/arch/api/v1/user/info?appCode=arch",
            "已登录状态下通过架构用户信息接口定时执行轻量保活请求防止 SESSION 过期（默认每 1200 秒 / 20 分钟，可在全局规则 keepAliveIntervalSecs 调整），请求与响应全程输出至运行日志。",
            "appCode=arch (固定应用编码)",
            "无请求体",
            &[],
            vec![p(
                "appCode",
                "query",
                "string",
                "arch",
                true,
                "DevOps 应用编码（固定默认 arch）",
                "",
            )],
        ),
        ep(
            "delivery_capacity",
            "auth",
            "当前用户交付产能批次指标",
            "GET",
            "/devops-api/space/api/v1/deliveryCapacity/query/current-user/current-batch",
            "登录与工作区概览卡片展示当前个人当季标准产能、系数与达标情况。",
            "无 Query 参数",
            "无请求体",
            &[],
            vec![],
        ),
        // 2. 工时与卡片 (9)
        ep(
            "space_members",
            "hours",
            "空间成员列表查询",
            "GET",
            "/devops-api/space/api/v1/spaces/members?spaceId={spaceId}",
            "拉取空间内成员姓名与 ERP 映射表，供缺报查询、团队统计和企微通知自动解析接收人。",
            "spaceId: 空间ID（如 26）",
            "无请求体",
            &["spaceId"],
            vec![p(
                "spaceId",
                "query",
                "number",
                "{spaceId}",
                true,
                "目标研发空间 ID",
                "",
            )],
        ),
        ep(
            "role_config",
            "hours",
            "空间业务角色字典配置",
            "GET",
            "/devops-api/space/api/v1/bizConfig/space/kv/{spaceId}",
            "解析角色名称（如 开发 / 测试）对应的数字 roleCode；失败时回退规则中的 defaultRoleCode。",
            "Path 变量 spaceId: 空间ID",
            "无请求体",
            &["spaceId"],
            vec![p(
                "spaceId",
                "path",
                "number",
                "{spaceId}",
                true,
                "空间 ID（路径占位符）",
                "",
            )],
        ),
        ep(
            "sprints_query",
            "hours",
            "空间迭代列表查询",
            "GET",
            "/devops-api/space/api/v1/spaces/sprints/query?spaceId={spaceId}&queryType={queryType}",
            "查询当前进行中或已归档迭代列表，自动跳过规则中的 skipSprintId。",
            "spaceId: 空间ID; queryType: 1=未结束迭代, 2=已结束/历史迭代",
            "无请求体",
            &["spaceId", "queryType"],
            vec![
                p("spaceId", "query", "number", "{spaceId}", true, "空间 ID", ""),
                p("queryType", "query", "number", "{queryType}", true, "迭代查询类型：1=当前未结束，2=历史已结束", ""),
            ],
        ),
        ep(
            "card_list",
            "hours",
            "条件检索任务卡片列表",
            "POST",
            "/devops-api/space/api/v1/bizSpaceCard/conditionTreeCardList",
            "按关键字（任务号）或开发人员 ERP + 迭代 ID 分页查询任务卡片集合。",
            "无 URL Query",
            "{ spaceId, sprintId, keyword, developersList[], orderField:\"id\", orderType:\"desc\", currentPage:1, pageSize:rules.cardPageSize }",
            &[],
            vec![
                p("spaceId", "body", "number", "{spaceId}", true, "空间 ID", ""),
                p("sprintId", "body", "number", "{sprintId}", false, "迭代 ID（全迭代检索时为 null）", ""),
                p("keyword", "body", "string", "{keyword}", false, "任务号/关键字过滤条件", ""),
                p("developersList", "body", "json", "{developersList}", false, "开发人员 ERP 列表 JSON 数组", ""),
                p("handlers", "body", "json", "[]", false, "经办人过滤 JSON 数组", ""),
                p("spaceWorkitemTypeCodes", "body", "json", "[]", false, "空间工作项类型编码过滤", ""),
                p("cardStates", "body", "json", "[]", false, "卡片状态过滤数组", ""),
                p("workitemTypeCodes", "body", "json", "[]", false, "工作项类型编码过滤", ""),
                p("orderField", "body", "string", "id", false, "排序字段名", ""),
                p("orderType", "body", "string", "desc", false, "排序方向：asc / desc", ""),
                p("currentPage", "body", "number", "1", false, "分页页码（从 1 开始）", ""),
                p("pageSize", "body", "number", "{rules.cardPageSize}", false, "每页拉取卡片数量（默认联动规则 cardPageSize）", "cardPageSize"),
            ],
        ),
        ep(
            "card_detail",
            "hours",
            "获取任务卡片详情",
            "GET",
            "/devops-api/space/api/v1/bizSpaceCard/cardDetail?id={cardId}",
            "读取任务状态、经办人、开发人员、计划提测日期(dateKey1等)以及已报工时明细。",
            "id={cardId} (任务卡片数字ID)",
            "无请求体",
            &["cardId"],
            vec![p(
                "id",
                "query",
                "number",
                "{cardId}",
                true,
                "任务卡片数字 ID",
                "",
            )],
        ),
        ep(
            "own_workload",
            "hours",
            "读取任务分配工作量",
            "GET",
            "/devops-api/space/api/v1/bizSpaceCard/ownWorkload?cardId={cardId}",
            "查询卡片上拆解分配给指定成员 ERP 的标准人天 (workload)，用于计算工时缺口。",
            "cardId={cardId}",
            "无请求体",
            &["cardId"],
            vec![p(
                "cardId",
                "query",
                "number",
                "{cardId}",
                true,
                "任务卡片数字 ID",
                "",
            )],
        ),
        ep(
            "actual_report_hours",
            "hours",
            "读取任务实际已报工时",
            "GET",
            "/devops-api/space/api/v1/bizSpaceCard/actualReportHours?cardId={cardId}",
            "查询单张卡片各成员实际提报工时累计摘要。",
            "cardId={cardId}",
            "无请求体",
            &["cardId"],
            vec![p(
                "cardId",
                "query",
                "number",
                "{cardId}",
                true,
                "任务卡片数字 ID",
                "",
            )],
        ),
        ep(
            "worktime_list",
            "hours",
            "按日历区间查询个人工时流水",
            "GET",
            "/devops-api/worktime/api/v1/worktime?startDate={startDate}&endDate={endDate}",
            "拉取日期区间内每天已报工时明细，用于计算日剩余容量(默认上限12h)与缺报核查。",
            "startDate, endDate 为毫秒时间戳；若指定 erp 会自动附加 &erp=..&userErp=..",
            "无请求体",
            &["startDate", "endDate"],
            vec![
                p("startDate", "query", "number", "{startDate}", true, "起始日期毫秒时间戳", ""),
                p("endDate", "query", "number", "{endDate}", true, "结束日期毫秒时间戳", ""),
                p("erp", "query", "string", "{erp}", false, "成员 ERP（指定成员查流水时自动附加）", ""),
                p("userErp", "query", "string", "{erp}", false, "成员 userErp 兼容字段（随 erp 自动附加）", ""),
            ],
        ),
        ep(
            "declare_hours",
            "hours",
            "单笔工时填报提交",
            "POST",
            "/devops-api/space/api/v1/bizSpaceCard/personHours/declare",
            "向指定任务卡片写入一条指定日期、工时、角色编码的工时记录。",
            "无 URL Query",
            "{ erp, declareDate(ms), declareHours(字符串), roleCode, desc, status:rules.declareStatus, cardId }",
            &[],
            vec![
                p("erp", "body", "string", "{erp}", true, "填报人 ERP 账号", ""),
                p("declareDate", "body", "number", "{declareDate}", true, "填报日期毫秒时间戳", ""),
                p("declareHours", "body", "string", "{declareHours}", true, "填报工时小时数（字符串，如 4 / 7）", ""),
                p("roleCode", "body", "number", "{roleCode}", true, "业务角色编码（如开发 1011 / 测试 1012）", "defaultRoleCode"),
                p("desc", "body", "string", "{desc}", false, "工时备注说明（空时采用规则默认值）", "defaultDeclareDesc"),
                p("status", "body", "number", "{rules.declareStatus}", true, "提报状态码（默认 2）", "declareStatus"),
                p("cardId", "body", "number", "{cardId}", true, "目标任务卡片数字 ID", ""),
            ],
        ),
        // 3. 代码分支与 MR (10)
        ep(
            "create_branch",
            "git_mr",
            "创建 Git 代码分支",
            "POST",
            "/devops-api/webapi/projects/{project}/branches",
            "基于基准分支（如 master/UAT）在指定代码库创建开发分支。",
            "Path 变量 project 为 ! 分隔库路径（如 GROUP!TEAM/repo-name）",
            "{ branch: 新分支名, ref: 源基准分支名 }",
            &["project"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("branch", "body", "string", "{branch}", true, "待创建的新分支名", ""),
                p("ref", "body", "string", "{ref}", true, "源基准分支名（如 master / UAT）", ""),
            ],
        ),
        ep(
            "branch_diff",
            "git_mr",
            "检查两分支间代码差异",
            "GET",
            "/devops-api/webapi/projects/{project}/compare/{dest}...{src}/info",
            "提交 MR 前校验源分支与目标分支是否存在新代码及提取 newCommitId / oldCommitId。",
            "Path 变量: project, dest(目标分支), src(源分支)",
            "无请求体",
            &["project", "dest", "src"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("dest", "path", "string", "{dest}", true, "目标分支名", ""),
                p("src", "path", "string", "{src}", true, "源开发分支名", ""),
            ],
        ),
        ep(
            "branch_commits",
            "git_mr",
            "获取分支差异 Commit 摘要",
            "GET",
            "/devops-api/webapi/projects/{project}/compare/{dest}...{src}/commits",
            "读取差异提交记录的 messageSummary.title 与 body 作为新建 MR 的默认标题与描述。",
            "Path 变量: project, dest(目标分支), src(源分支)",
            "无请求体",
            &["project", "dest", "src"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("dest", "path", "string", "{dest}", true, "目标分支名", ""),
                p("src", "path", "string", "{src}", true, "源开发分支名", ""),
            ],
        ),
        ep(
            "user_query_like",
            "git_mr",
            "模糊搜索 Git 评审人 UserId",
            "GET",
            "/devops-api/webapi/user/queryLike?keyword={keyword}",
            "当评审人不在规则 builtinReviewers 映射表内时，按姓名关键字实时查询数字 userId。",
            "keyword={keyword} (已 URL 编码的姓名或关键字)",
            "无请求体",
            &["keyword"],
            vec![p(
                "keyword",
                "query",
                "string",
                "{keyword}",
                true,
                "评审人姓名/工号模糊搜索关键字",
                "",
            )],
        ),
        ep(
            "mr_submit",
            "git_mr",
            "创建合并请求 (MR / Review)",
            "POST",
            "/devops-api/webapi/projects/{project}/reviews",
            "向指定代码库提交合并请求并返回 reviewId。",
            "Path 变量: project",
            "{ newCommitId, oldCommitId, targetBranch, sourceBranch, title, content, reviewerIds[], customizeReviewPerson }",
            &["project"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("newCommitId", "body", "string", "{newCommitId}", true, "源分支最新 Commit ID", ""),
                p("oldCommitId", "body", "string", "{oldCommitId}", true, "公共祖先基准 Commit ID", ""),
                p("targetBranch", "body", "string", "{targetBranch}", true, "合入目标分支", ""),
                p("sourceBranch", "body", "string", "{sourceBranch}", true, "源开发分支", ""),
                p("sourceProjectId", "body", "json", "null", false, "跨库 Fork 源项目 ID（同库默认为 null）", ""),
                p("title", "body", "string", "{title}", true, "MR 标题", ""),
                p("content", "body", "string", "{content}", false, "MR 描述内容", ""),
                p("reviewerIds", "body", "json", "{reviewerIds}", false, "评审人数字 userId 字符串数组", ""),
                p("customizeReviewPerson", "body", "boolean", "{customizeReviewPerson}", false, "是否启用自定义评审人", ""),
            ],
        ),
        ep(
            "mr_list_open",
            "git_mr",
            "查询本人名下开启中的 MR 列表",
            "GET",
            "/devops-api/webapi/mergeRequests?type=created&state=open&orderBy=newest&page=1",
            "避免重复提单：预先加载已存在的 open 状态 MR，直接复用其 reviewId。",
            "type=created&state=open&orderBy=newest&page=1",
            "无请求体",
            &[],
            vec![
                p("type", "query", "string", "created", false, "筛选维度：created / reviewed 等", ""),
                p("state", "query", "string", "open", false, "MR 状态：open / merged / closed", ""),
                p("orderBy", "query", "string", "newest", false, "排序方式：newest / updated", ""),
                p("page", "query", "number", "1", false, "分页页码", ""),
            ],
        ),
        ep(
            "mr_add_reviewer",
            "git_mr",
            "MR 一键步骤[1/3] 添加评审人",
            "POST",
            "/devops-api/webapi/projects/{project}/reviews/{reviewId}/reviewers/{userId}",
            "将指定数字 userId 加入该合并请求的评审人名单。",
            "Path 变量: project, reviewId, userId",
            "无请求体",
            &["project", "reviewId", "userId"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("reviewId", "path", "number", "{reviewId}", true, "合并请求编号", ""),
                p("userId", "path", "number", "{userId}", true, "评审人数字 userId", ""),
            ],
        ),
        ep(
            "mr_approve",
            "git_mr",
            "MR 一键步骤[2/3] 提交审批意见",
            "POST",
            "/devops-api/webapi/projects/{project}/reviews/{reviewId}/opinion",
            "提交代码评审结论分值（默认 approveScore=2 表示同意通过）。",
            "Path 变量: project, reviewId",
            "{ note: \"\", score: rules.approveScore }",
            &["project", "reviewId"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("reviewId", "path", "number", "{reviewId}", true, "合并请求编号", ""),
                p("note", "body", "string", "", false, "评审意见文案（默认空字符串）", ""),
                p("score", "body", "number", "{rules.approveScore}", true, "审批结论分值（默认联动规则 approveScore）", "approveScore"),
            ],
        ),
        ep(
            "mr_manual_merge",
            "git_mr",
            "MR 一键步骤[3/3] 执行合并",
            "POST",
            "/devops-api/webapi/projects/{project}/reviews/{reviewId}/manualMerge",
            "按规则中的 mergeStrategy（默认 DEFAULT）触发服务端合并分支。",
            "Path 变量: project, reviewId",
            "{ subject: null, body: null, mergeStrategy: rules.mergeStrategy }",
            &["project", "reviewId"],
            vec![
                p("project", "path", "string", "{project}", true, "! 分隔的仓库路径", ""),
                p("reviewId", "path", "number", "{reviewId}", true, "合并请求编号", ""),
                p("subject", "body", "json", "null", false, "自定义合并 Commit 标题（默认 null）", ""),
                p("body", "body", "json", "null", false, "自定义合并 Commit 说明（默认 null）", ""),
                p("mergeStrategy", "body", "string", "{rules.mergeStrategy}", true, "合并策略（如 DEFAULT / SQUASH）", "mergeStrategy"),
            ],
        ),
        ep(
            "mr_review_page",
            "git_mr",
            "MR 网页审查跳转链接模板",
            "WEB",
            "/codingRoot/{webProject}/merges/{reviewId}",
            "批量提交 MR 完成后生成的浏览器访问与企微推送链接，其中 ! 自动转为 %2F。",
            "Path 变量: webProject(%2F分隔仓库), reviewId",
            "仅用于拼接展示链接，不直接发起 HTTP 请求",
            &["webProject", "reviewId"],
            vec![
                p("webProject", "path", "string", "{webProject}", true, "%2F 分隔的浏览器仓库路径", ""),
                p("reviewId", "path", "number", "{reviewId}", true, "合并请求编号", ""),
            ],
        ),
        // 4. 检查单与状态流转 (4)
        ep(
            "checklist_list",
            "flow",
            "查询任务卡片原生检查单",
            "GET",
            "/devops-api/space/api/v1/bizSpaceCardCheckList/list/card/{cardId}",
            "获取任务在评审/设计/开发/测试阶段的服务端检查项列表。",
            "Path 变量: cardId",
            "无请求体",
            &["cardId"],
            vec![p(
                "cardId",
                "path",
                "number",
                "{cardId}",
                true,
                "任务卡片数字 ID",
                "",
            )],
        ),
        ep(
            "checklist_save_batch",
            "flow",
            "批量提交阶段检查单结果",
            "POST",
            "/devops-api/space/api/v1/bizSpaceCardCheckList/saveBatch",
            "一键批量勾选并通过指定阶段的检查单项目（pass 值读取 rules.checklistPassResult）。",
            "无 URL Query",
            "[{ cardId, checkId, checkResult:rules.checklistPassResult, checkTime, checkUserErp, checkUserName, stageId, ... }]",
            &[],
            vec![
                p("cardId", "body", "number", "{cardId}", true, "卡片数字 ID（数组每项）", ""),
                p("checkId", "body", "number", "{checkId}", true, "检查项 ID", ""),
                p("checkResult", "body", "number", "{rules.checklistPassResult}", true, "检查结果状态码（默认 2=通过）", "checklistPassResult"),
                p("checkUserErp", "body", "string", "{checkUserErp}", false, "检查人 ERP", ""),
                p("checkUserName", "body", "string", "{checkUserName}", false, "检查人姓名", ""),
                p("stageId", "body", "number", "{stageId}", false, "阶段 ID", ""),
            ],
        ),
        ep(
            "card_ext_properties",
            "flow",
            "更新扩展属性（计划提测日期）",
            "PUT",
            "/devops-api/space/api/v1/space/ext/editSpaceCardExtProperties",
            "流转至开发/自测阶段前写入计划提测日期（字段名由 rules.planTestDateField 控制，默认 dateKey1）。",
            "无 URL Query",
            "{ cardId, spaceId, [rules.planTestDateField]: date_ms }",
            &[],
            vec![
                p("cardId", "body", "number", "{cardId}", true, "卡片数字 ID", ""),
                p("spaceId", "body", "number", "{spaceId}", true, "空间 ID", ""),
                p("dateKey1", "body", "number", "{planDateMs}", true, "计划提测日期毫秒时间戳字段名（可联动 planTestDateField 或直接重命名）", "planTestDateField"),
            ],
        ),
        ep(
            "card_properties",
            "flow",
            "更新卡片状态与经办人",
            "PUT",
            "/devops-api/space/api/v1/bizSpaceCard/editCardProperties",
            "修改卡片当前经办人或按步骤流转至目标状态 ID（action 默认为 statusFlow）。",
            "无 URL Query",
            "转经办人: { cardId, spaceId, properties:{ handler } }；流转: { cardId, spaceId, properties:{ handler, action:rules.statusFlowAction, cardStatusId } }",
            &[],
            vec![
                p("cardId", "body", "number", "{cardId}", true, "卡片数字 ID", ""),
                p("spaceId", "body", "number", "{spaceId}", true, "空间 ID", ""),
                p("properties.handler", "body", "json", "{handler}", false, "目标经办人对象 JSON", ""),
                p("properties.action", "body", "string", "{rules.statusFlowAction}", false, "流转动作标识（默认 statusFlow）", "statusFlowAction"),
                p("properties.cardStatusId", "body", "number", "{cardStatusId}", false, "目标状态数字 ID", ""),
            ],
        ),
        // 5. 附件与标签 (4)
        ep(
            "file_upload",
            "tags_files",
            "上传设计/研发/测试附件",
            "POST",
            "/devops-api/space-demand/api/v1/files/upload",
            "Multipart 表单上传本地文档/截图，返回文件 id 与 uri 供后续绑定卡片。",
            "无 URL Query",
            "multipart/form-data 字段名 file=@本地文件",
            &[],
            vec![p(
                "file",
                "form",
                "file",
                "{localFile}",
                true,
                "Multipart 上传文件字段名（默认 file）",
                "",
            )],
        ),
        ep(
            "file_bind",
            "tags_files",
            "绑定已上传附件到任务卡片",
            "POST",
            "/devops-api/space-demand/api/v1/files/bindingAttach",
            "流转至测试审核前自动把上传文件按 design / dev / test 类型关联到卡片。",
            "无 URL Query",
            "{ attachmentType: \"design\"|\"dev\"|\"test\", attachmentId, entityId: String(cardId) }",
            &[],
            vec![
                p("attachmentType", "body", "string", "{attachmentType}", true, "附件分类：design / dev / test", ""),
                p("attachmentId", "body", "number", "{attachmentId}", true, "已上传文件返回的附件 ID", ""),
                p("entityId", "body", "string", "{cardId}", true, "任务卡片 ID（字符串格式）", ""),
            ],
        ),
        ep(
            "space_tags",
            "tags_files",
            "查询空间全部标签定义",
            "GET",
            "/devops-api/space/api/v1/spaces/{spaceId}/new-tags",
            "拉取空间可用标签 ID 与名称；无法联网时回退内置标签列表。",
            "Path 变量: spaceId",
            "无请求体",
            &["spaceId"],
            vec![p(
                "spaceId",
                "path",
                "number",
                "{spaceId}",
                true,
                "空间 ID（路径占位符）",
                "",
            )],
        ),
        ep(
            "card_tags",
            "tags_files",
            "为任务卡片打标签",
            "POST",
            "/devops-api/space/api/v1/bizSpaceCard/tags",
            "按单个标签 ID 为任务卡片追加仓库或属性标签。",
            "无 URL Query",
            "{ id: tagId, cardId }",
            &[],
            vec![
                p("id", "body", "number", "{tagId}", true, "标签 ID", ""),
                p("cardId", "body", "number", "{cardId}", true, "任务卡片数字 ID", ""),
            ],
        ),
        // 6. 企业微信通知 (1)
        ep(
            "wechat_webservice",
            "wechat",
            "企业微信内部 WebService(SOAP) 默认通道",
            "POST",
            "",
            "工时提报、批量 MR 提交或手动测试推送使用的企业内网 SOAP 通道；若改用独立地址会同步系统设置 wechat_config.url。",
            "会自动探测 ?wsdl 获取实际 targetNamespace（默认命名空间见规则 wechatSoapNamespace）",
            "SOAP XML sendMarkdownMsg (<content>, <sys_flag>, <sys_id>, <sys_id_pass>, <userNum>, <userType>)",
            &[],
            vec![
                p("sys_flag", "body", "string", "{sys_flag}", false, "SOAP 系统标识（默认读取企微配置 sys_flag）", ""),
                p("sys_id", "body", "string", "{sys_id}", false, "SOAP 系统 ID（默认读取企微配置 sys_id）", ""),
                p("sys_id_pass", "body", "string", "{sys_id_pass}", false, "SOAP 接入凭证密码（默认读取企微配置 sys_id_pass）", ""),
                p("userType", "body", "string", "{userType}", false, "接收用户类型（默认 2=身份证号/ERP）", ""),
                p("msgType", "body", "string", "markdown", false, "消息格式（默认 markdown）", ""),
                p("userNum", "body", "string", "{targetErp}", true, "接收人身份证号 / ERP", ""),
                p("content", "body", "string", "{content}", true, "Markdown 通知正文", ""),
            ],
        ),
    ]
}

impl ApiConfig {
    pub fn normalized_scheme(&self) -> &'static str {
        if self.scheme.trim().eq_ignore_ascii_case("https") {
            "https"
        } else {
            "http"
        }
    }

    pub fn host_only(&self) -> String {
        let mut h = self.ip.trim().trim_end_matches('/').to_string();
        if h.starts_with("http://") || h.starts_with("https://") {
            if let Ok(u) = reqwest::Url::parse(&h) {
                if let Some(hs) = u.host_str() {
                    return hs.to_string();
                }
            }
        }
        if h.starts_with('[') && h.ends_with(']') {
            h = h[1..h.len() - 1].to_string();
            return h;
        }
        if let Some((left, right)) = h.rsplit_once(':') {
            if !left.is_empty() && !right.is_empty() && right.chars().all(|c| c.is_ascii_digit())
            {
                return left
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .to_string();
            }
        }
        h
    }

    pub fn effective_port(&self) -> String {
        let raw_ip = self.ip.trim().trim_end_matches('/');
        if raw_ip.starts_with("http://") || raw_ip.starts_with("https://") {
            if let Ok(u) = reqwest::Url::parse(raw_ip) {
                if let Some(p) = u.port() {
                    return p.to_string();
                }
            }
        } else if let Some((left, right)) = raw_ip.rsplit_once(':') {
            if !left.is_empty() && !right.is_empty() && right.chars().all(|c| c.is_ascii_digit())
            {
                return right.to_string();
            }
        }
        self.port.trim().to_string()
    }

    pub fn base_host(&self) -> String {
        let scheme = self.normalized_scheme();
        let host = self.host_only();
        let port = self.effective_port();
        if host.is_empty() {
            return format!("{scheme}://devops.example.local:8880");
        }
        let host_fmt = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host
        };
        if port.is_empty() {
            format!("{scheme}://{host_fmt}")
        } else {
            format!("{scheme}://{host_fmt}:{port}")
        }
    }

    pub fn settings_ip_value(&self) -> String {
        let scheme = self.normalized_scheme();
        let host = self.host_only();
        let port = self.effective_port();
        if scheme == "https" {
            self.base_host()
        } else if port.is_empty() {
            format!("http://{host}")
        } else if port == "8880" {
            host
        } else {
            format!("{host}:{port}")
        }
    }

    pub fn normalized_login_path(&self) -> String {
        let p = self.login_path.trim();
        if p.is_empty() {
            "/".to_string()
        } else if p.starts_with('/') {
            p.to_string()
        } else {
            format!("/{p}")
        }
    }

    pub fn apply_ip_string(&mut self, raw: &str) {
        let trimmed = raw.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return;
        }
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            if let Ok(u) = reqwest::Url::parse(trimmed) {
                self.scheme = u.scheme().to_string();
                if let Some(h) = u.host_str() {
                    self.ip = h.trim_start_matches('[').trim_end_matches(']').to_string();
                }
                self.port = u.port().map(|p| p.to_string()).unwrap_or_default();
                let p = u.path().trim();
                if !p.is_empty() && p != "/" {
                    self.login_path = p.to_string();
                }
                return;
            }
        }
        if let Some((left, right)) = trimmed.rsplit_once(':') {
            if !left.is_empty() && !right.is_empty() && right.chars().all(|c| c.is_ascii_digit())
            {
                self.ip = left
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .to_string();
                self.port = right.to_string();
                return;
            }
        }
        self.ip = trimmed
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_string();
        if self.port.trim().is_empty() && self.normalized_scheme() == "http" {
            self.port = "8880".to_string();
        }
    }

    pub fn merge_missing_defaults(&mut self) {
        if self.scheme.trim().is_empty() {
            self.scheme = "http".to_string();
        } else {
            self.scheme = self.normalized_scheme().to_string();
        }
        if self.ip.trim().is_empty() {
            self.ip = "devops.example.local".to_string();
        }
        if self.login_path.trim().is_empty() {
            self.login_path = "/".to_string();
        }
        if self.space_id <= 0 {
            self.space_id = 1;
        }

        let defaults = default_endpoints();
        let mut by_key: BTreeMap<String, ApiEndpointRule> = BTreeMap::new();
        for item in self.endpoints.drain(..) {
            by_key.insert(item.key.clone(), item);
        }

        let mut merged = Vec::with_capacity(defaults.len() + by_key.len());
        let mut used = HashSet::new();
        for def in defaults {
            if let Some(mut existing) = by_key.remove(&def.key) {
                if def.key == "keep_alive"
                    && existing.path_template.trim()
                        == "/devops-api/proj/api/v1/whitelist/currentUserType"
                {
                    existing.path_template = def.path_template.clone();
                    existing.description = def.description.clone();
                    existing.query_params_doc = def.query_params_doc.clone();
                }
                if existing.group.trim().is_empty() {
                    existing.group = def.group;
                }
                if existing.name.trim().is_empty() {
                    existing.name = def.name;
                }
                if existing.method.trim().is_empty() {
                    existing.method = def.method;
                }
                if existing.path_template.trim().is_empty() {
                    existing.path_template = def.path_template;
                }
                if existing.description.trim().is_empty() {
                    existing.description = def.description;
                }
                if existing.query_params_doc.trim().is_empty() {
                    existing.query_params_doc = def.query_params_doc;
                }
                if existing.body_params_doc.trim().is_empty() {
                    existing.body_params_doc = def.body_params_doc;
                }
                if existing.placeholders.is_empty() {
                    existing.placeholders = def.placeholders;
                }
                if existing.params.is_empty() && !def.params.is_empty() {
                    existing.params = def.params;
                }
                used.insert(def.key);
                merged.push(existing);
            } else {
                used.insert(def.key.clone());
                merged.push(def);
            }
        }
        for (k, extra) in by_key {
            if !used.contains(&k) {
                merged.push(extra);
            }
        }
        self.endpoints = merged;
    }

    pub fn endpoint_by_key(&self, key: &str) -> Option<ApiEndpointRule> {
        self.endpoints
            .iter()
            .find(|e| e.key == key)
            .cloned()
            .or_else(|| default_endpoints().into_iter().find(|e| e.key == key))
    }

    pub fn endpoint_url(&self, key: &str) -> String {
        self.endpoint_by_key(key)
            .map(|e| e.path_template)
            .unwrap_or_default()
    }

    pub fn resolve_template_value(&self, raw: &str, vars: &[(&str, &str)]) -> (String, bool) {
        let base = self.base_host();
        let space_str = self.space_id.to_string();
        let login_path = self.normalized_login_path();

        let mut out = raw.to_string();
        out = out.replace("{host}", &base);
        out = out.replace("{spaceId}", &space_str);
        out = out.replace("{loginPath}", &login_path);
        out = out.replace("{rules.cardPageSize}", &self.rules.card_page_size.to_string());
        out = out.replace("{rules.declareStatus}", &self.rules.declare_status.to_string());
        out = out.replace(
            "{rules.defaultRoleCode}",
            &self.rules.default_role_code.to_string(),
        );
        out = out.replace(
            "{rules.defaultQaRoleCode}",
            &self.rules.default_qa_role_code.to_string(),
        );
        out = out.replace(
            "{rules.defaultDeclareDesc}",
            self.rules.default_declare_desc.trim(),
        );
        out = out.replace("{rules.approveScore}", &self.rules.approve_score.to_string());
        out = out.replace("{rules.mergeStrategy}", self.rules.merge_strategy.trim());
        out = out.replace(
            "{rules.checklistPassResult}",
            &self.rules.checklist_pass_result.to_string(),
        );
        out = out.replace(
            "{rules.planTestDateField}",
            self.rules.plan_test_date_field.trim(),
        );
        out = out.replace(
            "{rules.statusFlowAction}",
            self.rules.status_flow_action.trim(),
        );
        out = out.replace(
            "{rules.testAuditStatusId}",
            &self.rules.test_audit_status_id.to_string(),
        );
        out = out.replace(
            "{rules.uatVerifyStatusId}",
            &self.rules.uat_verify_status_id.to_string(),
        );
        for (k, v) in vars {
            out = out.replace(&format!("{{{k}}}"), v);
        }
        let unresolved = contains_template_placeholder(&out);
        (out, unresolved)
    }

    pub fn is_param_disabled_or_renamed(&self, key: &str, source_key: &str, location: &str) -> bool {
        let Some(ep) = self.endpoint_by_key(key) else {
            return false;
        };
        if let Some(p) = ep.params.iter().find(|p| {
            p.location == location
                && (p.source_key == source_key || (p.source_key.is_empty() && p.key == source_key))
        }) {
            return !p.enabled || p.key.trim() != source_key;
        }
        // If endpoint originally defined this param in defaults and user removed it completely
        let in_defaults = default_endpoints()
            .into_iter()
            .find(|e| e.key == key)
            .map(|d| {
                d.params
                    .iter()
                    .any(|p| p.location == location && p.key == source_key)
            })
            .unwrap_or(false);
        in_defaults
    }

    pub fn render_endpoint(&self, key: &str, vars: &[(&str, &str)]) -> (Method, String) {
        let ep_rule = self.endpoint_by_key(key);
        let def_ep = default_endpoints().into_iter().find(|e| e.key == key);
        let (method_str, mut tmpl, params) = match ep_rule {
            Some(r) => (r.method, r.path_template, r.params),
            None => ("GET".to_string(), "/".to_string(), Vec::new()),
        };

        let method = if method_str.eq_ignore_ascii_case("WEB") {
            Method::GET
        } else {
            Method::from_bytes(method_str.trim().to_ascii_uppercase().as_bytes())
                .unwrap_or(Method::GET)
        };

        // 1. Apply modified Path parameters before global placeholder substitution
        for p in params.iter().filter(|p| p.enabled && p.location == "path") {
            let orig_key = orig_param_key(p);
            if orig_key.is_empty() {
                continue;
            }
            let def_p = find_default_param(def_ep.as_ref(), "path", orig_key);
            let is_modified = def_p
                .map(|d| d.key != p.key || d.value != p.value || d.enabled != p.enabled)
                .unwrap_or(true);
            if !is_modified {
                continue;
            }
            let (resolved, unresolved) = self.resolve_template_value(&p.value, vars);
            if !unresolved {
                tmpl = tmpl.replace(&format!("{{{orig_key}}}"), &resolved);
                let tk = p.key.trim();
                if !tk.is_empty() && tk != orig_key {
                    tmpl = tmpl.replace(&format!("{{{tk}}}"), &resolved);
                }
            }
        }

        // 2. Substitute host / spaceId / loginPath / rules / runtime vars
        let (tmpl_resolved, _) = self.resolve_template_value(&tmpl, vars);
        let base = self.base_host();
        let trimmed = tmpl_resolved.trim();
        let mut full_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else if trimmed.starts_with('/') {
            format!("{base}{trimmed}")
        } else if trimmed.is_empty() {
            base
        } else {
            format!("{base}/{trimmed}")
        };

        // 3. Apply structured Query parameters (value override, rename, disable, custom add)
        let query_params: Vec<&ApiParamSpec> =
            params.iter().filter(|p| p.location == "query").collect();
        if !query_params.is_empty() {
            let q_pos = full_url.find('?');
            let h_pos = full_url.find('#');
            let split_idx = match (q_pos, h_pos) {
                (Some(qi), Some(hi)) if qi < hi => Some(qi),
                (Some(qi), None) => Some(qi),
                _ => None,
            };

            let (base_part, mut pairs, hash_suffix) = if let Some(qi) = split_idx {
                let b = full_url[..qi].to_string();
                let after_q = &full_url[qi + 1..];
                let (q_raw, h_suf) = if let Some(hi) = after_q.find('#') {
                    (&after_q[..hi], after_q[hi..].to_string())
                } else {
                    (after_q, String::new())
                };
                let parsed = parse_raw_query_pairs(q_raw);
                (b, parsed, h_suf)
            } else {
                (full_url.clone(), Vec::new(), String::new())
            };

            for p in query_params {
                let target_key = p.key.trim();
                let orig_key = orig_param_key(p);
                let def_p = find_default_param(def_ep.as_ref(), "query", orig_key);
                let is_custom = def_p.is_none();
                let is_modified = def_p
                    .map(|d| d.key != p.key || d.value != p.value || d.enabled != p.enabled)
                    .unwrap_or(true);
                let value_modified = def_p.map(|d| d.value != p.value).unwrap_or(true);

                if !p.enabled {
                    pairs.retain(|(k, _)| k != orig_key && k != target_key);
                    continue;
                }
                if target_key.is_empty() {
                    continue;
                }

                let (resolved, unresolved) = self.resolve_template_value(&p.value, vars);
                let pure_placeholder = contains_template_placeholder(&p.value);

                let match_idx = pairs
                    .iter()
                    .position(|(k, _)| k == orig_key || k == target_key);

                if let Some(idx) = match_idx {
                    pairs[idx].0 = target_key.to_string();
                    if value_modified && !unresolved {
                        pairs[idx].1 = encode_query_val_if_needed(&resolved);
                    }
                    // Deduplicate any secondary alias match
                    let mut i = idx + 1;
                    while i < pairs.len() {
                        if pairs[i].0 == orig_key || pairs[i].0 == target_key {
                            pairs.remove(i);
                        } else {
                            i += 1;
                        }
                    }
                } else if !unresolved {
                    let should_append = if is_custom || is_modified {
                        !pure_placeholder || !resolved.is_empty()
                    } else {
                        // Unmodified optional runtime placeholder (e.g. erp / userErp on worktime_list)
                        pure_placeholder && !resolved.is_empty()
                    };
                    if should_append {
                        pairs.push((
                            target_key.to_string(),
                            encode_query_val_if_needed(&resolved),
                        ));
                    }
                }
            }

            if pairs.is_empty() {
                full_url = format!("{base_part}{hash_suffix}");
            } else {
                let joined = pairs
                    .into_iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("&");
                full_url = format!("{base_part}?{joined}{hash_suffix}");
            }
        }

        (method, full_url)
    }

    pub fn endpoint_headers(&self, key: &str, vars: &[(&str, &str)]) -> Vec<(String, String)> {
        let Some(ep_rule) = self.endpoint_by_key(key) else {
            return Vec::new();
        };
        let mut headers = Vec::new();
        for p in ep_rule
            .params
            .iter()
            .filter(|p| p.enabled && p.location == "header")
        {
            let hk = p.key.trim();
            if hk.is_empty() {
                continue;
            }
            let (resolved, unresolved) = self.resolve_template_value(&p.value, vars);
            if !unresolved {
                headers.push((hk.to_string(), resolved));
            }
        }
        headers
    }

    pub fn endpoint_form_file_field(&self, key: &str, fallback: &str) -> String {
        let Some(ep_rule) = self.endpoint_by_key(key) else {
            return fallback.to_string();
        };
        for p in ep_rule
            .params
            .iter()
            .filter(|p| p.enabled && p.location == "form" && p.value_type == "file")
        {
            let k = p.key.trim();
            if !k.is_empty() {
                return k.to_string();
            }
        }
        fallback.to_string()
    }

    pub fn endpoint_extra_form_fields(
        &self,
        key: &str,
        vars: &[(&str, &str)],
    ) -> Vec<(String, String)> {
        let Some(ep_rule) = self.endpoint_by_key(key) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for p in ep_rule
            .params
            .iter()
            .filter(|p| p.enabled && p.location == "form" && p.value_type != "file")
        {
            let fk = p.key.trim();
            if fk.is_empty() {
                continue;
            }
            let (resolved, unresolved) = self.resolve_template_value(&p.value, vars);
            if !unresolved {
                out.push((fk.to_string(), resolved));
            }
        }
        out
    }

    pub fn endpoint_body_override_str(&self, key: &str, orig_field: &str) -> Option<String> {
        let ep_rule = self.endpoint_by_key(key)?;
        let def_ep = default_endpoints().into_iter().find(|e| e.key == key);
        let p = ep_rule.params.iter().find(|p| {
            p.location == "body"
                && (p.source_key == orig_field || (p.source_key.is_empty() && p.key == orig_field))
        })?;
        if !p.enabled {
            return Some(String::new());
        }
        let def_p = find_default_param(def_ep.as_ref(), "body", orig_field);
        let is_modified = def_p.map(|d| d.value != p.value).unwrap_or(true);
        if !is_modified {
            return None;
        }
        let (resolved, unresolved) = self.resolve_template_value(&p.value, &[]);
        if unresolved {
            None
        } else {
            Some(resolved)
        }
    }

    pub fn apply_body_params(&self, key: &str, body: &Value) -> Value {
        let Some(ep_rule) = self.endpoint_by_key(key) else {
            return body.clone();
        };
        let body_params: Vec<&ApiParamSpec> = ep_rule
            .params
            .iter()
            .filter(|p| p.location == "body")
            .collect();
        if body_params.is_empty() {
            return body.clone();
        }
        let def_ep = default_endpoints().into_iter().find(|e| e.key == key);

        match body {
            Value::Object(_) => {
                let mut cloned = body.clone();
                self.apply_body_params_to_obj(key, &mut cloned, &body_params, def_ep.as_ref());
                cloned
            }
            Value::Array(arr) => Value::Array(
                arr.iter()
                    .map(|item| {
                        if item.is_object() {
                            let mut c = item.clone();
                            self.apply_body_params_to_obj(
                                key,
                                &mut c,
                                &body_params,
                                def_ep.as_ref(),
                            );
                            c
                        } else {
                            item.clone()
                        }
                    })
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    fn apply_body_params_to_obj(
        &self,
        ep_key: &str,
        root: &mut Value,
        body_params: &[&ApiParamSpec],
        def_ep: Option<&ApiEndpointRule>,
    ) {
        for p in body_params {
            let target_key = p.key.trim();
            let orig_key = orig_param_key(p);
            let def_p = find_default_param(def_ep, "body", orig_key);
            let is_custom = def_p.is_none();
            let value_modified = def_p
                .map(|d| d.value != p.value || d.value_type != p.value_type)
                .unwrap_or(true);

            if !p.enabled {
                if !orig_key.is_empty() {
                    remove_nested_val(root, orig_key);
                    if ep_key == "card_ext_properties" && orig_key == "dateKey1" {
                        let rule_field = self.rules.plan_test_date_field.trim();
                        if !rule_field.is_empty() {
                            remove_nested_val(root, rule_field);
                        }
                    }
                }
                if !target_key.is_empty() && target_key != orig_key {
                    remove_nested_val(root, target_key);
                }
                continue;
            }

            if target_key.is_empty() {
                continue;
            }

            // Rename key if changed
            if !orig_key.is_empty() && target_key != orig_key {
                let moved = remove_nested_val(root, orig_key).or_else(|| {
                    if ep_key == "card_ext_properties" && orig_key == "dateKey1" {
                        let rule_field = self.rules.plan_test_date_field.trim();
                        if !rule_field.is_empty() {
                            remove_nested_val(root, rule_field)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                });
                if let Some(v) = moved {
                    set_nested_val(root, target_key, v);
                }
            }

            if is_custom || value_modified {
                // For shared sub-objects like card_properties' properties.action / cardStatusId,
                // only override built-in fields when the operation actually included that field.
                if !is_custom
                    && target_key.starts_with("properties.")
                    && get_nested_val(root, target_key).is_none()
                {
                    continue;
                }
                let (resolved, unresolved) = self.resolve_template_value(&p.value, &[]);
                if !unresolved {
                    let typed = parse_param_typed_value(&resolved, &p.value_type);
                    set_nested_val(root, target_key, typed);
                }
            }
        }
    }

    pub fn login_url(&self) -> String {
        let (_, u) = self.render_endpoint("login_page", &[]);
        u
    }
}

fn orig_param_key(p: &ApiParamSpec) -> &str {
    let sk = p.source_key.trim();
    if sk.is_empty() {
        p.key.trim()
    } else {
        sk
    }
}

fn find_default_param<'a>(
    def_ep: Option<&'a ApiEndpointRule>,
    location: &str,
    orig_key: &str,
) -> Option<&'a ApiParamSpec> {
    let ep = def_ep?;
    ep.params.iter().find(|d| {
        d.location == location
            && (d.key == orig_key || (!d.source_key.is_empty() && d.source_key == orig_key))
    })
}

fn contains_template_placeholder(s: &str) -> bool {
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i] == b'{' {
            let mut j = i + 1;
            if j < len && (bytes[j].is_ascii_alphabetic() || bytes[j] == b'_') {
                j += 1;
                while j < len
                    && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_' || bytes[j] == b'.')
                {
                    j += 1;
                }
                if j < len && bytes[j] == b'}' {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

fn has_percent_encoding(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b'%' && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            return true;
        }
        i += 1;
    }
    false
}

fn encode_query_val_if_needed(raw: &str) -> String {
    if has_percent_encoding(raw) {
        raw.to_string()
    } else {
        utf8_percent_encode(raw, QUERY_VALUE_ENCODE_SET).to_string()
    }
}

fn parse_raw_query_pairs(raw: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for seg in raw.split('&') {
        if seg.is_empty() {
            continue;
        }
        if let Some((k, v)) = seg.split_once('=') {
            out.push((k.to_string(), v.to_string()));
        } else {
            out.push((seg.to_string(), String::new()));
        }
    }
    out
}

fn parse_param_typed_value(raw: &str, value_type: &str) -> Value {
    let vt = value_type.trim().to_ascii_lowercase();
    let trimmed = raw.trim();
    match vt.as_str() {
        "number" => {
            if let Ok(n) = trimmed.parse::<i64>() {
                json!(n)
            } else if let Ok(f) = trimmed.parse::<f64>() {
                json!(f)
            } else {
                Value::String(raw.to_string())
            }
        }
        "boolean" => match trimmed.to_ascii_lowercase().as_str() {
            "true" | "1" => Value::Bool(true),
            "false" | "0" => Value::Bool(false),
            _ => Value::String(raw.to_string()),
        },
        "json" => {
            if trimmed.is_empty() {
                Value::Null
            } else {
                serde_json::from_str::<Value>(trimmed).unwrap_or_else(|_| Value::String(raw.to_string()))
            }
        }
        _ => Value::String(raw.to_string()),
    }
}

fn get_nested_val<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = root;
    for part in path.split('.') {
        cur = cur.as_object()?.get(part)?;
    }
    Some(cur)
}

fn remove_nested_val(root: &mut Value, path: &str) -> Option<Value> {
    let parts: Vec<&str> = path.split('.').collect();
    if parts.is_empty() {
        return None;
    }
    let mut cur = root;
    for part in &parts[..parts.len() - 1] {
        cur = cur.as_object_mut()?.get_mut(*part)?;
    }
    cur.as_object_mut()?.remove(parts[parts.len() - 1])
}

fn set_nested_val(root: &mut Value, path: &str, val: Value) {
    let parts: Vec<&str> = path.split('.').collect();
    if parts.is_empty() {
        return;
    }
    let mut cur = root;
    for part in &parts[..parts.len() - 1] {
        if !cur.is_object() {
            *cur = Value::Object(Map::new());
        }
        let obj = cur.as_object_mut().expect("object");
        cur = obj
            .entry((*part).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    if !cur.is_object() {
        *cur = Value::Object(Map::new());
    }
    if let Some(obj) = cur.as_object_mut() {
        obj.insert(parts[parts.len() - 1].to_string(), val);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub reachable: bool,
    pub url: String,
    pub host: String,
    pub port: u16,
    pub status_code: Option<u16>,
    pub latency_ms: u64,
    pub reason_kind: String,
    pub message: String,
}

fn probe_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::none())
            .pool_idle_timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(2)
            .build()
            .expect("build probe http client")
    })
}

pub async fn probe_url(url_str: &str, timeout_ms: u64) -> ProbeResult {
    let start = Instant::now();
    let trimmed = url_str.trim();
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    let parsed = match reqwest::Url::parse(&normalized) {
        Ok(u) => u,
        Err(e) => {
            return ProbeResult {
                reachable: false,
                url: normalized,
                host: String::new(),
                port: 0,
                status_code: None,
                latency_ms: start.elapsed().as_millis() as u64,
                reason_kind: "invalid_url".to_string(),
                message: format!("接口地址格式无效: {e}"),
            };
        }
    };

    let host = parsed.host_str().unwrap_or("").to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);
    if host.is_empty() {
        return ProbeResult {
            reachable: false,
            url: parsed.to_string(),
            host,
            port,
            status_code: None,
            latency_ms: start.elapsed().as_millis() as u64,
            reason_kind: "invalid_url".to_string(),
            message: "接口地址缺少有效主机名或 IP".to_string(),
        };
    }

    let timeout = Duration::from_millis(timeout_ms.clamp(400, 15_000));
    match tokio::time::timeout(timeout, tokio::net::TcpStream::connect((host.as_str(), port))).await
    {
        Err(_) => {
            let ms = start.elapsed().as_millis() as u64;
            return ProbeResult {
                reachable: false,
                url: parsed.to_string(),
                host,
                port,
                status_code: None,
                latency_ms: ms,
                reason_kind: "timeout".to_string(),
                message: format!("连接超时（{ms}ms 内未响应，请确认电脑已接入公司内网/VPN，或修改接口 IP）"),
            };
        }
        Ok(Err(err)) => {
            let ms = start.elapsed().as_millis() as u64;
            let (kind, msg) = match err.kind() {
                ErrorKind::ConnectionRefused => (
                    "refused",
                    format!("连接被拒绝：{host}:{port} 未开放或服务未启动"),
                ),
                ErrorKind::TimedOut => (
                    "timeout",
                    format!("网络连接超时（{host}:{port}）"),
                ),
                _ => (
                    "offline",
                    format!("当前无法访问内网服务 {host}:{port}（{err}）"),
                ),
            };
            return ProbeResult {
                reachable: false,
                url: parsed.to_string(),
                host,
                port,
                status_code: None,
                latency_ms: ms,
                reason_kind: kind.to_string(),
                message: msg,
            };
        }
        Ok(Ok(stream)) => {
            drop(stream);
        }
    }

    let status_code = match probe_http_client()
        .get(parsed.clone())
        .timeout(Duration::from_millis(1500))
        .send()
        .await
    {
        Ok(resp) => Some(resp.status().as_u16()),
        Err(_) => None,
    };

    let ms = start.elapsed().as_millis() as u64;
    let message = match status_code {
        Some(code) => format!("连接正常（HTTP {code}，耗时 {ms}ms）"),
        None => format!("TCP 端口 {host}:{port} 已连通（耗时 {ms}ms）"),
    };

    ProbeResult {
        reachable: true,
        url: parsed.to_string(),
        host,
        port,
        status_code,
        latency_ms: ms,
        reason_kind: "ok".to_string(),
        message,
    }
}

pub fn api_config_path(root: &Path) -> PathBuf {
    meta_dir(root).join("api_config.json")
}

pub fn load_api_config_sync(app: &AppHandle) -> Result<ApiConfig, String> {
    let root = data_root_dir(app)?;
    let settings = load_settings_sync(app)?;
    let path = api_config_path(&root);

    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let mut cfg = ApiConfig::default();
        if let Some(ip_str) = settings.worktime.get("ip").and_then(|v| v.as_str()) {
            cfg.apply_ip_string(ip_str);
        }
        if let Some(sp_id) = settings.worktime.get("space_id").and_then(val_as_i64) {
            if sp_id > 0 {
                cfg.space_id = sp_id;
            }
        }
        if let Some(wx_url) = settings
            .worktime
            .get("wechat_config")
            .and_then(|w| w.get("url"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if let Some(ep) = cfg
                .endpoints
                .iter_mut()
                .find(|e| e.key == "wechat_webservice")
            {
                ep.path_template = wx_url.to_string();
            }
        }
        cfg.updated_at = now_iso();
        cfg.merge_missing_defaults();
        atomic_write_json_unlocked(&path, &cfg)?;
        return Ok(cfg);
    }

    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取接口配置失败: {e}"))?;
    let mut cfg: ApiConfig =
        serde_json::from_str(&raw).map_err(|e| format!("解析接口配置失败: {e}"))?;
    let before_endpoints = cfg.endpoints.clone();
    cfg.merge_missing_defaults();
    if cfg.endpoints != before_endpoints {
        let _ = atomic_write_json_unlocked(&path, &cfg);
    }
    Ok(cfg)
}

pub fn save_api_config_file_only(app: &AppHandle, mut cfg: ApiConfig) -> Result<ApiConfig, String> {
    let root = data_root_dir(app)?;
    let path = api_config_path(&root);
    cfg.merge_missing_defaults();
    cfg.updated_at = now_iso();
    {
        let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
        atomic_write_json_unlocked(&path, &cfg)?;
    }
    Ok(cfg)
}

pub fn sync_from_settings_worktime(app: &AppHandle, worktime: &Value) -> Result<ApiConfig, String> {
    let mut cfg = load_api_config_sync(app)?;
    if let Some(ip_str) = worktime.get("ip").and_then(|v| v.as_str()) {
        cfg.apply_ip_string(ip_str);
    }
    if let Some(sp_id) = worktime.get("space_id").and_then(val_as_i64) {
        if sp_id > 0 {
            cfg.space_id = sp_id;
        }
    }
    if let Some(wx_url) = worktime
        .get("wechat_config")
        .and_then(|w| w.get("url"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Some(ep) = cfg
            .endpoints
            .iter_mut()
            .find(|e| e.key == "wechat_webservice")
        {
            ep.path_template = wx_url.to_string();
        }
    }
    save_api_config_file_only(app, cfg)
}

fn sync_settings_from_api_config(app: &AppHandle, cfg: &ApiConfig) -> Result<(), String> {
    let mut settings = load_settings_sync(app)?;
    if !settings.worktime.is_object() {
        settings.worktime = json!({});
    }
    if let Some(obj) = settings.worktime.as_object_mut() {
        obj.insert("ip".to_string(), Value::String(cfg.settings_ip_value()));
        obj.insert(
            "space_id".to_string(),
            Value::String(cfg.space_id.to_string()),
        );
        let wx_ep = cfg.endpoint_url("wechat_webservice");
        if !wx_ep.trim().is_empty() {
            let entry = obj
                .entry("wechat_config".to_string())
                .or_insert_with(|| json!({}));
            if let Some(wx_obj) = entry.as_object_mut() {
                wx_obj.insert("url".to_string(), Value::String(wx_ep));
            }
        }
    }
    save_settings_sync(app, &settings)?;
    Ok(())
}

#[tauri::command]
pub async fn get_api_config(app: AppHandle) -> Result<ApiConfig, String> {
    let cfg = load_api_config_sync(&app)?;
    let state = app.state::<Sidecar>();
    state.set_api_config(cfg.clone()).await;
    Ok(cfg)
}

#[tauri::command]
pub fn get_default_api_config() -> ApiConfig {
    ApiConfig::default()
}

#[tauri::command]
pub async fn save_api_config(app: AppHandle, config: ApiConfig) -> Result<ApiConfig, String> {
    if config.ip.trim().is_empty() {
        return Err("服务器 IP 或域名不能为空".to_string());
    }
    if config.space_id <= 0 {
        return Err("Space ID 必须大于 0".to_string());
    }
    if config.rules.time_work <= 0.0 {
        return Err("每日标准工时 (timeWork) 必须大于 0".to_string());
    }
    if config.rules.max_daily_hours <= 0.0 {
        return Err("每日工时上限 (maxDailyHours) 必须大于 0".to_string());
    }
    let saved = save_api_config_file_only(&app, config)?;
    sync_settings_from_api_config(&app, &saved)?;

    let state = app.state::<Sidecar>();
    state.set_api_config(saved.clone()).await;

    emit_app_log(
        &app,
        format!(
            "⚙️ 接口与参数规则已更新并即时生效: {} (Space ID={})",
            saved.base_host(),
            saved.space_id
        ),
    );
    Ok(saved)
}

#[tauri::command]
pub async fn reset_api_config(app: AppHandle) -> Result<ApiConfig, String> {
    let mut def = ApiConfig::default();
    def.updated_at = now_iso();
    save_api_config(app, def).await
}

#[tauri::command]
pub async fn probe_devops_connection(
    app: AppHandle,
    override_url: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<ProbeResult, String> {
    let cfg = load_api_config_sync(&app)?;
    let target = override_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.login_url());
    let wait_ms = timeout_ms.unwrap_or(cfg.rules.connect_check_timeout_ms);
    Ok(probe_url(&target, wait_ms).await)
}
