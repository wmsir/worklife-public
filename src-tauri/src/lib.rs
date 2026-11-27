mod backup;
mod break_lock;
mod keep_alive;
mod life;
mod login;
mod project_fs;
mod settings;
mod sidecar;
mod store;
mod tasks;
mod templates;
mod tencent_docs;
mod vault;
mod worktime;

use serde_json::json;
use std::time::{Duration, Instant};
use tauri::Manager;
use uuid::Uuid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar::Sidecar::default())
        .manage(break_lock::BreakLockState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 后台会话保活与防休眠任务：按配置周期（默认 600 秒 / 10 分钟）执行会话保活与鼠标微调
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let format_interval = |secs: u64| -> String {
                    if secs % 60 == 0 {
                        format!("{} 分钟 ({secs} 秒)", secs / 60)
                    } else {
                        format!("{secs} 秒")
                    }
                };
                // 等待前端初始化并挂载 wt-log 监听器，确保首条保活日志可见
                tokio::time::sleep(Duration::from_secs(5)).await;
                let _ = handle.state::<sidecar::Sidecar>().ensure_initialized(&handle).await;
                let mut was_logged_in = false;
                let mut last_ping_at: Option<Instant> = None;
                let mut last_mouse_nudge_at: Option<Instant> = None;
                let mut pending_initial_ping = false;
                let mut last_settings_probe = Instant::now() - Duration::from_secs(60);
                let mut cached_settings_has = false;
                let mut seq: u64 = 0;

                loop {
                    let sc = handle.state::<sidecar::Sidecar>();
                    let rules = sc.rules().await;
                    let interval_secs = rules.keep_alive_interval_secs.clamp(30, 7200);
                    let mouse_nudge_enabled = rules.keep_alive_mouse_nudge;
                    let mouse_custom_secs = rules.keep_alive_mouse_nudge_interval_secs;
                    let mouse_sync_with_ping = mouse_custom_secs == 0;
                    let mouse_interval_secs = if mouse_sync_with_ping {
                        interval_secs
                    } else {
                        mouse_custom_secs.clamp(30, 7200)
                    };
                    let mouse_interval_label = format_interval(mouse_interval_secs);

                    let mut is_logged_in = sc.has_cookies().await;
                    if !is_logged_in {
                        if last_settings_probe.elapsed() >= Duration::from_secs(30) {
                            last_settings_probe = Instant::now();
                            cached_settings_has = settings::load_settings_sync(&handle)
                                .map(|s| !s.cookies.is_empty())
                                .unwrap_or(false);
                            if cached_settings_has {
                                let _ = sc.ensure_initialized(&handle).await;
                            }
                        }
                        is_logged_in = sc.has_cookies().await || cached_settings_has;
                    }

                    if !is_logged_in {
                        was_logged_in = false;
                        last_ping_at = None;
                        pending_initial_ping = false;
                        if mouse_nudge_enabled {
                            if last_mouse_nudge_at.is_none() {
                                last_mouse_nudge_at = Some(Instant::now());
                            } else if last_mouse_nudge_at
                                .map(|t| t.elapsed() >= Duration::from_secs(mouse_interval_secs))
                                .unwrap_or(false)
                            {
                                last_mouse_nudge_at = Some(Instant::now());
                                if let Ok(res) = tokio::task::spawn_blocking(|| {
                                    keep_alive::nudge_mouse_keep_alive(false, 5)
                                })
                                .await
                                {
                                    sidecar::emit_app_log(
                                        &handle,
                                        format!(
                                            "🖱️ [离线防休眠] {}（每 {mouse_interval_label}）",
                                            res.detail
                                        ),
                                    );
                                }
                            }
                        } else {
                            last_mouse_nudge_at = None;
                        }
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }

                    if !was_logged_in {
                        was_logged_in = true;
                        pending_initial_ping = true;
                        last_ping_at = None;
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        continue;
                    }

                    if mouse_nudge_enabled && !mouse_sync_with_ping {
                        if last_mouse_nudge_at.is_none() {
                            last_mouse_nudge_at = Some(Instant::now());
                        } else if last_mouse_nudge_at
                            .map(|t| t.elapsed() >= Duration::from_secs(mouse_interval_secs))
                            .unwrap_or(false)
                        {
                            last_mouse_nudge_at = Some(Instant::now());
                            if let Ok(res) = tokio::task::spawn_blocking(|| {
                                keep_alive::nudge_mouse_keep_alive(false, 5)
                            })
                            .await
                            {
                                sidecar::emit_app_log(
                                    &handle,
                                    format!(
                                        "🖱️ [鼠标防呆] {}（独立周期: 每 {mouse_interval_label}）",
                                        res.detail
                                    ),
                                );
                            }
                        }
                    } else if !mouse_nudge_enabled {
                        last_mouse_nudge_at = None;
                    }

                    let should_fire = if pending_initial_ping {
                        pending_initial_ping = false;
                        true
                    } else {
                        last_ping_at
                            .map(|t| t.elapsed() >= Duration::from_secs(interval_secs))
                            .unwrap_or(true)
                    };

                    if !should_fire {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }

                    last_ping_at = Some(Instant::now());
                    seq = seq.saturating_add(1);
                    let interval_label = format_interval(interval_secs);
                    sidecar::emit_app_log(
                        &handle,
                        format!(
                            "💓 [后台保活 #{seq}] 正在请求会话保活接口（当前周期: 每 {interval_label}）..."
                        ),
                    );

                    let id = format!("keepalive-{}", Uuid::new_v4());
                    match sc.call(&handle, id, "keep_alive_ping", json!({})).await {
                        Ok(res) => {
                            let res_str = res.to_string();
                            let snippet: String = res_str.chars().take(160).collect();
                            sidecar::emit_app_log(
                                &handle,
                                format!(
                                    "♻️ [后台保活 #{seq}] 会话保活成功，Cookie 保持活跃（下次保活约 {interval_label} 后，响应: {snippet}）"
                                ),
                            );
                        }
                        Err(e) => sidecar::emit_app_log(
                            &handle,
                            format!(
                                "⚠️ [后台保活 #{seq}] 保活请求异常（下次重试约 {interval_label} 后）: {e}"
                            ),
                        ),
                    }

                    if mouse_nudge_enabled && mouse_sync_with_ping {
                        last_mouse_nudge_at = Some(Instant::now());
                        if let Ok(nudge_res) = tokio::task::spawn_blocking(|| {
                            keep_alive::nudge_mouse_keep_alive(false, 5)
                        })
                        .await
                        {
                            sidecar::emit_app_log(
                                &handle,
                                format!("🖱️ [后台保活 #{seq}] {}", nudge_res.detail),
                            );
                        }
                    }

                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            });

            // 后台自动网盘备份调度：每 60 秒扫描一次到期的定时备份任务
            let backup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    backup::tick_auto_backups(backup_handle.clone()).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            settings::choose_data_root,
            settings::read_text_file,
            store::list_projects,
            store::create_project,
            store::update_project,
            store::delete_project,
            store::list_todos,
            store::upsert_todo,
            store::delete_todo,
            store::toggle_todo,
            store::toggle_subtask,
            store::increment_todo_pomodoro,
            store::batch_reschedule_todos,
            store::clear_done_todos,
            templates::list_templates,
            templates::upsert_template,
            templates::delete_template,
            templates::preview_template,
            templates::apply_template,
            tasks::tasks_sync,
            tasks::tasks_list,
            tasks::task_create,
            tasks::task_update,
            tasks::tasks_confirm_released,
            tasks::task_record_branch,
            tasks::task_read_md,
            tasks::task_write_md,
            tasks::task_get_workspace_docs,
            tasks::task_read_workspace_file,
            tasks::task_write_workspace_file,
            tasks::task_open_folder,
            tasks::task_open_md,
            tasks::open_data_root,
            life::list_habits,
            life::upsert_habit,
            life::delete_habit,
            life::toggle_habit_checkin,
            life::list_countdowns,
            life::upsert_countdown,
            life::delete_countdown,
            life::list_journals,
            life::read_journal,
            life::save_journal,
            life::open_journal_dir,
            backup::get_backup_config,
            backup::upsert_backup_task,
            backup::delete_backup_task,
            backup::clear_backup_history,
            backup::test_webdav_connection,
            backup::run_backup_task,
            backup::open_local_path,
            vault::list_notes,
            vault::upsert_note,
            vault::delete_note,
            vault::increment_note_copy,
            vault::get_finance_data,
            vault::set_monthly_budget,
            vault::upsert_transaction,
            vault::delete_transaction,
            vault::upsert_recurring_bill,
            vault::delete_recurring_bill,
            vault::record_recurring_bill_for_month,
            vault::export_finance_csv,
            vault::list_weekly_reports,
            vault::read_weekly_report,
            vault::save_weekly_report,
            vault::open_weekly_reports_dir,
            vault::get_calendar_month_info,
            vault::get_today_cn_info,
            sidecar::wt_call,
            sidecar::wt_stop,
            sidecar::wt_restart,
            login::open_login_window,
            login::close_login_window,
            login::capture_login_cookies,
            login::set_cookie_string,
            login::auto_login,
            login::whoami,
            login::logout,
            worktime::api_config::get_api_config,
            worktime::api_config::get_default_api_config,
            worktime::api_config::save_api_config,
            worktime::api_config::reset_api_config,
            worktime::api_config::probe_devops_connection,
            tencent_docs::get_tencent_docs_config,
            tencent_docs::save_tencent_docs_config,
            tencent_docs::upsert_smartsheet_webhook,
            tencent_docs::delete_smartsheet_webhook,
            tencent_docs::clear_tencent_docs_history,
            tencent_docs::test_tencent_mcp_connection,
            tencent_docs::publish_markdown_to_tencent_doc,
            tencent_docs::call_tencent_mcp_tool,
            tencent_docs::push_smartsheet_webhook,
            tencent_docs::open_external_url,
            project_fs::project_fs_list,
            project_fs::project_fs_create_task,
            project_fs::project_fs_create_folder,
            project_fs::project_fs_create_file,
            project_fs::project_fs_read_file,
            project_fs::project_fs_write_file,
            project_fs::project_fs_import_files,
            project_fs::project_fs_rename,
            project_fs::project_fs_delete,
            project_fs::project_fs_open,
            keep_alive::keep_alive_mouse_nudge,
            break_lock::enter_break_lock_window,
            break_lock::exit_break_lock_window,
            break_lock::lock_windows_workstation,
        ])
        .run(tauri::generate_context!())
        .expect("error while building LifeWork application");
}
