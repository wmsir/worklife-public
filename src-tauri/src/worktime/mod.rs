pub mod api_config;
pub mod calendar;
pub mod client;
pub mod constants;
pub mod flow;
pub mod git_mr;
pub mod hours;
pub mod wechat;

pub use client::WorktimeEngine;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::settings::CookieRec;
use client::{val_as_f64, val_as_i64, val_as_str};

fn param_str<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|v| v.as_str())
}

fn param_str_vec(params: &Value, key: &str) -> Vec<String> {
    params
        .get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(val_as_str)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub async fn dispatch(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "__ping" => Ok(json!("pong")),
        "__set_cookies" => {
            let cookies_val = params.get("cookies").cloned().unwrap_or_else(|| json!([]));
            let cookies: Vec<CookieRec> =
                serde_json::from_value(cookies_val).map_err(|e| format!("解析 Cookie 失败: {e}"))?;
            engine.set_cookies(cookies).await;
            Ok(json!(true))
        }
        "__whoami" => engine.whoami(app).await,
        "__set_wechat_config" => {
            if let Some(cfg) = params.get("cfg") {
                engine.set_wechat_config(cfg).await;
            }
            Ok(json!(true))
        }
        "__const" => {
            let name = param_str(&params, "name").unwrap_or("");
            let rules = engine.rules().await;
            constants::get_const_value_with_rules(name, Some(&rules))
        }
        "reconfigure" => {
            let ip = param_str(&params, "ip")
                .unwrap_or("devops.example.local")
                .to_string();
            let space_id = params.get("space_id").and_then(val_as_i64).unwrap_or(1);
            engine.reconfigure(ip, space_id).await;
            Ok(json!(true))
        }
        "keep_alive_ping" => hours::keep_alive_ping(engine, app).await,
        "get_members" => {
            engine.require_logged_in().await?;
            Ok(Value::Array(hours::get_members(engine, app).await?))
        }
        "get_sprints" => {
            engine.require_logged_in().await?;
            let qt = params.get("query_type").and_then(val_as_i64).unwrap_or(1);
            Ok(Value::Array(hours::get_sprints(engine, app, qt).await?))
        }
        "resolve_card_id" => {
            engine.require_logged_in().await?;
            let raw = params
                .get("task_or_card_id")
                .map(val_as_str)
                .unwrap_or_default();
            Ok(json!(hours::resolve_card_id(engine, app, &raw).await?))
        }
        "query_task_summary" => {
            let raw = params.get("task_id").map(val_as_str).unwrap_or_default();
            hours::query_task_summary(engine, app, &raw).await
        }
        "get_own_workload" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            hours::get_own_workload(engine, app, cid).await
        }
        "get_actual_report_hours" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            hours::get_actual_report_hours(engine, app, cid).await
        }
        "count_work" => {
            let declare_erp = params
                .get("declare_erp")
                .map(val_as_str)
                .unwrap_or_default();
            let all_sprints = params
                .get("all_sprints")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let start_date = param_str(&params, "start_date");
            let end_date = param_str(&params, "end_date");
            let list = hours::count_work(
                engine,
                app,
                &declare_erp,
                all_sprints,
                start_date,
                end_date,
            )
            .await?;
            Ok(Value::Array(list))
        }
        "generate_declare_plan" => {
            let declare_erp = params
                .get("declare_erp")
                .map(val_as_str)
                .unwrap_or_default();
            let check_items = params.get("check_items").and_then(|v| v.as_array()).map(|v| v.as_slice());
            let mode = param_str(&params, "mode").unwrap_or("dynamic");
            let fixed_hours = params
                .get("fixed_hours")
                .and_then(val_as_f64)
                .unwrap_or(8.0);
            let start_date = param_str(&params, "start_date");
            let end_date = param_str(&params, "end_date");
            let list = hours::generate_declare_plan(
                engine,
                app,
                &declare_erp,
                check_items,
                mode,
                fixed_hours,
                start_date,
                end_date,
            )
            .await?;
            Ok(Value::Array(list))
        }
        "execute_declare_plan" => {
            let declare_erp = params
                .get("declare_erp")
                .map(val_as_str)
                .unwrap_or_default();
            let role_name = param_str(&params, "role_name").unwrap_or("开发");
            let plan_list = params
                .get("plan_list")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            hours::execute_declare_plan(engine, app, call_id, &declare_erp, role_name, &plan_list)
                .await
        }
        "not_report" => {
            let start_date = param_str(&params, "start_date");
            let end_date = param_str(&params, "end_date");
            let erp = param_str(&params, "erp");
            hours::not_report(engine, app, start_date, end_date, erp).await
        }
        "count_work_time" => {
            let user = params.get("user").cloned().unwrap_or_else(|| json!({}));
            let name_filter = param_str(&params, "name_filter");
            hours::count_work_time(engine, app, &user, name_filter).await
        }
        "execute_create_branch" => {
            let branch_name = params
                .get("branch_name")
                .map(val_as_str)
                .unwrap_or_default();
            let ref_branch = params
                .get("ref_branch")
                .map(val_as_str)
                .unwrap_or_default();
            let projects = param_str_vec(&params, "projects");
            git_mr::execute_create_branch(engine, app, call_id, &branch_name, &ref_branch, &projects)
                .await
        }
        "get_current_user_reviewer_id" => {
            let rules = engine.rules().await;
            let user_name = param_str(&params, "user_name")
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(rules.default_reviewer_name.as_str());
            let default_id = param_str(&params, "default_id")
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(rules.default_reviewer_id.as_str());
            Ok(json!(
                git_mr::get_current_user_reviewer_id(engine, app, user_name, default_id).await
            ))
        }
        "execute_submit_mr" => {
            let rules = engine.rules().await;
            let src_branch = params
                .get("src_branch")
                .map(val_as_str)
                .unwrap_or_default();
            let dest_branches = param_str_vec(&params, "dest_branches");
            let projects = param_str_vec(&params, "projects");
            let reviewer_names = param_str_vec(&params, "reviewer_names");
            let auto_approve = params
                .get("auto_approve_printcenter")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let reviewer_id = param_str(&params, "current_user_reviewer_id")
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(rules.default_reviewer_id.as_str());
            let reviewer_name = param_str(&params, "current_user_name")
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(rules.default_reviewer_name.as_str());
            let res = git_mr::execute_submit_mr(
                engine,
                app,
                call_id,
                &src_branch,
                &dest_branches,
                &projects,
                &reviewer_names,
                auto_approve,
                reviewer_id,
                reviewer_name,
            )
            .await?;
            Ok(Value::Array(res))
        }
        "execute_one_click_approve_and_merge" => {
            engine.require_logged_in().await?;
            let rules = engine.rules().await;
            let project = params.get("project").map(val_as_str).unwrap_or_default();
            let review_id = params.get("review_id").map(val_as_str).unwrap_or_default();
            let user_id = params
                .get("user_id")
                .map(val_as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| rules.default_reviewer_id.clone());
            let user_name = params
                .get("user_name")
                .map(val_as_str)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| rules.default_reviewer_name.clone());
            let (ok, msg) = git_mr::execute_one_click_approve_and_merge(
                engine,
                app,
                &project,
                &review_id,
                &user_id,
                &user_name,
            )
            .await;
            Ok(json!([ok, msg]))
        }
        "calculate_plan_test_date" => {
            let workdays = params
                .get("workdays")
                .and_then(val_as_i64)
                .unwrap_or(2)
                .max(0) as usize;
            let (d_str, ts_ms, ymd) = calendar::calculate_plan_test_date(None, workdays);
            Ok(json!([d_str, ts_ms, ymd]))
        }
        "date_str_to_ms" => {
            let d_str = params.get("date_str").map(val_as_str).unwrap_or_default();
            Ok(json!(calendar::date_str_to_ms(&d_str)?))
        }
        "fetch_card_checklist_from_api" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            Ok(flow::fetch_card_checklist_from_api(engine, app, cid).await)
        }
        "execute_checklist_workflow" => {
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let selected = param_str_vec(&params, "selected_stages");
            let custom_map = params.get("custom_items_map").filter(|v| !v.is_null());
            let user_erp = param_str(&params, "user_erp");
            let user_name = param_str(&params, "user_name");
            flow::execute_checklist_workflow(
                engine,
                app,
                call_id,
                cid,
                &selected,
                custom_map,
                user_erp,
                user_name,
            )
            .await
        }
        "upload_space_file" => {
            let fp = params.get("file_path").map(val_as_str).unwrap_or_default();
            flow::upload_space_file(engine, app, &fp).await
        }
        "bind_space_card_attachment" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let att_id = params
                .get("attachment_id")
                .and_then(val_as_i64)
                .ok_or("缺少 attachment_id")?;
            let att_type = param_str(&params, "attachment_type").unwrap_or("dev");
            flow::bind_space_card_attachment(engine, app, cid, att_id, att_type).await
        }
        "set_card_plan_test_date" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let date_ms = params
                .get("date_ms")
                .and_then(val_as_i64)
                .ok_or("缺少 date_ms")?;
            let sp_id = params.get("space_id").and_then(val_as_i64);
            flow::set_card_plan_test_date(engine, app, cid, date_ms, sp_id).await
        }
        "set_card_handler" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let handler = params.get("handler").cloned().unwrap_or_else(|| json!({}));
            let sp_id = params.get("space_id").and_then(val_as_i64);
            flow::set_card_handler(engine, app, cid, &handler, sp_id).await
        }
        "flow_card_status" => {
            engine.require_logged_in().await?;
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let target_id = params
                .get("target_status_id")
                .and_then(val_as_i64)
                .ok_or("缺少 target_status_id")?;
            let handler = params.get("handler").filter(|v| !v.is_null());
            let dev_handler = params.get("dev_handler").filter(|v| !v.is_null());
            let sp_id = params.get("space_id").and_then(val_as_i64);
            flow::flow_card_status(engine, app, cid, target_id, handler, dev_handler, sp_id).await
        }
        "execute_status_flow_pipeline" => {
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let target_id = params
                .get("target_status_id")
                .and_then(val_as_i64)
                .ok_or("缺少 target_status_id")?;
            let plan_ms = params.get("plan_date_ms").and_then(val_as_i64);
            let uat_h = params.get("uat_handler").filter(|v| !v.is_null());
            let dev_h = params.get("dev_handler").filter(|v| !v.is_null());
            let step_h = params.get("step_handlers").filter(|v| !v.is_null());
            let sp_id = params.get("space_id").and_then(val_as_i64);
            let auto_set_date = params
                .get("auto_set_date")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_set_handler = params
                .get("auto_set_handler")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let cur_status_id = params.get("current_status_id").and_then(val_as_i64);
            let rd_info = params.get("rd_file_info").filter(|v| !v.is_null()).cloned();
            let prod_info = params.get("prod_file_info").filter(|v| !v.is_null()).cloned();
            let rd_path = param_str(&params, "rd_file_path");
            let prod_path = param_str(&params, "prod_file_path");

            flow::execute_status_flow_pipeline(
                engine,
                app,
                call_id,
                cid,
                target_id,
                plan_ms,
                uat_h,
                dev_h,
                step_h,
                sp_id,
                auto_set_date,
                auto_set_handler,
                cur_status_id,
                rd_info,
                prod_info,
                rd_path,
                prod_path,
            )
            .await
        }
        "get_space_tags" => {
            engine.require_logged_in().await?;
            let sp_id = params.get("space_id").and_then(val_as_i64);
            let force_refresh = params
                .get("force_refresh")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Ok(Value::Array(
                flow::get_space_tags(engine, app, sp_id, force_refresh).await,
            ))
        }
        "match_tags_by_projects" => {
            let projects = param_str_vec(&params, "projects");
            let rules = engine.rules().await;
            Ok(Value::Array(flow::match_tags_by_projects_with_rules(
                &projects, &rules,
            )))
        }
        "set_card_tags_batch" => {
            let cid = params
                .get("card_id")
                .and_then(val_as_i64)
                .ok_or("缺少 card_id")?;
            let tags = params
                .get("tags")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            flow::set_card_tags_batch(engine, app, cid, &tags).await
        }
        "send_wechat_notice_ex" => {
            let erp = params.get("erp").map(val_as_str).unwrap_or_default();
            let content = params.get("content").map(val_as_str).unwrap_or_default();
            let custom_cfg = params.get("custom_cfg").filter(|v| !v.is_null());
            let (ok, msg) =
                wechat::send_wechat_notice_ex(engine, app, &erp, &content, custom_cfg).await;
            Ok(json!([ok, msg]))
        }
        _ => Err(format!("未知 Worktime 方法: {method}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn test_cn_calendar_holidays_and_plan_test_date() {
        // 2026-02-14 is Saturday in-lieu workday
        let feb14 = NaiveDate::from_ymd_opt(2026, 2, 14).unwrap();
        let info14 = calendar::get_day_info(feb14);
        assert_eq!(info14["is_workday"], json!(true));
        assert_eq!(info14["day_type"], json!("in_lieu"));

        // 2026-02-17 is Spring Festival holiday
        let feb17 = NaiveDate::from_ymd_opt(2026, 2, 17).unwrap();
        let info17 = calendar::get_day_info(feb17);
        assert_eq!(info17["is_workday"], json!(false));
        assert_eq!(info17["day_type"], json!("holiday"));

        // 2026-04-30 (Thu) + 2 workdays skips May 1..5 Labour Day -> 2026-05-07 (Thu)
        let apr30 = NaiveDate::from_ymd_opt(2026, 4, 30).unwrap();
        let (ymd, ms, ymd2) = calendar::calculate_plan_test_date(Some(apr30), 2);
        assert_eq!(ymd, "2026-05-07");
        assert_eq!(ymd2, "2026-05-07");
        assert!(ms > 0);
    }

    #[test]
    fn test_normalize_project_paths_and_tag_matching() {
        assert_eq!(
            git_mr::normalize_api_project(
                "http://devops.example.local:8880/codingRoot/GROUP%2FTEAM%2Fsub/demo-repo/merges/compare/UAT...TASK-0001-dev"
            ),
            "GROUP!TEAM!sub/demo-repo"
        );
        assert_eq!(
            git_mr::normalize_web_project("GROUP!TEAM/integration-svc"),
            "GROUP%2FTEAM/integration-svc"
        );

        let mut rules = api_config::ApiParamRules::default();
        rules.repo_to_tag_mapping = vec![
            api_config::RepoTagRule {
                repo_keyword: "demo-core".to_string(),
                tag_name: "C".to_string(),
                tag_id: 98,
                example_project: "GROUP/demo-core".to_string(),
            },
            api_config::RepoTagRule {
                repo_keyword: "demo-model".to_string(),
                tag_name: "M".to_string(),
                tag_id: 102,
                example_project: "GROUP/demo-model".to_string(),
            },
        ];
        let matched = flow::match_tags_by_projects_with_rules(
            &[
                "GROUP/demo-core".to_string(),
                "GROUP!TEAM/demo-model".to_string(),
                "GROUP/demo-core".to_string(),
            ],
            &rules,
        );
        assert_eq!(matched.len(), 2);
        assert_eq!(matched[0]["name"], json!("C"));
        assert_eq!(matched[0]["id"], json!(98));
        assert_eq!(matched[1]["name"], json!("M"));
        assert_eq!(matched[1]["id"], json!(102));
    }

    #[test]
    fn test_resolve_member_erp_variants() {
        assert_eq!(hours::clean_member_input("100001199001010001").0.as_deref(), Some("100001199001010001"));
        assert_eq!(hours::clean_member_input("测试用户 (100001199001010001)").0.as_deref(), Some("100001199001010001"));
        assert_eq!(hours::clean_member_input("测试用户（100001199001010001）").0.as_deref(), Some("100001199001010001"));
        assert_eq!(hours::clean_member_input("⭐ 测试用户（本人）"), (None, "测试用户".to_string()));
    }

    #[test]
    fn test_deduplicate_checklist_items() {
        let items = vec![
            json!({"id": 10, "checkId": 2, "checkTime": 100}),
            json!({"id": 11, "checkId": 2, "checkTime": 200}),
            json!({"id": 5,  "checkId": 1, "checkTime": 150}),
        ];
        let dedup = flow::deduplicate_stage_items(items);
        assert_eq!(dedup.len(), 2);
        assert_eq!(dedup[0]["checkId"], json!(1));
        assert_eq!(dedup[1]["checkId"], json!(2));
        assert_eq!(dedup[1]["id"], json!(11));
    }

    #[test]
    fn test_worktime_http_mock_whoami_keepalive_merge_upload_wechat() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::<(String, Option<String>, String)>::new()));
        let seen_srv = seen.clone();

        let srv = tokio::spawn(async move {
            for _ in 0..10 {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut tmp = [0u8; 4096];
                let header_end = loop {
                    let n = sock.read(&mut tmp).await.unwrap();
                    if n == 0 {
                        break None;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break Some(pos + 4);
                    }
                };
                let Some(hend) = header_end else { continue };
                let hdr_str = String::from_utf8_lossy(&buf[..hend]).to_string();
                let req_line = hdr_str.lines().next().unwrap_or("").trim().to_string();
                let mut cookie_hdr: Option<String> = None;
                let mut content_len: usize = 0;
                for l in hdr_str.lines() {
                    if let Some((k, v)) = l.split_once(':') {
                        if k.eq_ignore_ascii_case("cookie") {
                            cookie_hdr = Some(v.trim().to_string());
                        } else if k.eq_ignore_ascii_case("content-length") {
                            content_len = v.trim().parse().unwrap_or(0);
                        }
                    }
                }
                while buf.len() < hend + content_len {
                    let n = sock.read(&mut tmp).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
                let body_str =
                    String::from_utf8_lossy(&buf[hend..hend + content_len]).to_string();
                seen_srv
                    .lock()
                    .unwrap()
                    .push((req_line.clone(), cookie_hdr, body_str));

                let body_json = if req_line.contains("/user/info") {
                    r#"{"code":200,"data":{"name":"测试用户","userErp":"100001199001010001"}}"#
                } else if req_line.contains("/spaces/members") {
                    r#"{"code":200,"data":[]}"#
                } else if req_line.contains("deliveryCapacity") {
                    r#"{"code":200,"data":{"userName":"测试用户","userErp":"100001199001010001","rate":1.0}}"#
                } else if req_line.contains("currentUserType") {
                    r#"{"code":200,"data":1}"#
                } else if req_line.contains("/files/upload") {
                    r#"{"code":200,"data":{"id":9988,"fileName":"demo.txt","uri":"/u/demo.txt"}}"#
                } else if req_line.contains("/webhook") {
                    r#"{"errcode":0,"errmsg":"ok"}"#
                } else if req_line.contains("/wechat") {
                    "OK"
                } else {
                    r#"{"code":200,"status":"ok"}"#
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body_json.len(),
                    body_json
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });

        let cookies = vec![CookieRec {
            name: "SESSION".into(),
            value: "abc123".into(),
            domain: "127.0.0.1".into(),
            path: "/".into(),
        }];
        let engine = WorktimeEngine::with_host_and_cookies(&addr.to_string(), 26, cookies);

        // 1. whoami -> hits /user/info + deliveryCapacity
        let who = dispatch(&engine, None, "1", "__whoami", json!({}))
            .await
            .unwrap();
        assert_eq!(who["realName"], json!("测试用户"));

        // 2. keep_alive_ping -> hits /user/info?appCode=arch
        let ka = dispatch(&engine, None, "2", "keep_alive_ping", json!({}))
            .await
            .unwrap();
        assert_eq!(ka["code"], json!(200));
        assert_eq!(ka["data"]["userErp"], json!("100001199001010001"));

        // 3. 3-step one click approve & merge -> POST reviewers, POST opinion, POST manualMerge
        let merge_res = dispatch(
            &engine,
            None,
            "3",
            "execute_one_click_approve_and_merge",
            json!({
                "project": "GROUP!TEAM/demo-repo",
                "review_id": "34",
                "user_id": "100001",
                "user_name": "测试用户"
            }),
        )
        .await
        .unwrap();
        assert_eq!(merge_res[0], json!(true));

        // 4. multipart file upload
        let tmp = tempfile::tempdir().unwrap();
        let fp = tmp.path().join("demo.txt");
        std::fs::write(&fp, "hello upload").unwrap();
        let up = dispatch(
            &engine,
            None,
            "4",
            "upload_space_file",
            json!({ "file_path": fp.to_string_lossy().to_string() }),
        )
        .await
        .unwrap();
        assert_eq!(up["id"], json!(9988));

        // 5. wechat webhook + SOAP
        let wh = dispatch(
            &engine,
            None,
            "5",
            "send_wechat_notice_ex",
            json!({
                "erp": "100001199001010001",
                "content": "hello webhook",
                "custom_cfg": { "mode": "webhook", "webhook_url": format!("http://{addr}/webhook") }
            }),
        )
        .await
        .unwrap();
        assert_eq!(wh[0], json!(true));

        let soap = dispatch(
            &engine,
            None,
            "6",
            "send_wechat_notice_ex",
            json!({
                "erp": "测试用户",
                "content": "hello soap",
                "custom_cfg": { "mode": "webservice", "url": format!("http://{addr}/wechat") }
            }),
        )
        .await
        .unwrap();
        assert_eq!(soap[0], json!(true));

        srv.await.unwrap();
        let reqs = seen.lock().unwrap();
        assert_eq!(reqs.len(), 10);
        assert_eq!(reqs[0].1.as_deref(), Some("SESSION=abc123"));
        assert!(reqs[4].0.starts_with("POST /devops-api/webapi/projects/GROUP!TEAM/demo-repo/reviews/34/reviewers/100001 "));
        assert!(reqs[5].0.starts_with("POST /devops-api/webapi/projects/GROUP!TEAM/demo-repo/reviews/34/opinion "));
        assert!(reqs[6].0.starts_with("POST /devops-api/webapi/projects/GROUP!TEAM/demo-repo/reviews/34/manualMerge "));
        assert!(reqs[7].2.contains("hello upload"));
        assert!(reqs[9].2.contains("<userNum>100001199001010001</userNum>"));
        });
    }

    #[test]
    fn test_api_config_defaults_merge_and_url_render() {
        let mut cfg = api_config::ApiConfig::default();
        assert_eq!(cfg.endpoints.len(), 32);
        assert_eq!(cfg.base_host(), "http://devops.example.local:8880");
        assert_eq!(cfg.login_url(), "http://devops.example.local:8880/");

        // apply_ip_string with https and custom port & path
        cfg.apply_ip_string("https://devops.internal.local:8443/sso");
        assert_eq!(cfg.scheme, "https");
        assert_eq!(cfg.ip, "devops.internal.local");
        assert_eq!(cfg.port, "8443");
        assert_eq!(cfg.login_path, "/sso");
        assert_eq!(cfg.base_host(), "https://devops.internal.local:8443");
        assert_eq!(cfg.login_url(), "https://devops.internal.local:8443/sso");

        // Custom http IP:Port without scheme & template variable rendering
        cfg.apply_ip_string("10.20.30.40:9090");
        cfg.scheme = "http".to_string();
        cfg.space_id = 88;
        let (method, members_url) = cfg.render_endpoint("space_members", &[]);
        assert_eq!(method, reqwest::Method::GET);
        assert_eq!(
            members_url,
            "http://10.20.30.40:9090/devops-api/space/api/v1/spaces/members?spaceId=88"
        );

        // Full URL override takes precedence over base_host and retains custom method
        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "user_info") {
            ep.method = "POST".to_string();
            ep.path_template = "https://auth.example.com/v2/me?space={spaceId}".to_string();
        }
        let (m2, u2) = cfg.render_endpoint("user_info", &[]);
        assert_eq!(m2, reqwest::Method::POST);
        assert_eq!(u2, "https://auth.example.com/v2/me?space=88");

        // merge_missing_defaults preserves customized endpoints and restores deleted ones
        cfg.endpoints.retain(|e| e.key == "user_info");
        cfg.merge_missing_defaults();
        assert_eq!(cfg.endpoints.len(), 32);
        let retained = cfg.endpoints.iter().find(|e| e.key == "user_info").unwrap();
        assert_eq!(retained.method, "POST");
        assert_eq!(
            retained.path_template,
            "https://auth.example.com/v2/me?space={spaceId}"
        );

        // Keep-alive interval default = 600s (10 min) and legacy rules without field deserialize to 600s
        assert_eq!(cfg.rules.keep_alive_interval_secs, 600);
        let mut legacy_rules_val = serde_json::to_value(&cfg.rules).unwrap();
        legacy_rules_val
            .as_object_mut()
            .unwrap()
            .remove("keepAliveIntervalSecs");
        let parsed_legacy: api_config::ApiParamRules =
            serde_json::from_value(legacy_rules_val).unwrap();
        assert_eq!(parsed_legacy.keep_alive_interval_secs, 600);

        // Keep-alive endpoint defaults to /user/info?appCode=arch, auto-migrates legacy currentUserType, and keeps custom paths
        let ka_ep = cfg.endpoints.iter().find(|e| e.key == "keep_alive").unwrap();
        assert_eq!(
            ka_ep.path_template,
            "/devops-api/arch/api/v1/user/info?appCode=arch"
        );
        assert!(ka_ep
            .params
            .iter()
            .any(|p| p.location == "query" && p.key == "appCode" && p.value == "arch"));

        let mut old_ka_cfg = cfg.clone();
        if let Some(old_ka) = old_ka_cfg
            .endpoints
            .iter_mut()
            .find(|e| e.key == "keep_alive")
        {
            old_ka.path_template = "/devops-api/proj/api/v1/whitelist/currentUserType".to_string();
            old_ka.params.clear();
        }
        old_ka_cfg.merge_missing_defaults();
        let migrated_ka = old_ka_cfg
            .endpoints
            .iter()
            .find(|e| e.key == "keep_alive")
            .unwrap();
        assert_eq!(
            migrated_ka.path_template,
            "/devops-api/arch/api/v1/user/info?appCode=arch"
        );
        assert!(migrated_ka
            .params
            .iter()
            .any(|p| p.location == "query" && p.key == "appCode" && p.value == "arch"));

        let mut custom_ka_cfg = cfg.clone();
        if let Some(custom_ka) = custom_ka_cfg
            .endpoints
            .iter_mut()
            .find(|e| e.key == "keep_alive")
        {
            custom_ka.path_template = "/custom/ping".to_string();
        }
        custom_ka_cfg.merge_missing_defaults();
        let kept_ka = custom_ka_cfg
            .endpoints
            .iter()
            .find(|e| e.key == "keep_alive")
            .unwrap();
        assert_eq!(kept_ka.path_template, "/custom/ping");
    }

    #[test]
    fn test_probe_url_reachable_and_unreachable() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            // 1. Reachable local listener
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let srv = tokio::spawn(async move {
                for _ in 0..2 {
                    if let Ok((mut sock, _)) = listener.accept().await {
                        let mut tmp = [0u8; 1024];
                        let n = sock.read(&mut tmp).await.unwrap_or(0);
                        if n > 0 {
                            let _ = sock
                                .write_all(b"HTTP/1.1 302 Found\r\nLocation: /login\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                                .await;
                        }
                        let _ = sock.shutdown().await;
                    }
                }
            });
            let ok_res = api_config::probe_url(&format!("http://{addr}/"), 2000).await;
            let _ = srv.await;
            assert!(ok_res.reachable);
            assert_eq!(ok_res.status_code, Some(302));
            assert_eq!(ok_res.reason_kind, "ok");

            // 2. Unreachable closed port
            let tmp_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let closed_addr = tmp_listener.local_addr().unwrap();
            drop(tmp_listener);
            let fail_res = api_config::probe_url(&format!("http://{closed_addr}/"), 1500).await;
            assert!(!fail_res.reachable);
            assert_ne!(fail_res.reason_kind, "ok");

            // 3. Invalid URL
            let invalid_res = api_config::probe_url("http://", 500).await;
            assert!(!invalid_res.reachable);
            assert_eq!(invalid_res.reason_kind, "invalid_url");
        });
    }

    #[test]
    fn test_worktime_hot_reload_custom_endpoint_and_rules() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let seen = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
            let seen_srv = seen.clone();

            let srv = tokio::spawn(async move {
                for _ in 0..4 {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let header_end = loop {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break None;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break Some(pos + 4);
                        }
                    };
                    let Some(hend) = header_end else { continue };
                    let hdr_str = String::from_utf8_lossy(&buf[..hend]).to_string();
                    let req_line = hdr_str.lines().next().unwrap_or("").trim().to_string();
                    let mut content_len: usize = 0;
                    for l in hdr_str.lines() {
                        if let Some((k, v)) = l.split_once(':') {
                            if k.eq_ignore_ascii_case("content-length") {
                                content_len = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    while buf.len() < hend + content_len {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    let body_str =
                        String::from_utf8_lossy(&buf[hend..hend + content_len]).to_string();
                    seen_srv.lock().unwrap().push((req_line, body_str));

                    let body_json = r#"{"code":200,"status":"ok"}"#;
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body_json.len(),
                        body_json
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });

            let cookies = vec![CookieRec {
                name: "SESSION".into(),
                value: "hotreload".into(),
                domain: "127.0.0.1".into(),
                path: "/".into(),
            }];
            let engine = WorktimeEngine::with_host_and_cookies(&addr.to_string(), 99, cookies);

            // Override endpoint templates & business rules dynamically
            let mut custom_cfg = engine.api_config().await;
            if let Some(ep) = custom_cfg
                .endpoints
                .iter_mut()
                .find(|e| e.key == "mr_approve")
            {
                ep.method = "PUT".to_string();
                ep.path_template = "/custom-git/{project}/mr/{reviewId}/approve-v2".to_string();
            }
            if let Some(ep) = custom_cfg
                .endpoints
                .iter_mut()
                .find(|e| e.key == "card_ext_properties")
            {
                ep.method = "POST".to_string();
                ep.path_template = "/custom-space/{spaceId}/ext-date".to_string();
            }
            custom_cfg.rules.approve_score = 9;
            custom_cfg.rules.merge_strategy = "SQUASH".to_string();
            custom_cfg.rules.plan_test_date_field = "customPlanDate".to_string();
            engine.set_api_config(custom_cfg).await;

            // 1. Trigger one-click approve & merge -> checks overridden mr_approve + approve_score + merge_strategy
            let res = dispatch(
                &engine,
                None,
                "h1",
                "execute_one_click_approve_and_merge",
                json!({
                    "project": "TEAM/demo-repo",
                    "review_id": "77",
                    "user_id": "100001",
                    "user_name": "测试用户"
                }),
            )
            .await
            .unwrap();
            assert_eq!(res[0], json!(true));

            // 2. Trigger set_card_plan_test_date -> checks overridden card_ext_properties + customPlanDate field + space_id=99
            let _ = dispatch(
                &engine,
                None,
                "h2",
                "set_card_plan_test_date",
                json!({
                    "card_id": 12345,
                    "date_ms": 1795300000000_i64
                }),
            )
            .await
            .unwrap();

            srv.await.unwrap();
            let reqs = seen.lock().unwrap();
            assert_eq!(reqs.len(), 4);
            // reqs[0] = add_reviewer, reqs[1] = overridden mr_approve, reqs[2] = manualMerge, reqs[3] = overridden card_ext_properties
            assert!(reqs[1]
                .0
                .starts_with("PUT /custom-git/TEAM/demo-repo/mr/77/approve-v2 "));
            assert!(reqs[1].1.contains("\"score\":9"));
            assert!(reqs[2].1.contains("\"mergeStrategy\":\"SQUASH\""));
            assert!(reqs[3].0.starts_with("POST /custom-space/99/ext-date "));
            assert!(reqs[3].1.contains("\"customPlanDate\":1795300000000"));
        });
    }

    #[test]
    fn test_probe_cookies_user_only_and_whoami_sync() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();

            let srv = tokio::spawn(async move {
                // 1. invalid probe cookie -> 401
                // 2. valid probe cookie -> userErp ok
                // 3..5. whoami -> user_info, space_members, delivery_capacity
                for _ in 0..5 {
                    let Ok((mut sock, _)) = listener.accept().await else {
                        break;
                    };
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let header_end = loop {
                        let n = sock.read(&mut tmp).await.unwrap_or(0);
                        if n == 0 {
                            break None;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break Some(pos + 4);
                        }
                    };
                    let Some(hend) = header_end else { continue };
                    let hdr = String::from_utf8_lossy(&buf[..hend]).to_string();
                    let req_line = hdr.lines().next().unwrap_or("").trim().to_string();
                    let cookie = hdr
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            if k.eq_ignore_ascii_case("cookie") {
                                Some(v.trim().to_string())
                            } else {
                                None
                            }
                        })
                        .unwrap_or_default();

                    let (status, body) = if req_line.contains("/user/info") {
                        if cookie.contains("good=1") {
                            (
                                "200 OK",
                                r#"{"code":0,"data":{"userErp":"100001199001010001","email":"demo@example.com","org":{"name":"研发交付一部"}}}"#,
                            )
                        } else {
                            ("401 Unauthorized", r#"{"code":401,"msg":"unauthenticated"}"#)
                        }
                    } else if req_line.contains("/spaces/members") {
                        (
                            "200 OK",
                            r#"{"code":0,"data":[{"memberErp":"100001199001010001","memberName":"测试用户"},{"memberErp":"10002","memberName":"张三"}]}"#,
                        )
                    } else if req_line.contains("/deliveryCapacity/") {
                        (
                            "200 OK",
                            r#"{"code":0,"data":{"userName":"测试用户","personalDeliveryCapacity":1.2345,"personalDeliveryCapacityStandard":1.0,"isQualified":true,"cardCount":8,"devWorkCoefficient":1.15,"startMonth":"2026-10","month":"2026-11"}}"#,
                        )
                    } else {
                        ("404 Not Found", r#"{"code":404}"#)
                    };

                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });

            let base_cookies = vec![CookieRec {
                name: "SESSION".into(),
                value: "init".into(),
                domain: "127.0.0.1".into(),
                path: "/".into(),
            }];
            let engine = WorktimeEngine::with_host_and_cookies(&addr.to_string(), 26, base_cookies);

            // 1. Invalid probe must fail without touching stored cookies
            let bad = engine
                .probe_cookies_user_only(&[CookieRec {
                    name: "bad".into(),
                    value: "0".into(),
                    domain: "127.0.0.1".into(),
                    path: "/".into(),
                }])
                .await;
            assert!(bad.is_err());
            assert_eq!(engine.cookie_header().await, "SESSION=init");

            // 2. Valid probe returns userErp cleanly
            let good_cookies = vec![CookieRec {
                name: "good".into(),
                value: "1".into(),
                domain: "127.0.0.1".into(),
                path: "/".into(),
            }];
            let probed = engine.probe_cookies_user_only(&good_cookies).await.unwrap();
            assert_eq!(probed["userErp"], json!("100001199001010001"));

            // 3. Apply cookies + whoami syncs personal info, orgName, memberCount, capacity
            engine.set_cookies(good_cookies).await;
            let info = engine.whoami(None).await.unwrap();
            assert_eq!(info["realName"], json!("测试用户"));
            assert_eq!(info["orgName"], json!("研发交付一部"));
            assert_eq!(info["erp"], json!("100001199001010001"));
            assert_eq!(info["email"], json!("demo@example.com"));
            assert_eq!(info["memberCount"], json!(2));
            assert_eq!(info["capacity"]["isQualified"], json!(true));
            assert_eq!(info["capacity"]["personalDeliveryCapacity"], json!(1.2345));
            assert!(!info["syncedAt"].as_str().unwrap_or("").is_empty());

            srv.await.unwrap();
        });
    }

    #[test]
    fn test_api_config_endpoint_params_defaults_and_legacy_backfill() {
        let def = api_config::ApiConfig::default();
        for key in [
            "user_info",
            "card_list",
            "declare_hours",
            "mr_approve",
            "mr_manual_merge",
            "card_ext_properties",
            "card_properties",
            "file_upload",
            "wechat_webservice",
        ] {
            let ep = def.endpoint_by_key(key).expect(key);
            assert!(!ep.params.is_empty(), "endpoint {key} should define structured params");
        }

        // Simulate legacy api_config.json where endpoints lacked `params` field
        let legacy_json = json!({
            "scheme": "http",
            "ip": "10.1.2.3",
            "port": "8080",
            "loginPath": "/sso",
            "spaceId": 42,
            "endpoints": [
                {
                    "key": "user_info",
                    "group": "auth",
                    "name": "获取当前登录用户信息",
                    "method": "POST",
                    "pathTemplate": "/custom/me?appCode=arch",
                    "description": ""
                }
            ]
        });
        let mut migrated: api_config::ApiConfig = serde_json::from_value(legacy_json).unwrap();
        migrated.merge_missing_defaults();
        assert_eq!(migrated.endpoints.len(), 32);
        let ui_ep = migrated.endpoint_by_key("user_info").unwrap();
        assert_eq!(ui_ep.method, "POST");
        assert_eq!(ui_ep.path_template, "/custom/me?appCode=arch");
        assert!(!ui_ep.params.is_empty(), "legacy endpoint should backfill default params");

        // Test render_endpoint query edit, rename, disable, custom add, and path override
        let mut cfg = api_config::ApiConfig::default();
        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "user_info") {
            ep.params[0].key = "app".to_string();
            ep.params[0].value = "arch-v2".to_string();
            ep.params.push(api_config::ApiParamSpec {
                key: "tenant".to_string(),
                location: "query".to_string(),
                value_type: "string".to_string(),
                value: "007".to_string(),
                source_key: String::new(),
                enabled: true,
                required: false,
                description: "custom".to_string(),
                linked_rule: String::new(),
            });
        }
        let (_, u_mod) = cfg.render_endpoint("user_info", &[]);
        assert_eq!(
            u_mod,
            "http://devops.example.local:8880/devops-api/arch/api/v1/user/info?app=arch-v2&tenant=007"
        );

        // Disable query param & override path param on role_config
        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "user_info") {
            ep.params[0].enabled = false;
        }
        let (_, u_dis) = cfg.render_endpoint("user_info", &[]);
        assert_eq!(
            u_dis,
            "http://devops.example.local:8880/devops-api/arch/api/v1/user/info?tenant=007"
        );

        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "role_config") {
            ep.params[0].value = "999".to_string();
        }
        let (_, role_u) = cfg.render_endpoint("role_config", &[]);
        assert!(role_u.ends_with("/bizConfig/space/kv/999"));

        // Test apply_body_params on nested dot-path and array body
        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "card_properties") {
            if let Some(act) = ep.params.iter_mut().find(|p| p.key == "properties.action") {
                act.key = "properties.flowType".to_string();
                act.value = "fastFlow".to_string();
            }
            ep.params.push(api_config::ApiParamSpec {
                key: "meta.trace".to_string(),
                location: "body".to_string(),
                value_type: "boolean".to_string(),
                value: "true".to_string(),
                source_key: String::new(),
                enabled: true,
                required: false,
                description: "".to_string(),
                linked_rule: String::new(),
            });
        }
        let flow_payload = json!({
            "cardId": 1,
            "spaceId": 26,
            "properties": { "handler": {}, "action": "statusFlow", "cardStatusId": 90 }
        });
        let transformed = cfg.apply_body_params("card_properties", &flow_payload);
        assert!(transformed["properties"].get("action").is_none());
        assert_eq!(transformed["properties"]["flowType"], json!("fastFlow"));
        assert_eq!(transformed["meta"]["trace"], json!(true));

        // Array payload (checklist_save_batch)
        if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "checklist_save_batch") {
            if let Some(res_p) = ep.params.iter_mut().find(|p| p.key == "checkResult") {
                res_p.value = "9".to_string();
            }
        }
        let arr_body = json!([
            { "cardId": 1, "checkId": 10, "checkResult": 2 },
            { "cardId": 1, "checkId": 11, "checkResult": 2 }
        ]);
        let arr_out = cfg.apply_body_params("checklist_save_batch", &arr_body);
        assert_eq!(arr_out[0]["checkResult"], json!(9));
        assert_eq!(arr_out[1]["checkResult"], json!(9));
    }

    #[test]
    fn test_worktime_live_http_endpoint_param_overrides() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let captured = Arc::new(Mutex::new(Vec::<(String, String, String)>::new()));
            let captured_srv = captured.clone();

            let srv = tokio::spawn(async move {
                for _ in 0..3 {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let header_end = loop {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break None;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break Some(pos + 4);
                        }
                    };
                    let Some(hend) = header_end else { continue };
                    let hdr_str = String::from_utf8_lossy(&buf[..hend]).to_string();
                    let req_line = hdr_str.lines().next().unwrap_or("").trim().to_string();
                    let mut content_len: usize = 0;
                    for l in hdr_str.lines() {
                        if let Some((k, v)) = l.split_once(':') {
                            if k.eq_ignore_ascii_case("content-length") {
                                content_len = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    while buf.len() < hend + content_len {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    let body_str =
                        String::from_utf8_lossy(&buf[hend..hend + content_len]).to_string();
                    captured_srv.lock().unwrap().push((req_line.clone(), hdr_str, body_str));

                    let resp_body = if req_line.contains("/user/info") {
                        r#"{"code":0,"data":{"userErp":"100001","org":{"name":"研发"}}}"#
                    } else if req_line.contains("conditionTreeCardList") {
                        r#"{"code":0,"data":{"resultList":[]}}"#
                    } else {
                        r#"{"code":200,"status":"ok"}"#
                    };
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        resp_body.len(),
                        resp_body
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });

            let cookies = vec![CookieRec {
                name: "SESSION".into(),
                value: "param-override".into(),
                domain: "127.0.0.1".into(),
                path: "/".into(),
            }];
            let engine = WorktimeEngine::with_host_and_cookies(&addr.to_string(), 26, cookies);
            let mut cfg = engine.api_config().await;

            // 1. Customize user_info query override + custom query + custom header
            if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "user_info") {
                ep.params[0].value = "arch-v2".to_string();
                ep.params.push(api_config::ApiParamSpec {
                    key: "tenant".to_string(),
                    location: "query".to_string(),
                    value_type: "string".to_string(),
                    value: "007".to_string(),
                    source_key: String::new(),
                    enabled: true,
                    required: false,
                    description: String::new(),
                    linked_rule: String::new(),
                });
                ep.params.push(api_config::ApiParamSpec {
                    key: "X-Custom-Token".to_string(),
                    location: "header".to_string(),
                    value_type: "string".to_string(),
                    value: "secret-123".to_string(),
                    source_key: String::new(),
                    enabled: true,
                    required: false,
                    description: String::new(),
                    linked_rule: String::new(),
                });
            }

            // 2. Customize card_list body: value edits, disable, rename, custom boolean
            if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "card_list") {
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "orderField") {
                    p.value = "updateTime".to_string();
                }
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "orderType") {
                    p.value = "asc".to_string();
                }
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "pageSize") {
                    p.value = "50".to_string();
                }
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "handlers") {
                    p.enabled = false;
                }
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "keyword") {
                    p.key = "searchText".to_string();
                }
                ep.params.push(api_config::ApiParamSpec {
                    key: "extraFlag".to_string(),
                    location: "body".to_string(),
                    value_type: "boolean".to_string(),
                    value: "true".to_string(),
                    source_key: String::new(),
                    enabled: true,
                    required: false,
                    description: String::new(),
                    linked_rule: String::new(),
                });
            }

            // 3. Customize mr_approve body parameters
            if let Some(ep) = cfg.endpoints.iter_mut().find(|e| e.key == "mr_approve") {
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "note") {
                    p.value = "LGTM-auto".to_string();
                }
                if let Some(p) = ep.params.iter_mut().find(|p| p.key == "score") {
                    p.value = "5".to_string();
                }
            }

            engine.set_api_config(cfg).await;

            // Fire live requests through the engine
            let _ = hours::get_current_user(&engine, None).await.unwrap();
            let _ = hours::search_cards_raw(&engine, None, Some("TASK-1"), &[], None)
                .await
                .unwrap();
            let _ = git_mr::approve_mr_review(&engine, None, "TEAM/repo", "88", "", 2)
                .await
                .unwrap();

            srv.await.unwrap();
            let reqs = captured.lock().unwrap();
            assert_eq!(reqs.len(), 3);

            // Assert req[0]: user_info query + header
            assert!(reqs[0]
                .0
                .starts_with("GET /devops-api/arch/api/v1/user/info?appCode=arch-v2&tenant=007 "));
            assert!(reqs[0]
                .1
                .to_ascii_lowercase()
                .contains("x-custom-token: secret-123"));

            // Assert req[1]: card_list body transformations
            let card_body: Value = serde_json::from_str(&reqs[1].2).unwrap();
            assert_eq!(card_body["orderField"], json!("updateTime"));
            assert_eq!(card_body["orderType"], json!("asc"));
            assert_eq!(card_body["pageSize"], json!(50));
            assert!(card_body.get("handlers").is_none());
            assert!(card_body.get("keyword").is_none());
            assert_eq!(card_body["searchText"], json!("TASK-1"));
            assert_eq!(card_body["extraFlag"], json!(true));

            // Assert req[2]: mr_approve body overrides
            let approve_body: Value = serde_json::from_str(&reqs[2].2).unwrap();
            assert_eq!(approve_body["note"], json!("LGTM-auto"));
            assert_eq!(approve_body["score"], json!(5));
        });
    }

    #[test]
    fn test_engine_state_bounded_caches() {
        let mut st = client::EngineState::default();
        for i in 0..(client::MAX_CARD_DETAIL_CACHE + 25) {
            st.insert_card_detail_cache(i as i64, json!({ "id": i }));
        }
        assert!(st.card_detail_cache.len() <= client::MAX_CARD_DETAIL_CACHE);
        let last_detail_id = (client::MAX_CARD_DETAIL_CACHE + 24) as i64;
        assert_eq!(
            st.card_detail_cache.get(&last_detail_id),
            Some(&json!({ "id": last_detail_id }))
        );

        for i in 0..(client::MAX_MR_CACHE + 15) {
            st.insert_mr_cache(format!("k-{i}"), json!({ "idx": i }));
        }
        assert!(st.mr_cache.len() <= client::MAX_MR_CACHE);
        let last_mr_key = format!("k-{}", client::MAX_MR_CACHE + 14);
        assert_eq!(
            st.mr_cache.get(&last_mr_key),
            Some(&json!({ "idx": client::MAX_MR_CACHE + 14 }))
        );
    }
}
