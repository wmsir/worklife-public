use chrono::Local;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

pub type Sidecar = crate::worktime::WorktimeEngine;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WtLogPayload {
    pub line: String,
    pub ts: String,
}

pub fn emit_app_log(app: &AppHandle, line: impl Into<String>) {
    let ts = Local::now().format("%H:%M:%S").to_string();
    let _ = app.emit(
        "wt-log",
        WtLogPayload {
            line: line.into(),
            ts,
        },
    );
}

#[tauri::command]
pub async fn wt_call(
    app: AppHandle,
    call_id: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let state = app.state::<Sidecar>();
    state.call(&app, call_id, &method, params).await
}

#[tauri::command]
pub async fn wt_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Sidecar>();
    state.stop_running(&app).await
}

#[tauri::command]
pub async fn wt_restart(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Sidecar>();
    state.restart(&app).await
}
