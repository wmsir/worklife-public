use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;
use tauri::AppHandle;

use crate::sidecar::emit_app_log;

use super::client::{val_as_i64, val_as_str, WorktimeEngine};
use super::constants::SPACE_INDENT;
use super::hours;
use super::wechat::send_wechat_notice;

fn log_line(app: Option<&AppHandle>, msg: impl Into<String>) {
    if let Some(a) = app {
        emit_app_log(a, msg.into());
    }
}

pub fn normalize_api_project(project: &str) -> String {
    let mut p = project.trim().to_string();
    if p.is_empty() {
        return p;
    }
    if let Some(idx) = p.find("/codingRoot/") {
        p = p[idx + "/codingRoot/".len()..].to_string();
        for marker in ["/merges", "/tree", "/commits", "/branches"] {
            if let Some(mi) = p.find(marker) {
                p.truncate(mi);
            }
        }
        p = p.trim_matches('/').to_string();
    }
    p = p.replace("%2F", "!").replace("%2f", "!");
    let slash_count = p.matches('/').count();
    if slash_count > 1 {
        if let Some(last_slash) = p.rfind('/') {
            let prefix = p[..last_slash].replace('/', "!");
            let suffix = &p[last_slash + 1..];
            p = format!("{prefix}/{suffix}");
        }
    }
    p
}

pub fn normalize_web_project(project: &str) -> String {
    if project.trim().is_empty() {
        return String::new();
    }
    normalize_api_project(project).replace('!', "%2F")
}

pub async fn create_branch(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project_path: &str,
    new_branch: &str,
    ref_branch: &str,
) -> Result<Value, String> {
    let api_proj = normalize_api_project(project_path);
    let payload = json!({
        "branch": new_branch,
        "ref": ref_branch,
    });
    let (_, data) = engine
        .call_endpoint_json(
            app,
            "create_branch",
            &[("project", &api_proj)],
            None,
            Some(&payload),
            false,
            15,
        )
        .await?;

    if let Some(obj) = data.as_object() {
        let has_name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let is_branch = obj.get("type").and_then(|v| v.as_str()) == Some("BRANCH");
        if has_name || is_branch {
            return Ok(data);
        }
        if let Some(code) = obj.get("code").and_then(val_as_i64) {
            if code != 0 {
                let msg = obj
                    .get("msg")
                    .or_else(|| obj.get("message"))
                    .map(val_as_str)
                    .unwrap_or_else(|| data.to_string());
                return Err(msg);
            }
        }
    }
    Ok(data)
}

pub async fn execute_create_branch(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    branch_name: &str,
    ref_branch: &str,
    projects: &[String],
) -> Result<Value, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();
    log_line(
        app,
        format!("🚀 开始批量创建代码分支：源分支=[{ref_branch}]  新分支=[{branch_name}]"),
    );

    let mut results = Vec::with_capacity(projects.len());
    for (idx, project) in projects.iter().enumerate() {
        if engine.is_stopped() {
            log_line(app, "⏹ 已中止执行。");
            break;
        }
        let proj_name = project.split('/').next_back().unwrap_or(project);
        log_line(app, format!("{SPACE_INDENT}⏳ 正在为 [{proj_name}] 创建分支..."));
        let (ok, existed, status) = match create_branch(engine, app, project, branch_name, ref_branch).await {
            Ok(_) => (true, false, "✅ 成功".to_string()),
            Err(e) => {
                let lower = e.to_lowercase();
                if e.contains("已存在") || e.contains("已经存在") || lower.contains("already exists") {
                    (false, true, format!("ℹ️ 分支已存在: {e}"))
                } else {
                    (false, false, format!("❌ 失败: {e}"))
                }
            }
        };
        log_line(app, format!("{SPACE_INDENT}📝 [{proj_name}] -> {status}"));
        results.push(json!({
            "project": project,
            "project_name": proj_name,
            "ok": ok,
            "existed": existed,
            "status": status,
        }));
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

    log_line(app, "\n✅ 分支创建执行完毕。");
    Ok(Value::Array(results))
}

pub async fn get_branch_diff(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    src: &str,
    dest: &str,
) -> Result<Value, String> {
    let api_proj = normalize_api_project(project);
    let (_, data) = engine
        .call_endpoint_json(
            app,
            "branch_diff",
            &[("project", &api_proj), ("dest", dest), ("src", src)],
            None,
            None,
            false,
            15,
        )
        .await?;
    Ok(data)
}

pub async fn get_commit_msg(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    src: &str,
    dest: &str,
) -> Result<(String, String), String> {
    let api_proj = normalize_api_project(project);
    let (_, commits) = engine
        .call_endpoint_json(
            app,
            "branch_commits",
            &[("project", &api_proj), ("dest", dest), ("src", src)],
            None,
            None,
            false,
            15,
        )
        .await?;
    if !commits.is_null() && commits.as_object().map(|m| !m.is_empty()).unwrap_or(false) {
        let ms = commits.get("messageSummary").unwrap_or(&Value::Null);
        let title = ms.get("title").map(val_as_str).unwrap_or_default();
        let body = ms.get("body").map(val_as_str).unwrap_or_default();
        Ok((title, body))
    } else {
        Err(format!(
            "分支差异获取失败：没有发现新的提交 (src={src} dest={dest})"
        ))
    }
}

pub async fn get_reviewer_user_id(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    name_or_id: &str,
) -> String {
    let clean = name_or_id.trim();
    if clean.is_empty() {
        return String::new();
    }

    let rules = engine.rules().await;
    if let Some(id) = rules.lookup_reviewer_id(clean) {
        return id.to_string();
    }

    if clean.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(v) = clean.parse::<i32>() {
            return v.to_string();
        }
    }

    let encoded = utf8_percent_encode(clean, NON_ALPHANUMERIC).to_string();
    match engine
        .call_endpoint_raw(
            app,
            "user_query_like",
            &[("keyword", &encoded)],
            None,
            None,
            false,
            10,
            1,
            false,
        )
        .await
    {
        Ok((200, text)) => {
            if let Ok(res_data) = serde_json::from_str::<Value>(&text) {
                let users = if let Some(arr) = res_data.as_array() {
                    arr.clone()
                } else {
                    res_data
                        .get("data")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default()
                };
                for u in &users {
                    let rname = u
                        .get("realName")
                        .or_else(|| u.get("name"))
                        .or_else(|| u.get("userName"))
                        .map(val_as_str)
                        .unwrap_or_default();
                    let uid = u
                        .get("userId")
                        .or_else(|| u.get("id"))
                        .map(val_as_str)
                        .unwrap_or_default();
                    if !uid.is_empty() && rname == clean {
                        return uid;
                    }
                }
                for u in &users {
                    let uid = u
                        .get("userId")
                        .or_else(|| u.get("id"))
                        .map(val_as_str)
                        .unwrap_or_default();
                    if !uid.is_empty() {
                        return uid;
                    }
                }
            }
        }
        Ok(_) => {}
        Err(e) => {
            log_line(app, format!("⚠️ 调用 user/queryLike 查询 [{clean}] 异常: {e}"));
        }
    }

    if let Ok(members) = hours::get_members(engine, app).await {
        for m in members {
            let mname = m.get("memberName").map(val_as_str).unwrap_or_default();
            if mname == clean {
                let uid = m
                    .get("userId")
                    .or_else(|| m.get("memberId"))
                    .or_else(|| m.get("id"))
                    .map(val_as_str)
                    .unwrap_or_default();
                if !uid.is_empty() {
                    return uid;
                }
            }
        }
    }

    String::new()
}

pub async fn get_current_user_reviewer_id(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    user_name: &str,
    default_id: &str,
) -> String {
    let rules = engine.rules().await;
    let fallback_name = if rules.default_reviewer_name.trim().is_empty() {
        ""
    } else {
        rules.default_reviewer_name.trim()
    };
    let clean = if user_name.trim().is_empty() {
        fallback_name
    } else {
        user_name.trim()
    };
    if let Some(id) = rules.lookup_reviewer_id(clean) {
        return id.to_string();
    }
    let uid = get_reviewer_user_id(engine, app, clean).await;
    if !uid.is_empty() {
        uid
    } else if !default_id.trim().is_empty() {
        default_id.to_string()
    } else {
        rules.default_reviewer_id
    }
}

pub async fn add_mr_reviewer(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    review_id: &str,
    user_id: &str,
) -> Result<Value, String> {
    let api_proj = normalize_api_project(project);
    let (_, val) = engine
        .call_endpoint_json(
            app,
            "mr_add_reviewer",
            &[
                ("project", &api_proj),
                ("reviewId", review_id),
                ("userId", user_id),
            ],
            None,
            None,
            true,
            15,
        )
        .await?;
    Ok(val)
}

pub async fn approve_mr_review(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    review_id: &str,
    note: &str,
    score: i64,
) -> Result<Value, String> {
    let api_proj = normalize_api_project(project);
    let payload = json!({ "note": note, "score": score });
    let (_, val) = engine
        .call_endpoint_json(
            app,
            "mr_approve",
            &[("project", &api_proj), ("reviewId", review_id)],
            None,
            Some(&payload),
            true,
            15,
        )
        .await?;
    Ok(val)
}

pub async fn manual_merge_mr(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    review_id: &str,
    subject: Value,
    body: Value,
    merge_strategy: &str,
) -> Result<Value, String> {
    let api_proj = normalize_api_project(project);
    let default_strat = engine.rules().await.merge_strategy;
    let fallback_strat = if default_strat.trim().is_empty() {
        "DEFAULT".to_string()
    } else {
        default_strat
    };
    let payload = json!({
        "subject": subject,
        "body": body,
        "mergeStrategy": if merge_strategy.trim().is_empty() { fallback_strat } else { merge_strategy.trim().to_string() },
    });
    let (_, val) = engine
        .call_endpoint_json(
            app,
            "mr_manual_merge",
            &[("project", &api_proj), ("reviewId", review_id)],
            None,
            Some(&payload),
            true,
            20,
        )
        .await?;
    Ok(val)
}

pub async fn execute_one_click_approve_and_merge(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    review_id: &str,
    user_id: &str,
    user_name: &str,
) -> (bool, String) {
    let api_proj = normalize_api_project(project);
    let proj_name = api_proj.split('/').next_back().unwrap_or(&api_proj);
    let rid = review_id.trim();

    log_line(
        app,
        format!(
            "⚡ 开始对工程 [{proj_name}] MR #{rid} 执行【一键通过三个接口】(添加评审人 -> 审批通过 -> 合并)..."
        ),
    );

    // 1. 添加评审人
    log_line(
        app,
        format!("  👉 [1/3] 正在添加评审人: {user_name} (ID: {user_id})..."),
    );
    match add_mr_reviewer(engine, app, &api_proj, rid, user_id).await {
        Ok(_) => log_line(app, "  ✅ [1/3] 评审人添加成功！"),
        Err(e) => {
            if e.contains("已是")
                || e.contains("已存在")
                || e.contains("409")
                || e.contains("Conflict")
            {
                log_line(app, "  ℹ️ [1/3] 评审人已在评审列表中，跳过并继续下一步。");
            } else {
                log_line(app, format!("  ⚠️ [1/3] 添加评审人提示: {e}，继续尝试审批..."));
            }
        }
    }

    tokio::time::sleep(Duration::from_millis(300)).await;

    let rules = engine.rules().await;
    let approve_score = rules.approve_score;
    let merge_strategy = if rules.merge_strategy.trim().is_empty() {
        "DEFAULT".to_string()
    } else {
        rules.merge_strategy.trim().to_string()
    };

    // 2. 评审通过
    log_line(app, format!("  👉 [2/3] 正在提交评审通过 (score: {approve_score})..."));
    match approve_mr_review(engine, app, &api_proj, rid, "", approve_score).await {
        Ok(_) => log_line(app, "  ✅ [2/3] 评审通过提交成功！"),
        Err(e) => {
            if e.contains("已评审") || e.contains("已经评审") || e.contains("已通过") {
                log_line(app, "  ℹ️ [2/3] 该评审已被批准，继续合并...");
            } else {
                log_line(app, format!("  ❌ [2/3] 评审通过失败: {e}"));
                return (false, format!("评审通过失败: {e}"));
            }
        }
    }

    tokio::time::sleep(Duration::from_millis(300)).await;

    // 3. 合并
    log_line(app, "  👉 [3/3] 正在执行合并 (manualMerge)...");
    match manual_merge_mr(
        engine,
        app,
        &api_proj,
        rid,
        Value::Null,
        Value::Null,
        &merge_strategy,
    )
    .await
    {
        Ok(_) => {
            log_line(
                app,
                format!("  🎉 [3/3] 合并执行成功！工程 [{proj_name}] MR #{rid} 已成功合并！"),
            );
            (true, "评审通过并已成功合并".to_string())
        }
        Err(e) => {
            if e.contains("已合并") || e.contains("MERGED") || e.contains("merged") {
                log_line(app, "  🎉 [3/3] 该 MR 已处于合并状态！");
                (true, "已成功合并".to_string())
            } else {
                log_line(app, format!("  ❌ [3/3] 合并失败: {e}"));
                (false, format!("合并失败: {e}"))
            }
        }
    }
}

pub async fn submit_mr(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    project: &str,
    src: &str,
    dest: &str,
    new_commit: &str,
    old_commit: &str,
    reviewer_ids: &[String],
) -> Result<i64, String> {
    let api_proj = normalize_api_project(project);
    let (title, content) = get_commit_msg(engine, app, &api_proj, src, dest).await?;
    let rules = engine.rules().await;
    let timeout = rules.request_timeout_secs.clamp(3, 300);
    let max_retries = rules.max_retries.min(5);

    let valid_reviewers: Vec<String> = reviewer_ids
        .iter()
        .filter_map(|r| r.trim().parse::<i32>().ok().map(|v| v.to_string()))
        .collect();

    let payload = json!({
        "newCommitId": new_commit,
        "oldCommitId": old_commit,
        "targetBranch": dest,
        "sourceBranch": src,
        "sourceProjectId": Value::Null,
        "title": title,
        "content": content,
        "reviewerIds": valid_reviewers,
        "customizeReviewPerson": !valid_reviewers.is_empty(),
    });

    let (status, text) = engine
        .call_endpoint_raw(
            app,
            "mr_submit",
            &[("project", &api_proj)],
            None,
            Some(&payload),
            false,
            timeout,
            max_retries,
            false,
        )
        .await?;
    if status == 404 {
        return Err(format!("工程 {project} 的 {src} 分支不存在!"));
    }
    if status == 409 {
        return Err(format!("工程 {project} 的 {src} 分支合并请求已存在!"));
    }
    if !(200..300).contains(&status) {
        return Err(format!("提交 MR 失败 HTTP {status}: {text}"));
    }
    let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    data.get("id")
        .and_then(val_as_i64)
        .ok_or_else(|| format!("提交 MR 响应未返回 review id: {text}"))
}

pub async fn get_all_mrs(engine: &WorktimeEngine, app: Option<&AppHandle>) -> Result<(), String> {
    let (_, data) = engine
        .call_endpoint_json(app, "mr_list_open", &[], None, None, false, 15)
        .await?;
    if let Some(reviews) = data.as_array() {
        let mut st = engine.state.write().await;
        st.mr_cache.clear();
        for r in reviews {
            let s_branch = r.get("sourceBranch").map(val_as_str).unwrap_or_default();
            let d_branch = r.get("branch").map(val_as_str).unwrap_or_default();
            let p_name = r
                .get("project")
                .and_then(|p| p.get("name"))
                .map(val_as_str)
                .unwrap_or_default();
            if !p_name.is_empty() && !s_branch.is_empty() && !d_branch.is_empty() {
                st.insert_mr_cache(format!("{p_name}-{s_branch}-{d_branch}"), r.clone());
            }
        }
    }
    Ok(())
}

pub async fn project_mr(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    dest: &str,
    project_path: &str,
    src: &str,
    reviewer_ids: &[String],
) -> Result<String, String> {
    let api_proj = normalize_api_project(project_path);
    let web_proj = normalize_web_project(project_path);

    let diff_data = get_branch_diff(engine, app, &api_proj, src, dest).await?;
    if !diff_data
        .get("hasNewCode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Err(format!("源分支 {src} 与目标分支 {dest} 之间无新代码差异"));
    }

    let new_commit = diff_data
        .get("newCommitId")
        .map(val_as_str)
        .unwrap_or_default();
    let old_commit = diff_data
        .get("oldCommitId")
        .map(val_as_str)
        .unwrap_or_default();

    let review_id = submit_mr(
        engine,
        app,
        &api_proj,
        src,
        dest,
        &new_commit,
        &old_commit,
        reviewer_ids,
    )
    .await?;

    let rid_str = review_id.to_string();
    let (_, mr_url) = engine
        .resolve_endpoint(
            "mr_review_page",
            &[("webProject", &web_proj), ("reviewId", &rid_str)],
        )
        .await;
    Ok(mr_url)
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_submit_mr(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    call_id: &str,
    src_branch: &str,
    dest_branches: &[String],
    projects: &[String],
    reviewer_names: &[String],
    auto_approve_printcenter: bool,
    current_user_reviewer_id: &str,
    current_user_name: &str,
) -> Result<Vec<Value>, String> {
    engine.require_logged_in().await?;
    engine.clear_stop();
    let rules = engine.rules().await;
    let auto_kw = rules.auto_approve_keyword.trim().to_lowercase();

    log_line(
        app,
        format!("🚀 开始批量提交 MR：源分支=[{src_branch}]  目标环境={dest_branches:?}"),
    );

    let mut reviewer_ids: Vec<String> = Vec::new();
    for raw_name in reviewer_names {
        let r_name = raw_name.trim();
        if r_name.is_empty() {
            continue;
        }
        let uid = get_reviewer_user_id(engine, app, r_name).await;
        if !uid.is_empty() {
            let source_tag = if rules.builtin_reviewers.contains_key(r_name) {
                "内置"
            } else {
                "查询"
            };
            log_line(
                app,
                format!("  👤 评审人 [{r_name}] ({source_tag}) -> userId: {uid}"),
            );
            reviewer_ids.push(uid);
        } else {
            log_line(app, format!("⚠️ 无法匹配评审人 [{r_name}] 的数值 userId，将跳过。"));
        }
    }

    let _ = get_all_mrs(engine, app).await;
    let mut mr_results: Vec<Value> = Vec::new();
    let mut total_idx: usize = 0;

    for dest in dest_branches {
        if engine.is_stopped() {
            break;
        }
        log_line(app, format!("\n⚡ 正在处理目标分支环境: {dest}"));
        let mut d_mrs: Vec<Value> = Vec::new();

        for project_path in projects {
            if engine.is_stopped() {
                break;
            }
            let proj_name = project_path.split('/').next_back().unwrap_or(project_path);
            let key = format!("{proj_name}-{src_branch}-{dest}");
            let web_proj = normalize_web_project(project_path);
            let is_auto_approve_repo = !auto_kw.is_empty()
                && (proj_name.to_lowercase().contains(&auto_kw)
                    || project_path.to_lowercase().contains(&auto_kw));

            let cached_mr = engine.state.read().await.mr_cache.get(&key).cloned();
            if let Some(existing_r) = cached_mr {
                let mut status = "⚠️ 已存在合并请求".to_string();
                let mut mr_url = String::new();
                let rid = existing_r
                    .get("id")
                    .or_else(|| existing_r.get("reviewId"))
                    .or_else(|| existing_r.get("number"))
                    .and_then(val_as_i64);
                if let Some(review_id) = rid {
                    let rid_str = review_id.to_string();
                    mr_url = engine
                        .resolve_endpoint(
                            "mr_review_page",
                            &[("webProject", &web_proj), ("reviewId", &rid_str)],
                        )
                        .await
                        .1;
                    if auto_approve_printcenter && is_auto_approve_repo {
                        log_line(
                            app,
                            format!("\n⚡ [单证打印] 发现存量 MR #{review_id}，自动启动【一键自评与合并流程 (3个接口)】..."),
                        );
                        let (ok_m, msg_m) = execute_one_click_approve_and_merge(
                            engine,
                            app,
                            project_path,
                            &review_id.to_string(),
                            current_user_reviewer_id,
                            current_user_name,
                        )
                        .await;
                        status = if ok_m {
                            "🎉 评审通过并已合并".to_string()
                        } else {
                            format!("⚠️ 已存在MR(自动合并未成: {msg_m})")
                        };
                    }
                }
                let link_suffix = if mr_url.is_empty() {
                    String::new()
                } else {
                    format!(" 🔗 {mr_url}")
                };
                log_line(
                    app,
                    format!("{SPACE_INDENT}📝 [{proj_name} -> {dest}] {status}{link_suffix}"),
                );
                if let Some(a) = app {
                    WorktimeEngine::emit_callback(
                        a,
                        call_id,
                        "update_status_cb",
                        vec![json!(total_idx), json!(status), json!(mr_url)],
                    );
                }
                total_idx += 1;
                if !mr_url.is_empty() {
                    let item = json!({
                        "project": proj_name,
                        "project_path": project_path,
                        "dest": dest,
                        "url": mr_url,
                        "is_new": false
                    });
                    d_mrs.push(item.clone());
                    mr_results.push(item);
                }
                continue;
            }

            let mut mr_url = String::new();
            let mut status: String;
            log_line(
                app,
                format!("{SPACE_INDENT}⏳ 正在向 {proj_name} 提交 {src_branch} -> {dest} 的合并请求..."),
            );
            match project_mr(engine, app, dest, project_path, src_branch, &reviewer_ids).await {
                Ok(url) => {
                    mr_url = url;
                    status = "✅ 成功".to_string();
                    log_line(app, format!("{SPACE_INDENT}🔗 审查链接: {mr_url}"));

                    if auto_approve_printcenter && is_auto_approve_repo && !mr_url.is_empty() {
                        if let Some(rid_str) = mr_url.trim_end_matches('/').split('/').next_back() {
                            if rid_str.parse::<i64>().is_ok() {
                                log_line(
                                    app,
                                    format!("\n⚡ [单证打印] 检测到提交成功 (MR #{rid_str})，自动启动【一键自评与合并流程 (3个接口)】..."),
                                );
                                let (ok_m, msg_m) = execute_one_click_approve_and_merge(
                                    engine,
                                    app,
                                    project_path,
                                    rid_str,
                                    current_user_reviewer_id,
                                    current_user_name,
                                )
                                .await;
                                status = if ok_m {
                                    "🎉 成功并已自动通过合并".to_string()
                                } else {
                                    format!("⚠️ 已提交MR(自动合并未成: {msg_m})")
                                };
                            }
                        }
                    }

                    let item = json!({
                        "project": proj_name,
                        "project_path": project_path,
                        "dest": dest,
                        "url": mr_url,
                        "is_new": true
                    });
                    d_mrs.push(item.clone());
                    mr_results.push(item);
                }
                Err(e) => {
                    status = format!("❌ 失败: {e}");
                    if e.contains("已存在") {
                        let _ = get_all_mrs(engine, app).await;
                        if let Some(existing_r) = engine.state.read().await.mr_cache.get(&key).cloned()
                        {
                            if let Some(rid) = existing_r
                                .get("id")
                                .or_else(|| existing_r.get("reviewId"))
                                .or_else(|| existing_r.get("number"))
                                .and_then(val_as_i64)
                            {
                                let rid_str = rid.to_string();
                                mr_url = engine
                                    .resolve_endpoint(
                                        "mr_review_page",
                                        &[("webProject", &web_proj), ("reviewId", &rid_str)],
                                    )
                                    .await
                                    .1;
                                let item = json!({
                                    "project": proj_name,
                                    "project_path": project_path,
                                    "dest": dest,
                                    "url": mr_url,
                                    "is_new": false
                                });
                                d_mrs.push(item.clone());
                                mr_results.push(item);
                            }
                        }
                    }
                }
            }

            log_line(
                app,
                format!("{SPACE_INDENT}📝 [{proj_name} -> {dest}] {status}"),
            );
            if let Some(a) = app {
                WorktimeEngine::emit_callback(
                    a,
                    call_id,
                    "update_status_cb",
                    vec![json!(total_idx), json!(status), json!(mr_url)],
                );
            }
            total_idx += 1;
        }

        let wx_enabled = engine
            .state
            .read()
            .await
            .wechat_config
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !d_mrs.is_empty() && !reviewer_names.is_empty() && wx_enabled {
            let mut member_map: HashMap<String, String> = HashMap::new();
            if let Ok(members) = hours::get_members(engine, app).await {
                for m in members {
                    let mn = m.get("memberName").map(val_as_str).unwrap_or_default();
                    let me = m.get("memberErp").map(val_as_str).unwrap_or_default();
                    if !mn.is_empty() && !me.is_empty() {
                        member_map.insert(mn, me);
                    }
                }
            }

            let links_md: Vec<String> = d_mrs
                .iter()
                .map(|it| {
                    let p = it.get("project").map(val_as_str).unwrap_or_default();
                    let d = it.get("dest").map(val_as_str).unwrap_or_default();
                    let u = it.get("url").map(val_as_str).unwrap_or_default();
                    format!("* **{p}** (-> `{d}`): [点击直接审查]({u})\n  {u}")
                })
                .collect();

            let msg = format!(
                "### 📢 请帮我合并以下 [{dest}] 请求, 感谢 🙏\n\
                 * **源分支**: `{src_branch}`\n\
                 * **目标环境**: `{dest}`\n\n\
                 🔗 **合并审查链接**:\n\
                 {}\n\n\
                 > 来自工时管理工具自动提交",
                links_md.join("\n")
            );

            for r_name in reviewer_names {
                let clean_r = r_name.trim();
                if clean_r.is_empty() {
                    continue;
                }
                let resolved = hours::resolve_member_erp(engine, app, clean_r).await;
                let erp_target = if !resolved.is_empty() {
                    resolved
                } else {
                    member_map
                        .get(clean_r)
                        .cloned()
                        .unwrap_or_else(|| clean_r.to_string())
                };
                log_line(
                    app,
                    format!("🚀 正在向评审人 [{clean_r}] 发送 MR 审核企微通知 (接收人={erp_target})..."),
                );
                let _ = send_wechat_notice(engine, app, &erp_target, &msg, None).await;
            }
        }
    }

    log_line(app, "\n✅ 批量提交 MR 流程结束。");
    Ok(mr_results)
}
