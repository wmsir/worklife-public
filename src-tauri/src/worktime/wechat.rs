use regex::Regex;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;
use uuid::Uuid;

use crate::sidecar::emit_app_log;

use super::client::{val_as_str, WorktimeEngine};
use super::constants::SPACE_INDENT;
use super::hours;

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn cdata_safe(s: &str) -> String {
    s.replace("]]>", "]]]]><![CDATA[>")
}

fn cfg_str(cfg: &Value, key: &str, default: &str) -> String {
    cfg.get(key)
        .map(val_as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

pub async fn send_wechat_notice_ex(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    erp: &str,
    content: &str,
    custom_cfg: Option<&Value>,
) -> (bool, String) {
    let default_cfg = engine.state.read().await.wechat_config.clone();
    let cfg = custom_cfg.unwrap_or(&default_cfg);
    let mode = cfg_str(cfg, "mode", "webservice");
    let rules = engine.rules().await;

    let log_it = |msg: String| {
        if let Some(a) = app {
            emit_app_log(a, msg);
        }
    };

    if mode == "webhook" {
        let mut webhook_url = cfg_str(cfg, "webhook_url", "");
        if webhook_url.is_empty() {
            let msg = "企业微信群机器人 Webhook 地址未配置！".to_string();
            log_it(format!("⚠️ {msg}"));
            return (false, msg);
        }
        if !webhook_url.starts_with("http") {
            let prefix = if rules.wechat_webhook_prefix.trim().is_empty() {
                "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=".to_string()
            } else {
                rules.wechat_webhook_prefix.clone()
            };
            webhook_url = format!("{prefix}{webhook_url}");
        }
        let payload = json!({
            "msgtype": "markdown",
            "markdown": {
                "content": content
            }
        });
        match engine
            .http
            .post(&webhook_url)
            .timeout(Duration::from_secs(rules.request_timeout_secs.clamp(5, 60)))
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) => {
                let text = resp.text().await.unwrap_or_default();
                let res_json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if res_json.get("errcode").and_then(|v| v.as_i64()) == Some(0) {
                    let msg = "已成功通过企微群机器人 Webhook 发送通知！".to_string();
                    log_it(format!("📱 {msg}"));
                    (true, msg)
                } else {
                    let err = res_json
                        .get("errmsg")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&text);
                    let msg = format!("企微 Webhook 推送失败: {err}");
                    log_it(format!("⚠️ {msg}"));
                    (false, msg)
                }
            }
            Err(e) => {
                let msg = format!("企微 Webhook 推送异常: {e}");
                log_it(format!("⚠️ {msg}"));
                (false, msg)
            }
        }
    } else {
        let api_cfg = engine.api_config().await;
        let (_, ep_default_url) = api_cfg.render_endpoint("wechat_webservice", &[]);
        let extra_headers = api_cfg.endpoint_headers("wechat_webservice", &[]);
        let fallback_url = if ep_default_url.starts_with("http") {
            ep_default_url
        } else {
            String::new()
        };
        let raw_url = cfg_str(cfg, "url", &fallback_url);
        if raw_url.trim().is_empty() {
            let msg = "未配置企微 WebService 地址".to_string();
            log_it(format!("⚠️ {msg}"));
            return (false, msg);
        }
        let (wsdl_url, soap_url) = if let Some(stripped) = raw_url.strip_suffix("?wsdl") {
            (raw_url.clone(), stripped.to_string())
        } else {
            (format!("{raw_url}?wsdl"), raw_url.clone())
        };

        let sys_flag = api_cfg
            .endpoint_body_override_str("wechat_webservice", "sys_flag")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| cfg_str(cfg, "sys_flag", ""));
        let sys_id = api_cfg
            .endpoint_body_override_str("wechat_webservice", "sys_id")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| cfg_str(cfg, "sys_id", ""));
        let sys_id_pass = api_cfg
            .endpoint_body_override_str("wechat_webservice", "sys_id_pass")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| cfg_str(cfg, "sys_id_pass", ""));
        let user_type = api_cfg
            .endpoint_body_override_str("wechat_webservice", "userType")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| cfg_str(cfg, "user_type", "2"));
        let msg_type = api_cfg
            .endpoint_body_override_str("wechat_webservice", "msgType")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "markdown".to_string());

        let mut target_erp = erp.trim().to_string();
        if target_erp.is_empty() {
            target_erp = cfg_str(cfg, "target_erp", "");
        }
        if !target_erp.is_empty() {
            let resolved = hours::resolve_member_erp(engine, app, &target_erp).await;
            if !resolved.is_empty() {
                target_erp = resolved;
            }
        }
        if target_erp.is_empty() {
            let msg = "未指定接收人身份证号码/ERP！".to_string();
            log_it(format!("⚠️ 企微推送失败：{msg}"));
            return (false, msg);
        }

        log_it(format!(
            "🚀 正在调用企业微信 WebService 发送通知: 接收人=[{target_erp}], 端点=[{soap_url}]"
        ));

        let clean_content = content
            .replace('🌐', "")
            .replace('📤', "")
            .replace('✅', "")
            .replace('❌', "")
            .replace("⚠️", "");
        let msg_id = Uuid::new_v4().to_string().replace('-', "");

        let build_soap = |ns: &str| -> String {
            format!(
                r#"<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="{ns}">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:sendMarkdownMsg>
         <arg0>
            <content><![CDATA[{cdata}]]></content>
            <msgType>{msg_type}</msgType>
            <sys_flag>{sys_flag}</sys_flag>
            <sys_id>{sys_id}</sys_id>
            <sys_id_pass>{sys_id_pass}</sys_id_pass>
            <sys_message_id>{msg_id}</sys_message_id>
            <userNum>{user_num}</userNum>
            <userType>{user_type}</userType>
         </arg0>
      </ser:sendMarkdownMsg>
   </soapenv:Body>
</soapenv:Envelope>"#,
                ns = xml_escape(ns),
                cdata = cdata_safe(&clean_content),
                msg_type = xml_escape(&msg_type),
                sys_flag = xml_escape(&sys_flag),
                sys_id = xml_escape(&sys_id),
                sys_id_pass = xml_escape(&sys_id_pass),
                msg_id = xml_escape(&msg_id),
                user_num = xml_escape(&target_erp),
                user_type = xml_escape(&user_type),
            )
        };

        let default_ns = if rules.wechat_soap_namespace.trim().is_empty() {
            "http://service.wechat.wbs.com/"
        } else {
            rules.wechat_soap_namespace.trim()
        };
        let soap_xml = build_soap(default_ns);
        let raw_err_msg: String;

        let mut rb = engine
            .http
            .post(&soap_url)
            .timeout(Duration::from_secs(6))
            .header("Content-Type", "text/xml;charset=UTF-8")
            .header("SOAPAction", "\"\"");
        for (hk, hv) in &extra_headers {
            rb = rb.header(hk.as_str(), hv.as_str());
        }
        match rb
            .body(soap_xml.into_bytes())
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                if status == 200 {
                    let msg = format!("已成功将通知推送到 ERP [{target_erp}] 的企微通知！");
                    log_it(format!("📱 {msg}"));
                    return (true, msg);
                }
                let snippet: String = text.chars().take(160).collect();
                raw_err_msg = format!("HTTP {status}: {snippet}");
            }
            Err(e) => {
                raw_err_msg = e.to_string();
            }
        }

        // 若原生 SOAP 请求未成功，尝试从 WSDL 检测真实 targetNamespace 并重试一次
        log_it(format!(
            "ℹ️ 原生 SOAP 请求未直接通过 ({raw_err_msg})，正在检测 WSDL 通道重试..."
        ));
        let wsdl_err_str;
        if let Ok(wsdl_resp) = engine
            .http
            .get(&wsdl_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
        {
            let status = wsdl_resp.status().as_u16();
            let wsdl_text = wsdl_resp.text().await.unwrap_or_default();
            if status == 200 {
                if let Some(cap) = Regex::new(r#"targetNamespace=["']([^"']+)["']"#)
                    .ok()
                    .and_then(|re| re.captures(&wsdl_text))
                {
                    let detected_ns = cap[1].to_string();
                    if detected_ns != default_ns {
                        let retry_xml = build_soap(&detected_ns);
                        let mut rb2 = engine
                            .http
                            .post(&soap_url)
                            .timeout(Duration::from_secs(10))
                            .header("Content-Type", "text/xml;charset=UTF-8")
                            .header("SOAPAction", "\"\"");
                        for (hk, hv) in &extra_headers {
                            rb2 = rb2.header(hk.as_str(), hv.as_str());
                        }
                        match rb2
                            .body(retry_xml.into_bytes())
                            .send()
                            .await
                        {
                            Ok(r2) if r2.status().as_u16() == 200 => {
                                let body = r2.text().await.unwrap_or_default();
                                log_it(format!(
                                    "📱 成功发送企微通知给 [{target_erp}] (WSDL 命名空间={detected_ns})"
                                ));
                                return (true, body);
                            }
                            Ok(r2) => {
                                wsdl_err_str = format!("HTTP {}", r2.status().as_u16());
                            }
                            Err(e) => {
                                wsdl_err_str = e.to_string();
                            }
                        }
                    } else {
                        wsdl_err_str = "WSDL namespace 相同，服务端仍拒收".to_string();
                    }
                } else {
                    wsdl_err_str = "WSDL 中未解析出 targetNamespace".to_string();
                }
            } else {
                wsdl_err_str = format!("WSDL HTTP {status}");
            }
        } else {
            wsdl_err_str = "无法拉取 WSDL 描述".to_string();
        }

        let low_raw = raw_err_msg.to_lowercase();
        let low_wsdl = wsdl_err_str.to_lowercase();
        let msg = if low_raw.contains("timed out") || low_wsdl.contains("timed out") {
            format!(
                "连接超时。请确认当前电脑已接入公司内网或开启内部 VPN (目标服务: {soap_url})"
            )
        } else if low_raw.contains("connection refused") || low_wsdl.contains("connection refused")
        {
            format!("连接被拒绝。目标服务 {soap_url} 当前不可访问")
        } else {
            format!(
                "{SPACE_INDENT}企微服务端返回异常。原生: [{raw_err_msg}] | WSDL: [{wsdl_err_str}]"
            )
        };
        log_it(format!("⚠️ {msg}"));
        (false, msg)
    }
}

pub async fn send_wechat_notice(
    engine: &WorktimeEngine,
    app: Option<&AppHandle>,
    erp: &str,
    content: &str,
    custom_cfg: Option<&Value>,
) -> bool {
    send_wechat_notice_ex(engine, app, erp, content, custom_cfg)
        .await
        .0
}
