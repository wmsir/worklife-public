use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseNudgeResult {
    pub nudged: bool,
    pub skipped_active: bool,
    pub idle_secs: u64,
    pub detail: String,
}

#[cfg(target_os = "windows")]
mod win32 {
    use std::mem::{size_of, zeroed};
    use std::time::Duration;

    pub const INPUT_MOUSE: u32 = 0;
    pub const MOUSEEVENTF_MOVE: u32 = 0x0001;
    pub const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    pub const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct MouseInput {
        pub dx: i32,
        pub dy: i32,
        pub mouse_data: u32,
        pub dw_flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct KeybdInput {
        pub w_vk: u16,
        pub w_scan: u16,
        pub dw_flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct HardwareInput {
        pub u_msg: u32,
        pub w_param_l: u16,
        pub w_param_h: u16,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub union InputUnion {
        pub mi: MouseInput,
        pub ki: KeybdInput,
        pub hi: HardwareInput,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct Input {
        pub r#type: u32,
        pub u: InputUnion,
    }

    #[repr(C)]
    pub struct LastInputInfo {
        pub cb_size: u32,
        pub dw_time: u32,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        pub fn SendInput(c_inputs: u32, p_inputs: *const Input, cb_size: i32) -> u32;
        pub fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn GetTickCount() -> u32;
        pub fn SetThreadExecutionState(es_flags: u32) -> u32;
    }

    fn make_mouse_move(dx: i32, dy: i32) -> Input {
        let mut input: Input = unsafe { zeroed() };
        input.r#type = INPUT_MOUSE;
        input.u.mi = MouseInput {
            dx,
            dy,
            mouse_data: 0,
            dw_flags: MOUSEEVENTF_MOVE,
            time: 0,
            dw_extra_info: 0,
        };
        input
    }

    fn get_idle_secs(fallback: u64) -> u64 {
        let mut lii = LastInputInfo {
            cb_size: size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        let ok = unsafe { GetLastInputInfo(&mut lii) };
        if ok == 0 {
            return fallback;
        }
        let now = unsafe { GetTickCount() };
        let idle_ms = now.wrapping_sub(lii.dw_time);
        u64::from(idle_ms / 1000)
    }

    pub fn nudge(force: bool, min_idle_secs: u64) -> super::MouseNudgeResult {
        // 阻止系统休眠与息屏
        unsafe {
            SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
        }

        let idle_secs = get_idle_secs(min_idle_secs);
        if !force && idle_secs < min_idle_secs {
            return super::MouseNudgeResult {
                nudged: false,
                skipped_active: true,
                idle_secs,
                detail: format!("检测到当前正在操作（空闲 {idle_secs}s），跳过鼠标微调"),
            };
        }

        let cb_size = size_of::<Input>() as i32;
        let move_right = make_mouse_move(1, 0);
        let move_back = make_mouse_move(-1, 0);

        let sent1 = unsafe { SendInput(1, &move_right, cb_size) };
        std::thread::sleep(Duration::from_millis(40));
        let sent2 = unsafe { SendInput(1, &move_back, cb_size) };

        if sent1 > 0 && sent2 > 0 {
            super::MouseNudgeResult {
                nudged: true,
                skipped_active: false,
                idle_secs,
                detail: format!("已微调鼠标 (±1px) 防止判定无人操作（空闲 {idle_secs}s）"),
            }
        } else {
            super::MouseNudgeResult {
                nudged: false,
                skipped_active: false,
                idle_secs,
                detail: "前景为高权限窗口无法注入鼠标事件，已通过系统电源信号保活".to_string(),
            }
        }
    }
}

pub fn nudge_mouse_keep_alive(force: bool, min_idle_secs: u64) -> MouseNudgeResult {
    #[cfg(target_os = "windows")]
    {
        win32::nudge(force, min_idle_secs)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (force, min_idle_secs);
        MouseNudgeResult {
            nudged: false,
            skipped_active: false,
            idle_secs: 0,
            detail: "非 Windows 平台跳过鼠标微调".to_string(),
        }
    }
}

#[tauri::command]
pub async fn keep_alive_mouse_nudge(force: Option<bool>) -> Result<MouseNudgeResult, String> {
    let force_flag = force.unwrap_or(true);
    tokio::task::spawn_blocking(move || nudge_mouse_keep_alive(force_flag, 5))
        .await
        .map_err(|e| format!("执行鼠标防休眠失败: {e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_win32_input_struct_layout() {
        #[cfg(all(target_os = "windows", target_pointer_width = "64"))]
        {
            assert_eq!(std::mem::size_of::<super::win32::Input>(), 40);
            assert_eq!(std::mem::size_of::<super::win32::LastInputInfo>(), 8);
        }
        #[cfg(all(target_os = "windows", target_pointer_width = "32"))]
        {
            assert_eq!(std::mem::size_of::<super::win32::Input>(), 28);
            assert_eq!(std::mem::size_of::<super::win32::LastInputInfo>(), 8);
        }
    }
}
