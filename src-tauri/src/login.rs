use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use uuid::Uuid;

use crate::settings::{load_settings_sync, save_settings_sync, CookieRec};
use crate::sidecar::{emit_app_log, Sidecar};
use crate::worktime::api_config::{load_api_config_sync, probe_url, ApiConfig, ProbeResult};

static LOGIN_WATCH_GEN: AtomicU64 = AtomicU64::new(0);

const LOGIN_INIT_SCRIPT: &str = r#"
(function () {
  if (window.__lwLoginInitInstalled) return;
  window.__lwLoginInitInstalled = true;

  var noticeTimer = null;
  function showNonBlockingNotice(msg) {
    try {
      var text = String(msg || "").trim();
      if (!text) return;
      var attach = function () {
        var host = document.body || document.documentElement;
        if (!host) return;
        var el = document.getElementById("__lw_http_notice_banner");
        if (!el) {
          el = document.createElement("div");
          el.id = "__lw_http_notice_banner";
          el.style.cssText = [
            "position:fixed",
            "top:12px",
            "left:50%",
            "transform:translateX(-50%)",
            "z-index:2147483647",
            "pointer-events:none",
            "max-width:86vw",
            "padding:8px 14px",
            "border-radius:10px",
            "background:rgba(15,23,42,0.88)",
            "color:#f8fafc",
            "font:500 12px/1.4 'Microsoft YaHei',system-ui,sans-serif",
            "box-shadow:0 8px 24px rgba(15,23,42,0.22)",
            "border:1px solid rgba(148,163,184,0.3)",
            "transition:opacity 0.25s ease",
            "opacity:1"
          ].join(";");
          host.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = "1";
        if (noticeTimer) clearTimeout(noticeTimer);
        noticeTimer = setTimeout(function () {
          if (el) el.style.opacity = "0";
        }, 4800);
      };
      if (document.body || document.documentElement) {
        attach();
      } else {
        window.addEventListener("DOMContentLoaded", attach, { once: true });
      }
    } catch (_) {}
  }

  var origAlert = typeof window.alert === "function" ? window.alert.bind(window) : null;
  var origConfirm = typeof window.confirm === "function" ? window.confirm.bind(window) : null;
  var httpRe = /http|https|安全|不安全|协议|加密|证书|扫码|内网/i;

  window.alert = function (msg) {
    var s = String(msg || "");
    if (window.location && (window.location.protocol === "http:" || httpRe.test(s))) {
      showNonBlockingNotice("提示：" + (s || "当前为 HTTP 内网登录，请直接扫码/输入账号，成功后将自动关闭"));
      return;
    }
    if (origAlert) {
      try { origAlert(msg); } catch (_) {}
    }
  };

  window.confirm = function (msg) {
    var s = String(msg || "");
    if (window.location && (window.location.protocol === "http:" || httpRe.test(s))) {
      showNonBlockingNotice("提示：" + (s || "当前使用 HTTP 连接，已自动允许继续"));
      return true;
    }
    return origConfirm ? origConfirm(msg) : true;
  };

  if (window.location && window.location.protocol === "http:") {
    var triggerInitialNotice = function () {
      showNonBlockingNotice("提示：当前通过 HTTP 协议连接内网，直接扫码或输入账号登录即可，成功后将自动同步并关闭弹窗");
    };
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", triggerInitialNotice, { once: true });
    } else {
      triggerInitialNotice();
    }
  }
})();
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginWindowResult {
    pub opened: bool,
    pub is_http: bool,
    pub probe: ProbeResult,
}

fn configured_api_config(app: &AppHandle) -> ApiConfig {
    load_api_config_sync(app).unwrap_or_default()
}

fn emit_login_closed(app: &AppHandle) {
    let _ = app.emit("login-window-closed", json!({ "closed": true }));
}

fn emit_login_succeeded(app: &AppHandle, info: &Value) {
    let _ = app.emit("login-succeeded", info);
}

fn extract_window_cookies(
    win: &WebviewWindow,
    url: &tauri::Url,
    host_only: &str,
) -> Vec<CookieRec> {
    let mut cookies: Vec<CookieRec> = win
        .cookies_for_url(url.clone())
        .unwrap_or_default()
        .into_iter()
        .map(|c| CookieRec {
            name: c.name().to_string(),
            value: c.value().to_string(),
            domain: c
                .domain()
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| host_only.to_string()),
            path: c
                .path()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "/".to_string()),
        })
        .collect();

    if cookies.is_empty() {
        if let Ok(all) = win.cookies() {
            cookies = all
                .into_iter()
                .filter(|c| {
                    c.domain()
                        .map(|d| d.contains(host_only))
                        .unwrap_or(true)
                })
                .map(|c| CookieRec {
                    name: c.name().to_string(),
                    value: c.value().to_string(),
                    domain: c
                        .domain()
                        .map(|d| d.trim().to_string())
                        .filter(|d| !d.is_empty())
                        .unwrap_or_else(|| host_only.to_string()),
                    path: c
                        .path()
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty())
                        .unwrap_or_else(|| "/".to_string()),
                })
                .collect();
        }
    }
    cookies
}

fn cookies_fingerprint(cookies: &[CookieRec]) -> String {
    let mut pairs: Vec<String> = cookies
        .iter()
        .filter(|c| !c.name.trim().is_empty())
        .map(|c| format!("{}={}", c.name.trim(), c.value.trim()))
        .collect();
    pairs.sort();
    pairs.join(";")
}

async fn apply_cookies_and_whoami(
    app: &AppHandle,
    cookies: Vec<CookieRec>,
) -> Result<Value, String> {
    let state = app.state::<Sidecar>();
    state
        .call(
            app,
            format!("setck-{}", Uuid::new_v4()),
            "__set_cookies",
            json!({ "cookies": cookies }),
        )
        .await?;

    let info = state
        .call(
            app,
            format!("whoami-{}", Uuid::new_v4()),
            "__whoami",
            json!({}),
        )
        .await?;

    let mut cfg = load_settings_sync(app)?;
    cfg.cookies = cookies;
    cfg.last_user = Some(info.clone());
    save_settings_sync(app, &cfg)?;

    let real_name = info
        .get("realName")
        .and_then(|v| v.as_str())
        .unwrap_or("已登录");
    let org_name = info
        .get("orgName")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if org_name.is_empty() {
        emit_app_log(app, format!("✅ DevOps 登录成功：{real_name}"));
    } else {
        emit_app_log(app, format!("✅ DevOps 登录成功：{real_name}（{org_name}）"));
    }
    emit_login_succeeded(app, &info);
    Ok(info)
}

fn spawn_login_watcher(app: AppHandle, url: tauri::Url, host_only: String, watch_id: u64) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Sidecar>();
        let _ = state.ensure_initialized(&app).await;
        let mut last_failed_fp = String::new();

        for _ in 0..250 {
            tokio::time::sleep(Duration::from_millis(1200)).await;
            if LOGIN_WATCH_GEN.load(Ordering::SeqCst) != watch_id {
                break;
            }
            let Some(win) = app.get_webview_window("login") else {
                break;
            };
            let cookies = extract_window_cookies(&win, &url, &host_only);
            if cookies.is_empty() {
                continue;
            }
            let fp = cookies_fingerprint(&cookies);
            if fp.is_empty() || fp == last_failed_fp {
                continue;
            }

            if state.probe_cookies_user_only(&cookies).await.is_ok() {
                if LOGIN_WATCH_GEN
                    .compare_exchange(
                        watch_id,
                        watch_id.wrapping_add(1),
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    )
                    .is_err()
                {
                    break;
                }
                match apply_cookies_and_whoami(&app, cookies).await {
                    Ok(_) => {
                        let _ = win.close();
                        emit_login_closed(&app);
                        emit_app_log(
                            &app,
                            "🚪 扫码/网页登录成功，已自动同步个人基础数据与交付产能并关闭登录弹窗",
                        );
                    }
                    Err(e) => {
                        emit_app_log(&app, format!("⚠️ 自动同步登录信息失败：{e}"));
                    }
                }
                break;
            } else {
                last_failed_fp = fp;
            }
        }
    });
}

#[tauri::command]
pub async fn open_login_window(
    app: AppHandle,
    force: Option<bool>,
) -> Result<LoginWindowResult, String> {
    let api_cfg = configured_api_config(&app);
    let url_str = api_cfg.login_url();
    let is_http = url_str.to_ascii_lowercase().starts_with("http://");
    let host_only = api_cfg.host_only();
    let forced = force.unwrap_or(false);

    let probe = if !forced {
        let res = probe_url(&url_str, api_cfg.rules.connect_check_timeout_ms).await;
        if !res.reachable {
            LOGIN_WATCH_GEN.fetch_add(1, Ordering::SeqCst);
            if let Some(stale) = app.get_webview_window("login") {
                let _ = stale.close();
            }
            emit_login_closed(&app);
            emit_app_log(
                &app,
                format!("⚠️ DevOps 内网不可达 ({url_str})：{}", res.message),
            );
            return Ok(LoginWindowResult {
                opened: false,
                is_http,
                probe: res,
            });
        }
        res
    } else {
        let port_u16 = api_cfg
            .effective_port()
            .parse::<u16>()
            .unwrap_or(if api_cfg.normalized_scheme() == "https" {
                443
            } else {
                80
            });
        ProbeResult {
            reachable: true,
            url: url_str.clone(),
            host: host_only.clone(),
            port: port_u16,
            status_code: None,
            latency_ms: 0,
            reason_kind: "forced".to_string(),
            message: "已跳过连通检测，强制打开网页窗口".to_string(),
        }
    };

    let url: tauri::Url = url_str
        .parse()
        .map_err(|e| format!("无效登录 URL {url_str}: {e}"))?;
    let title = format!(
        "登录 DevOps（{}，扫码/账号登录成功后将自动同步并关闭窗口）",
        api_cfg.base_host()
    );

    let watch_gen = LOGIN_WATCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    if let Some(win) = app.get_webview_window("login") {
        let _ = win.set_title(&title);
        let _ = win.navigate(url.clone());
        let _ = win.show();
        let _ = win.set_focus();
        spawn_login_watcher(app.clone(), url, host_only, watch_gen);
        emit_app_log(
            &app,
            if is_http {
                format!("🔑 已刷新 DevOps 登录窗口 (HTTP): {url_str}")
            } else {
                format!("🔑 已刷新 DevOps 登录窗口: {url_str}")
            },
        );
        return Ok(LoginWindowResult {
            opened: true,
            is_http,
            probe,
        });
    }

    let win = WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url.clone()))
        .title(&title)
        .inner_size(1100.0, 800.0)
        .initialization_script(LOGIN_INIT_SCRIPT)
        .build()
        .map_err(|e| format!("打开登录窗口失败: {e}"))?;

    let app_ev = app.clone();
    win.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            LOGIN_WATCH_GEN.fetch_add(1, Ordering::SeqCst);
            emit_login_closed(&app_ev);
        }
    });

    spawn_login_watcher(app.clone(), url, host_only, watch_gen);

    emit_app_log(
        &app,
        if is_http {
            format!("🔑 已打开 DevOps HTTP 登录窗口: {url_str}（提示：直接使用无需确认，登录后自动关闭）")
        } else {
            format!("🔑 已打开 DevOps 登录窗口: {url_str} ({})", probe.message)
        },
    );
    Ok(LoginWindowResult {
        opened: true,
        is_http,
        probe,
    })
}

#[tauri::command]
pub async fn close_login_window(app: AppHandle) -> Result<bool, String> {
    LOGIN_WATCH_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("login") {
        let _ = win.close();
        emit_login_closed(&app);
        emit_app_log(&app, "❎ 已关闭 DevOps 登录弹窗");
        Ok(true)
    } else {
        emit_login_closed(&app);
        Ok(false)
    }
}

#[tauri::command]
pub async fn capture_login_cookies(app: AppHandle) -> Result<Value, String> {
    let win = app
        .get_webview_window("login")
        .ok_or_else(|| "请先点击「扫码/网页登录」打开登录窗口".to_string())?;

    let api_cfg = configured_api_config(&app);
    let url_str = api_cfg.login_url();
    let host_only = api_cfg.host_only();
    let url: tauri::Url = url_str
        .parse()
        .map_err(|e| format!("无效 URL {url_str}: {e}"))?;

    let cookies = extract_window_cookies(&win, &url, &host_only);
    if cookies.is_empty() {
        return Err("未捕获到登录 Cookie，请确认已在打开的窗口中完成登录".to_string());
    }

    LOGIN_WATCH_GEN.fetch_add(1, Ordering::SeqCst);
    let info = apply_cookies_and_whoami(&app, cookies).await?;
    let _ = win.close();
    emit_login_closed(&app);
    Ok(info)
}

#[tauri::command]
pub async fn set_cookie_string(app: AppHandle, s: String) -> Result<Value, String> {
    let api_cfg = configured_api_config(&app);
    let host_only = api_cfg.host_only();
    let mut cookies = Vec::new();
    for part in s.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let name = k.trim().to_string();
            let value = v.trim().to_string();
            if !name.is_empty() {
                cookies.push(CookieRec {
                    name,
                    value,
                    domain: host_only.clone(),
                    path: "/".to_string(),
                });
            }
        }
    }
    if cookies.is_empty() {
        return Err("Cookie 字符串格式无效（示例：key1=val1; key2=val2）".to_string());
    }
    apply_cookies_and_whoami(&app, cookies).await
}

#[tauri::command]
pub async fn auto_login(app: AppHandle) -> Result<Value, String> {
    let api_cfg = configured_api_config(&app);
    let url_str = api_cfg.login_url();
    let host_only = api_cfg.host_only();
    let mut cookies: Vec<CookieRec> = Vec::new();

    if let Some(win) = app.get_webview_window("main") {
        if let Ok(url) = url_str.parse::<tauri::Url>() {
            if let Ok(raw) = win.cookies_for_url(url) {
                cookies = raw
                    .into_iter()
                    .map(|c| CookieRec {
                        name: c.name().to_string(),
                        value: c.value().to_string(),
                        domain: c
                            .domain()
                            .map(|d| d.trim().to_string())
                            .filter(|d| !d.is_empty())
                            .unwrap_or_else(|| host_only.clone()),
                        path: c
                            .path()
                            .map(|p| p.trim().to_string())
                            .filter(|p| !p.is_empty())
                            .unwrap_or_else(|| "/".to_string()),
                    })
                    .collect();
            }
        }
    }

    if cookies.is_empty() {
        if let Ok(cfg) = load_settings_sync(&app) {
            if !cfg.cookies.is_empty() {
                cookies = cfg.cookies;
            }
        }
    }

    if cookies.is_empty() {
        return Err(
            "未检测到已缓存的 DevOps 登录会话，请点击「网页/扫码登录」或「粘贴 Cookie」登录"
                .to_string(),
        );
    }

    apply_cookies_and_whoami(&app, cookies).await
}

#[tauri::command]
pub async fn whoami(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<Sidecar>();
    let info = state
        .call(
            &app,
            format!("whoami-{}", Uuid::new_v4()),
            "__whoami",
            json!({}),
        )
        .await?;
    if let Ok(mut cfg) = load_settings_sync(&app) {
        cfg.last_user = Some(info.clone());
        let _ = save_settings_sync(&app, &cfg);
    }
    Ok(info)
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    let mut cfg = load_settings_sync(&app)?;
    cfg.cookies.clear();
    cfg.last_user = None;
    save_settings_sync(&app, &cfg)?;

    let state = app.state::<Sidecar>();
    let _ = state
        .call(
            &app,
            format!("logout-{}", Uuid::new_v4()),
            "__set_cookies",
            json!({ "cookies": [] }),
        )
        .await;
    emit_app_log(&app, "🚪 已退出 DevOps 登录");
    Ok(())
}
