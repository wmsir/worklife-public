use reqwest::multipart::{Form, Part};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::sidecar::emit_app_log;

use super::api_config::ApiParamRules;
use super::calendar::{calculate_plan_test_date, ms_to_local_ymd};
use super::client::{truncate_chars, val_as_i64, val_as_str, WorktimeEngine};
use super::constants::{
    checklist_stages_json, checklist_templates_json, default_dev_handler_json,
    default_space_tags_json, default_uat_handler_json, status_flow_steps_from_rules,
};
use super::hours::{get_card_detail, get_current_user};

fn log_line(app: Option<&AppHandle>, msg: impl Into<String>) {
    if let Some(a) = app {
        emit_app_log(a, msg.into());
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn guess_mime(filename: &str) -> &'static str {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" | "md" | "sql" | "log" => "text/plain",
        "json" => "application/json",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

pub fn deduplicate_stage_items(items: Vec<Value>) -> Vec<Value> {
    let mut seen: HashMap<String, Value> = HashMap::new();
    for it in items {
        let key = it
            .get("checkId")
            .filter(|v| !v.is_null())
            .or_else(|| it.get("id").filter(|v| !v.is_null()))
            .or_else(|| it.get("checkContent").filter(|v| !v.is_null()))
            .map(val_as_str)
            .unwrap_or_default();
        if let Some(prev) = seen.get(&key) {
            let prev_ct = prev.get("checkTime").and_then(val_as_i64).unwrap_or(0);
            let prev_id = prev.get("id").and_then(val_as_i64).unwrap_or(0);
            let curr_ct = it.get("checkTime").and_then(val_as_i64).unwrap_or(0);
            let curr_id = it.get("id").and_then(val_as_i64).unwrap_or(0);
            if (curr_ct, curr_id) > (prev_ct, prev_id) {
                seen.insert(key, it);
            }
        } else {
            seen.insert(key, it);
        }
    }
    let mut out: Vec<Value> = seen.into_values().collect();
    out.sort_by_key(|x| x.get("checkId").and_then(val_as_i64).unwrap_or(0));
    out
}

pub async fn fetch_card_checklist_from_api(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
) -> Value {
    let cid_str = card_id.to_string();
    let rules = engine.rules().await;
    let timeout = rules.request_timeout_secs.clamp(3, 300);
    let max_retries = rules.max_retries.min(5);
    log_line(
        app,
        format!("🔍 正在从官方接口获取卡片 [{card_id}] 原生检查项数据..."),
    );

    let mut review = Vec::new();
    let mut design = Vec::new();
    let mut dev = Vec::new();
    let mut test = Vec::new();
    let mut raw_data = Value::Array(Vec::new());

    match engine
        .call_endpoint_raw(
            app,
            "checklist_list",
            &[("cardId", &cid_str)],
            None,
            None,
            true,
            timeout,
            max_retries,
            false,
        )
        .await
    {
        Ok((200, text)) => {
            if let Ok(res_json) = serde_json::from_str::<Value>(&text) {
                if let Some(data_arr) = res_json.get("data").and_then(|v| v.as_array()) {
                    raw_data = Value::Array(data_arr.clone());
                    for stage_obj in data_arr {
                        let sid = stage_obj.get("id").and_then(val_as_i64);
                        let sname = stage_obj.get("name").map(val_as_str).unwrap_or_default();
                        let skey = match sid {
                            Some(30) => Some("review"),
                            Some(70) => Some("design"),
                            Some(90) => Some("dev"),
                            Some(110) => Some("test"),
                            _ => match sname.as_str() {
                                "评审" => Some("review"),
                                "设计" => Some("design"),
                                "开发" => Some("dev"),
                                "测试" => Some("test"),
                                _ => None,
                            },
                        };
                        let items = stage_obj
                            .get("checkList")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        match skey {
                            Some("review") => review = deduplicate_stage_items(items),
                            Some("design") => design = deduplicate_stage_items(items),
                            Some("dev") => dev = deduplicate_stage_items(items),
                            Some("test") => test = deduplicate_stage_items(items),
                            _ => {}
                        }
                    }
                    let total = review.len() + design.len() + dev.len() + test.len();
                    log_line(
                        app,
                        format!(
                            "✅ 成功获取卡片 [{card_id}] 官方原生检查单数据：共 {total} 项 (评审:{}, 设计:{}, 开发:{}, 测试:{})",
                            review.len(),
                            design.len(),
                            dev.len(),
                            test.len()
                        ),
                    );
                }
            }
        }
        Ok((st, _)) => {
            log_line(app, format!("⚠️ 获取检查项明细 HTTP 状态码: {st}"));
        }
        Err(e) => {
            log_line(app, format!("⚠️ 从接口获取检查项明细遇到异常: {e}"));
        }
    }

    json!({
        "review": review,
        "design": design,
        "dev": dev,
        "test": test,
        "_raw_data": raw_data,
    })
}

pub fn build_stage_checklist_payload_with_result(
    stage_key: &str,
    card_id: i64,
    existing_items: Option<&[Value]>,
    user_erp: Option<&str>,
    user_name: Option<&str>,
    check_time: Option<i64>,
    pass_result: i64,
) -> Vec<Value> {
    let ts_now = now_ms();
    let chk_time = check_time.filter(|&v| v > 0).unwrap_or(ts_now);
    let chk_erp = user_erp
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    let chk_name = user_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");

    let target_sid = match stage_key {
        "review" => Some(30_i64),
        "design" => Some(70_i64),
        "dev" => Some(90_i64),
        "test" => Some(110_i64),
        _ => None,
    };

    let mut result: Vec<Value> = Vec::new();
    if let Some(ex_list) = existing_items {
        for ex in ex_list {
            let ex_sid = ex.get("stageId").and_then(val_as_i64);
            if target_sid.is_none() || ex_sid == target_sid {
                let mut copy = ex.clone();
                if let Some(obj) = copy.as_object_mut() {
                    obj.insert("cardId".to_string(), json!(card_id));
                    obj.insert("checkResult".to_string(), json!(pass_result));
                    obj.insert("checkTime".to_string(), json!(chk_time));
                    obj.insert("checkUserErp".to_string(), json!(chk_erp));
                    obj.insert("checkUserName".to_string(), json!(chk_name));
                }
                result.push(copy);
            }
        }
    }

    if result.is_empty() {
        let templates = checklist_templates_json();
        if let Some(arr) = templates.get(stage_key).and_then(|v| v.as_array()) {
            for tmpl in arr {
                let mut copy = tmpl.clone();
                if let Some(obj) = copy.as_object_mut() {
                    obj.insert("cardId".to_string(), json!(card_id));
                    obj.insert("cTime".to_string(), json!(ts_now));
                    obj.insert("checkResult".to_string(), json!(pass_result));
                    obj.insert("checkTime".to_string(), json!(chk_time));
                    obj.insert("checkUserErp".to_string(), json!(chk_erp));
                    obj.insert("checkUserName".to_string(), json!(chk_name));
                    obj.remove("id");
                }
                result.push(copy);
            }
        }
    }

    result
}

#[allow(dead_code)]
pub fn build_stage_checklist_payload(
    stage_key: &str,
    card_id: i64,
    existing_items: Option<&[Value]>,
    user_erp: Option<&str>,
    user_name: Option<&str>,
    check_time: Option<i64>,
) -> Vec<Value> {
    build_stage_checklist_payload_with_result(
        stage_key,
        card_id,
        existing_items,
        user_erp,
        user_name,
        check_time,
        2,
    )
}

pub async fn submit_stage_checklist(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    stage_key: &str,
    card_id: i64,
    items: &[Value],
    user_name: Option<&str>,
) -> (bool, String) {
    let stages = checklist_stages_json();
    let stage_name = stages
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|s| s.get("key").and_then(|k| k.as_str()) == Some(stage_key))
                .and_then(|s| s.get("name").and_then(|n| n.as_str()))
        })
        .unwrap_or(stage_key);

    let chk_person = items
        .first()
        .and_then(|it| it.get("checkUserName"))
        .map(val_as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| user_name.unwrap_or("").to_string());

    log_line(
        app,
        format!(
            "🚀 正在向系统提交【{stage_name}】检查单 (卡片 ID: {card_id}, 检查人: {chk_person}, 共 {} 项)...",
            items.len()
        ),
    );

    let rules = engine.rules().await;
    let timeout = rules.request_timeout_secs.saturating_add(5).clamp(5, 300);
    let max_retries = rules.max_retries.min(5);
    let body = Value::Array(items.to_vec());

    match engine
        .call_endpoint_raw(
            app,
            "checklist_save_batch",
            &[],
            None,
            Some(&body),
            true,
            timeout,
            max_retries,
            false,
        )
        .await
    {
        Ok((200, text)) => {
            let res_json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let code = res_json.get("code").and_then(val_as_i64);
            let msg = res_json
                .get("msg")
                .or_else(|| res_json.get("message"))
                .map(val_as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "操作成功".to_string());
            if code.is_none() || code == Some(0) || code == Some(200) {
                log_line(
                    app,
                    format!("✅ 【{stage_name}】检查单提交成功！(代码: {code:?}, 信息: {msg})"),
                );
                (true, format!("成功 ({msg})"))
            } else {
                let err_msg = format!("服务返回错误: code={code:?}, msg={msg}");
                log_line(app, format!("❌ 【{stage_name}】检查单提交失败: {err_msg}"));
                (false, err_msg)
            }
        }
        Ok((st, text)) => {
            let err_msg = format!("HTTP 状态码异常 {st}: {}", truncate_chars(&text, 200));
            log_line(app, format!("❌ 【{stage_name}】检查单提交失败: {err_msg}"));
            (false, err_msg)
        }
        Err(e) => {
            let err_msg = format!("网络请求异常: {e}");
            log_line(app, format!("❌ 【{stage_name}】检查单提交失败: {err_msg}"));
            (false, err_msg)
        }
    }
}

pub async fn execute_checklist_workflow(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    card_id: i64,
    selected_stages: &[String],
    custom_items_map: Option<&Value>,
    user_erp: Option<&str>,
    user_name: Option<&str>,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();

    let stages = checklist_stages_json();
    let stages_arr = stages.as_array().cloned().unwrap_or_default();
    let stage_names: Vec<String> = selected_stages
        .iter()
        .map(|k| {
            stages_arr
                .iter()
                .find(|s| s.get("key").and_then(|v| v.as_str()) == Some(k.as_str()))
                .and_then(|s| s.get("name").and_then(|n| n.as_str()))
                .unwrap_or(k)
                .to_string()
        })
        .collect();

    log_line(app, format!("\n📋 开始批量提交卡片 [{card_id}] 的检查单..."));
    log_line(
        app,
        format!(
            "🎯 待执行阶段 ({} 个): {}",
            selected_stages.len(),
            stage_names.join("、")
        ),
    );

    let api_stage_map = fetch_card_checklist_from_api(engine, app, card_id).await;
    let mut results: Map<String, Value> = Map::new();

    for st_info in &stages_arr {
        let s_key = st_info
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        if !selected_stages.iter().any(|x| x == s_key) {
            if let Some(a) = app {
                WorktimeEngine::emit_callback(
                    a,
                    call_id,
                    "status_cb",
                    vec![json!(s_key), json!("skipped"), json!("未勾选")],
                );
            }
            continue;
        }

        if engine.is_stopped() {
            log_line(app, "⏹ 用户中止了检查单提交流程。");
            if let Some(a) = app {
                WorktimeEngine::emit_callback(
                    a,
                    call_id,
                    "status_cb",
                    vec![json!(s_key), json!("fail"), json!("已中止")],
                );
            }
            break;
        }

        if let Some(a) = app {
            WorktimeEngine::emit_callback(
                a,
                call_id,
                "status_cb",
                vec![json!(s_key), json!("running"), json!("正在提交...")],
            );
        }

        let items: Vec<Value> = if let Some(custom_arr) =
            custom_items_map.and_then(|m| m.get(s_key)).and_then(|v| v.as_array())
        {
            custom_arr.clone()
        } else {
            let native_items = api_stage_map.get(s_key).and_then(|v| v.as_array());
            let pass_res = engine.rules().await.checklist_pass_result;
            build_stage_checklist_payload_with_result(
                s_key,
                card_id,
                native_items.map(|v| v.as_slice()),
                user_erp,
                user_name,
                None,
                pass_res,
            )
        };

        let (ok, msg) =
            submit_stage_checklist(engine, app, s_key, card_id, &items, user_name).await;
        results.insert(
            s_key.to_string(),
            json!({ "success": ok, "msg": msg }),
        );
        if let Some(a) = app {
            WorktimeEngine::emit_callback(
                a,
                call_id,
                "status_cb",
                vec![
                    json!(s_key),
                    json!(if ok { "success" } else { "fail" }),
                    json!(msg),
                ],
            );
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let succ = results
        .values()
        .filter(|r| r.get("success").and_then(|v| v.as_bool()) == Some(true))
        .count();
    let fail = results.len() - succ;
    log_line(
        app,
        format!(
            "\n🏁 检查单提交完毕！共提交 {} 个阶段：✅ 成功 {succ} 个，❌ 失败 {fail} 个。",
            results.len()
        ),
    );

    Ok(Value::Object(results))
}

pub async fn upload_space_file(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    file_path: &str,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    let p = Path::new(file_path.trim());
    if !p.is_file() {
        return Err(format!("文件不存在: {file_path}"));
    }
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment.bin")
        .to_string();
    let mime = guess_mime(&filename);
    let bytes = std::fs::read(p).map_err(|e| format!("读取上传文件失败 {file_path}: {e}"))?;

    let cfg = engine.api_config().await;
    let (method, url) = cfg.render_endpoint("file_upload", &[]);
    let file_field = cfg.endpoint_form_file_field("file_upload", "file");
    let extra_form = cfg.endpoint_extra_form_fields("file_upload", &[]);
    let extra_headers = cfg.endpoint_headers("file_upload", &[]);
    let upload_timeout = cfg.rules.upload_timeout_secs.clamp(5, 600);
    log_line(app, format!("📤 正在上传附件 [{filename}] (类型: {mime})..."));

    let cookie_hdr = engine.cookie_header().await;
    let part = Part::bytes(bytes)
        .file_name(filename.clone())
        .mime_str(mime)
        .map_err(|e| format!("构建上传 MIME 失败: {e}"))?;
    let mut form = Form::new().part(file_field, part);
    for (fk, fv) in extra_form {
        form = form.text(fk, fv);
    }

    let mut rb = engine
        .http
        .request(method, &url)
        .timeout(Duration::from_secs(upload_timeout))
        .multipart(form);
    if !cookie_hdr.is_empty() {
        rb = rb.header("Cookie", cookie_hdr);
    }
    for (hk, hv) in extra_headers {
        rb = rb.header(hk, hv);
    }
    let resp = rb
        .send()
        .await
        .map_err(|e| format!("附件上传请求失败: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取上传响应失败: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("附件上传 HTTP {status}: {}", truncate_chars(&text, 200)));
    }
    let res_json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析上传响应 JSON 失败: {e} ({text})"))?;
    if res_json.get("code").and_then(val_as_i64) == Some(200) {
        let data = res_json.get("data").cloned().unwrap_or_else(|| json!({}));
        let id = data.get("id").map(val_as_str).unwrap_or_default();
        let uri = data.get("uri").map(val_as_str).unwrap_or_default();
        log_line(
            app,
            format!("✅ 附件 [{filename}] 上传成功！ID: {id}, URI: {uri}"),
        );
        Ok(data)
    } else {
        let err_msg = res_json
            .get("message")
            .or_else(|| res_json.get("msg"))
            .map(val_as_str)
            .unwrap_or(text);
        Err(format!("附件上传失败: {err_msg}"))
    }
}

pub async fn bind_space_card_attachment(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    attachment_id: i64,
    attachment_type: &str,
) -> Result<Value, String> {
    let (att_type, type_cn) = match attachment_type.trim() {
        "design" | "prod" => ("design", "设计附件"),
        "test" | "testing" => ("test", "测试附件"),
        _ => ("dev", "研发附件"),
    };
    let payload = json!({
        "attachmentType": att_type,
        "attachmentId": attachment_id,
        "entityId": card_id.to_string(),
    });
    log_line(
        app,
        format!("🔗 正在向卡片 [{card_id}] 关联绑定【{type_cn}】(文件ID: {attachment_id})..."),
    );
    let (_, res_json) = engine
        .call_endpoint_json(app, "file_bind", &[], None, Some(&payload), true, 15)
        .await?;
    if res_json.get("code").and_then(val_as_i64) == Some(200) {
        log_line(
            app,
            format!("✅ 卡片 [{card_id}] 成功绑定【{type_cn}】！原页面已同步就绪。"),
        );
        Ok(res_json)
    } else {
        let err = res_json
            .get("message")
            .or_else(|| res_json.get("msg"))
            .map(val_as_str)
            .unwrap_or_else(|| res_json.to_string());
        Err(format!("绑定{type_cn}失败: {err}"))
    }
}

pub async fn set_card_plan_test_date(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    date_ms: i64,
    space_id: Option<i64>,
) -> Result<Value, String> {
    let sp_id = match space_id {
        Some(v) => v,
        None => engine.space_id().await,
    };
    let rules = engine.rules().await;
    let date_field = if rules.plan_test_date_field.trim().is_empty() {
        "dateKey1"
    } else {
        rules.plan_test_date_field.trim()
    };
    let mut payload_map = Map::new();
    payload_map.insert("cardId".to_string(), json!(card_id));
    payload_map.insert("spaceId".to_string(), json!(sp_id));
    payload_map.insert(date_field.to_string(), json!(date_ms));
    let payload = Value::Object(payload_map);

    let date_readable = ms_to_local_ymd(date_ms).unwrap_or_default();
    log_line(
        app,
        format!("📅 [设置提测日期] 卡片 ID={card_id}, {date_field}={date_ms} ({date_readable})"),
    );
    let (_, res) = engine
        .call_endpoint_json(app, "card_ext_properties", &[], None, Some(&payload), false, 15)
        .await?;
    engine.state.write().await.card_detail_cache.remove(&card_id);
    Ok(res)
}

pub async fn set_card_handler(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    handler: &Value,
    space_id: Option<i64>,
) -> Result<Value, String> {
    let sp_id = match space_id {
        Some(v) => v,
        None => engine.space_id().await,
    };
    let h_name = handler
        .get("name")
        .or_else(|| handler.get("userName"))
        .map(val_as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "-".into());
    let h_erp = handler
        .get("erp")
        .map(val_as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "-".into());
    log_line(
        app,
        format!("👤 [修改经办人] 卡片 ID={card_id}, 新经办人: {h_name} ({h_erp})"),
    );
    let payload = json!({
        "cardId": card_id,
        "spaceId": sp_id,
        "properties": {
            "handler": handler
        }
    });
    let (_, res) = engine
        .call_endpoint_json(app, "card_properties", &[], None, Some(&payload), false, 15)
        .await?;
    engine.state.write().await.card_detail_cache.remove(&card_id);
    Ok(res)
}

pub async fn flow_card_status(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    target_status_id: i64,
    handler: Option<&Value>,
    dev_handler: Option<&Value>,
    space_id: Option<i64>,
) -> Result<Value, String> {
    let sp_id = match space_id {
        Some(v) => v,
        None => engine.space_id().await,
    };
    let rules = engine.rules().await;
    let uat_status_id = rules.uat_verify_status_id;
    let flow_action = if rules.status_flow_action.trim().is_empty() {
        "statusFlow".to_string()
    } else {
        rules.status_flow_action.trim().to_string()
    };
    let uat_default_erp = default_uat_handler_json()
        .get("erp")
        .map(val_as_str)
        .unwrap_or_default();

    let use_handler: Value = if target_status_id == uat_status_id {
        if let Some(h) = handler.filter(|v| !v.is_null()) {
            h.clone()
        } else {
            default_uat_handler_json()
        }
    } else if let Some(dh) = dev_handler.filter(|v| !v.is_null()) {
        dh.clone()
    } else if let Some(h) = handler.filter(|v| {
        !v.is_null() && v.get("erp").map(val_as_str).unwrap_or_default() != uat_default_erp
    }) {
        h.clone()
    } else if let Ok(cur) = get_current_user(engine, app).await {
        let cur_erp = cur
            .get("userErp")
            .or_else(|| cur.get("erp"))
            .map(val_as_str)
            .unwrap_or_default();
        if !cur_erp.is_empty() {
            let cur_name = cur
                .get("name")
                .or_else(|| cur.get("userName"))
                .map(val_as_str)
                .unwrap_or_default();
            json!({
                "userName": cur_name,
                "sex": 2,
                "name": cur_name,
                "email": cur.get("email").map(val_as_str).unwrap_or_default(),
                "erp": cur_erp,
                "orgTierCode": cur.get("org").and_then(|o| o.get("id")).map(val_as_str).unwrap_or_default(),
                "orgTierName": cur.get("org").and_then(|o| o.get("name")).map(val_as_str).unwrap_or_default(),
                "positionName": "研发运维工程师",
                "isLeader": false,
                "type": 1,
                "role": "member"
            })
        } else {
            default_dev_handler_json()
        }
    } else {
        default_dev_handler_json()
    };

    let steps = status_flow_steps_from_rules(&rules);
    let s_name = steps
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|s| s.get("id").and_then(val_as_i64) == Some(target_status_id))
                .and_then(|s| s.get("name").and_then(|n| n.as_str()))
        })
        .map(str::to_string)
        .unwrap_or_else(|| format!("状态{target_status_id}"));
    let h_name = use_handler
        .get("name")
        .or_else(|| use_handler.get("userName"))
        .map(val_as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "-".into());

    log_line(
        app,
        format!("🔀 [状态流转] 卡片 ID={card_id} -> 流转至【{s_name} (ID: {target_status_id})】，经办人: {h_name}"),
    );

    let payload = json!({
        "cardId": card_id,
        "spaceId": sp_id,
        "properties": {
            "handler": use_handler,
            "action": flow_action,
            "cardStatusId": target_status_id,
        }
    });
    let (_, res) = engine
        .call_endpoint_json(app, "card_properties", &[], None, Some(&payload), false, 15)
        .await?;
    engine.state.write().await.card_detail_cache.remove(&card_id);
    Ok(res)
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_status_flow_pipeline(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    card_id: i64,
    target_status_id: i64,
    plan_date_ms: Option<i64>,
    uat_handler: Option<&Value>,
    dev_handler: Option<&Value>,
    step_handlers: Option<&Value>,
    space_id: Option<i64>,
    auto_set_date: bool,
    auto_set_handler: bool,
    current_status_id: Option<i64>,
    mut rd_file_info: Option<Value>,
    mut prod_file_info: Option<Value>,
    rd_file_path: Option<&str>,
    prod_file_path: Option<&str>,
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();

    let sp_id = match space_id {
        Some(v) => v,
        None => engine.space_id().await,
    };
    let uat_h = uat_handler
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or_else(default_uat_handler_json);
    let effective_plan_ms = plan_date_ms.unwrap_or_else(|| calculate_plan_test_date(None, 2).1);

    let mut cur_status = current_status_id;
    match get_card_detail(engine, app, card_id, true).await {
        Ok(detail) => {
            if cur_status.is_none() {
                cur_status = detail
                    .get("cardStatusId")
                    .or_else(|| detail.get("statusId"))
                    .and_then(val_as_i64);
            }
        }
        Err(e) => log_line(app, format!("⚠️ 获取卡片详情提示: {e}")),
    }

    let rules = engine.rules().await;
    let plan_trigger_statuses = if rules.plan_date_trigger_statuses.is_empty() {
        vec![70, 90]
    } else {
        rules.plan_date_trigger_statuses.clone()
    };
    let test_audit_id = rules.test_audit_status_id;
    let uat_verify_id = rules.uat_verify_status_id;

    let steps = status_flow_steps_from_rules(&rules);
    let steps_arr = steps.as_array().cloned().unwrap_or_default();
    let target_idx = steps_arr
        .iter()
        .position(|s| s.get("id").and_then(val_as_i64) == Some(target_status_id))
        .ok_or_else(|| format!("未知的目标流转状态 ID: {target_status_id}"))?;

    let cur_idx = cur_status
        .and_then(|cs| {
            steps_arr
                .iter()
                .position(|s| s.get("id").and_then(val_as_i64) == Some(cs))
        });

    if let Some(cidx) = cur_idx {
        if cidx >= target_idx {
            let cur_name = steps_arr[cidx].get("name").map(val_as_str).unwrap_or_default();
            let tgt_name = steps_arr[target_idx].get("name").map(val_as_str).unwrap_or_default();
            let msg = format!(
                "卡片当前已处于【{cur_name} ({})】，已达到或超越目标状态【{tgt_name}】，无需再次流转。",
                cur_status.unwrap_or(0)
            );
            log_line(app, format!("ℹ️ {msg}"));
            if let Some(a) = app {
                for s in &steps_arr[..=target_idx] {
                    if let Some(sid) = s.get("id").and_then(val_as_i64) {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![json!(sid), json!("success"), json!("已就绪/已完成")],
                        );
                    }
                }
            }
            return Ok(json!({ "skipped": true, "message": msg }));
        }
    }

    let start_idx = cur_idx.map(|c| c + 1).unwrap_or(0);
    if start_idx > 0 {
        if let Some(cidx) = cur_idx {
            let cur_name = steps_arr[cidx].get("name").map(val_as_str).unwrap_or_default();
            let next_name = steps_arr[start_idx].get("name").map(val_as_str).unwrap_or_default();
            log_line(
                app,
                format!(
                    "ℹ️ 检测到卡片当前处于【{cur_name} ({})】，自动跳过已完成状态，从【{next_name}】开始继续流转！",
                    cur_status.unwrap_or(0)
                ),
            );
        }
        if let Some(a) = app {
            for s in &steps_arr[..start_idx] {
                if let Some(sid) = s.get("id").and_then(val_as_i64) {
                    WorktimeEngine::emit_callback(
                        a,
                        call_id,
                        "step_cb",
                        vec![json!(sid), json!("success"), json!("已完成 (自动跳过)")],
                    );
                }
            }
        }
    }

    let mut results: Map<String, Value> = Map::new();
    for step in &steps_arr[start_idx..=target_idx] {
        if engine.is_stopped() {
            log_line(app, "⏹ 流水线已被用户手动中止。");
            break;
        }
        let sid = step.get("id").and_then(val_as_i64).unwrap_or(0);
        let sname = step.get("name").map(val_as_str).unwrap_or_default();
        if let Some(a) = app {
            WorktimeEngine::emit_callback(
                a,
                call_id,
                "step_cb",
                vec![json!(sid), json!("running"), json!(format!("正在流转至【{sname}】..."))],
            );
        }

        if plan_trigger_statuses.contains(&sid) && auto_set_date {
            log_line(
                app,
                format!("📌 [必填校验] 流转至【{sname} ({sid})】前设置计划提测日期..."),
            );
            if let Some(a) = app {
                WorktimeEngine::emit_callback(
                    a,
                    call_id,
                    "step_cb",
                    vec![json!(sid), json!("running"), json!("正在提交计划提测日期...")],
                );
            }
            match set_card_plan_test_date(engine, app, card_id, effective_plan_ms, Some(sp_id)).await
            {
                Ok(_) => log_line(app, "✅ 计划提测日期设置成功！"),
                Err(de) => log_line(app, format!("⚠️ 设置计划提测日期提示: {de}")),
            }
        }

        if sid == test_audit_id {
            log_line(
                app,
                format!("📌 [必填校验] 正在检查【{sname} ({test_audit_id})】所需的【设计附件】与【研发附件】..."),
            );
            if prod_file_info
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(val_as_i64)
                .is_none()
            {
                if let Some(pf) = prod_file_path.filter(|s| !s.trim().is_empty()) {
                    if let Some(a) = app {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![json!(test_audit_id), json!("running"), json!("正在自动上传并绑定设计附件...")],
                        );
                    }
                    match upload_space_file(engine, app, pf).await {
                        Ok(info) => {
                            if let Some(fid) = info.get("id").and_then(val_as_i64) {
                                let _ =
                                    bind_space_card_attachment(engine, app, card_id, fid, "design")
                                        .await;
                            }
                            prod_file_info = Some(info);
                            log_line(app, "✅ 设计附件自动上传并绑定卡片成功！");
                        }
                        Err(fe) => log_line(app, format!("⚠️ 自动上传/绑定设计附件提示: {fe}")),
                    }
                }
            } else if let Some(fid) = prod_file_info
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(val_as_i64)
            {
                let _ = bind_space_card_attachment(engine, app, card_id, fid, "design").await;
            }

            if rd_file_info
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(val_as_i64)
                .is_none()
            {
                if let Some(rf) = rd_file_path.filter(|s| !s.trim().is_empty()) {
                    if let Some(a) = app {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![json!(test_audit_id), json!("running"), json!("正在自动上传并绑定研发附件...")],
                        );
                    }
                    match upload_space_file(engine, app, rf).await {
                        Ok(info) => {
                            if let Some(fid) = info.get("id").and_then(val_as_i64) {
                                let _ =
                                    bind_space_card_attachment(engine, app, card_id, fid, "dev").await;
                            }
                            rd_file_info = Some(info);
                            log_line(app, "✅ 研发附件自动上传并绑定卡片成功！");
                        }
                        Err(fe) => log_line(app, format!("⚠️ 自动上传/绑定研发附件提示: {fe}")),
                    }
                }
            } else if let Some(fid) = rd_file_info
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(val_as_i64)
            {
                let _ = bind_space_card_attachment(engine, app, card_id, fid, "dev").await;
            }
        }

        let cur_h = step_handlers
            .and_then(|m| m.get(sid.to_string()))
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| {
                if sid == uat_verify_id {
                    Some(uat_h.clone())
                } else {
                    dev_handler.cloned()
                }
            });

        match flow_card_status(
            engine,
            app,
            card_id,
            sid,
            cur_h.as_ref(),
            cur_h.as_ref(),
            Some(sp_id),
        )
        .await
        {
            Ok(flow_res) => {
                if sid == uat_verify_id && auto_set_handler {
                    let uname = uat_h.get("name").map(val_as_str).unwrap_or_default();
                    log_line(
                        app,
                        format!("📌 [经办人变更] 正在将卡片经办人转给 UAT 验收人 [{uname}]..."),
                    );
                    if let Some(a) = app {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![
                                json!(uat_verify_id),
                                json!("running"),
                                json!(format!("正在修改经办人为 {uname}...")),
                            ],
                        );
                    }
                    set_card_handler(engine, app, card_id, &uat_h, Some(sp_id)).await?;
                    log_line(app, format!("✅ 卡片经办人已成功变更为: {uname}！"));
                }

                results.insert(sid.to_string(), json!({ "success": true, "data": flow_res }));
                if let Some(a) = app {
                    WorktimeEngine::emit_callback(
                        a,
                        call_id,
                        "step_cb",
                        vec![json!(sid), json!("success"), json!(format!("已流转至【{sname}】"))],
                    );
                }
                log_line(app, format!("🎉 阶段 [{sname}] 流转完成！"));
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            Err(err_msg) => {
                results.insert(sid.to_string(), json!({ "success": false, "error": err_msg }));
                if sid == test_audit_id && (err_msg.contains("必填字段") || err_msg.contains("400")) {
                    log_line(
                        app,
                        "💡 流程提示: 卡片已安全流转停靠在【UAT更新 (130)】！进入【测试审核 (110)】需提供【设计附件】与【研发附件】，请在上方选择并上传附件后再继续流转。",
                    );
                    if let Some(a) = app {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![json!(sid), json!("fail"), json!("需补充设计/研发附件")],
                        );
                    }
                } else {
                    log_line(app, format!("❌ 阶段 [{sname}] 流转异常: {err_msg}"));
                    if let Some(a) = app {
                        WorktimeEngine::emit_callback(
                            a,
                            call_id,
                            "step_cb",
                            vec![json!(sid), json!("fail"), json!(format!("流转失败: {err_msg}"))],
                        );
                    }
                }
                break;
            }
        }
    }

    Ok(Value::Object(results))
}

pub async fn get_space_tags(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    space_id: Option<i64>,
    force_refresh: bool,
) -> Vec<Value> {
    let sp_id = match space_id {
        Some(v) => v,
        None => engine.space_id().await,
    };
    if !force_refresh {
        if let Some(cached) = engine.state.read().await.space_tags_cache.get(&sp_id).cloned() {
            return cached;
        }
    }
    let sp_str = sp_id.to_string();
    let rules = engine.rules().await;
    let timeout = rules.request_timeout_secs.clamp(3, 300);
    let max_retries = rules.max_retries.min(1);
    match engine
        .call_endpoint_raw(
            app,
            "space_tags",
            &[("spaceId", &sp_str)],
            None,
            None,
            true,
            timeout,
            max_retries,
            false,
        )
        .await
    {
        Ok((200, text)) => {
            if let Ok(res_json) = serde_json::from_str::<Value>(&text) {
                if let Some(arr) = res_json.get("data").and_then(|v| v.as_array()) {
                    if !arr.is_empty() {
                        engine
                            .state
                            .write()
                            .await
                            .space_tags_cache
                            .insert(sp_id, arr.clone());
                        log_line(
                            app,
                            format!("✅ 成功从接口获取空间 [{sp_id}] 标签列表，共 {} 个可用标签", arr.len()),
                        );
                        return arr.clone();
                    }
                }
            }
        }
        Ok(_) => {}
        Err(e) => log_line(app, format!("⚠️ 获取空间标签接口提示: {e}，使用本地预置标签库")),
    }

    let fallback = default_space_tags_json().as_array().cloned().unwrap_or_default();
    engine
        .state
        .write()
        .await
        .space_tags_cache
        .insert(sp_id, fallback.clone());
    fallback
}

pub fn match_tags_by_projects_with_rules(
    projects: &[String],
    rules: &ApiParamRules,
) -> Vec<Value> {
    let mut matched = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for p in projects {
        let p_low = p.to_lowercase();
        for m in &rules.repo_to_tag_mapping {
            let repo_key = m.repo_keyword.trim();
            if repo_key.is_empty() {
                continue;
            }
            if p_low.contains(&repo_key.to_lowercase()) && seen_names.insert(m.tag_name.clone()) {
                matched.push(json!({
                    "id": m.tag_id,
                    "name": m.tag_name,
                    "repo": repo_key,
                    "matched_project": p,
                }));
            }
        }
    }
    matched
}

#[allow(dead_code)]
pub fn match_tags_by_projects(projects: &[String]) -> Vec<Value> {
    match_tags_by_projects_with_rules(projects, &ApiParamRules::default())
}

pub async fn set_card_tag(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    tag_id: i64,
    tag_name: &str,
) -> (bool, String) {
    let rules = engine.rules().await;
    let timeout = rules.request_timeout_secs.clamp(3, 300);
    let max_retries = rules.max_retries.min(5);
    let payload = json!({ "id": tag_id, "cardId": card_id });
    let t_desc = if !tag_name.is_empty() {
        format!("【{tag_name}】(ID: {tag_id})")
    } else {
        format!("ID: {tag_id}")
    };
    log_line(app, format!("🏷️ 正在为卡片 [{card_id}] 打上标签 {t_desc}..."));
    match engine
        .call_endpoint_raw(
            app,
            "card_tags",
            &[],
            None,
            Some(&payload),
            true,
            timeout,
            max_retries,
            false,
        )
        .await
    {
        Ok((200, text)) => {
            let res_json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let code = res_json.get("code").and_then(val_as_i64);
            let msg = res_json
                .get("msg")
                .or_else(|| res_json.get("message"))
                .map(val_as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "操作成功".into());
            if code.is_none() || code == Some(0) || code == Some(200) {
                log_line(app, format!("✅ 卡片 [{card_id}] 打标签 {t_desc} 成功！"));
                (true, msg)
            } else {
                let err_msg = format!("服务返回错误: code={code:?}, msg={msg}");
                log_line(app, format!("❌ 卡片 [{card_id}] 打标签 {t_desc} 失败: {err_msg}"));
                (false, err_msg)
            }
        }
        Ok((st, text)) => {
            let err_msg = format!("HTTP {st}: {}", truncate_chars(&text, 200));
            log_line(app, format!("❌ 卡片 [{card_id}] 打标签 {t_desc} 失败: {err_msg}"));
            (false, err_msg)
        }
        Err(e) => {
            let err_msg = format!("网络请求异常: {e}");
            log_line(app, format!("❌ 卡片 [{card_id}] 打标签 {t_desc} 异常: {err_msg}"));
            (false, err_msg)
        }
    }
}

pub async fn set_card_tags_batch(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    card_id: i64,
    tags: &[Value],
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    let all_tags = get_space_tags(engine, app, None, false).await;
    let mut name_to_id: HashMap<String, i64> = HashMap::new();
    let mut id_to_name: HashMap<i64, String> = HashMap::new();
    for t in &all_tags {
        if let (Some(id), Some(n)) = (
            t.get("id").and_then(val_as_i64),
            t.get("name").and_then(|v| v.as_str()),
        ) {
            name_to_id.insert(n.to_uppercase(), id);
            id_to_name.insert(id, n.to_string());
        }
    }

    let mut results: Map<String, Value> = Map::new();
    let mut succ_cnt = 0usize;
    for t in tags {
        let mut t_id: Option<i64> = None;
        let mut t_name = String::new();
        if let Some(obj) = t.as_object() {
            t_id = obj.get("id").and_then(val_as_i64);
            t_name = obj.get("name").map(val_as_str).unwrap_or_default();
            if t_id.is_none() && !t_name.is_empty() {
                t_id = name_to_id.get(&t_name.to_uppercase()).copied();
            }
        } else if let Some(id) = val_as_i64(t) {
            t_id = Some(id);
            t_name = id_to_name
                .get(&id)
                .cloned()
                .unwrap_or_else(|| id.to_string());
        } else if let Some(s) = t.as_str() {
            t_name = s.trim().to_string();
            t_id = name_to_id.get(&t_name.to_uppercase()).copied();
        }

        let Some(id_val) = t_id else {
            log_line(app, format!("⚠️ 未找到标签 [{t}] 对应的有效 ID，跳过打标签"));
            results.insert(val_as_str(t), json!([false, "未找到有效 ID"]));
            continue;
        };

        let (ok, msg) = set_card_tag(engine, app, card_id, id_val, &t_name).await;
        if ok {
            succ_cnt += 1;
        }
        let res_key = if t_name.is_empty() {
            id_val.to_string()
        } else {
            t_name
        };
        results.insert(res_key, json!([ok, msg]));
    }

    log_line(
        app,
        format!("🏷️ 批量打标签完成：成功 {succ_cnt}/{} 个标签", results.len()),
    );
    Ok(Value::Object(results))
}
