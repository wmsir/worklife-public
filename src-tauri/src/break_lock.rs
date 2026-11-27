use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::sidecar;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SavedWindowState {
    pub was_fullscreen: bool,
    pub was_maximized: bool,
}

#[derive(Default)]
pub struct BreakLockState(pub Mutex<Option<SavedWindowState>>);

#[cfg(target_os = "windows")]
mod win32 {
    #[link(name = "user32")]
    unsafe extern "system" {
        pub fn LockWorkStation() -> i32;
    }
}

#[tauri::command]
pub fn enter_break_lock_window(
    app: AppHandle,
    state: tauri::State<'_, BreakLockState>,
) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "休息锁屏状态锁异常".to_string())?;
        if guard.is_none() {
            let was_fullscreen = win.is_fullscreen().unwrap_or(false);
            let was_maximized = win.is_maximized().unwrap_or(false);
            *guard = Some(SavedWindowState {
                was_fullscreen,
                was_maximized,
            });
        }
    }

    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    let _ = win.set_fullscreen(true);
    let _ = win.set_focus();

    sidecar::emit_app_log(&app, "🛑 [定时休息锁屏] 已弹出全屏强制休息界面");
    Ok(())
}

#[tauri::command]
pub fn exit_break_lock_window(
    app: AppHandle,
    state: tauri::State<'_, BreakLockState>,
) -> Result<(), String> {
    let saved = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "休息锁屏状态锁异常".to_string())?;
        guard.take()
    };

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
        let was_fullscreen = saved.map(|s| s.was_fullscreen).unwrap_or(false);
        let was_maximized = saved.map(|s| s.was_maximized).unwrap_or(false);
        let _ = win.set_fullscreen(was_fullscreen);
        if was_maximized {
            let _ = win.maximize();
        }
    }

    sidecar::emit_app_log(&app, "✅ [定时休息锁屏] 已解除全屏休息界面");
    Ok(())
}

#[tauri::command]
pub fn lock_windows_workstation() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let ok = unsafe { win32::LockWorkStation() };
        if ok != 0 {
            Ok(())
        } else {
            Err("调用 Windows 系统锁屏失败".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("仅 Windows 平台支持系统一键锁屏".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_break_lock_state_lifecycle() {
        let st = BreakLockState::default();
        {
            let mut guard = st.0.lock().unwrap();
            assert!(guard.is_none());
            *guard = Some(SavedWindowState {
                was_fullscreen: false,
                was_maximized: true,
            });
        }
        {
            let mut guard = st.0.lock().unwrap();
            let taken = guard.take().unwrap();
            assert_eq!(
                taken,
                SavedWindowState {
                    was_fullscreen: false,
                    was_maximized: true
                }
            );
            assert!(guard.is_none());
        }
    }
}
