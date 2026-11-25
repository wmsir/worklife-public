#![windows_subsystem = "windows"]

use flate2::read::GzDecoder;
use std::ffi::{c_void, OsStr};
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

static APP_GZ: &[u8] = include_bytes!("../payload/LifeWorkApp.exe.gz");
static WV2_GZ: &[u8] = include_bytes!("../payload/WebView2Loader.dll.gz");

const BUILD_ID: &str = match option_env!("LW_BUILD_ID") {
    Some(v) => v,
    None => "dev",
};

const APP_SIZE_STR: &str = match option_env!("LW_APP_SIZE") {
    Some(v) => v,
    None => "0",
};

const WV2_SIZE_STR: &str = match option_env!("LW_WV2_SIZE") {
    Some(v) => v,
    None => "0",
};

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn show_error(msg: &str) {
    let text = to_wide(msg);
    let caption = to_wide("LifeWork");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

fn ensure_file_gz(
    dir: &Path,
    name: &str,
    gz_bytes: &[u8],
    expected_len: u64,
) -> Result<(), String> {
    let target = dir.join(name);
    if expected_len > 0 {
        if let Ok(meta) = fs::metadata(&target) {
            if meta.is_file() && meta.len() == expected_len {
                return Ok(());
            }
        }
    }

    fs::create_dir_all(dir)
        .map_err(|e| format!("无法创建运行时目录 {}: {e}", dir.display()))?;

    let tmp = dir.join(format!("{name}.tmp-{}", std::process::id()));
    let written = (|| -> io::Result<u64> {
        let mut decoder = GzDecoder::new(gz_bytes);
        let out_file = File::create(&tmp)?;
        let mut writer = BufWriter::new(out_file);
        let n = io::copy(&mut decoder, &mut writer)?;
        writer.flush()?;
        Ok(n)
    })()
    .map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("无法解压运行时文件 {}: {e}", target.display())
    })?;

    if expected_len > 0 && written != expected_len {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "解压运行时文件大小校验失败 {}: 预期 {} 字节，实际 {} 字节",
            target.display(),
            expected_len,
            written
        ));
    }

    if let Err(rename_err) = fs::rename(&tmp, &target) {
        if expected_len > 0 {
            if let Ok(meta) = fs::metadata(&target) {
                if meta.is_file() && meta.len() == expected_len {
                    let _ = fs::remove_file(&tmp);
                    return Ok(());
                }
            }
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "无法放置运行时文件 {}: {rename_err}",
            target.display()
        ));
    }

    Ok(())
}

fn run() -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("无法定位当前程序路径: {e}"))?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "无法获取当前程序所在目录".to_string())?;

    let local_base: PathBuf = std::env::var_os("LOCALAPPDATA")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);

    let base = local_base.join("LifeWork").join("runtime");
    let rt = base.join(BUILD_ID);

    let app_size = APP_SIZE_STR.parse::<u64>().unwrap_or(0);
    let wv2_size = WV2_SIZE_STR.parse::<u64>().unwrap_or(0);

    ensure_file_gz(&rt, "LifeWorkApp.exe", APP_GZ, app_size)?;
    if !WV2_GZ.is_empty() {
        ensure_file_gz(&rt, "WebView2Loader.dll", WV2_GZ, wv2_size)?;
    }

    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() && entry.file_name() != OsStr::new(BUILD_ID) {
                let _ = fs::remove_dir_all(p);
            }
        }
    }

    Command::new(rt.join("LifeWorkApp.exe"))
        .args(std::env::args_os().skip(1))
        .env("LIFEWORK_PORTABLE_DIR", exe_dir)
        .env("LIFEWORK_LAUNCHER", &exe_path)
        .current_dir(exe_dir)
        .spawn()
        .map_err(|e| format!("无法拉起主程序 ({}): {e}", rt.join("LifeWorkApp.exe").display()))?;

    Ok(())
}

fn main() {
    if let Err(e) = run() {
        show_error(&format!("LifeWork 启动失败：\n{e}"));
    }
}
