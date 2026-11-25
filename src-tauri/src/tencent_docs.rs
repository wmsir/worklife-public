use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::settings::data_root_dir;
use crate::sidecar::emit_app_log;
use crate::store::{atomic_write_json_unlocked, meta_dir, now_iso, FILE_LOCK};

pub const DEFAULT_MCP_URL: &str = "https://docs.qq.com/openapi/mcp";
pub const MAX_HISTORY_LEN: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookFieldMapping {
    pub field_key: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub source_key: String,
    #[serde(default = "default_value_type")]
    pub value_type: String, // "text_rich" | "text" | "number" | "checkbox" | "date"
    #[serde(default)]
    pub default_value: String,
}

fn default_value_type() -> String {
    "text_rich".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetWebhookProfile {
    pub id: String,
    pub name: String,
    pub webhook_url: String,
    #[serde(default)]
    pub share_url: String,
    #[serde(default = "default_payload_mode")]
    pub payload_mode: String, // "add_records" | "fields" | "raw_object"
    #[serde(default)]
    pub fields: Vec<WebhookFieldMapping>,
    #[serde(default)]
    pub created_at: String,
}

fn default_payload_mode() -> String {
    "add_records".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TencentDocPublishRecord {
    pub id: String,
    pub kind: String, // "mcp_doc" | "mcp_tool" | "smartsheet_webhook"
    pub title: String,
    #[serde(default)]
    pub source_label: String,
    #[serde(default)]
    pub doc_url: String,
    #[serde(default)]
    pub file_id: String,
    pub status: String, // "success" | "failed"
    #[serde(default)]
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TencentDocsConfig {
    #[serde(default = "default_mcp_url")]
    pub mcp_url: String,
    #[serde(default)]
    pub mcp_token: String,
    #[serde(default)]
    pub default_parent_id: String,
    #[serde(default = "default_preferred_doc_tool")]
    pub preferred_doc_tool: String,
    #[serde(default = "default_doc_title_arg")]
    pub doc_title_arg: String,
    #[serde(default = "default_doc_content_arg")]
    pub doc_content_arg: String,
    #[serde(default = "default_doc_parent_arg")]
    pub doc_parent_arg: String,
    #[serde(default = "default_timeout_secs")]
    pub request_timeout_secs: u64,
    #[serde(default)]
    pub webhooks: Vec<SmartsheetWebhookProfile>,
    #[serde(default)]
    pub history: Vec<TencentDocPublishRecord>,
}

fn default_mcp_url() -> String {
    DEFAULT_MCP_URL.to_string()
}
fn default_preferred_doc_tool() -> String {
    "create_smartcanvas_by_markdown".to_string()
}
fn default_doc_title_arg() -> String {
    "title".to_string()
}
fn default_doc_content_arg() -> String {
    "markdown".to_string()
}
fn default_doc_parent_arg() -> String {
    "parent_id".to_string()
}
fn default_timeout_secs() -> u64 {
    30
}

impl Default for TencentDocsConfig {
    fn default() -> Self {
        Self {
            mcp_url: default_mcp_url(),
            mcp_token: String::new(),
            default_parent_id: String::new(),
            preferred_doc_tool: default_preferred_doc_tool(),
            doc_title_arg: default_doc_title_arg(),
            doc_content_arg: default_doc_content_arg(),
            doc_parent_arg: default_doc_parent_arg(),
            request_timeout_secs: default_timeout_secs(),
            webhooks: Vec::new(),
            history: Vec::new(),
        }
    }
}

impl TencentDocsConfig {
    pub fn normalize(&mut self) {
        if self.mcp_url.trim().is_empty() {
            self.mcp_url = default_mcp_url();
        } else {
            self.mcp_url = self.mcp_url.trim().to_string();
        }
        self.mcp_token = self.mcp_token.trim().to_string();
        self.default_parent_id = self.default_parent_id.trim().to_string();
        if self.preferred_doc_tool.trim().is_empty() {
            self.preferred_doc_tool = default_preferred_doc_tool();
        } else {
            self.preferred_doc_tool = self.preferred_doc_tool.trim().to_string();
        }
        if self.doc_title_arg.trim().is_empty() {
            self.doc_title_arg = default_doc_title_arg();
        } else {
            self.doc_title_arg = self.doc_title_arg.trim().to_string();
        }
        if self.doc_content_arg.trim().is_empty() {
            self.doc_content_arg = default_doc_content_arg();
        } else {
            self.doc_content_arg = self.doc_content_arg.trim().to_string();
        }
        if self.doc_parent_arg.trim().is_empty() {
            self.doc_parent_arg = default_doc_parent_arg();
        } else {
            self.doc_parent_arg = self.doc_parent_arg.trim().to_string();
        }
        if self.request_timeout_secs < 5 {
            self.request_timeout_secs = 5;
        } else if self.request_timeout_secs > 180 {
            self.request_timeout_secs = 180;
        }
        if self.history.len() > MAX_HISTORY_LEN {
            self.history.truncate(MAX_HISTORY_LEN);
        }
    }

    pub fn push_history(&mut self, rec: TencentDocPublishRecord) {
        self.history.insert(0, rec);
        if self.history.len() > MAX_HISTORY_LEN {
            self.history.truncate(MAX_HISTORY_LEN);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub server_name: String,
    pub session_id: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub record: TencentDocPublishRecord,
    pub raw_result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPushResult {
    pub record: TencentDocPublishRecord,
    pub pushed_rows: usize,
    pub raw_responses: Vec<Value>,
}

pub fn tencent_docs_path(root: &Path) -> PathBuf {
    meta_dir(root).join("tencent_docs.json")
}

pub fn load_config_from_root(root: &Path) -> Result<TencentDocsConfig, String> {
    let path = tencent_docs_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    if !path.exists() {
        let def = TencentDocsConfig::default();
        atomic_write_json_unlocked(&path, &def)?;
        return Ok(def);
    }
    let raw =
        std::fs::read_to_string(&path).map_err(|e| format!("读取腾讯文档配置失败: {e}"))?;
    let mut cfg: TencentDocsConfig =
        serde_json::from_str(&raw).map_err(|e| format!("解析腾讯文档配置失败: {e}"))?;
    cfg.normalize();
    Ok(cfg)
}

pub fn save_config_to_root(
    root: &Path,
    mut cfg: TencentDocsConfig,
) -> Result<TencentDocsConfig, String> {
    let path = tencent_docs_path(root);
    cfg.normalize();
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    atomic_write_json_unlocked(&path, &cfg)?;
    Ok(cfg)
}

pub fn append_history_to_root(
    root: &Path,
    rec: TencentDocPublishRecord,
) -> Result<TencentDocsConfig, String> {
    let path = tencent_docs_path(root);
    let _guard = FILE_LOCK.lock().map_err(|e| format!("文件锁异常: {e}"))?;
    let mut cfg = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取腾讯文档配置失败: {e}"))?;
        serde_json::from_str::<TencentDocsConfig>(&raw)
            .map_err(|e| format!("解析腾讯文档配置失败: {e}"))?
    } else {
        TencentDocsConfig::default()
    };
    cfg.normalize();
    cfg.push_history(rec);
    atomic_write_json_unlocked(&path, &cfg)?;
    Ok(cfg)
}

fn load_config_sync(app: &AppHandle) -> Result<TencentDocsConfig, String> {
    let root = data_root_dir(app)?;
    load_config_from_root(&root)
}

fn save_config_sync(
    app: &AppHandle,
    cfg: TencentDocsConfig,
) -> Result<TencentDocsConfig, String> {
    let root = data_root_dir(app)?;
    save_config_to_root(&root, cfg)
}

fn append_history_sync(app: &AppHandle, rec: &TencentDocPublishRecord) {
    if let Ok(root) = data_root_dir(app) {
        let _ = append_history_to_root(&root, rec.clone());
    }
}

const MAX_HTTP_BODY_BYTES: usize = 4 * 1024 * 1024;
static DEFAULT_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static LOCAL_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn init_shared_client(is_local: bool) -> Result<Client, String> {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(4);
    if is_local {
        builder = builder.no_proxy().danger_accept_invalid_certs(true);
    }
    builder
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))
}

fn build_http_client(target_url: &str, _timeout_secs: u64) -> Result<Client, String> {
    let is_local = reqwest::Url::parse(target_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .map(|h| h == "127.0.0.1" || h == "localhost" || h == "::1" || h == "[::1]")
        .unwrap_or(false);

    let slot = if is_local {
        &LOCAL_HTTP_CLIENT
    } else {
        &DEFAULT_HTTP_CLIENT
    };
    if let Some(c) = slot.get() {
        return Ok(c.clone());
    }
    let created = init_shared_client(is_local)?;
    let _ = slot.set(created.clone());
    Ok(slot.get().cloned().unwrap_or(created))
}

async fn read_response_text_limited(
    mut resp: reqwest::Response,
    max_bytes: usize,
) -> Result<String, String> {
    if let Some(len) = resp.content_length() {
        if len as usize > max_bytes {
            return Err(format!(
                "响应内容过大 ({len} 字节，上限 {max_bytes} 字节)，已中止读取以保护内存"
            ));
        }
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("读取响应流失败: {e}"))?
    {
        if buf.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!(
                "响应内容超过上限 ({max_bytes} 字节)，已中止读取以保护内存"
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn snippet_chars(s: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

pub fn parse_mcp_response_body(
    content_type: &str,
    body: &str,
    expected_id: Option<u64>,
) -> Result<Value, String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Ok(Value::Null);
    }

    let looks_sse = content_type.to_ascii_lowercase().contains("text/event-stream")
        || trimmed.starts_with("event:")
        || trimmed.starts_with("data:");

    if !looks_sse {
        return serde_json::from_str::<Value>(trimmed).map_err(|e| {
            format!(
                "MCP 响应 JSON 解析失败: {e}（响应: {}）",
                snippet_chars(trimmed, 240)
            )
        });
    }

    let mut frames: Vec<Value> = Vec::new();
    let mut data_lines: Vec<&str> = Vec::new();

    let flush_event = |lines: &mut Vec<&str>, out: &mut Vec<Value>| {
        if lines.is_empty() {
            return;
        }
        let joined = lines.join("\n");
        lines.clear();
        let data_trim = joined.trim();
        if data_trim.is_empty() || data_trim == "[DONE]" {
            return;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data_trim) {
            out.push(v);
        }
    };

    for raw_line in body.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            flush_event(&mut data_lines, &mut frames);
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    flush_event(&mut data_lines, &mut frames);

    if frames.is_empty() {
        return Err(format!(
            "未能从 SSE 事件流中解析出 JSON-RPC 数据（原文: {}）",
            snippet_chars(trimmed, 240)
        ));
    }

    if let Some(eid) = expected_id {
        if let Some(exact) = frames
            .iter()
            .rfind(|f| f.get("id").and_then(|v| v.as_u64()) == Some(eid))
        {
            return Ok(exact.clone());
        }
    }

    if let Some(rpc) = frames
        .iter()
        .rfind(|f| f.get("result").is_some() || f.get("error").is_some())
    {
        return Ok(rpc.clone());
    }

    Ok(frames.into_iter().last().unwrap_or(Value::Null))
}

fn format_jsonrpc_error(err: &Value) -> (Option<i64>, String) {
    let code = err.get("code").and_then(|v| v.as_i64());
    let msg = err
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| err.to_string());
    let detail = match code {
        Some(400006) => {
            format!("鉴权失败 (400006: {msg})。请检查 Token 是否过期或前往官网重新获取个人 Token。")
        }
        Some(c) => format!("MCP 错误 ({c}): {msg}"),
        None => format!("MCP 错误: {msg}"),
    };
    (code, detail)
}

async fn mcp_post_jsonrpc(
    client: &Client,
    mcp_url: &str,
    token: &str,
    session_id: Option<&str>,
    payload: &Value,
    expected_id: Option<u64>,
) -> Result<(Value, Option<String>), String> {
    let mut rb = client
        .post(mcp_url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");

    if !token.trim().is_empty() {
        rb = rb.header("Authorization", token.trim());
    }
    if let Some(sid) = session_id {
        if !sid.trim().is_empty() {
            rb = rb.header("Mcp-Session-Id", sid.trim());
        }
    }

    let resp = rb
        .json(payload)
        .send()
        .await
        .map_err(|e| format!("请求腾讯文档 MCP 服务失败 ({mcp_url}): {e}"))?;

    let status = resp.status();
    let new_sid = resp
        .headers()
        .get("mcp-session-id")
        .or_else(|| resp.headers().get("Mcp-Session-Id"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| session_id.map(|s| s.to_string()));
    let ctype = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = read_response_text_limited(resp, MAX_HTTP_BODY_BYTES).await?;

    if status.as_u16() == 202 || (expected_id.is_none() && status.is_success() && text.trim().is_empty()) {
        return Ok((Value::Null, new_sid));
    }

    if !status.is_success() {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(err) = v.get("error") {
                let (code, detail) = format_jsonrpc_error(err);
                return Err(detail.replace("MCP 错误", &format!("HTTP {} · {code:?}", status.as_u16())));
            }
        }
        let hint = if status.as_u16() == 401 || status.as_u16() == 403 {
            "（Token 无效、缺失或权限不足，请检查 Authorization Token）"
        } else {
            ""
        };
        return Err(format!(
            "MCP 服务返回 HTTP {}{hint}: {}",
            status.as_u16(),
            snippet_chars(&text, 240)
        ));
    }

    let rpc = parse_mcp_response_body(&ctype, &text, expected_id)?;
    if let Some(err) = rpc.get("error") {
        if !err.is_null() {
            let (_, detail) = format_jsonrpc_error(err);
            return Err(detail);
        }
    }

    Ok((rpc, new_sid))
}

async fn mcp_handshake_and_list_tools(
    client: &Client,
    mcp_url: &str,
    token: &str,
) -> Result<(String, Option<String>, Vec<McpToolInfo>), String> {
    let init_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "LifeWork",
                "version": "0.1.0"
            }
        }
    });

    let mut server_name = "Tencent Docs MCP".to_string();
    let mut session_id: Option<String> = None;

    match mcp_post_jsonrpc(client, mcp_url, token, None, &init_req, Some(1)).await {
        Ok((init_rpc, sid)) => {
            session_id = sid;
            if let Some(name) = init_rpc
                .pointer("/result/serverInfo/name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
            {
                server_name = name.trim().to_string();
            }
            let notif = json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            });
            let _ = mcp_post_jsonrpc(
                client,
                mcp_url,
                token,
                session_id.as_deref(),
                &notif,
                None,
            )
            .await;
        }
        Err(e) => {
            // 仅当服务端明确不支持 initialize 方法时回退直接 tools/list；鉴权/网络错误直接上抛
            if !e.contains("-32601") {
                return Err(e);
            }
        }
    }

    let list_req = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    let (list_rpc, sid2) =
        mcp_post_jsonrpc(client, mcp_url, token, session_id.as_deref(), &list_req, Some(2)).await?;
    if sid2.is_some() {
        session_id = sid2;
    }

    let raw_tools = list_rpc
        .pointer("/result/tools")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let tools: Vec<McpToolInfo> = raw_tools
        .into_iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let description = t
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = t
                .get("inputSchema")
                .or_else(|| t.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            Some(McpToolInfo {
                name,
                description,
                input_schema,
            })
        })
        .collect();

    Ok((server_name, session_id, tools))
}

fn collect_urls_and_ids(val: &Value, urls: &mut Vec<String>, ids: &mut Vec<String>, texts: &mut Vec<String>) {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                let kl = k.to_ascii_lowercase();
                if let Some(s) = v.as_str() {
                    let trimmed = s.trim();
                    if kl.contains("url") || kl == "link" || trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                            urls.push(trimmed.to_string());
                        }
                    } else if matches!(kl.as_str(), "file_id" | "fileid" | "doc_id" | "docid" | "node_id" | "nodeid" | "pad_id" | "padid") && !trimmed.is_empty() {
                        ids.push(trimmed.to_string());
                    }
                    if kl == "text" {
                        texts.push(trimmed.to_string());
                        if let Ok(nested) = serde_json::from_str::<Value>(trimmed) {
                            collect_urls_and_ids(&nested, urls, ids, texts);
                        }
                    }
                } else {
                    collect_urls_and_ids(v, urls, ids, texts);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect_urls_and_ids(item, urls, ids, texts);
            }
        }
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                urls.push(trimmed.to_string());
            } else if let Ok(nested) = serde_json::from_str::<Value>(trimmed) {
                collect_urls_and_ids(&nested, urls, ids, texts);
            }
        }
        _ => {}
    }
}

pub fn extract_doc_url_and_id(result: &Value) -> (String, String, String) {
    let mut urls = Vec::new();
    let mut ids = Vec::new();
    let mut texts = Vec::new();
    collect_urls_and_ids(result, &mut urls, &mut ids, &mut texts);

    let full_text = texts.join("\n");
    if let Ok(re) = Regex::new(r#"https?://[^\s"'<>)\]`]+"#) {
        for m in re.find_iter(&full_text) {
            let u = m.as_str().trim_end_matches(&['.', ',', ';', '。', '，'][..]);
            if !urls.iter().any(|x| x == u) {
                urls.push(u.to_string());
            }
        }
    }

    let doc_url = urls
        .iter()
        .find(|u| u.contains("docs.qq.com"))
        .or_else(|| urls.first())
        .cloned()
        .unwrap_or_default();

    let file_id = ids
        .first()
        .cloned()
        .or_else(|| {
            if !doc_url.is_empty() {
                reqwest::Url::parse(&doc_url)
                    .ok()
                    .and_then(|u| {
                        u.path_segments()
                            .and_then(|segs| segs.filter(|s| !s.is_empty()).next_back().map(str::to_string))
                    })
            } else {
                None
            }
        })
        .unwrap_or_default();

    let summary = if !full_text.trim().is_empty() {
        snippet_chars(full_text.trim(), 220)
    } else if !doc_url.is_empty() {
        format!("已生成文档：{doc_url}")
    } else {
        snippet_chars(&result.to_string(), 220)
    };

    (doc_url, file_id, summary)
}

pub fn build_typed_field_value(raw_val: &str, value_type: &str) -> Value {
    match value_type.trim() {
        "text" => Value::String(raw_val.to_string()),
        "number" => {
            let trimmed = raw_val.trim();
            if let Ok(i) = trimmed.parse::<i64>() {
                json!(i)
            } else if let Ok(f) = trimmed.parse::<f64>() {
                json!(f)
            } else {
                json!(0)
            }
        }
        "checkbox" => {
            let low = raw_val.trim().to_ascii_lowercase();
            let b = matches!(
                low.as_str(),
                "true" | "1" | "yes" | "y" | "是" | "已完成" | "已发版" | "已关闭" | "done"
            );
            json!(b)
        }
        "date" => Value::String(raw_val.trim().to_string()),
        _ => json!([{ "type": "text", "text": raw_val }]),
    }
}

fn scalar_from_row(row: &Map<String, Value>, key: &str) -> Option<String> {
    let val = row.get(key)?;
    match val {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Array(arr) => {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|it| match it {
                    Value::String(s) => Some(s.clone()),
                    Value::Number(n) => Some(n.to_string()),
                    Value::Bool(b) => Some(b.to_string()),
                    _ => None,
                })
                .collect();
            Some(parts.join(", "))
        }
        other => Some(other.to_string()),
    }
}

fn map_row_values(
    row: &Map<String, Value>,
    mappings: &[WebhookFieldMapping],
) -> Map<String, Value> {
    if mappings.is_empty() {
        return row.clone();
    }
    let mut out = Map::new();
    for m in mappings {
        let fkey = m.field_key.trim();
        if fkey.is_empty() {
            continue;
        }
        let raw = if !m.source_key.trim().is_empty() {
            scalar_from_row(row, m.source_key.trim())
                .or_else(|| scalar_from_row(row, fkey))
        } else {
            scalar_from_row(row, fkey)
        }
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| m.default_value.clone());

        out.insert(
            fkey.to_string(),
            build_typed_field_value(&raw, &m.value_type),
        );
    }
    out
}

pub async fn execute_mcp_connection_test(
    mcp_url: &str,
    token: &str,
    timeout_secs: u64,
) -> Result<McpConnectionTestResult, String> {
    if mcp_url.trim().is_empty() {
        return Err("MCP 服务地址不能为空".to_string());
    }
    let start = Instant::now();
    let client = build_http_client(mcp_url, timeout_secs)?;
    match mcp_handshake_and_list_tools(&client, mcp_url.trim(), token.trim()).await {
        Ok((server_name, session_id, tools)) => {
            let ms = start.elapsed().as_millis() as u64;
            let count = tools.len();
            Ok(McpConnectionTestResult {
                ok: true,
                latency_ms: ms,
                server_name,
                session_id,
                tools,
                message: format!("MCP 握手成功，共发现 {count} 个可用工具（耗时 {ms}ms）"),
            })
        }
        Err(e) => {
            let ms = start.elapsed().as_millis() as u64;
            Ok(McpConnectionTestResult {
                ok: false,
                latency_ms: ms,
                server_name: String::new(),
                session_id: None,
                tools: Vec::new(),
                message: e,
            })
        }
    }
}

pub async fn execute_mcp_tool_raw(
    cfg: &TencentDocsConfig,
    tool_name: &str,
    arguments: Value,
) -> Result<(Value, Option<Vec<McpToolInfo>>), String> {
    if cfg.mcp_url.trim().is_empty() {
        return Err("请先配置腾讯文档 MCP 地址".to_string());
    }
    if cfg.mcp_token.trim().is_empty() {
        return Err("请先配置腾讯文档 MCP Token（可点击页面「获取个人 Token」获取）".to_string());
    }
    let client = build_http_client(&cfg.mcp_url, cfg.request_timeout_secs)?;
    let (_, session_id, tools) =
        mcp_handshake_and_list_tools(&client, &cfg.mcp_url, &cfg.mcp_token).await?;

    let call_req = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    });

    let (call_rpc, _) = mcp_post_jsonrpc(
        &client,
        &cfg.mcp_url,
        &cfg.mcp_token,
        session_id.as_deref(),
        &call_req,
        Some(3),
    )
    .await?;

    let result = call_rpc.get("result").cloned().unwrap_or(call_rpc);
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        let (_, _, summary) = extract_doc_url_and_id(&result);
        return Err(format!("MCP 工具 [{tool_name}] 返回错误: {summary}"));
    }
    Ok((result, Some(tools)))
}

pub async fn execute_publish_markdown_with_cfg(
    cfg: &TencentDocsConfig,
    title: &str,
    markdown: &str,
    parent_id: Option<&str>,
    tool_name_override: Option<&str>,
    source_label: &str,
) -> (TencentDocPublishRecord, Result<Value, String>) {
    let tool_name = tool_name_override
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.preferred_doc_tool.trim());
    let eff_title = if title.trim().is_empty() {
        "LifeWork 同步文档"
    } else {
        title.trim()
    };
    let eff_parent = parent_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.default_parent_id.trim());

    if cfg.mcp_token.trim().is_empty() {
        let msg = "尚未配置腾讯文档 MCP 个人 Token，请先前往「腾讯文档」配置页填写并保存 Token。"
            .to_string();
        let rec = TencentDocPublishRecord {
            id: Uuid::new_v4().to_string(),
            kind: "mcp_doc".to_string(),
            title: eff_title.to_string(),
            source_label: source_label.to_string(),
            doc_url: String::new(),
            file_id: String::new(),
            status: "failed".to_string(),
            message: msg.clone(),
            created_at: now_iso(),
        };
        return (rec, Err(msg));
    }

    let client = match build_http_client(&cfg.mcp_url, cfg.request_timeout_secs) {
        Ok(c) => c,
        Err(e) => {
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "mcp_doc".to_string(),
                title: eff_title.to_string(),
                source_label: source_label.to_string(),
                doc_url: String::new(),
                file_id: String::new(),
                status: "failed".to_string(),
                message: e.clone(),
                created_at: now_iso(),
            };
            return (rec, Err(e));
        }
    };

    let (session_id, tools) =
        match mcp_handshake_and_list_tools(&client, &cfg.mcp_url, &cfg.mcp_token).await {
            Ok((_, sid, list)) => (sid, list),
            Err(e) => {
                let rec = TencentDocPublishRecord {
                    id: Uuid::new_v4().to_string(),
                    kind: "mcp_doc".to_string(),
                    title: eff_title.to_string(),
                    source_label: source_label.to_string(),
                    doc_url: String::new(),
                    file_id: String::new(),
                    status: "failed".to_string(),
                    message: e.clone(),
                    created_at: now_iso(),
                };
                return (rec, Err(e));
            }
        };

    // 根据实际工具 inputSchema 自动适配参数键名（兼容 markdown / content）
    let matched_tool = tools.iter().find(|t| t.name == tool_name);
    let schema_props = matched_tool
        .and_then(|t| t.input_schema.get("properties"))
        .and_then(|p| p.as_object());

    let title_key = if let Some(props) = schema_props {
        if props.contains_key(&cfg.doc_title_arg) {
            cfg.doc_title_arg.as_str()
        } else if props.contains_key("title") {
            "title"
        } else if props.contains_key("name") {
            "name"
        } else {
            cfg.doc_title_arg.as_str()
        }
    } else {
        cfg.doc_title_arg.as_str()
    };

    let content_key = if let Some(props) = schema_props {
        if props.contains_key(&cfg.doc_content_arg) {
            cfg.doc_content_arg.as_str()
        } else if props.contains_key("markdown") {
            "markdown"
        } else if props.contains_key("content") {
            "content"
        } else if props.contains_key("mdx") {
            "mdx"
        } else if props.contains_key("body") {
            "body"
        } else {
            cfg.doc_content_arg.as_str()
        }
    } else {
        cfg.doc_content_arg.as_str()
    };

    let parent_key = if let Some(props) = schema_props {
        if props.contains_key(&cfg.doc_parent_arg) {
            cfg.doc_parent_arg.as_str()
        } else if props.contains_key("parent_id") {
            "parent_id"
        } else if props.contains_key("folder_id") {
            "folder_id"
        } else {
            cfg.doc_parent_arg.as_str()
        }
    } else {
        cfg.doc_parent_arg.as_str()
    };

    let mut args = Map::new();
    args.insert(title_key.to_string(), Value::String(eff_title.to_string()));
    args.insert(content_key.to_string(), Value::String(markdown.to_string()));
    if !eff_parent.is_empty() {
        args.insert(
            parent_key.to_string(),
            Value::String(eff_parent.to_string()),
        );
    }

    let call_req = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": Value::Object(args)
        }
    });

    match mcp_post_jsonrpc(
        &client,
        &cfg.mcp_url,
        &cfg.mcp_token,
        session_id.as_deref(),
        &call_req,
        Some(3),
    )
    .await
    {
        Ok((call_rpc, _)) => {
            let result = call_rpc.get("result").cloned().unwrap_or(call_rpc);
            let is_err = result.get("isError").and_then(|v| v.as_bool()) == Some(true);
            let (doc_url, file_id, summary) = extract_doc_url_and_id(&result);
            if is_err {
                let err_msg = format!("MCP 创建文档失败: {summary}");
                let rec = TencentDocPublishRecord {
                    id: Uuid::new_v4().to_string(),
                    kind: "mcp_doc".to_string(),
                    title: eff_title.to_string(),
                    source_label: source_label.to_string(),
                    doc_url,
                    file_id,
                    status: "failed".to_string(),
                    message: err_msg.clone(),
                    created_at: now_iso(),
                };
                return (rec, Err(err_msg));
            }
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "mcp_doc".to_string(),
                title: eff_title.to_string(),
                source_label: source_label.to_string(),
                doc_url,
                file_id,
                status: "success".to_string(),
                message: summary,
                created_at: now_iso(),
            };
            (rec, Ok(result))
        }
        Err(e) => {
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "mcp_doc".to_string(),
                title: eff_title.to_string(),
                source_label: source_label.to_string(),
                doc_url: String::new(),
                file_id: String::new(),
                status: "failed".to_string(),
                message: e.clone(),
                created_at: now_iso(),
            };
            (rec, Err(e))
        }
    }
}

pub async fn execute_webhook_push(
    profile: &SmartsheetWebhookProfile,
    rows: &[Map<String, Value>],
    timeout_secs: u64,
    source_label: &str,
) -> Result<WebhookPushResult, String> {
    let url = profile.webhook_url.trim();
    if url.is_empty() {
        return Err(format!("智能表格模板「{}」缺少 Webhook 地址", profile.name));
    }
    if rows.is_empty() {
        return Err("没有可推送的行数据".to_string());
    }

    let client = build_http_client(url, timeout_secs)?;
    let mapped_rows: Vec<Map<String, Value>> = rows
        .iter()
        .map(|r| map_row_values(r, &profile.fields))
        .collect();

    let mut payloads: Vec<Value> = Vec::new();
    match profile.payload_mode.trim() {
        "fields" => {
            for mr in &mapped_rows {
                payloads.push(json!({ "fields": mr }));
            }
        }
        "raw_object" => {
            for mr in &mapped_rows {
                payloads.push(Value::Object(mr.clone()));
            }
        }
        _ => {
            for chunk in mapped_rows.chunks(50) {
                let records: Vec<Value> = chunk
                    .iter()
                    .map(|mr| json!({ "values": mr }))
                    .collect();
                payloads.push(json!({ "add_records": records }));
            }
        }
    }

    let mut raw_responses = Vec::new();
    for payload in &payloads {
        let resp = client
            .post(url)
            .timeout(Duration::from_secs(timeout_secs.clamp(5, 180)))
            .header("Content-Type", "application/json; charset=utf-8")
            .json(payload)
            .send()
            .await
            .map_err(|e| format!("Webhook 推送请求失败: {e}"))?;

        let status = resp.status();
        let text = read_response_text_limited(resp, MAX_HTTP_BODY_BYTES).await?;

        if !status.is_success() {
            return Err(format!(
                "Webhook HTTP {} 错误: {}",
                status.as_u16(),
                snippet_chars(&text, 240)
            ));
        }

        let val: Value = serde_json::from_str(&text)
            .unwrap_or_else(|_| json!({ "status": status.as_u16(), "text": text }));
        if let Some(errcode) = val.get("errcode").and_then(|v| v.as_i64()) {
            if errcode != 0 {
                let errmsg = val
                    .get("errmsg")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误");
                return Err(format!(
                    "智能表格写入拒绝 (errcode={errcode}, errmsg={errmsg})"
                ));
            }
        }
        raw_responses.push(val);
    }

    let rec = TencentDocPublishRecord {
        id: Uuid::new_v4().to_string(),
        kind: "smartsheet_webhook".to_string(),
        title: format!("{}（{} 条）", profile.name, rows.len()),
        source_label: source_label.to_string(),
        doc_url: profile.share_url.trim().to_string(),
        file_id: String::new(),
        status: "success".to_string(),
        message: format!("已成功写入 {} 行数据至智能表格「{}」", rows.len(), profile.name),
        created_at: now_iso(),
    };

    Ok(WebhookPushResult {
        record: rec,
        pushed_rows: rows.len(),
        raw_responses,
    })
}

#[tauri::command]
pub fn get_tencent_docs_config(app: AppHandle) -> Result<TencentDocsConfig, String> {
    load_config_sync(&app)
}

#[tauri::command]
pub fn save_tencent_docs_config(
    app: AppHandle,
    config: TencentDocsConfig,
) -> Result<TencentDocsConfig, String> {
    let saved = save_config_sync(&app, config)?;
    emit_app_log(&app, "💾 已保存腾讯文档 MCP 与智能表格配置");
    Ok(saved)
}

#[tauri::command]
pub fn upsert_smartsheet_webhook(
    app: AppHandle,
    mut profile: SmartsheetWebhookProfile,
) -> Result<TencentDocsConfig, String> {
    if profile.name.trim().is_empty() {
        return Err("模板名称不能为空".to_string());
    }
    if profile.webhook_url.trim().is_empty() {
        return Err("Webhook URL 不能为空".to_string());
    }
    profile.name = profile.name.trim().to_string();
    profile.webhook_url = profile.webhook_url.trim().to_string();
    profile.share_url = profile.share_url.trim().to_string();

    let mut cfg = load_config_sync(&app)?;
    if profile.id.trim().is_empty() {
        profile.id = Uuid::new_v4().to_string();
        profile.created_at = now_iso();
        cfg.webhooks.push(profile);
    } else if let Some(slot) = cfg.webhooks.iter_mut().find(|w| w.id == profile.id) {
        if profile.created_at.trim().is_empty() {
            profile.created_at = slot.created_at.clone();
        }
        *slot = profile;
    } else {
        if profile.created_at.trim().is_empty() {
            profile.created_at = now_iso();
        }
        cfg.webhooks.push(profile);
    }
    save_config_sync(&app, cfg)
}

#[tauri::command]
pub fn delete_smartsheet_webhook(
    app: AppHandle,
    id: String,
) -> Result<TencentDocsConfig, String> {
    let mut cfg = load_config_sync(&app)?;
    cfg.webhooks.retain(|w| w.id != id);
    save_config_sync(&app, cfg)
}

#[tauri::command]
pub fn clear_tencent_docs_history(app: AppHandle) -> Result<TencentDocsConfig, String> {
    let mut cfg = load_config_sync(&app)?;
    cfg.history.clear();
    save_config_sync(&app, cfg)
}

#[tauri::command]
pub async fn test_tencent_mcp_connection(
    app: AppHandle,
    override_url: Option<String>,
    override_token: Option<String>,
) -> Result<McpConnectionTestResult, String> {
    let cfg = load_config_sync(&app)?;
    let url = override_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.mcp_url.clone());
    let token = override_token
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| cfg.mcp_token.clone());

    if token.is_empty() {
        return Ok(McpConnectionTestResult {
            ok: false,
            latency_ms: 0,
            server_name: String::new(),
            session_id: None,
            tools: Vec::new(),
            message: "请先填写腾讯文档 MCP Token（可前往 https://docs.qq.com/open/auth/mcp.html 获取）".to_string(),
        });
    }

    let res = execute_mcp_connection_test(&url, &token, cfg.request_timeout_secs).await?;
    if res.ok {
        emit_app_log(&app, format!("✅ {}", res.message));
    } else {
        emit_app_log(&app, format!("⚠️ 腾讯文档 MCP 测试未通过: {}", res.message));
    }
    Ok(res)
}

#[tauri::command]
pub async fn publish_markdown_to_tencent_doc(
    app: AppHandle,
    title: String,
    markdown: String,
    parent_id: Option<String>,
    tool_name: Option<String>,
    source_label: Option<String>,
) -> Result<TencentDocPublishRecord, String> {
    let cfg = load_config_sync(&app)?;
    let src = source_label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Markdown");
    let (rec, res) = execute_publish_markdown_with_cfg(
        &cfg,
        &title,
        &markdown,
        parent_id.as_deref(),
        tool_name.as_deref(),
        src,
    )
    .await;
    append_history_sync(&app, &rec);
    match res {
        Ok(_) => {
            emit_app_log(
                &app,
                format!(
                    "📄 已发布到腾讯文档「{}」{}",
                    rec.title,
                    if rec.doc_url.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", rec.doc_url)
                    }
                ),
            );
            Ok(rec)
        }
        Err(e) => {
            emit_app_log(&app, format!("❌ 发布腾讯文档失败: {e}"));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn call_tencent_mcp_tool(
    app: AppHandle,
    tool_name: String,
    arguments: Value,
    source_label: Option<String>,
) -> Result<McpToolCallResult, String> {
    let cfg = load_config_sync(&app)?;
    let tname = tool_name.trim().to_string();
    if tname.is_empty() {
        return Err("MCP 工具名称不能为空".to_string());
    }
    let src = source_label
        .unwrap_or_else(|| "MCP 工具台".to_string());

    match execute_mcp_tool_raw(&cfg, &tname, arguments).await {
        Ok((raw_result, _)) => {
            let (doc_url, file_id, summary) = extract_doc_url_and_id(&raw_result);
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "mcp_tool".to_string(),
                title: tname.clone(),
                source_label: src,
                doc_url,
                file_id,
                status: "success".to_string(),
                message: summary,
                created_at: now_iso(),
            };
            append_history_sync(&app, &rec);
            emit_app_log(&app, format!("🛠️ MCP 工具 [{tname}] 执行成功"));
            Ok(McpToolCallResult {
                record: rec,
                raw_result,
            })
        }
        Err(e) => {
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "mcp_tool".to_string(),
                title: tname.clone(),
                source_label: src,
                doc_url: String::new(),
                file_id: String::new(),
                status: "failed".to_string(),
                message: e.clone(),
                created_at: now_iso(),
            };
            append_history_sync(&app, &rec);
            emit_app_log(&app, format!("❌ MCP 工具 [{tname}] 失败: {e}"));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn push_smartsheet_webhook(
    app: AppHandle,
    profile_id: String,
    rows: Vec<Map<String, Value>>,
    source_label: Option<String>,
) -> Result<WebhookPushResult, String> {
    let cfg = load_config_sync(&app)?;
    let profile = cfg
        .webhooks
        .iter()
        .find(|w| w.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的智能表格模板"))?;
    let src = source_label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("智能表格填报");

    match execute_webhook_push(&profile, &rows, cfg.request_timeout_secs, src).await {
        Ok(res) => {
            append_history_sync(&app, &res.record);
            emit_app_log(&app, format!("📊 {}", res.record.message));
            Ok(res)
        }
        Err(e) => {
            let rec = TencentDocPublishRecord {
                id: Uuid::new_v4().to_string(),
                kind: "smartsheet_webhook".to_string(),
                title: format!("{}（失败）", profile.name),
                source_label: src.to_string(),
                doc_url: profile.share_url.clone(),
                file_id: String::new(),
                status: "failed".to_string(),
                message: e.clone(),
                created_at: now_iso(),
            };
            append_history_sync(&app, &rec);
            emit_app_log(&app, format!("❌ 智能表格写入失败: {e}"));
            Err(e)
        }
    }
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("仅支持打开 http:// 或 https:// 链接".to_string());
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| format!("打开外部链接失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn test_tencent_docs_config_roundtrip_and_history_cap() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = TencentDocsConfig::default();
        cfg.mcp_token = "tok_test_123".to_string();
        cfg.webhooks.push(SmartsheetWebhookProfile {
            id: "wh1".to_string(),
            name: "研发排期".to_string(),
            webhook_url: "https://docs.qq.com/openapi/smartsheet/webhook?key=demo".to_string(),
            share_url: "https://docs.qq.com/smartsheet/demo".to_string(),
            payload_mode: "add_records".to_string(),
            fields: vec![WebhookFieldMapping {
                field_key: "fld_code".to_string(),
                label: "任务号".to_string(),
                source_key: "code".to_string(),
                value_type: "text_rich".to_string(),
                default_value: String::new(),
            }],
            created_at: "2026-11-23T01:00:00".to_string(),
        });
        save_config_to_root(dir.path(), cfg).unwrap();

        for i in 0..95 {
            append_history_to_root(
                dir.path(),
                TencentDocPublishRecord {
                    id: format!("rec-{i}"),
                    kind: "mcp_doc".to_string(),
                    title: format!("Doc {i}"),
                    source_label: "test".to_string(),
                    doc_url: format!("https://docs.qq.com/doc/D{i}"),
                    file_id: format!("D{i}"),
                    status: "success".to_string(),
                    message: "ok".to_string(),
                    created_at: "2026-11-23T01:00:00".to_string(),
                },
            )
            .unwrap();
        }

        let loaded = load_config_from_root(dir.path()).unwrap();
        assert_eq!(loaded.mcp_token, "tok_test_123");
        assert_eq!(loaded.webhooks.len(), 1);
        assert_eq!(loaded.history.len(), MAX_HISTORY_LEN);
        assert_eq!(loaded.history[0].id, "rec-94");
    }

    #[test]
    fn test_extract_doc_url_variants() {
        // 1. Structured JSON nested in MCP text content
        let v1 = json!({
            "content": [
                {
                    "type": "text",
                    "text": "{\"file_id\":\"DABCD123\",\"url\":\"https://docs.qq.com/doc/DABCD123\"}"
                }
            ]
        });
        let (u1, id1, _) = extract_doc_url_and_id(&v1);
        assert_eq!(u1, "https://docs.qq.com/doc/DABCD123");
        assert_eq!(id1, "DABCD123");

        // 2. Plain markdown link text
        let v2 = json!({
            "content": [
                {
                    "type": "text",
                    "text": "文档创建成功，在线地址：https://docs.qq.com/smartcanvas/DXYZ999 ，请点击分享。"
                }
            ]
        });
        let (u2, id2, _) = extract_doc_url_and_id(&v2);
        assert_eq!(u2, "https://docs.qq.com/smartcanvas/DXYZ999");
        assert_eq!(id2, "DXYZ999");
    }

    #[test]
    fn test_mcp_streamable_http_json_and_sse_publish() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let seen = Arc::new(Mutex::new(Vec::<(Option<String>, Option<String>, String)>::new()));
            let seen_srv = seen.clone();

            let srv = tokio::spawn(async move {
                for _ in 0..4 {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let hend = loop {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break None;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break Some(pos + 4);
                        }
                    };
                    let Some(h) = hend else { continue };
                    let hdr = String::from_utf8_lossy(&buf[..h]).to_string();
                    let mut auth = None;
                    let mut sid = None;
                    let mut clen = 0usize;
                    for line in hdr.lines() {
                        if let Some((k, v)) = line.split_once(':') {
                            if k.eq_ignore_ascii_case("authorization") {
                                auth = Some(v.trim().to_string());
                            } else if k.eq_ignore_ascii_case("mcp-session-id") {
                                sid = Some(v.trim().to_string());
                            } else if k.eq_ignore_ascii_case("content-length") {
                                clen = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    while buf.len() < h + clen {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    let body = String::from_utf8_lossy(&buf[h..h + clen]).to_string();
                    seen_srv.lock().unwrap().push((auth, sid, body.clone()));

                    if body.contains("\"initialize\"") {
                        let resp_body = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","serverInfo":{"name":"MockTencentDocs","version":"1.0"}}}"#;
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nMcp-Session-Id: sess-xyz\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            resp_body.len(),
                            resp_body
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                    } else if body.contains("notifications/initialized") {
                        let _ = sock
                            .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                            .await;
                    } else if body.contains("\"tools/list\"") {
                        // Intentionally expose `content` instead of `markdown` in inputSchema to test schema auto-adaptation
                        let resp_body = json!({
                            "jsonrpc": "2.0",
                            "id": 2,
                            "result": {
                                "tools": [
                                    {
                                        "name": "create_smartcanvas_by_markdown",
                                        "description": "Create online smartcanvas",
                                        "inputSchema": {
                                            "type": "object",
                                            "properties": {
                                                "title": { "type": "string" },
                                                "content": { "type": "string" },
                                                "parent_id": { "type": "string" }
                                            }
                                        }
                                    }
                                ]
                            }
                        })
                        .to_string();
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            resp_body.len(),
                            resp_body
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                    } else {
                        // Return SSE text/event-stream response
                        let payload = json!({
                            "jsonrpc": "2.0",
                            "id": 3,
                            "result": {
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "{\"file_id\":\"DTEST777\",\"url\":\"https://docs.qq.com/doc/DTEST777\"}"
                                    }
                                ]
                            }
                        })
                        .to_string();
                        let sse = format!("event: message\ndata: {payload}\n\n");
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            sse.len(),
                            sse
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                    }
                    let _ = sock.shutdown().await;
                }
            });

            let mut cfg = TencentDocsConfig::default();
            cfg.mcp_url = format!("http://{addr}/mcp");
            cfg.mcp_token = "Bearer user_tok_99".to_string();

            let (rec, res) = execute_publish_markdown_with_cfg(
                &cfg,
                "第47周周报",
                "# 本周总结\n- 完成腾讯文档接入",
                Some("folder_abc"),
                None,
                "工作周报",
            )
            .await;

            srv.await.unwrap();
            assert!(res.is_ok());
            assert_eq!(rec.status, "success");
            assert_eq!(rec.doc_url, "https://docs.qq.com/doc/DTEST777");
            assert_eq!(rec.file_id, "DTEST777");

            let captured = seen.lock().unwrap();
            assert_eq!(captured.len(), 4);
            assert_eq!(captured[0].0.as_deref(), Some("Bearer user_tok_99"));
            assert_eq!(captured[2].1.as_deref(), Some("sess-xyz"));
            assert_eq!(captured[3].1.as_deref(), Some("sess-xyz"));
            assert!(captured[3].2.contains("\"content\":"));
            assert!(captured[3].2.contains("\"parent_id\":\"folder_abc\""));
        });
    }

    #[test]
    fn test_smartsheet_webhook_add_records_and_fields_modes() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let bodies = Arc::new(Mutex::new(Vec::<Value>::new()));
            let bodies_srv = bodies.clone();

            let srv = tokio::spawn(async move {
                for idx in 0..3 {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = Vec::new();
                    let mut tmp = [0u8; 4096];
                    let hend = loop {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break None;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break Some(pos + 4);
                        }
                    };
                    let Some(h) = hend else { continue };
                    let hdr = String::from_utf8_lossy(&buf[..h]).to_string();
                    let mut clen = 0usize;
                    for line in hdr.lines() {
                        if let Some((k, v)) = line.split_once(':') {
                            if k.eq_ignore_ascii_case("content-length") {
                                clen = v.trim().parse().unwrap_or(0);
                            }
                        }
                    }
                    while buf.len() < h + clen {
                        let n = sock.read(&mut tmp).await.unwrap();
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    let body = String::from_utf8_lossy(&buf[h..h + clen]).to_string();
                    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    bodies_srv.lock().unwrap().push(parsed);

                    let resp_body = if idx == 2 {
                        r#"{"errcode":851003,"errmsg":"no authority"}"#
                    } else {
                        r#"{"errcode":0,"errmsg":"ok"}"#
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

            let fields = vec![
                WebhookFieldMapping {
                    field_key: "f_code".into(),
                    label: "任务号".into(),
                    source_key: "code".into(),
                    value_type: "text_rich".into(),
                    default_value: String::new(),
                },
                WebhookFieldMapping {
                    field_key: "f_title".into(),
                    label: "需求名称".into(),
                    source_key: "name".into(),
                    value_type: "text".into(),
                    default_value: String::new(),
                },
                WebhookFieldMapping {
                    field_key: "f_score".into(),
                    label: "天数".into(),
                    source_key: "days".into(),
                    value_type: "number".into(),
                    default_value: "1".into(),
                },
                WebhookFieldMapping {
                    field_key: "f_done".into(),
                    label: "是否发版".into(),
                    source_key: "status".into(),
                    value_type: "checkbox".into(),
                    default_value: "false".into(),
                },
                WebhookFieldMapping {
                    field_key: "f_date".into(),
                    label: "发版日期".into(),
                    source_key: "releaseDate".into(),
                    value_type: "date".into(),
                    default_value: String::new(),
                },
            ];

            let mut profile = SmartsheetWebhookProfile {
                id: "p1".into(),
                name: "任务发版总表".into(),
                webhook_url: format!("http://{addr}/webhook"),
                share_url: "https://docs.qq.com/smartsheet/SHARE123".into(),
                payload_mode: "add_records".into(),
                fields,
                created_at: String::new(),
            };

            let mut row = Map::new();
            row.insert("code".into(), json!("TASK-5089"));
            row.insert("name".into(), json!("核心服务改造"));
            row.insert("days".into(), json!("3.5"));
            row.insert("status".into(), json!("已发版"));
            row.insert("releaseDate".into(), json!("2026-11-23"));

            // 1. add_records mode
            let r1 = execute_webhook_push(&profile, &[row.clone()], 15, "任务台账")
                .await
                .unwrap();
            assert_eq!(r1.pushed_rows, 1);
            assert_eq!(r1.record.doc_url, "https://docs.qq.com/smartsheet/SHARE123");

            // 2. fields mode
            profile.payload_mode = "fields".into();
            let r2 = execute_webhook_push(&profile, &[row.clone()], 15, "任务台账")
                .await
                .unwrap();
            assert_eq!(r2.pushed_rows, 1);

            // 3. errcode != 0 rejection
            let r3 = execute_webhook_push(&profile, &[row], 15, "任务台账").await;
            assert!(r3.is_err());
            assert!(r3.unwrap_err().contains("851003"));

            srv.await.unwrap();
            let captured = bodies.lock().unwrap();
            assert_eq!(captured.len(), 3);
            assert_eq!(
                captured[0]["add_records"][0]["values"]["f_code"],
                json!([{ "type": "text", "text": "TASK-5089" }])
            );
            assert_eq!(captured[0]["add_records"][0]["values"]["f_title"], json!("核心服务改造"));
            assert_eq!(captured[0]["add_records"][0]["values"]["f_score"], json!(3.5));
            assert_eq!(captured[0]["add_records"][0]["values"]["f_done"], json!(true));
            assert_eq!(captured[0]["add_records"][0]["values"]["f_date"], json!("2026-11-23"));
            assert!(captured[1].get("fields").is_some());
        });
    }

    #[test]
    fn test_http_client_reuse_and_body_cap() {
        assert!(build_http_client("https://docs.qq.com/openapi/mcp", 15).is_ok());
        assert!(build_http_client("https://docs.qq.com/openapi/mcp", 30).is_ok());
        assert!(DEFAULT_HTTP_CLIENT.get().is_some());

        assert!(build_http_client("http://127.0.0.1:9999/mcp", 15).is_ok());
        assert!(LOCAL_HTTP_CLIENT.get().is_some());

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            use tokio::net::TcpListener;

            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();

            let srv = tokio::spawn(async move {
                for _ in 0..2 {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = [0u8; 512];
                    let _ = sock.read(&mut buf).await;
                    let big = "A".repeat(512);
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        big.len(),
                        big
                    );
                    sock.write_all(resp.as_bytes()).await.unwrap();
                }
            });

            let client = build_http_client(&format!("http://{addr}"), 10).unwrap();
            let resp_over = client.get(format!("http://{addr}/cap")).send().await.unwrap();
            let err = read_response_text_limited(resp_over, 128).await.unwrap_err();
            assert!(err.contains("已中止读取以保护内存"));

            let resp_ok = client.get(format!("http://{addr}/ok")).send().await.unwrap();
            let body = read_response_text_limited(resp_ok, 1024).await.unwrap();
            assert_eq!(body.len(), 512);

            srv.await.unwrap();
        });
    }
}
