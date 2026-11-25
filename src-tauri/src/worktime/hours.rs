use chrono::{Datelike, Duration as ChronoDuration, Local, NaiveDate};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::sidecar::emit_app_log;

use super::calendar::{
    days_in_month, get_day_info, get_quarter, local_end_of_day_ms, local_midnight_ms,
    ms_to_local_ymd,
};
use super::client::{val_as_f64, val_as_i64, val_as_str, WorktimeEngine};
use super::constants::SPACE_INDENT;

fn log_line(app: Option<&AppHandle>, msg: impl Into<String>) {
    if let Some(a) = app {
        emit_app_log(a, msg.into());
    }
}

pub async fn get_current_user(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
) -> Result<Value, String> {
    let (_, body) = engine
        .call_endpoint_json(app, "user_info", &[], None, None, false, 15)
        .await?;
    let data = body.get("data").cloned().unwrap_or_else(|| json!({}));
    if let Some(obj) = data.as_object() {
        let u_name = obj
            .get("name")
            .or_else(|| obj.get("org").and_then(|o| o.get("name")))
            .map(val_as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let u_erp = obj
            .get("userErp")
            .map(val_as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !u_name.is_empty() && !u_erp.is_empty() {
            engine.state.write().await.name_to_erp.insert(u_name, u_erp);
        }
    }
    Ok(data)
}

pub async fn keep_alive_ping(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    let (_, res_json) = engine
        .call_endpoint_json(app, "keep_alive", &[], None, None, false, 15)
        .await?;
    if let Some(code) = res_json.get("code").and_then(val_as_i64) {
        if code != 0 && code != 200 {
            let msg = res_json
                .get("msg")
                .or_else(|| res_json.get("message"))
                .map(val_as_str)
                .unwrap_or_else(|| "会话可能已失效".to_string());
            return Err(format!("保活接口返回异常状态: code={code}, msg={msg}"));
        }
    }
    let (_, ka_url) = engine.resolve_endpoint("keep_alive", &[]).await;
    if ka_url.contains("/user/info") {
        let user_erp = res_json
            .get("data")
            .and_then(|d| d.get("userErp").or_else(|| d.get("erp")))
            .map(val_as_str)
            .unwrap_or_default();
        if user_erp.trim().is_empty() {
            return Err("会话已失效：保活接口未返回有效 userErp，请重新登录".to_string());
        }
    }
    Ok(res_json)
}

pub async fn get_delivery_capacity(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
) -> Result<Value, String> {
    match engine
        .call_endpoint_json(app, "delivery_capacity", &[], None, None, false, 15)
        .await
    {
        Ok((_, res)) => {
            let candidate = if let Some(d) = res.get("data") {
                if d.is_null() {
                    Value::Null
                } else {
                    d.clone()
                }
            } else if res.get("personalDeliveryCapacity").is_some()
                || res.get("personalDeliveryCapacityStandard").is_some()
                || res.get("cardCount").is_some()
            {
                res
            } else {
                Value::Null
            };

            if let Some(obj) = candidate.as_object() {
                if obj.is_empty() {
                    return Ok(Value::Null);
                }
                let u_name = obj
                    .get("userName")
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let u_erp = obj
                    .get("userErp")
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !u_name.is_empty() && !u_erp.is_empty() {
                    let mut st = engine.state.write().await;
                    st.name_to_erp.insert(u_name.clone(), u_erp.clone());
                    st.erp_to_name.insert(u_erp, u_name);
                }
                Ok(Value::Object(obj.clone()))
            } else {
                Ok(Value::Null)
            }
        }
        Err(_) => Ok(Value::Null),
    }
}

pub async fn get_members(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
) -> Result<Vec<Value>, String> {
    let (_, body) = engine
        .call_endpoint_json(app, "space_members", &[], None, None, false, 15)
        .await?;
    let list = body
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    {
        let mut st = engine.state.write().await;
        for item in &list {
            let m_name = item
                .get("memberName")
                .or_else(|| item.get("name"))
                .or_else(|| item.get("userName"))
                .map(val_as_str)
                .unwrap_or_default()
                .trim()
                .to_string();
            let m_erp = item
                .get("memberErp")
                .or_else(|| item.get("userErp"))
                .map(val_as_str)
                .unwrap_or_default()
                .trim()
                .to_string();
            if !m_name.is_empty() && !m_erp.is_empty() {
                st.name_to_erp.insert(m_name.clone(), m_erp.clone());
                st.erp_to_name.insert(m_erp, m_name);
            }
        }
    }
    Ok(list)
}

pub async fn resolve_erp_to_name(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    erp: &str,
) -> String {
    let raw = erp.trim();
    if raw.is_empty() {
        return String::new();
    }
    {
        let mut st = engine.state.write().await;
        if let Some(name) = st.erp_to_name.get(raw) {
            return name.clone();
        }
        if let Some((n, _)) = st.name_to_erp.iter().find(|(_, e)| e.as_str() == raw) {
            let n_clone = n.clone();
            st.erp_to_name.insert(raw.to_string(), n_clone.clone());
            return n_clone;
        }
    }
    if engine.has_cookies().await && get_members(engine, app).await.is_ok() {
        let st = engine.state.read().await;
        if let Some(n) = st.erp_to_name.get(raw) {
            return n.clone();
        }
    }
    String::new()
}

pub fn clean_member_input(raw: &str) -> (Option<String>, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (Some(String::new()), String::new());
    }
    if trimmed.len() >= 6 && trimmed.chars().all(|c| c.is_ascii_digit()) {
        return (Some(trimmed.to_string()), trimmed.to_string());
    }
    if let Ok(re) = Regex::new(r"[\(（](\d{6,})[\)）]") {
        if let Some(caps) = re.captures(trimmed) {
            return (Some(caps[1].to_string()), trimmed.to_string());
        }
    }
    let clean = trimmed
        .trim_start_matches(|c: char| "⭐#*•- ".contains(c) || c.is_whitespace())
        .replace("（本人）", "")
        .replace("(本人)", "")
        .trim()
        .to_string();
    if clean.len() >= 6 && clean.chars().all(|c| c.is_ascii_digit()) {
        return (Some(clean.clone()), clean);
    }
    (None, clean)
}

pub async fn resolve_member_erp(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    name_or_erp: &str,
) -> String {
    let raw = name_or_erp.trim();
    if raw.is_empty() {
        return String::new();
    }
    let (direct, clean_name) = clean_member_input(raw);
    if let Some(erp) = direct {
        return erp;
    }

    {
        let st = engine.state.read().await;
        if let Some(e) = st.name_to_erp.get(&clean_name) {
            return e.clone();
        }
        if let Some(e) = st.name_to_erp.get(raw) {
            return e.clone();
        }
    }

    if engine.has_cookies().await {
        if let Ok(members) = get_members(engine, app).await {
            for item in &members {
                let m_name = item
                    .get("memberName")
                    .or_else(|| item.get("name"))
                    .or_else(|| item.get("userName"))
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let m_erp = item
                    .get("memberErp")
                    .or_else(|| item.get("userErp"))
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !m_name.is_empty() && !m_erp.is_empty() && (m_name == clean_name || m_name == raw)
                {
                    return m_erp;
                }
            }
            for item in &members {
                let m_name = item
                    .get("memberName")
                    .or_else(|| item.get("name"))
                    .or_else(|| item.get("userName"))
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let m_erp = item
                    .get("memberErp")
                    .or_else(|| item.get("userErp"))
                    .map(val_as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !m_name.is_empty()
                    && !m_erp.is_empty()
                    && (m_name.contains(&clean_name) || m_name.contains(raw))
                {
                    return m_erp;
                }
            }
        }
    }

    let st = engine.state.read().await;
    st.name_to_erp
        .get(&clean_name)
        .or_else(|| st.name_to_erp.get(raw))
        .cloned()
        .unwrap_or(clean_name)
}

pub async fn get_role_code(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    role_name: &str,
) -> Result<i64, String> {
    let target = role_name.trim();
    let rules = engine.rules().await;
    let def_dev = if rules.default_role_code > 0 {
        rules.default_role_code
    } else {
        1011
    };
    let def_qa = if rules.default_qa_role_code > 0 {
        rules.default_qa_role_code
    } else {
        1012
    };

    match engine
        .call_endpoint_json(app, "role_config", &[], None, None, false, 15)
        .await
    {
        Ok((_, body)) => {
            let items = body
                .get("data")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            for it in &items {
                let name = it.get("name").map(val_as_str).unwrap_or_default();
                if name.trim() == target {
                    if let Some(code) = it.get("code").and_then(val_as_i64) {
                        return Ok(code);
                    }
                }
            }
            for it in &items {
                let name = it.get("name").map(val_as_str).unwrap_or_default();
                let ntrim = name.trim();
                if !target.is_empty() && (ntrim.contains(target) || ntrim.ends_with(target)) {
                    if let Some(code) = it.get("code").and_then(val_as_i64) {
                        return Ok(code);
                    }
                }
            }
            if target.contains("开发") || target.to_uppercase().contains("DEV") {
                return Ok(def_dev);
            }
            if target.contains("测试")
                || target.to_uppercase().contains("TEST")
                || target.to_uppercase().contains("QA")
            {
                for it in &items {
                    let name = it.get("name").map(val_as_str).unwrap_or_default();
                    if name.contains("测试") {
                        if let Some(code) = it.get("code").and_then(val_as_i64) {
                            return Ok(code);
                        }
                    }
                }
                return Ok(def_qa);
            }
            if target.is_empty() {
                return Ok(def_dev);
            }
            Err(format!("未找到角色 name={role_name}"))
        }
        Err(e) => {
            if target.contains("开发") || target.is_empty() {
                Ok(def_dev)
            } else {
                Err(e)
            }
        }
    }
}

pub async fn get_sprints(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    query_type: i64,
) -> Result<Vec<Value>, String> {
    let qt_str = query_type.to_string();
    let (_, body) = engine
        .call_endpoint_json(
            app,
            "sprints_query",
            &[("queryType", &qt_str)],
            None,
            None,
            false,
            15,
        )
        .await?;
    Ok(body
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

pub async fn search_cards_raw(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    task_id: Option<&str>,
    developers_list: &[String],
    sprint_id: Option<i64>,
) -> Result<Vec<Value>, String> {
    let cfg = engine.api_config().await;
    let page_size = cfg.rules.card_page_size.max(1);
    let payload = json!({
        "spaceId": cfg.space_id,
        "sprintId": sprint_id.map(Value::from).unwrap_or(Value::Null),
        "handlers": [],
        "spaceWorkitemTypeCodes": [],
        "keyword": task_id.unwrap_or(""),
        "cardStates": [],
        "orderField": "id",
        "orderType": "desc",
        "workitemTypeCodes": [],
        "developersList": developers_list,
        "currentPage": 1,
        "pageSize": page_size,
    });
    let (_, body) = engine
        .call_endpoint_json(app, "card_list", &[], None, Some(&payload), false, 15)
        .await?;
    Ok(body
        .get("data")
        .and_then(|d| d.get("resultList"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

pub async fn search_card_id(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    task_id: &str,
) -> Result<i64, String> {
    let target = task_id.trim();
    if let Some(cached) = engine.state.read().await.card_cache.get(target).copied() {
        return Ok(cached);
    }
    let result_list = search_cards_raw(engine, app, Some(target), &[], None).await?;
    if result_list.is_empty() {
        return Err(format!("任务号 {target} 未查询到对应卡片"));
    }
    let matched = result_list
        .iter()
        .find(|item| {
            let c_code = item
                .get("cardCode")
                .or_else(|| item.get("code"))
                .or_else(|| item.get("sequenceNum"))
                .map(val_as_str)
                .unwrap_or_default();
            let c_id = item.get("id").map(val_as_str).unwrap_or_default();
            c_code.trim().eq_ignore_ascii_case(target) || c_id.trim() == target
        })
        .unwrap_or(&result_list[0]);

    let cid = matched
        .get("id")
        .and_then(val_as_i64)
        .ok_or_else(|| format!("卡片缺少数字 ID: {target}"))?;
    engine
        .state
        .write()
        .await
        .insert_card_cache(target.to_string(), cid);
    Ok(cid)
}

pub async fn get_card_detail(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    force_refresh: bool,
) -> Result<Value, String> {
    if !force_refresh {
        if let Some(cached) = engine
            .state
            .read()
            .await
            .card_detail_cache
            .get(&card_id)
            .cloned()
        {
            return Ok(cached);
        }
    }
    let cid_str = card_id.to_string();
    let cfg = engine.api_config().await;
    let (_, url) = cfg.render_endpoint("card_detail", &[("cardId", &cid_str)]);
    let query_fallback = [("id", cid_str.clone())];
    let query_opt = if url.contains(&cid_str)
        || cfg.is_param_disabled_or_renamed("card_detail", "id", "query")
    {
        None
    } else {
        Some(query_fallback.as_slice())
    };
    let (_, body) = engine
        .call_endpoint_json(
            app,
            "card_detail",
            &[("cardId", &cid_str)],
            query_opt,
            None,
            false,
            15,
        )
        .await?;
    let detail = body.get("data").cloned().unwrap_or_else(|| json!({}));
    engine
        .state
        .write()
        .await
        .insert_card_detail_cache(card_id, detail.clone());
    Ok(detail)
}

pub async fn resolve_card_id(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    task_or_card_id: &str,
) -> Result<i64, String> {
    let raw = task_or_card_id.trim();
    if raw.is_empty() {
        return Err("请输入任务号或卡片ID".to_string());
    }
    if let Some(cid) = engine.state.read().await.card_cache.get(raw).copied() {
        return Ok(cid);
    }
    if let Ok(cid) = search_card_id(engine, app, raw).await {
        if cid > 0 {
            return Ok(cid);
        }
    }
    if raw.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(num_id) = raw.parse::<i64>() {
            if let Ok(detail) = get_card_detail(engine, app, num_id, false).await {
                if detail.get("id").is_some() || detail.get("cardName").is_some() {
                    engine
                        .state
                        .write()
                        .await
                        .insert_card_cache(raw.to_string(), num_id);
                    return Ok(num_id);
                }
            }
            return Ok(num_id);
        }
    }
    Err(format!(
        "未查询到任务号【{raw}】对应的卡片，请核对任务号是否正确"
    ))
}

pub async fn query_task_summary(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    task_id: &str,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Ok(json!({}));
    }
    let card_id = resolve_card_id(engine, app, trimmed).await?;
    let detail = get_card_detail(engine, app, card_id, false).await?;
    let space_id = engine.space_id().await;

    let mut devs = Vec::new();
    if let Some(arr) = detail.get("developers").and_then(|v| v.as_array()) {
        for d in arr {
            if let Some(s) = d.as_str() {
                if !s.is_empty() {
                    devs.push(s.to_string());
                }
            } else {
                let s = d
                    .get("name")
                    .or_else(|| d.get("userName"))
                    .or_else(|| d.get("erp"))
                    .map(val_as_str)
                    .unwrap_or_default();
                if !s.is_empty() {
                    devs.push(s);
                }
            }
        }
    }
    let dev_str = if devs.is_empty() {
        detail
            .get("developerName")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("-")
            .to_string()
    } else {
        devs.join(", ")
    };

    let total_hours: f64 = detail
        .get("declareHours")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|d| d.get("declareHours").and_then(val_as_f64))
                .sum()
        })
        .unwrap_or(0.0);

    let creator_name = if let Some(obj) = detail.get("creator").and_then(|v| v.as_object()) {
        obj.get("name")
            .or_else(|| obj.get("userName"))
            .map(val_as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "-".to_string())
    } else {
        detail
            .get("creatorName")
            .map(val_as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "-".to_string())
    };

    let handler_info = detail
        .get("handler")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let handler_name = if let Some(obj) = handler_info.as_object() {
        obj.get("name")
            .or_else(|| obj.get("userName"))
            .map(val_as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "-".to_string())
    } else if handler_info.is_null() {
        "-".to_string()
    } else {
        val_as_str(&handler_info)
    };

    let rules = engine.rules().await;
    let date_field = if rules.plan_test_date_field.trim().is_empty() {
        "dateKey1"
    } else {
        rules.plan_test_date_field.trim()
    };
    let time_work = rules.time_work.max(0.1);

    let date_key1 = detail
        .get(date_field)
        .filter(|v| !v.is_null())
        .or_else(|| {
            detail
                .get("extProperties")
                .and_then(|e| e.get(date_field))
                .filter(|v| !v.is_null())
        })
        .cloned()
        .unwrap_or(Value::Null);
    let plan_date_str = date_key1
        .as_i64()
        .or_else(|| val_as_i64(&date_key1))
        .and_then(ms_to_local_ymd)
        .unwrap_or_default();

    let status_text = detail
        .get("stageName")
        .or_else(|| detail.get("stateName"))
        .or_else(|| detail.get("statusName"))
        .and_then(|v| v.as_str())
        .unwrap_or("-")
        .to_string();

    Ok(json!({
        "card_id": card_id,
        "space_id": detail.get("spaceId").and_then(val_as_i64).unwrap_or(space_id),
        "code": detail.get("cardCode").or_else(|| detail.get("code")).and_then(|v| v.as_str()).unwrap_or(trimmed),
        "name": detail.get("cardName").or_else(|| detail.get("name")).and_then(|v| v.as_str()).unwrap_or(""),
        "type": detail.get("workitemTypeName").or_else(|| detail.get("typeName")).and_then(|v| v.as_str()).unwrap_or("需求/任务"),
        "stage": status_text,
        "status_name": status_text,
        "card_status_id": detail.get("cardStatusId").or_else(|| detail.get("statusId")).or_else(|| detail.get("cardStateId")).cloned().unwrap_or(Value::Null),
        "sprint": detail.get("sprintName").or_else(|| detail.get("sprint")).and_then(|v| v.as_str()).unwrap_or("-"),
        "creator": creator_name,
        "developers": dev_str,
        "handler": handler_info,
        "handler_name": handler_name,
        "dateKey1": date_key1,
        "plan_test_date_str": plan_date_str,
        "declared_hours": total_hours,
        "declared_days": (total_hours / time_work * 100.0).round() / 100.0,
        "detail_raw": detail,
    }))
}

pub async fn get_own_workload(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
) -> Result<Value, String> {
    let cid_str = card_id.to_string();
    let (_, body) = engine
        .call_endpoint_json(
            app,
            "own_workload",
            &[("cardId", &cid_str)],
            None,
            None,
            false,
            15,
        )
        .await?;
    let data = body.get("data").cloned().unwrap_or_else(|| json!({}));
    Ok(if data.is_null() { json!({}) } else { data })
}

pub async fn get_actual_report_hours(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
) -> Result<Value, String> {
    let cid_str = card_id.to_string();
    let (_, body) = engine
        .call_endpoint_json(
            app,
            "actual_report_hours",
            &[("cardId", &cid_str)],
            None,
            None,
            false,
            15,
        )
        .await?;
    let data = body.get("data").cloned().unwrap_or_else(|| json!({}));
    Ok(if data.is_null() { json!({}) } else { data })
}

pub async fn get_workload_days(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    erp: &str,
) -> Result<f64, String> {
    let rows = if let Some(cached) = engine
        .state
        .read()
        .await
        .work_days_cache
        .get(&card_id)
        .cloned()
    {
        cached
    } else {
        let data = get_own_workload(engine, app, card_id).await?;
        let r = data
            .get("rows")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        engine
            .state
            .write()
            .await
            .insert_work_days_cache(card_id, r.clone());
        r
    };

    let mut total = 0.0_f64;
    for row in rows {
        if let Some(members) = row.get("members").and_then(|v| v.as_array()) {
            for m in members {
                if m.get("erp").map(val_as_str).as_deref() == Some(erp) {
                    total += m.get("workload").and_then(val_as_f64).unwrap_or(0.0);
                }
            }
        }
    }
    Ok(total)
}

pub async fn get_work_times(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    erp: Option<&str>,
) -> Result<Vec<Value>, String> {
    let today = Local::now().date_naive();
    let s_ms = start_ms.unwrap_or_else(|| {
        let first = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
        local_midnight_ms(first)
    });
    let e_ms = end_ms.unwrap_or_else(|| local_end_of_day_ms(today));

    let clean_erp = match erp {
        Some(e) if !e.trim().is_empty() => Some(resolve_member_erp(engine, app, e).await),
        _ => None,
    };

    let s_str = s_ms.to_string();
    let e_str = e_ms.to_string();
    let erp_str = clean_erp.clone().unwrap_or_default();
    let (_, res_json) = engine
        .call_endpoint_json(
            app,
            "worktime_list",
            &[
                ("startDate", &s_str),
                ("endDate", &e_str),
                ("erp", &erp_str),
            ],
            None,
            None,
            false,
            15,
        )
        .await?;
    let data = res_json.get("data").unwrap_or(&Value::Null);
    let mut wt_list = if let Some(arr) = data.as_array() {
        arr.clone()
    } else if let Some(obj) = data.as_object() {
        obj.get("worktimeList")
            .or_else(|| obj.get("rows"))
            .or_else(|| obj.get("list"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    if let Some(ref ce) = clean_erp {
        if !wt_list.is_empty() {
            let erps_in_list: HashSet<String> = wt_list
                .iter()
                .filter_map(|item| {
                    let s = item
                        .get("erp")
                        .or_else(|| item.get("userErp"))
                        .map(val_as_str)
                        .unwrap_or_default();
                    let t = s.trim().to_string();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t)
                    }
                })
                .collect();
            if erps_in_list.len() > 1 {
                wt_list.retain(|item| {
                    item.get("erp")
                        .or_else(|| item.get("userErp"))
                        .map(val_as_str)
                        .unwrap_or_default()
                        .trim()
                        == ce.trim()
                });
            }
        }
    }

    Ok(wt_list)
}

pub fn already_declared(
    card_detail: &Value,
    declare_date_ms: i64,
    hours: f64,
    erp: Option<&str>,
) -> bool {
    let Some(arr) = card_detail.get("declareHours").and_then(|v| v.as_array()) else {
        return false;
    };
    for r in arr {
        if let Some(target_erp) = erp {
            let row_erp = r.get("erp").map(val_as_str).unwrap_or_default();
            if !row_erp.is_empty() && row_erp != target_erp {
                continue;
            }
        }
        let r_hours = r
            .get("declareHours")
            .or_else(|| r.get("hours"))
            .and_then(val_as_f64)
            .unwrap_or(0.0);
        let r_date = r
            .get("declareDate")
            .or_else(|| r.get("date"))
            .and_then(val_as_i64)
            .unwrap_or(0);
        if r_date == declare_date_ms && (r_hours - hours).abs() < 0.01 {
            return true;
        }
    }
    false
}

pub async fn declare_hours(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    erp: &str,
    declare_date_ms: i64,
    hours: f64,
    role_code: i64,
    desc: &str,
    card_id: i64,
) -> Result<Value, String> {
    let resolved = resolve_member_erp(engine, app, erp).await;
    let erp_clean = if resolved.is_empty() {
        erp.to_string()
    } else {
        resolved
    };
    let h_str = if (hours - hours.trunc()).abs() < 1e-6 {
        format!("{}", hours.trunc() as i64)
    } else {
        let rounded = (hours * 100.0).round() / 100.0;
        format!("{rounded}")
    };
    let rules = engine.rules().await;
    let desc_clean = if desc.trim().is_empty() {
        if rules.default_declare_desc.trim().is_empty() {
            "任务开发自己测试".to_string()
        } else {
            rules.default_declare_desc.trim().to_string()
        }
    } else {
        desc.trim().to_string()
    };

    let payload = json!({
        "erp": erp_clean,
        "declareDate": declare_date_ms,
        "declareHours": h_str,
        "roleCode": role_code,
        "desc": desc_clean,
        "status": rules.declare_status,
        "cardId": card_id,
    });
    let (_, res) = engine
        .call_endpoint_json(app, "declare_hours", &[], None, Some(&payload), false, 15)
        .await?;
    engine.state.write().await.card_detail_cache.remove(&card_id);
    Ok(res)
}

pub async fn count_work(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    declare_erp: &str,
    all_sprints: bool,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<Value>, String> {
    engine.require_logged_in().await?;
    engine.reset_caches().await;
    log_line(app, "🔍 正在获取迭代信息...");

    let rules = engine.rules().await;
    let time_work = rules.time_work.max(0.1);
    let skip_sprint_id = rules.skip_sprint_id;
    let work_item_type_code = rules.work_item_type_code;

    let tod_ms = Local::now().timestamp_millis() as f64;
    let today = Local::now().date_naive();
    let start_of_year = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap_or(today);
    let end_of_year = NaiveDate::from_ymd_opt(today.year(), 12, 31).unwrap_or(today);

    let sprints: Vec<Value> = if all_sprints {
        let start_d = start_date
            .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
            .unwrap_or(start_of_year);
        let end_d = end_date
            .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
            .unwrap_or(end_of_year);
        let start_time = local_midnight_ms(start_d);
        let end_time = local_end_of_day_ms(end_d);

        let valid = get_sprints(engine, app, 1).await?;
        let invalid = get_sprints(engine, app, 2).await?;
        valid
            .into_iter()
            .chain(invalid)
            .filter(|s| {
                let s_end = s.get("endDate").and_then(val_as_i64).unwrap_or(0);
                let s_start = s.get("startDate").and_then(val_as_i64).unwrap_or(0);
                s_end >= start_time && s_start <= end_time
            })
            .collect()
    } else {
        get_sprints(engine, app, 1).await?
    };

    log_line(app, format!("🔍 找到 {} 个迭代符合条件，开始分析...", sprints.len()));
    let mut problems: Vec<Value> = Vec::new();
    let erp_vec = vec![declare_erp.to_string()];

    for sprint in sprints {
        let sp_id = sprint.get("id").and_then(val_as_i64).unwrap_or(0);
        if skip_sprint_id > 0 && sp_id == skip_sprint_id {
            continue;
        }
        let sp_end = sprint.get("endDate").and_then(val_as_f64).unwrap_or(0.0);
        if !all_sprints && sp_end < tod_ms {
            continue;
        }
        let sp_name = sprint.get("name").map(val_as_str).unwrap_or_else(|| "Unknown".into());
        let result_list =
            search_cards_raw(engine, app, None, &erp_vec, Some(sp_id)).await?;
        log_line(
            app,
            format!("  👉 正在分析迭代: {sp_name}, 找到 {} 个任务...", result_list.len()),
        );

        for card in result_list {
            let Some(cid) = card.get("id").and_then(val_as_i64) else {
                continue;
            };
            let card_detail = get_card_detail(engine, app, cid, false).await?;
            let wt_code = card_detail
                .get("workitemType")
                .and_then(|w| w.get("workItemTypeCode"))
                .and_then(val_as_i64);
            if work_item_type_code > 0 {
                if let Some(code) = wt_code {
                    if code != work_item_type_code {
                        continue;
                    }
                }
            }

            let total_hours: f64 = card_detail
                .get("declareHours")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|d| {
                            if declare_erp.is_empty() {
                                true
                            } else {
                                d.get("erp").map(val_as_str).unwrap_or_default().trim()
                                    == declare_erp.trim()
                            }
                        })
                        .filter_map(|d| {
                            d.get("declareHours")
                                .or_else(|| d.get("hours"))
                                .and_then(val_as_f64)
                        })
                        .sum()
                })
                .unwrap_or(0.0);
            let declared_days = total_hours / time_work;
            let workdays = get_workload_days(engine, app, cid, declare_erp).await?;
            let gap_val = ((workdays - declared_days) * 100.0).round() / 100.0;
            if all_sprints || gap_val > 0.0 {
                problems.push(json!({
                    "card_id": cid,
                    "sprint": sp_name,
                    "code": card_detail.get("cardCode").map(val_as_str).unwrap_or_default(),
                    "name": card_detail.get("cardName").map(val_as_str).unwrap_or_default(),
                    "declared": (declared_days * 100.0).round() / 100.0,
                    "required": (workdays * 100.0).round() / 100.0,
                    "gap": if gap_val < 0.0 { 0.0 } else { gap_val },
                }));
            }
        }
    }

    if !problems.is_empty() {
        log_line(app, format!("\n⚠️ 以下 {} 个任务工时填报不达标：", problems.len()));
        for p in &problems {
            log_line(
                app,
                format!(
                    "{SPACE_INDENT}🟡 {}【{} {}】  已填{}d / 应填{}d  差{}d",
                    p["sprint"].as_str().unwrap_or(""),
                    p["code"].as_str().unwrap_or(""),
                    p["name"].as_str().unwrap_or(""),
                    p["declared"],
                    p["required"],
                    p["gap"]
                ),
            );
        }
    } else {
        log_line(app, "\n✅ 当前迭代所有任务工时均已达标！");
    }

    Ok(problems)
}

pub async fn generate_declare_plan(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    declare_erp: &str,
    check_items: Option<&[Value]>,
    mode: &str,
    fixed_hours: f64,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<Value>, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();

    let rules = engine.rules().await;
    let time_work = rules.time_work.max(0.1);
    let max_daily_hours = rules.max_daily_hours.max(1.0);
    let dyn_preferred_hours = rules.dynamic_preferred_hours.max(0.5);
    let skip_sprint_id = rules.skip_sprint_id;
    let work_item_type_code = rules.work_item_type_code;

    let today = Local::now().date_naive();
    let (s_m, e_m) = get_quarter(today.year(), today.month());

    let plan_start = start_date
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(today.year(), s_m, 1).unwrap_or(today));
    let start_ms = local_midnight_ms(plan_start);

    let plan_end = end_date
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or(today);
    let end_ms_today = if end_date.is_some() {
        local_end_of_day_ms(plan_end)
    } else {
        local_midnight_ms(plan_end)
    };

    let ed = days_in_month(today.year(), e_m);
    let quarter_end_d = NaiveDate::from_ymd_opt(today.year(), e_m, ed).unwrap_or(today);
    let end_ms_q = local_end_of_day_ms(quarter_end_d);

    let worktimes =
        get_work_times(engine, app, Some(start_ms), Some(end_ms_today), Some(declare_erp))
            .await?;
    let mut daily_map: HashMap<String, f64> = HashMap::new();
    for item in worktimes {
        if let Some(fill_ms) = item.get("fillDate").and_then(val_as_i64) {
            let hours = item.get("hours").and_then(val_as_f64).unwrap_or(0.0);
            if let Some(d_str) = ms_to_local_ymd(fill_ms) {
                *daily_map.entry(d_str).or_insert(0.0) += hours;
            }
        }
    }

    #[derive(Clone)]
    struct GapTask {
        card_id: i64,
        task_code: String,
        task_name: String,
        gap_hours: f64,
        gap_days: f64,
        sprint_end_ms: i64,
    }

    let mut all_gap_tasks: Vec<GapTask> = Vec::new();
    if let Some(items) = check_items.filter(|arr| !arr.is_empty()) {
        log_line(
            app,
            format!("🔍 依据上面查询展示的 {} 个差额任务进行排期...", items.len()),
        );
        for item in items {
            if engine.is_stopped() {
                return Ok(Vec::new());
            }
            let tname = item.get("name").map(val_as_str).unwrap_or_default();
            log_line(app, format!("  👉 正在解析排期任务: {tname} ..."));
            let code = item.get("code").map(val_as_str).unwrap_or_default();
            let gap_days = item.get("gap").and_then(val_as_f64).unwrap_or(0.0);
            let gap_hours = gap_days * time_work;
            let cid = match item.get("card_id").and_then(val_as_i64) {
                Some(id) if id > 0 => id,
                _ => match search_card_id(engine, app, &code).await {
                    Ok(id) => id,
                    Err(e) => {
                        log_line(app, format!("⚠️ 查询任务 [{code}] 卡片信息失败: {e}"));
                        continue;
                    }
                },
            };
            all_gap_tasks.push(GapTask {
                card_id: cid,
                task_code: code,
                task_name: tname,
                gap_hours,
                gap_days,
                sprint_end_ms: end_ms_today,
            });
        }
    } else {
        log_line(app, "🔍 未检测到上方查询结果，正在扫描本季度所有迭代及任务...");
        let valid = get_sprints(engine, app, 1).await?;
        let invalid = get_sprints(engine, app, 2).await?;
        let sprints: Vec<Value> = valid
            .into_iter()
            .chain(invalid)
            .filter(|s| {
                let s_end = s.get("endDate").and_then(val_as_i64).unwrap_or(0);
                start_ms <= s_end && s_end <= end_ms_q
            })
            .collect();

        let erp_vec = vec![declare_erp.to_string()];
        for sp in sprints {
            let sp_id = sp.get("id").and_then(val_as_i64).unwrap_or(0);
            if skip_sprint_id > 0 && sp_id == skip_sprint_id {
                continue;
            }
            let sp_name = sp.get("name").map(val_as_str).unwrap_or_else(|| "Unknown".into());
            log_line(app, format!("  👉 正在扫描迭代: {sp_name} ..."));
            let cards = search_cards_raw(engine, app, None, &erp_vec, Some(sp_id)).await?;
            for card in cards {
                if engine.is_stopped() {
                    return Ok(Vec::new());
                }
                let Some(card_id) = card.get("id").and_then(val_as_i64) else {
                    continue;
                };
                let card_detail = get_card_detail(engine, app, card_id, false).await?;
                if work_item_type_code > 0 {
                    if let Some(code) = card_detail
                        .get("workitemType")
                        .and_then(|w| w.get("workItemTypeCode"))
                        .and_then(val_as_i64)
                    {
                        if code != work_item_type_code {
                            continue;
                        }
                    }
                }
                let task_name = card_detail
                    .get("cardName")
                    .or_else(|| card.get("name"))
                    .map(val_as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "日常开发".to_string());
                let task_code = card_detail
                    .get("cardCode")
                    .or_else(|| card.get("code"))
                    .map(val_as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "UNKNOWN".to_string());

                let total_hours: f64 = card_detail
                    .get("declareHours")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter(|d| {
                                declare_erp.is_empty()
                                    || d.get("erp").map(val_as_str).unwrap_or_default().trim()
                                        == declare_erp.trim()
                            })
                            .filter_map(|d| {
                                d.get("declareHours")
                                    .or_else(|| d.get("hours"))
                                    .and_then(val_as_f64)
                            })
                            .sum()
                    })
                    .unwrap_or(0.0);

                let declared_days = total_hours / time_work;
                let workdays = get_workload_days(engine, app, card_id, declare_erp).await?;
                let gap_days = ((workdays - declared_days) * 100.0).round() / 100.0;
                let gap_hours = gap_days * time_work;

                if gap_days > 0.0 && gap_hours >= 0.1 {
                    all_gap_tasks.push(GapTask {
                        card_id,
                        task_code,
                        task_name,
                        gap_hours,
                        gap_days,
                        sprint_end_ms: sp.get("endDate").and_then(val_as_i64).unwrap_or(end_ms_today),
                    });
                }
            }
        }
    }

    if all_gap_tasks.is_empty() {
        log_line(app, "\n✅ 所有任务均已达标！无需补报。");
        return Ok(Vec::new());
    }

    all_gap_tasks.sort_by(|a, b| {
        b.gap_hours
            .partial_cmp(&a.gap_hours)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.sprint_end_ms.cmp(&b.sprint_end_ms))
    });

    log_line(
        app,
        format!(
            "\n💡 锁定 {} 个需补报任务，绝对优先为差额最大的任务 [{}] (差额 {}d) 生成排期...",
            all_gap_tasks.len(),
            all_gap_tasks[0].task_code,
            all_gap_tasks[0].gap_days
        ),
    );

    let mut available_dates: Vec<(i64, String)> = Vec::new();
    let mut skipped_dates: Vec<(String, f64)> = Vec::new();
    let mut partially_filled: Vec<(String, f64, f64)> = Vec::new();
    let mut holiday_skipped: Vec<(String, String, String, String)> = Vec::new();
    let mut in_lieu_dates: Vec<(String, String, String)> = Vec::new();

    let mut curr = plan_start;
    while curr <= plan_end {
        let info = get_day_info(curr);
        let is_wd = info.get("is_workday").and_then(|v| v.as_bool()).unwrap_or(true);
        let d_str = curr.format("%Y-%m-%d").to_string();
        let w_str = info.get("weekday_str").map(val_as_str).unwrap_or_default();
        let lbl = info.get("label").map(val_as_str).unwrap_or_else(|| "工作日".into());
        let dtype = info
            .get("day_type")
            .map(val_as_str)
            .unwrap_or_else(|| "workday".into());

        if !is_wd {
            holiday_skipped.push((d_str, w_str, lbl, dtype));
        } else {
            if dtype == "in_lieu" {
                in_lieu_dates.push((d_str.clone(), w_str, lbl));
            }
            let existing_h = daily_map.get(&d_str).copied().unwrap_or(0.0);
            if existing_h >= max_daily_hours {
                skipped_dates.push((d_str, existing_h));
            } else {
                let d_ms = local_midnight_ms(curr);
                available_dates.push((d_ms, d_str.clone()));
                if existing_h > 0.0 {
                    let rem = ((max_daily_hours - existing_h) * 100.0).round() / 100.0;
                    partially_filled.push((d_str, existing_h, rem));
                }
            }
        }
        curr += ChronoDuration::days(1);
    }

    if !holiday_skipped.is_empty() {
        let h_items: Vec<String> = holiday_skipped
            .iter()
            .filter(|x| x.3 == "holiday")
            .map(|x| format!("{}({}·{})", x.0, x.1, x.2))
            .collect();
        let w_items: Vec<String> = holiday_skipped
            .iter()
            .filter(|x| x.3 == "weekend")
            .map(|x| format!("{}({})", x.0, x.1))
            .collect();
        if !h_items.is_empty() {
            log_line(
                app,
                format!("🎉 检测到法定节假日，已自动跳过不排期：{}", h_items.join("、")),
            );
        }
        if !w_items.is_empty() {
            if w_items.len() <= 6 {
                log_line(
                    app,
                    format!("🏖️ 检测到周末休息日，已自动跳过：{}", w_items.join("、")),
                );
            } else {
                log_line(
                    app,
                    format!("🏖️ 检测到 {} 天常规周末休息日，已自动跳过。", w_items.len()),
                );
            }
        }
    }

    if !in_lieu_dates.is_empty() {
        let s: Vec<String> = in_lieu_dates
            .iter()
            .map(|x| format!("{}({}·{})", x.0, x.1, x.2))
            .collect();
        log_line(
            app,
            format!("💼 检测到调休补班工作日，已自动纳入补报计划：{}", s.join("、")),
        );
    }
    if !skipped_dates.is_empty() {
        let s: Vec<String> = skipped_dates
            .iter()
            .map(|x| format!("{}(已满{:.1}h)", x.0, x.1))
            .collect();
        log_line(
            app,
            format!("⏭️ 检测到已达 {max_daily_hours:.0} 小时上限的日期，已自动跳过：{}", s.join("、")),
        );
    }
    if !partially_filled.is_empty() {
        let s: Vec<String> = partially_filled
            .iter()
            .map(|x| format!("{}(已有{:.1}h, 可补{:.1}h)", x.0, x.1, x.2))
            .collect();
        log_line(
            app,
            format!("💡 检测到已报工但未满 {max_daily_hours:.0} 小时的日期，允许继续补报：{}", s.join("、")),
        );
    }

    if available_dates.is_empty() {
        log_line(
            app,
            format!("ℹ️ 所选日期范围内的所有工作日（含调休补班）均已达到 {max_daily_hours:.0} 小时上限或无可用排期日期。"),
        );
        return Ok(Vec::new());
    }

    available_dates.sort_by_key(|x| x.0);
    let mut daily_totals: HashMap<i64, f64> = available_dates
        .iter()
        .map(|(ms, ds)| (*ms, daily_map.get(ds).copied().unwrap_or(0.0)))
        .collect();

    let mut allocations: HashMap<(i64, String, String, i64), f64> = HashMap::new();

    if mode == "fixed" {
        let fixed = if fixed_hours > 0.0 { fixed_hours } else { 8.0 };
        let mut task_idx = 0usize;
        let mut task_remaining_hours = all_gap_tasks[0].gap_hours;

        for (d_ms, _) in &available_dates {
            if engine.is_stopped() {
                log_line(app, "⏹ 已中止填报。");
                return Ok(Vec::new());
            }
            let cur_existing = daily_totals.get(d_ms).copied().unwrap_or(0.0);
            let day_capacity = ((max_daily_hours - cur_existing) * 100.0).round() / 100.0;
            if day_capacity <= 0.05 {
                continue;
            }
            let h_to_allocate = fixed.min(day_capacity);
            if h_to_allocate <= 0.05 {
                continue;
            }
            let curr_task = &all_gap_tasks[task_idx];
            let key = (
                *d_ms,
                curr_task.task_code.clone(),
                curr_task.task_name.clone(),
                curr_task.card_id,
            );
            *allocations.entry(key).or_insert(0.0) += h_to_allocate;
            daily_totals.insert(*d_ms, cur_existing + h_to_allocate);
            task_remaining_hours -= h_to_allocate;
            if task_remaining_hours <= 0.0 && task_idx + 1 < all_gap_tasks.len() {
                task_idx += 1;
                task_remaining_hours = all_gap_tasks[task_idx].gap_hours;
            }
        }
    } else {
        for task in &all_gap_tasks {
            if engine.is_stopped() {
                log_line(app, "⏹ 已中止填报。");
                return Ok(Vec::new());
            }
            let preview_name: String = task.task_name.chars().take(15).collect();
            log_line(
                app,
                format!(
                    "\n📌 优先排期差额最大任务 [{}] {preview_name}... 缺 {}d ({:.1}h)",
                    task.task_code, task.gap_days, task.gap_hours
                ),
            );
            let mut remaining = task.gap_hours;
            for (d_ms, _) in &available_dates {
                if remaining <= 0.05 {
                    break;
                }
                let cur_total = daily_totals.get(d_ms).copied().unwrap_or(0.0);
                let day_capacity = ((max_daily_hours - cur_total) * 100.0).round() / 100.0;
                if day_capacity <= 0.05 {
                    continue;
                }
                let raw_chunk = if cur_total == 0.0 {
                    let preferred = if remaining >= dyn_preferred_hours {
                        dyn_preferred_hours
                    } else {
                        remaining
                    };
                    remaining.min(preferred).min(day_capacity)
                } else {
                    remaining.min(day_capacity)
                };
                let chunk = (raw_chunk * 100.0).round() / 100.0;
                if chunk <= 0.05 {
                    continue;
                }
                let key = (
                    *d_ms,
                    task.task_code.clone(),
                    task.task_name.clone(),
                    task.card_id,
                );
                *allocations.entry(key).or_insert(0.0) += chunk;
                daily_totals.insert(*d_ms, cur_total + chunk);
                remaining -= chunk;
            }
        }
    }

    let mut results: Vec<Value> = Vec::new();
    for ((d_ms, t_code, t_name, c_id), raw_h) in allocations {
        if raw_h <= 0.01 {
            continue;
        }
        let h = (raw_h * 100.0).round() / 100.0;
        let d_str = ms_to_local_ymd(d_ms).unwrap_or_default();
        let desc = format!("{t_code}-{t_name}");
        results.push(json!({
            "declare_date_ms": d_ms,
            "card_id": c_id,
            "date": d_str,
            "task_id": t_code,
            "hours": h,
            "desc": desc,
            "status": "待填报",
            "task_name": t_name,
        }));
    }

    results.sort_by(|a, b| {
        let ba = b.get("declare_date_ms").and_then(val_as_i64).unwrap_or(0);
        let aa = a.get("declare_date_ms").and_then(val_as_i64).unwrap_or(0);
        ba.cmp(&aa)
    });

    if results.is_empty() {
        log_line(app, "\n✅ 所有任务均已达标！无需补报。");
    } else {
        log_line(
            app,
            format!("\n✅ 计划生成完毕，共需要补报 {} 笔工时。", results.len()),
        );
        let mut daily_summary: BTreeMap<String, f64> = BTreeMap::new();
        for r in &results {
            let d = r.get("date").map(val_as_str).unwrap_or_default();
            let h = r.get("hours").and_then(val_as_f64).unwrap_or(0.0);
            *daily_summary.entry(d).or_insert(0.0) += h;
        }
        log_line(app, "\n📊 每日排期总览 (仅本次新排期)：");
        for (d, total_h) in daily_summary.iter().rev() {
            if let Ok(d_obj) = NaiveDate::parse_from_str(d, "%Y-%m-%d") {
                let info = get_day_info(d_obj);
                let w_str = info.get("weekday_str").map(val_as_str).unwrap_or_default();
                let dtype = info
                    .get("day_type")
                    .map(val_as_str)
                    .unwrap_or_else(|| "workday".into());
                let tag_str = if dtype == "in_lieu" {
                    format!(" ({w_str}·调休补班)")
                } else {
                    format!(" ({w_str})")
                };
                log_line(app, format!("   🗓️ {d}{tag_str} : 需填报 {total_h:.2}h"));
            }
        }
        log_line(app, "\n请核对上述计划，无误后可点击【确认并执行补报】。");
    }

    Ok(results)
}

pub async fn execute_declare_plan(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    declare_erp: &str,
    role_name: &str,
    plan_list: &[Value],
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();
    log_line(app, "🚀 开始执行补报计划...");
    let mut role_code_cache: Option<i64> = None;

    for (idx, plan) in plan_list.iter().enumerate() {
        if engine.is_stopped() {
            log_line(app, "⏹ 已中止执行。");
            break;
        }
        let card_id = plan
            .get("card_id")
            .and_then(val_as_i64)
            .ok_or_else(|| format!("第 {} 行缺少 card_id", idx + 1))?;
        let declare_date_ms = plan
            .get("declare_date_ms")
            .and_then(val_as_i64)
            .ok_or_else(|| format!("第 {} 行缺少 declare_date_ms", idx + 1))?;
        let h = plan.get("hours").and_then(val_as_f64).unwrap_or(0.0);
        let desc = plan.get("desc").map(val_as_str).unwrap_or_default();
        let d_str = plan.get("date").map(val_as_str).unwrap_or_default();
        let task_id = plan.get("task_id").map(val_as_str).unwrap_or_default();

        let status = match get_card_detail(engine, app, card_id, false).await {
            Ok(detail) => {
                if already_declared(&detail, declare_date_ms, h, Some(declare_erp)) {
                    "✅ 已存在".to_string()
                } else {
                    if role_code_cache.is_none() {
                        match get_role_code(engine, app, role_name).await {
                            Ok(rc) => role_code_cache = Some(rc),
                            Err(e) => {
                                let st = format!("❌ {e}");
                                log_line(
                                    app,
                                    format!("{SPACE_INDENT}📅 {d_str} {task_id} 填报 {h}h -> {st}"),
                                );
                                if let Some(a) = app {
                                    WorktimeEngine::emit_callback(
                                        a,
                                        call_id,
                                        "update_status_cb",
                                        vec![json!(idx), json!(st)],
                                    );
                                }
                                continue;
                            }
                        }
                    }
                    let default_rc = engine.rules().await.default_role_code;
                    let rc = role_code_cache.unwrap_or(if default_rc > 0 { default_rc } else { 1011 });
                    match declare_hours(
                        engine,
                        app,
                        declare_erp,
                        declare_date_ms,
                        h,
                        rc,
                        &desc,
                        card_id,
                    )
                    .await
                    {
                        Ok(_) => "✅ 成功".to_string(),
                        Err(e) => format!("❌ {e}"),
                    }
                }
            }
            Err(e) => format!("❌ {e}"),
        };

        log_line(
            app,
            format!("{SPACE_INDENT}📅 {d_str} {task_id} 填报 {h}h -> {status}"),
        );
        if let Some(a) = app {
            WorktimeEngine::emit_callback(
                a,
                call_id,
                "update_status_cb",
                vec![json!(idx), json!(status)],
            );
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    log_line(app, "\n✅ 计划执行完毕。");
    Ok(Value::Null)
}

pub async fn not_report(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    start_date: Option<&str>,
    end_date: Option<&str>,
    erp: Option<&str>,
) -> Result<Value, String> {
    engine.require_logged_in().await?;

    let clean_erp = match erp {
        Some(e) if !e.trim().is_empty() => Some(resolve_member_erp(engine, app, e).await),
        _ => None,
    };
    let user_name = if let Some(ref ce) = clean_erp {
        let resolved = resolve_erp_to_name(engine, app, ce).await;
        if resolved.is_empty() {
            ce.clone()
        } else {
            resolved
        }
    } else {
        "当前用户".to_string()
    };

    if let Some(ref ce) = clean_erp {
        log_line(
            app,
            format!("🔍 正在查询 [{user_name}] (工号/身份证: {ce}) 的工时数据..."),
        );
    } else {
        log_line(app, "🔍 正在查询当前用户的工时数据...");
    }

    let today = Local::now().date_naive();
    let start_dt = start_date
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today));
    let end_dt = end_date
        .and_then(|s| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok())
        .unwrap_or_else(|| {
            let dmax = days_in_month(today.year(), today.month());
            NaiveDate::from_ymd_opt(today.year(), today.month(), dmax).unwrap_or(today)
        });

    let start_ms = local_midnight_ms(start_dt);
    let end_ms = local_end_of_day_ms(end_dt);
    let worktimes =
        get_work_times(engine, app, Some(start_ms), Some(end_ms), clean_erp.as_deref()).await?;

    let mut daily_map: BTreeMap<String, f64> = BTreeMap::new();
    for item in &worktimes {
        let fill_ms = item
            .get("fillDate")
            .or_else(|| item.get("declareDate"))
            .or_else(|| item.get("date"))
            .and_then(val_as_i64);
        let raw_hours = item
            .get("hours")
            .filter(|v| !v.is_null())
            .or_else(|| item.get("declareHours").filter(|v| !v.is_null()))
            .or_else(|| item.get("workHours").filter(|v| !v.is_null()))
            .and_then(val_as_f64)
            .unwrap_or(0.0);
        if let Some(ms) = fill_ms {
            if let Some(date_str) = ms_to_local_ymd(ms) {
                let prev = daily_map.get(&date_str).copied().unwrap_or(0.0);
                daily_map.insert(date_str, ((prev + raw_hours) * 100.0).round() / 100.0);
            }
        }
    }

    let reported_days_cnt = daily_map.values().filter(|&&h| h > 0.0).count();
    if !worktimes.is_empty() {
        log_line(
            app,
            format!(
                "📋 共获取到 {} 条工时填报记录 (覆盖 {reported_days_cnt} 个填报工作日)",
                worktimes.len()
            ),
        );
    } else {
        log_line(
            app,
            format!("ℹ️ 该时间段内未查询到 [{user_name}] 的工时填报记录 (共 0 条)"),
        );
    }

    let mut day_info_map: Map<String, Value> = Map::new();
    let mut curr = start_dt;
    while curr <= end_dt {
        let d_str = curr.format("%Y-%m-%d").to_string();
        day_info_map.insert(d_str.clone(), get_day_info(curr));
        daily_map.entry(d_str).or_insert(0.0);
        curr += ChronoDuration::days(1);
    }

    let time_work = engine.rules().await.time_work.max(0.1);
    let mut under_map: BTreeMap<String, f64> = BTreeMap::new();
    for (d, &h) in &daily_map {
        let is_wd = day_info_map
            .get(d)
            .and_then(|v| v.get("is_workday"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if is_wd && h < time_work {
            under_map.insert(d.clone(), h);
        }
    }

    if !under_map.is_empty() {
        log_line(
            app,
            format!(
                "\n⚠️ [{user_name}] 以下 {} 个工作日工时缺报或不足 {:.1} 小时：",
                under_map.len(),
                time_work
            ),
        );
        for (d, h) in &under_map {
            let info = day_info_map.get(d);
            let lbl = info
                .and_then(|v| v.get("label"))
                .map(val_as_str)
                .unwrap_or_else(|| "工作日".into());
            let w_str = info
                .and_then(|v| v.get("weekday_str"))
                .map(val_as_str)
                .unwrap_or_default();
            if *h <= 0.001 {
                log_line(app, format!("{SPACE_INDENT}📅 {d} ({w_str} · {lbl})  ❌ 缺报 (0.0 小时)"));
            } else {
                log_line(
                    app,
                    format!(
                        "{SPACE_INDENT}📅 {d} ({w_str} · {lbl})  ⚠️ 不足 {:.1}h (已填 {:.1} 小时)",
                        time_work, h
                    ),
                );
            }
        }
    } else {
        log_line(app, format!("\n✅ [{user_name}] 所选时间段内所有工作日工时均已达标！"));
    }

    Ok(json!([daily_map, under_map, day_info_map]))
}

pub async fn count_work_time(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    user: &Value,
    name_filter: Option<&str>,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();

    let rules = engine.rules().await;
    let skip_sprint_id = rules.skip_sprint_id;
    let work_item_type_code = rules.work_item_type_code;

    let today = Local::now().date_naive();
    let org_name = user
        .get("org")
        .and_then(|o| o.get("name"))
        .map(val_as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "默认团队".to_string());
    let (s_m, e_m) = get_quarter(today.year(), today.month());
    let start_d = NaiveDate::from_ymd_opt(today.year(), s_m, 1).unwrap_or(today);
    let end_day = days_in_month(today.year(), e_m).min(30);
    let end_d = NaiveDate::from_ymd_opt(today.year(), e_m, end_day).unwrap_or(today);
    let start_ms = local_midnight_ms(start_d);
    let end_ms = local_midnight_ms(end_d);

    log_line(
        app,
        format!("📅 统计季度：{}/{s_m:02} - {}/{e_m:02}", today.year(), today.year()),
    );

    let valid = get_sprints(engine, app, 1).await?;
    let invalid = get_sprints(engine, app, 2).await?;
    let sprints: Vec<Value> = valid
        .into_iter()
        .chain(invalid)
        .filter(|s| {
            let s_end = s.get("endDate").and_then(val_as_i64).unwrap_or(0);
            start_ms < s_end && s_end < end_ms
        })
        .collect();
    log_line(app, format!("📦 共 {} 个迭代纳入统计", sprints.len()));

    let members = get_members(engine, app).await?;
    let org_id = user.get("orgTierCode").map(val_as_str).unwrap_or_default();
    let filtered: Vec<Value> = if let Some(nf_raw) = name_filter.map(str::trim).filter(|s| !s.is_empty()) {
        let nf = nf_raw.to_lowercase();
        let out: Vec<Value> = members
            .into_iter()
            .filter(|m| {
                let mn = m.get("memberName").map(val_as_str).unwrap_or_default().to_lowercase();
                let me = m.get("memberErp").map(val_as_str).unwrap_or_default().to_lowercase();
                mn.contains(&nf) || me.contains(&nf)
            })
            .collect();
        log_line(
            app,
            format!("🔍 开启跨团队人员搜索 [{nf_raw}]，在空间内共匹配到 {} 名人员", out.len()),
        );
        out
    } else {
        let out: Vec<Value> = members
            .into_iter()
            .filter(|m| m.get("memberOrgId").map(val_as_str).unwrap_or_default() == org_id)
            .collect();
        log_line(app, format!("👥 默认团队成员 {} 人", out.len()));
        out
    };

    log_line(app, "🚀 开始并行统计...");
    let sem = Arc::new(Semaphore::new(5));
    let sprints_cache: Arc<Mutex<HashMap<(i64, String), Vec<Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let results_map: Arc<Mutex<Vec<(String, BTreeMap<String, f64>)>>> =
        Arc::new(Mutex::new(Vec::new()));

    let mut set = JoinSet::new();
    for m in filtered {
        let permit_sem = sem.clone();
        let eng = engine.clone();
        let app_opt = app.cloned();
        let sp_cache = sprints_cache.clone();
        let res_vec = results_map.clone();
        let sprints_clone = sprints.clone();

        set.spawn(async move {
            let _permit = permit_sem.acquire_owned().await;
            if eng.is_stopped() {
                return;
            }
            let m_erp = m.get("memberErp").map(val_as_str).unwrap_or_default();
            let m_name = m.get("memberName").map(val_as_str).unwrap_or_default();
            let erp_vec = vec![m_erp.clone()];
            let mut sc: BTreeMap<String, f64> = BTreeMap::new();

            for sp in &sprints_clone {
                if eng.is_stopped() {
                    return;
                }
                let sp_id = sp.get("id").and_then(val_as_i64).unwrap_or(0);
                if skip_sprint_id > 0 && sp_id == skip_sprint_id {
                    continue;
                }
                let ckey = (sp_id, m_erp.clone());
                let cached_cards = sp_cache.lock().await.get(&ckey).cloned();
                let cards = if let Some(c) = cached_cards {
                    c
                } else {
                    let fetched = search_cards_raw(
                        &eng,
                        app_opt.as_ref(),
                        None,
                        &erp_vec,
                        Some(sp_id),
                    )
                    .await
                    .unwrap_or_default();
                    sp_cache.lock().await.insert(ckey, fetched.clone());
                    fetched
                };

                let mut days = 0.0_f64;
                for card in cards {
                    let Some(cid) = card.get("id").and_then(val_as_i64) else {
                        continue;
                    };
                    if let Ok(cd) = get_card_detail(&eng, app_opt.as_ref(), cid, false).await {
                        if work_item_type_code > 0 {
                            if let Some(code) = cd
                                .get("workitemType")
                                .and_then(|w| w.get("workItemTypeCode"))
                                .and_then(val_as_i64)
                            {
                                if code != work_item_type_code {
                                    continue;
                                }
                            }
                        }
                        if let Ok(d) = get_workload_days(&eng, app_opt.as_ref(), cid, &m_erp).await {
                            days += d;
                        }
                    }
                }
                let sp_name = sp.get("name").map(val_as_str).unwrap_or_default();
                sc.insert(sp_name, days);
            }

            res_vec.lock().await.push((m_name.clone(), sc));
            log_line(app_opt.as_ref(), format!("{SPACE_INDENT}✔ {m_name} 统计完成"));
        });
    }

    while let Some(_) = set.join_next().await {}

    let months = (e_m - s_m + 1) as f64;
    let monthly_factor = if rules.monthly_workdays_factor > 0.0 {
        rules.monthly_workdays_factor
    } else {
        21.75
    };
    let mut summary_list: Vec<Value> = Vec::new();
    log_line(app, format!("\n🎯 {org_name} 工作量汇总："));
    let collected = results_map.lock().await;
    for (mn, sc) in collected.iter() {
        let total: f64 = sc.values().sum();
        let total_r = (total * 100.0).round() / 100.0;
        let rate = rules.member_rate_for(mn);
        let target = (months * monthly_factor * rate * 100.0).round() / 100.0;
        let achieve = if target != 0.0 {
            ((total / target) * 100.0).round() / 100.0
        } else {
            0.0
        };
        let gap = ((target - total) * 100.0).round() / 100.0;
        log_line(
            app,
            format!(
                "{SPACE_INDENT}{mn}  任务工作量={total_r}d  应完成={target}d  达成率={achieve}  差额={gap}d"
            ),
        );
        summary_list.push(json!({
            "name": mn,
            "total": total_r,
            "target": target,
            "achieve": achieve,
            "gap": gap,
            "sprints": sc,
        }));
    }

    let sprint_names: Vec<String> = sprints
        .iter()
        .map(|s| s.get("name").map(val_as_str).unwrap_or_default())
        .collect();

    Ok(json!({
        "org": org_name,
        "members": summary_list,
        "sprints": sprint_names,
    }))
}
