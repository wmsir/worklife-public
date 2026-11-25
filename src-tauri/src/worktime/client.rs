use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

use crate::settings::{load_settings_sync, CookieRec};
use crate::sidecar::emit_app_log;

use super::api_config::{load_api_config_sync, ApiConfig, ApiParamRules};
use super::constants::default_wechat_config;
use super::hours;

pub fn val_as_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                t.parse::<i64>()
                    .ok()
                    .or_else(|| t.parse::<f64>().ok().map(|f| f as i64))
            }
        }
        _ => None,
    }
}

pub fn val_as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                t.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

pub fn val_as_str(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}

pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    for ch in s.chars() {
        if count >= max_chars {
            out.push_str("...(已截断)");
            break;
        }
        out.push(ch);
        count += 1;
    }
    out
}

pub const MAX_CARD_CACHE: usize = 500;
pub const MAX_CARD_DETAIL_CACHE: usize = 200;
pub const MAX_WORK_DAYS_CACHE: usize = 100;
pub const MAX_MR_CACHE: usize = 300;

pub struct EngineState {
    pub ip: String,
    pub space_id: i64,
    pub api_config: ApiConfig,
    pub cookies: Vec<CookieRec>,
    pub wechat_config: Value,
    pub current_user: Option<Value>,
    pub name_to_erp: HashMap<String, String>,
    pub erp_to_name: HashMap<String, String>,
    pub card_cache: HashMap<String, i64>,
    pub card_detail_cache: HashMap<i64, Value>,
    pub work_days_cache: HashMap<i64, Vec<Value>>,
    pub mr_cache: HashMap<String, Value>,
    pub space_tags_cache: HashMap<i64, Vec<Value>>,
}

impl EngineState {
    pub fn insert_card_cache(&mut self, key: String, val: i64) {
        if !self.card_cache.contains_key(&key) && self.card_cache.len() >= MAX_CARD_CACHE {
            self.card_cache.clear();
        }
        self.card_cache.insert(key, val);
    }

    pub fn insert_card_detail_cache(&mut self, key: i64, val: Value) {
        if !self.card_detail_cache.contains_key(&key)
            && self.card_detail_cache.len() >= MAX_CARD_DETAIL_CACHE
        {
            self.card_detail_cache.clear();
        }
        self.card_detail_cache.insert(key, val);
    }

    pub fn insert_work_days_cache(&mut self, key: i64, val: Vec<Value>) {
        if !self.work_days_cache.contains_key(&key)
            && self.work_days_cache.len() >= MAX_WORK_DAYS_CACHE
        {
            self.work_days_cache.clear();
        }
        self.work_days_cache.insert(key, val);
    }

    pub fn insert_mr_cache(&mut self, key: String, val: Value) {
        if !self.mr_cache.contains_key(&key) && self.mr_cache.len() >= MAX_MR_CACHE {
            self.mr_cache.clear();
        }
        self.mr_cache.insert(key, val);
    }
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            ip: "devops.example.local".to_string(),
            space_id: 1,
            api_config: ApiConfig::default(),
            cookies: Vec::new(),
            wechat_config: default_wechat_config(),
            current_user: None,
            name_to_erp: HashMap::new(),
            erp_to_name: HashMap::new(),
            card_cache: HashMap::new(),
            card_detail_cache: HashMap::new(),
            work_days_cache: HashMap::new(),
            mr_cache: HashMap::new(),
            space_tags_cache: HashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct WorktimeEngine {
    pub http: Client,
    pub initialized: Arc<Mutex<bool>>,
    pub state: Arc<RwLock<EngineState>>,
    pub stop_flag: Arc<AtomicBool>,
}

impl Default for WorktimeEngine {
    fn default() -> Self {
        let http = Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(4)
            .build()
            .expect("build reqwest client");
        Self {
            http,
            initialized: Arc::new(Mutex::new(false)),
            state: Arc::new(RwLock::new(EngineState::default())),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl WorktimeEngine {
    #[cfg(test)]
    pub fn with_host_and_cookies(base_ip_port: &str, space_id: i64, cookies: Vec<CookieRec>) -> Self {
        let eng = Self::default();
        if let Ok(mut st) = eng.state.try_write() {
            st.ip = base_ip_port.to_string();
            st.space_id = space_id;
            st.api_config.apply_ip_string(base_ip_port);
            st.api_config.space_id = space_id;
            st.cookies = cookies;
        }
        if let Ok(mut init) = eng.initialized.try_lock() {
            *init = true;
        }
        eng
    }

    pub async fn api_config(&self) -> ApiConfig {
        self.state.read().await.api_config.clone()
    }

    pub async fn rules(&self) -> ApiParamRules {
        self.state.read().await.api_config.rules.clone()
    }

    pub async fn set_api_config(&self, mut cfg: ApiConfig) {
        cfg.merge_missing_defaults();
        let mut st = self.state.write().await;
        st.ip = cfg.settings_ip_value();
        st.space_id = cfg.space_id;
        let wx_url = cfg.endpoint_url("wechat_webservice");
        if !wx_url.trim().is_empty() {
            if let Some(obj) = st.wechat_config.as_object_mut() {
                obj.insert("url".to_string(), Value::String(wx_url));
            }
        }
        st.api_config = cfg;
        st.card_cache.clear();
        st.card_detail_cache.clear();
        st.work_days_cache.clear();
        st.mr_cache.clear();
        st.space_tags_cache.clear();
    }

    pub async fn resolve_endpoint(&self, key: &str, vars: &[(&str, &str)]) -> (Method, String) {
        let st = self.state.read().await;
        st.api_config.render_endpoint(key, vars)
    }

    pub async fn resolve_endpoint_full(
        &self,
        key: &str,
        vars: &[(&str, &str)],
        json_body: Option<&Value>,
    ) -> (Method, String, Vec<(String, String)>, Option<Value>) {
        let cfg = self.api_config().await;
        let (method, url) = cfg.render_endpoint(key, vars);
        let headers = cfg.endpoint_headers(key, vars);
        let body = json_body.map(|b| cfg.apply_body_params(key, b));
        (method, url, headers, body)
    }

    #[allow(dead_code)]
    pub async fn base_host(&self) -> String {
        self.state.read().await.api_config.base_host()
    }

    pub async fn space_id(&self) -> i64 {
        self.state.read().await.api_config.space_id
    }

    pub async fn has_cookies(&self) -> bool {
        !self.state.read().await.cookies.is_empty()
    }

    pub async fn require_logged_in(&self) -> Result<(), String> {
        if !self.has_cookies().await {
            return Err("未登录：请先登录 DevOps".to_string());
        }
        Ok(())
    }

    pub async fn ensure_initialized(&self, app: &AppHandle) -> Result<(), String> {
        let mut init_guard = self.initialized.lock().await;
        if *init_guard {
            return Ok(());
        }
        let settings = load_settings_sync(app)?;
        let api_cfg = load_api_config_sync(app).unwrap_or_default();
        self.apply_settings_and_api_config(&settings, api_cfg).await;
        *init_guard = true;
        Ok(())
    }

    async fn apply_settings_and_api_config(
        &self,
        settings: &crate::settings::Settings,
        mut api_cfg: ApiConfig,
    ) {
        api_cfg.merge_missing_defaults();
        let mut st = self.state.write().await;
        st.ip = api_cfg.settings_ip_value();
        st.space_id = api_cfg.space_id;
        st.api_config = api_cfg;
        if let Some(wc) = settings.worktime.get("wechat_config") {
            if let (Some(base_obj), Some(new_obj)) =
                (st.wechat_config.as_object_mut(), wc.as_object())
            {
                for (k, v) in new_obj {
                    base_obj.insert(k.clone(), v.clone());
                }
            }
        }
        st.cookies = settings.cookies.clone();
    }

    pub fn emit_callback(app: &AppHandle, call_id: &str, name: &str, args: Vec<Value>) {
        if call_id.is_empty() {
            return;
        }
        let _ = app.emit(
            "wt-callback",
            json!({
                "event": "callback",
                "id": call_id,
                "name": name,
                "args": args,
                "kwargs": {}
            }),
        );
    }

    fn log(app: Option<&AppHandle>, silent: bool, msg: String) {
        if !silent {
            if let Some(a) = app {
                emit_app_log(a, msg);
            }
        }
    }

    pub async fn cookie_header(&self) -> String {
        let st = self.state.read().await;
        st.cookies
            .iter()
            .filter(|c| !c.name.trim().is_empty())
            .map(|c| format!("{}={}", c.name.trim(), c.value.trim()))
            .collect::<Vec<_>>()
            .join("; ")
    }

    #[allow(dead_code, clippy::too_many_arguments)]
    pub async fn api_request(
        &self,
        app: Option<&AppHandle>,
        method: Method,
        url: &str,
        query: Option<&[(&str, String)]>,
        json_body: Option<&Value>,
        common_headers: bool,
        timeout_secs: u64,
        max_retries: usize,
        silent: bool,
    ) -> Result<(u16, String), String> {
        self.api_request_with_headers(
            app,
            method,
            url,
            query,
            json_body,
            None,
            common_headers,
            timeout_secs,
            max_retries,
            silent,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn api_request_with_headers(
        &self,
        app: Option<&AppHandle>,
        method: Method,
        url: &str,
        query: Option<&[(&str, String)]>,
        json_body: Option<&Value>,
        extra_headers: Option<&[(String, String)]>,
        common_headers: bool,
        timeout_secs: u64,
        max_retries: usize,
        silent: bool,
    ) -> Result<(u16, String), String> {
        let mut req_desc = format!("🌐 [API 请求] {} {}", method.as_str(), url);
        if let Some(q) = query {
            if !q.is_empty() {
                let q_str: Vec<String> = q.iter().map(|(k, v)| format!("{k}={v}")).collect();
                req_desc.push_str(&format!("\n   ↳ [URL 参数]: {}", q_str.join("&")));
            }
        }
        if let Some(hdrs) = extra_headers {
            if !hdrs.is_empty() {
                let h_str: Vec<String> = hdrs.iter().map(|(k, v)| format!("{k}: {v}")).collect();
                req_desc.push_str(&format!(
                    "\n   ↳ [Header 参数]: {}",
                    truncate_chars(&h_str.join("; "), 200)
                ));
            }
        }
        if let Some(body) = json_body {
            let b_str = truncate_chars(&body.to_string(), 300);
            req_desc.push_str(&format!("\n   ↳ [Body 参数]: {b_str}"));
        }
        Self::log(app, silent, req_desc);

        let cookie_hdr = self.cookie_header().await;

        for attempt in 0..=max_retries {
            if attempt > 0 {
                Self::log(
                    app,
                    silent,
                    format!("🔄 [重连重试] 正在进行第 {attempt} 次网络请求重试..."),
                );
            }
            let mut rb = self
                .http
                .request(method.clone(), url)
                .timeout(Duration::from_secs(timeout_secs));
            if !cookie_hdr.is_empty() {
                rb = rb.header("Cookie", &cookie_hdr);
            }
            if common_headers {
                rb = rb
                    .header("accept", "application/json, text/plain, */*")
                    .header("accept-language", "zh-CN,zh;q=0.9")
                    .header("content-type", "application/json;charset=utf-8");
            }
            if let Some(hdrs) = extra_headers {
                for (k, v) in hdrs {
                    rb = rb.header(k.as_str(), v.as_str());
                }
            }
            if let Some(q) = query {
                if !q.is_empty() {
                    rb = rb.query(q);
                }
            }
            if let Some(body) = json_body {
                rb = rb.json(body);
            }

            match rb.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let text = resp
                        .text()
                        .await
                        .map_err(|e| format!("读取响应体失败: {e}"))?;
                    let snippet = truncate_chars(&text, 300);
                    Self::log(
                        app,
                        silent,
                        format!("📤 [API 返回] [{status}] -> {snippet}"),
                    );
                    return Ok((status, text));
                }
                Err(e) => {
                    if (e.is_connect() || e.is_timeout() || e.is_request()) && attempt < max_retries
                    {
                        Self::log(
                            app,
                            silent,
                            format!("⚠️ [网络波动] 连接异常 ({e})，正在自动重新建立连接..."),
                        );
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    let err_msg = format!("{} {url} 请求失败: {e}", method.as_str());
                    Self::log(app, silent, format!("❌ [API 异常] {err_msg}"));
                    return Err(err_msg);
                }
            }
        }

        Err(format!("{} {url} 请求失败", method.as_str()))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn call_endpoint_raw(
        &self,
        app: Option<&AppHandle>,
        endpoint_key: &str,
        vars: &[(&str, &str)],
        query: Option<&[(&str, String)]>,
        json_body: Option<&Value>,
        common_headers: bool,
        timeout_secs: u64,
        max_retries: usize,
        silent: bool,
    ) -> Result<(u16, String), String> {
        let (method, url, extra_headers, transformed_body) =
            self.resolve_endpoint_full(endpoint_key, vars, json_body).await;
        let hdr_opt = if extra_headers.is_empty() {
            None
        } else {
            Some(extra_headers.as_slice())
        };
        self.api_request_with_headers(
            app,
            method,
            &url,
            query,
            transformed_body.as_ref(),
            hdr_opt,
            common_headers,
            timeout_secs,
            max_retries,
            silent,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn call_endpoint_json(
        &self,
        app: Option<&AppHandle>,
        endpoint_key: &str,
        vars: &[(&str, &str)],
        query: Option<&[(&str, String)]>,
        json_body: Option<&Value>,
        common_headers: bool,
        timeout_secs: u64,
    ) -> Result<(u16, Value), String> {
        let rules = self.rules().await;
        let effective_timeout = if rules.request_timeout_secs > 0 {
            let extra = timeout_secs.saturating_sub(15);
            rules.request_timeout_secs.saturating_add(extra).clamp(3, 300)
        } else {
            timeout_secs.clamp(3, 300)
        };
        let effective_retries = rules.max_retries.min(5);
        let (method, url, extra_headers, transformed_body) =
            self.resolve_endpoint_full(endpoint_key, vars, json_body).await;
        let hdr_opt = if extra_headers.is_empty() {
            None
        } else {
            Some(extra_headers.as_slice())
        };
        let (status, text) = self
            .api_request_with_headers(
                app,
                method,
                &url,
                query,
                transformed_body.as_ref(),
                hdr_opt,
                common_headers,
                effective_timeout,
                effective_retries,
                false,
            )
            .await?;
        if !(200..300).contains(&status) {
            return Err(format!(
                "HTTP 状态码 {status}: {}",
                truncate_chars(&text, 250)
            ));
        }
        if text.trim().is_empty() {
            return Ok((status, json!({ "status": status })));
        }
        match serde_json::from_str::<Value>(&text) {
            Ok(v) => Ok((status, v)),
            Err(_) => Ok((status, json!({ "status": status, "text": text }))),
        }
    }

    #[allow(dead_code, clippy::too_many_arguments)]
    pub async fn api_json_checked(
        &self,
        app: Option<&AppHandle>,
        method: Method,
        url: &str,
        query: Option<&[(&str, String)]>,
        json_body: Option<&Value>,
        common_headers: bool,
        timeout_secs: u64,
    ) -> Result<(u16, Value), String> {
        let rules = self.rules().await;
        let effective_timeout = if rules.request_timeout_secs > 0 {
            let extra = timeout_secs.saturating_sub(15);
            rules.request_timeout_secs.saturating_add(extra).clamp(3, 300)
        } else {
            timeout_secs.clamp(3, 300)
        };
        let effective_retries = rules.max_retries.min(5);
        let (status, text) = self
            .api_request(
                app,
                method,
                url,
                query,
                json_body,
                common_headers,
                effective_timeout,
                effective_retries,
                false,
            )
            .await?;
        if !(200..300).contains(&status) {
            return Err(format!(
                "HTTP 状态码 {status}: {}",
                truncate_chars(&text, 250)
            ));
        }
        if text.trim().is_empty() {
            return Ok((status, json!({ "status": status })));
        }
        match serde_json::from_str::<Value>(&text) {
            Ok(v) => Ok((status, v)),
            Err(_) => Ok((status, json!({ "status": status, "text": text }))),
        }
    }

    pub async fn reset_caches(&self) {
        let mut st = self.state.write().await;
        st.card_cache.clear();
        st.card_detail_cache.clear();
        st.work_days_cache.clear();
        st.mr_cache.clear();
    }

    pub async fn set_cookies(&self, cookies: Vec<CookieRec>) {
        let mut st = self.state.write().await;
        if cookies.is_empty() {
            st.cookies.clear();
            st.current_user = None;
        } else {
            st.cookies = cookies;
        }
    }

    pub async fn reconfigure(&self, ip: String, space_id: i64) {
        let mut st = self.state.write().await;
        st.ip = ip.trim().to_string();
        st.space_id = space_id;
        st.api_config.apply_ip_string(&ip);
        if space_id > 0 {
            st.api_config.space_id = space_id;
        }
        st.space_tags_cache.clear();
    }

    pub async fn set_wechat_config(&self, cfg: &Value) {
        let mut st = self.state.write().await;
        if let (Some(base_obj), Some(new_obj)) =
            (st.wechat_config.as_object_mut(), cfg.as_object())
        {
            for (k, v) in new_obj {
                base_obj.insert(k.clone(), v.clone());
            }
        }
    }

    pub async fn probe_cookies_user_only(&self, cookies: &[CookieRec]) -> Result<Value, String> {
        let cookie_hdr = cookies
            .iter()
            .filter(|c| !c.name.trim().is_empty())
            .map(|c| format!("{}={}", c.name.trim(), c.value.trim()))
            .collect::<Vec<_>>()
            .join("; ");
        if cookie_hdr.is_empty() {
            return Err("Cookie 为空".to_string());
        }
        let (method, url, extra_headers, _) = self.resolve_endpoint_full("user_info", &[], None).await;
        let mut rb = self
            .http
            .request(method, &url)
            .timeout(Duration::from_secs(6))
            .header("Cookie", cookie_hdr)
            .header("accept", "application/json, text/plain, */*");
        for (k, v) in extra_headers {
            rb = rb.header(k.as_str(), v.as_str());
        }
        let resp = rb
            .send()
            .await
            .map_err(|e| format!("探测会话失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("解析用户信息 JSON 失败: {e}"))?;
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        let erp = data
            .get("userErp")
            .or_else(|| data.get("erp"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if erp.is_empty() {
            return Err("尚未完成登录认证".to_string());
        }
        Ok(data)
    }

    pub async fn whoami(&self, app: Option<&AppHandle>) -> Result<Value, String> {
        self.require_logged_in().await?;
        let user = hours::get_current_user(self, app).await?;
        let erp = user
            .get("userErp")
            .or_else(|| user.get("erp"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if erp.is_empty() {
            return Err("会话已失效，未获取到用户信息".to_string());
        }

        // 登录或刷新身份后自动同步空间成员目录与个人交付产能基线数据
        let members = hours::get_members(self, app).await.unwrap_or_default();
        if !members.is_empty() {
            Self::log(
                app,
                false,
                format!("👥 已自动同步空间成员目录，共 {} 人", members.len()),
            );
        }

        let cap_raw = hours::get_delivery_capacity(self, app)
            .await
            .unwrap_or(Value::Null);

        let cap_name = cap_raw
            .get("userName")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let resolved_name = hours::resolve_erp_to_name(self, app, &erp).await;
        let user_direct_name = user
            .get("name")
            .or_else(|| user.get("realName"))
            .or_else(|| user.get("nickName"))
            .or_else(|| user.get("userName"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let org_name = user
            .get("org")
            .and_then(|o| o.get("name"))
            .or_else(|| user.get("deptName"))
            .or_else(|| user.get("orgName"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let email = user
            .get("email")
            .or_else(|| user.get("userEmail"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();

        let real_name = cap_name
            .or_else(|| {
                if resolved_name.is_empty() {
                    None
                } else {
                    Some(resolved_name)
                }
            })
            .or(user_direct_name)
            .unwrap_or_else(|| {
                if !org_name.is_empty() {
                    org_name.clone()
                } else {
                    erp.clone()
                }
            });

        let synced_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let capacity = match cap_raw {
            Value::Object(mut obj) if !obj.is_empty() => {
                let has_uname = obj
                    .get("userName")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                if !has_uname {
                    obj.insert("userName".to_string(), Value::String(real_name.clone()));
                }
                let val_num = obj
                    .get("personalDeliveryCapacity")
                    .and_then(val_as_f64)
                    .unwrap_or(0.0);
                let std_num = obj
                    .get("personalDeliveryCapacityStandard")
                    .and_then(val_as_f64)
                    .unwrap_or(0.0);
                let qualified = obj
                    .get("isQualified")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Self::log(
                    app,
                    false,
                    format!(
                        "📊 已自动同步个人交付产能：{real_name} · 产能 {:.4} / 基准 {:.2} ({})",
                        val_num,
                        std_num,
                        if qualified { "已达标" } else { "未达标" }
                    ),
                );
                Value::Object(obj)
            }
            _ => Value::Null,
        };

        {
            let mut st = self.state.write().await;
            st.current_user = Some(user.clone());
        }
        Ok(json!({
            "user": user,
            "realName": real_name,
            "orgName": org_name,
            "erp": erp,
            "email": email,
            "memberCount": members.len(),
            "syncedAt": synced_at,
            "capacity": capacity,
        }))
    }

    pub async fn stop_running(&self, app: &AppHandle) -> Result<(), String> {
        self.stop_flag.store(true, Ordering::SeqCst);
        emit_app_log(app, "⏹ 已发送中止信号给后台任务");
        Ok(())
    }

    pub async fn restart(&self, app: &AppHandle) -> Result<(), String> {
        self.stop_flag.store(false, Ordering::SeqCst);
        self.reset_caches().await;
        let settings = load_settings_sync(app)?;
        let api_cfg = load_api_config_sync(app).unwrap_or_default();
        self.apply_settings_and_api_config(&settings, api_cfg).await;
        *self.initialized.lock().await = true;
        Ok(())
    }

    pub fn clear_stop(&self) {
        self.stop_flag.store(false, Ordering::SeqCst);
    }

    pub fn is_stopped(&self) -> bool {
        self.stop_flag.load(Ordering::SeqCst)
    }

    pub async fn call(
        &self,
        app: &AppHandle,
        id: String,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_initialized(app).await?;
        super::dispatch(self, Some(app), &id, method, params).await
    }
}
