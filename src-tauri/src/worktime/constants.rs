use serde_json::{json, Value};

pub const SPACE_INDENT: &str = "     ";
pub const TIME_WORK: f64 = 7.0;
pub const MAX_DAILY_HOURS: f64 = 12.0;

pub const DEFAULT_TEMPLATE_REPORT: &str = "\
### 📊 工时批量提报完成通知\n\
> 状态：<font color=\"info\">{status_desc}</font>\n\n\
* **提报人员**：{user_name}\n\
* **提报时间**：<font color=\"comment\">{time}</font>\n\
* **提报条数**：<font color=\"info\">{plan_count} 条</font>\n\n\
📋 **成功明细**：\n\
{report_details}";

pub const DEFAULT_TEMPLATE_MR: &str = "\
### 🚀 批量提交 MR 完成通知\n\
> 目标环境：<font color=\"info\">{dest_branches}</font>（涉及 **{project_count}** 个仓库）\n\n\
* **操作人员**：{user_name}\n\
* **源分支**：`{src_branch}`\n\
* **评审人员**：{reviewers}\n\
* **提交时间**：<font color=\"comment\">{time}</font>\n\n\
🔗 **合并审查链接**：\n\
{mr_links}";

pub const DEFAULT_TEMPLATE_TEST: &str = "\
### 🧪 企微推送通道测试\n\
> 状态：<font color=\"info\">连接正常，消息送达测试通过</font>\n\n\
* **推送模式**：`{mode}`\n\
* **接收对象**：{target}\n\
* **测试时间**：<font color=\"comment\">{time}</font>";

pub const DEFAULT_TEMPLATE_MISS: &str = "\
### ⏰ 工时缺报提醒通知\n\
> <font color=\"warning\">存在 {miss_count} 个未达标工作日，请及时补报</font>\n\n\
* **提醒对象**：{user_name}\n\
* **统计周期**：{start_date} 至 {end_date}\n\
* **缺报天数**：<font color=\"warning\">{miss_count} 天</font>\n\
* **通知时间**：<font color=\"comment\">{time}</font>\n\n\
📋 **缺报/不足明细**：\n\
{miss_details}";

pub const BUILTIN_REVIEWERS: &[(&str, i64)] = &[];

pub const REPO_TO_TAG_MAPPING: &[(&str, &str, i64, &str)] = &[];

#[allow(dead_code)]
pub fn member_rate(_name: &str) -> f64 {
    0.9
}

pub fn default_wechat_config() -> Value {
    json!({
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
        "template_report": DEFAULT_TEMPLATE_REPORT,
        "template_mr": DEFAULT_TEMPLATE_MR,
        "template_test": DEFAULT_TEMPLATE_TEST,
        "template_miss": DEFAULT_TEMPLATE_MISS,
    })
}

pub fn checklist_stages_json() -> Value {
    json!([
        {"key": "review", "name": "评审", "stageId": 30,  "count": 10, "desc": "需求规格说明书与方案合理性规范检查 (10项)"},
        {"key": "design", "name": "设计", "stageId": 70,  "count": 21, "desc": "设计文档、系统架构与原型正确性检查 (21项)"},
        {"key": "dev",    "name": "开发", "stageId": 90,  "count": 16, "desc": "代码评审规范性与自测检查 (16项)"},
        {"key": "test",   "name": "测试", "stageId": 110, "count": 8,  "desc": "测试设计覆盖度与执行结果检查 (8项)"}
    ])
}

pub fn checklist_review_items_json() -> Value {
    json!([
        {"checkId": 1,  "checkPointId": 1,  "checkPointName": "规范性", "stageId": 30, "checkContent": "需求规格说明书命名是否符合规范。", "checkResult": 2},
        {"checkId": 2,  "checkPointId": 1,  "checkPointName": "规范性", "stageId": 30, "checkContent": "需求规格说明书应包括界面设计图与流程图。", "checkResult": 2},
        {"checkId": 3,  "checkPointId": 2,  "checkPointName": "合理性", "stageId": 30, "checkContent": "业务逻辑是否明确。", "checkResult": 2},
        {"checkId": 4,  "checkPointId": 2,  "checkPointName": "合理性", "stageId": 30, "checkContent": "需求的范围是否合理，可行。", "checkResult": 2},
        {"checkId": 5,  "checkPointId": 2,  "checkPointName": "合理性", "stageId": 30, "checkContent": "设计人员是否认为可以据此进行设计。", "checkResult": 2},
        {"checkId": 6,  "checkPointId": 2,  "checkPointName": "合理性", "stageId": 30, "checkContent": "是否对系统与外部的边界，接口进行说明。", "checkResult": 2},
        {"checkId": 7,  "checkPointId": 3,  "checkPointName": "完整性", "stageId": 30, "checkContent": "充分考虑不同角色，在不同状态下页面的表现。", "checkResult": 2},
        {"checkId": 8,  "checkPointId": 3,  "checkPointName": "完整性", "stageId": 30, "checkContent": "文字描述上不要让用户迷惑，不要让客户去猜测开发者的意图。", "checkResult": 2},
        {"checkId": 9,  "checkPointId": 3,  "checkPointName": "完整性", "stageId": 30, "checkContent": "明确哪些是必填项，哪些是默认选项。", "checkResult": 2},
        {"checkId": 10, "checkPointId": 12, "checkPointName": "可测性", "stageId": 30, "checkContent": "是否所有需求均具备可测试。", "checkResult": 2}
    ])
}

pub fn checklist_design_items_json() -> Value {
    json!([
        {"checkId": 11, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "设计文档命名是否符合规范。", "checkResult": 2},
        {"checkId": 12, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "设计文档模板是否正确。", "checkResult": 2},
        {"checkId": 13, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "涉及机构、险种、系统是否均已做明确说明。", "checkResult": 2},
        {"checkId": 14, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "较大需求是否明确系统架构。", "checkResult": 2},
        {"checkId": 15, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "是否所有的客户需求在目前情况下技术都是可以实现的。", "checkResult": 2},
        {"checkId": 16, "checkPointId": 3, "checkPointName": "完整性",   "stageId": 70, "checkContent": "是否明确说明需改造哪些相关系统。", "checkResult": 2},
        {"checkId": 17, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否所有待确认问题均已确认无误。", "checkResult": 2},
        {"checkId": 18, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "如果需求涉及数据结构变更或数据变更，是否已在设计文档中明确给出SQL脚本。", "checkResult": 2},
        {"checkId": 19, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "针对已有基础数据的变更或已有数据结构存储规则变化时，是否告知其他模块。", "checkResult": 2},
        {"checkId": 20, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否包含清晰的页面原型设计，页面布局是否合理。", "checkResult": 2},
        {"checkId": 21, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否明确说明页面流转流程，校验规则是否清晰。", "checkResult": 2},
        {"checkId": 22, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "修改现有功能是否已考虑对于历史数据是否存在影响。", "checkResult": 2},
        {"checkId": 23, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "如果包含与外部系统接口，内部与外部系统接口内容及交互方式是否明确定义。", "checkResult": 2},
        {"checkId": 24, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否针对关键逻辑做了明确说明。", "checkResult": 2},
        {"checkId": 25, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否包含系统改造风险说明。", "checkResult": 2},
        {"checkId": 26, "checkPointId": 4, "checkPointName": "正确性",   "stageId": 70, "checkContent": "是否考虑程序扩展性，是否能够配置实现。", "checkResult": 2},
        {"checkId": 27, "checkPointId": 5, "checkPointName": "用户体验", "stageId": 70, "checkContent": "是否包含用户体验方面的设计。", "checkResult": 2},
        {"checkId": 28, "checkPointId": 6, "checkPointName": "性能设计", "stageId": 70, "checkContent": "是否包含非功能性需求的设计。非功能性需求指性能、稳定性、可操作性、可维护性、容量估计、安全性等。", "checkResult": 2},
        {"checkId": 29, "checkPointId": 6, "checkPointName": "性能设计", "stageId": 70, "checkContent": "是否所有使用到的SQL都明确说明需要做绑定变量处理。", "checkResult": 2},
        {"checkId": 30, "checkPointId": 6, "checkPointName": "性能设计", "stageId": 70, "checkContent": "是否存在循环中反复开关连接池的情况。", "checkResult": 2},
        {"checkId": 31, "checkPointId": 6, "checkPointName": "性能设计", "stageId": 70, "checkContent": "较大SQL是否做过执行计划且分析过其执行效率。", "checkResult": 2}
    ])
}

pub fn checklist_dev_items_json() -> Value {
    json!([
        {"checkId": 30011, "checkPointId": 1, "checkPointName": "规范性",   "stageId": 90, "checkContent": "是否备注缺陷原因与修改方案。", "checkResult": 2},
        {"checkId": 32,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "与设计文档相比，程序实现是否有遗漏点。", "checkResult": 2},
        {"checkId": 33,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "是否提交必要的SQL脚本。", "checkResult": 2},
        {"checkId": 34,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "是否对程序逻辑异常做处理。", "checkResult": 2},
        {"checkId": 35,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "是否对新增变量做声明。", "checkResult": 2},
        {"checkId": 36,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "是否对新增使用参数做校验。", "checkResult": 2},
        {"checkId": 37,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "代码是否进行考虑到尽量使用了重用。", "checkResult": 2},
        {"checkId": 38,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "程序是否存在死循环。", "checkResult": 2},
        {"checkId": 39,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "程序是否存在连接池泄露。", "checkResult": 2},
        {"checkId": 40,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "程序是否存在循环中打开连接池。", "checkResult": 2},
        {"checkId": 41,    "checkPointId": 8, "checkPointName": "代码评审", "stageId": 90, "checkContent": "是否按规范添加代码注释，包括新增方法、代码段、变量。", "checkResult": 2},
        {"checkId": 42,    "checkPointId": 9, "checkPointName": "自测检查", "stageId": 90, "checkContent": "明确的功能点是否在测试中都覆盖到了。", "checkResult": 2},
        {"checkId": 43,    "checkPointId": 9, "checkPointName": "自测检查", "stageId": 90, "checkContent": "是否明确要求要处理历史数据，有无相应的处理SQL。", "checkResult": 2},
        {"checkId": 44,    "checkPointId": 9, "checkPointName": "自测检查", "stageId": 90, "checkContent": "是否明确要求全险种都处理，是否测试。", "checkResult": 2},
        {"checkId": 45,    "checkPointId": 9, "checkPointName": "自测检查", "stageId": 90, "checkContent": "是否明确要求几个机构都处理，是否测试。", "checkResult": 2},
        {"checkId": 46,    "checkPointId": 9, "checkPointName": "自测检查", "stageId": 90, "checkContent": "是否明确要求有开关处理，开关控制点是否测试。", "checkResult": 2}
    ])
}

pub fn checklist_test_items_json() -> Value {
    json!([
        {"checkId": 47, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "需求中的有效描述是否都能对应到用例中至少一个“主要测试点”。", "checkResult": 2},
        {"checkId": 48, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "每个“主要测试点”是否对有效等价类、无效等价类都设计了测试用例。", "checkResult": 2},
        {"checkId": 49, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "每个“主要测试点”是否对所有的边界值（包括大于、等于、小于）都设计了测试用例。", "checkResult": 2},
        {"checkId": 50, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "每个“主要测试点”是否对正常流程、异常流程都设计了测试用例。", "checkResult": 2},
        {"checkId": 51, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "用例中是否包括对历史数据查询的测试。", "checkResult": 2},
        {"checkId": 52, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "用例中是否包括对历史数据后续处理的测试，如核保、收付、批改。", "checkResult": 2},
        {"checkId": 53, "checkPointId": 10, "checkPointName": "测试设计",     "stageId": 110, "checkContent": "用例是否覆盖该功能的所有使用场景，包括例如总公司、分公司以及各个使用角色等。", "checkResult": 2},
        {"checkId": 54, "checkPointId": 11, "checkPointName": "测试执行结果", "stageId": 110, "checkContent": "每条用例是否都填写有效执行结果，如有效测试数据，测试页面截图等，能清晰判断该用例被执行。", "checkResult": 2}
    ])
}

pub fn checklist_templates_json() -> Value {
    json!({
        "review": checklist_review_items_json(),
        "design": checklist_design_items_json(),
        "dev":    checklist_dev_items_json(),
        "test":   checklist_test_items_json(),
    })
}

pub fn status_flow_steps_json() -> Value {
    json!([
        {"id": 50,  "key": "design",        "name": "方案设计", "desc": "需求分析与方案设计"},
        {"id": 60,  "key": "design_review", "name": "设计评审", "desc": "设计评审文档"},
        {"id": 70,  "key": "dev",           "name": "开发",     "desc": "进入开发阶段 (需设置计划提测日期)"},
        {"id": 90,  "key": "dev_test",      "name": "开发自测", "desc": "编码实现与单元自测"},
        {"id": 130, "key": "uat_update",    "name": "UAT更新",  "desc": "部署更新至UAT验证环境"},
        {"id": 110, "key": "test_audit",    "name": "测试审核", "desc": "测试审核验收 (需研发附件)"},
        {"id": 140, "key": "uat_verify",    "name": "UAT验收",  "desc": "转测试/业务验收 (自动转经办人)"}
    ])
}

pub fn default_dev_handler_json() -> Value {
    json!({
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
    })
}

pub fn default_uat_handler_json() -> Value {
    json!({
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
    })
}

pub fn default_space_tags_json() -> Value {
    json!([])
}

pub fn status_flow_steps_from_rules(rules: &super::api_config::ApiParamRules) -> Value {
    if rules.status_flow_steps.is_empty() {
        return status_flow_steps_json();
    }
    Value::Array(
        rules
            .status_flow_steps
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "key": s.key,
                    "name": s.name,
                    "desc": s.desc,
                })
            })
            .collect(),
    )
}

pub fn get_const_value_with_rules(
    name: &str,
    rules: Option<&super::api_config::ApiParamRules>,
) -> Result<Value, String> {
    if name.is_empty() || name != name.to_uppercase() {
        return Err(format!("仅允许读取全大写常量: {name}"));
    }
    match name {
        "TIME_WORK" => Ok(json!(rules.map(|r| r.time_work).unwrap_or(TIME_WORK))),
        "MAX_DAILY_HOURS" => Ok(json!(rules
            .map(|r| r.max_daily_hours)
            .unwrap_or(MAX_DAILY_HOURS))),
        "SPACE_INDENT" => Ok(json!(SPACE_INDENT)),
        "DEFAULT_TEMPLATE_REPORT" => Ok(json!(DEFAULT_TEMPLATE_REPORT)),
        "DEFAULT_TEMPLATE_MR" => Ok(json!(DEFAULT_TEMPLATE_MR)),
        "DEFAULT_TEMPLATE_TEST" => Ok(json!(DEFAULT_TEMPLATE_TEST)),
        "DEFAULT_TEMPLATE_MISS" => Ok(json!(DEFAULT_TEMPLATE_MISS)),
        "WECHAT_CONFIG" => Ok(default_wechat_config()),
        "CHECKLIST_STAGES" => Ok(checklist_stages_json()),
        "CHECKLIST_REVIEW_ITEMS" => Ok(checklist_review_items_json()),
        "CHECKLIST_DESIGN_ITEMS" => Ok(checklist_design_items_json()),
        "CHECKLIST_DEV_ITEMS" => Ok(checklist_dev_items_json()),
        "CHECKLIST_TEST_ITEMS" => Ok(checklist_test_items_json()),
        "CHECKLIST_TEMPLATES" => Ok(checklist_templates_json()),
        "STATUS_FLOW_STEPS" => Ok(rules
            .map(status_flow_steps_from_rules)
            .unwrap_or_else(status_flow_steps_json)),
        "DEFAULT_DEV_HANDLER" => Ok(default_dev_handler_json()),
        "DEFAULT_UAT_HANDLER" => Ok(default_uat_handler_json()),
        "DEFAULT_SPACE_TAGS" => Ok(default_space_tags_json()),
        "BUILTIN_REVIEWERS" => {
            let mut map = serde_json::Map::new();
            if let Some(r) = rules {
                for (k, v) in &r.builtin_reviewers {
                    map.insert(k.clone(), json!(v));
                }
            } else {
                for (k, v) in BUILTIN_REVIEWERS {
                    map.insert((*k).to_string(), json!(v));
                }
            }
            Ok(Value::Object(map))
        }
        "REPO_TO_TAG_MAPPING" => {
            if let Some(r) = rules {
                let list: Vec<Value> = r
                    .repo_to_tag_mapping
                    .iter()
                    .map(|m| json!([m.repo_keyword, m.tag_name, m.tag_id, m.example_project]))
                    .collect();
                Ok(Value::Array(list))
            } else {
                let list: Vec<Value> = REPO_TO_TAG_MAPPING
                    .iter()
                    .map(|(a, b, c, d)| json!([a, b, c, d]))
                    .collect();
                Ok(Value::Array(list))
            }
        }
        _ => Err(format!("不存在常量: {name}")),
    }
}

#[allow(dead_code)]
pub fn get_const_value(name: &str) -> Result<Value, String> {
    get_const_value_with_rules(name, None)
}
