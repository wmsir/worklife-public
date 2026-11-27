use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=LW_BUILD_ID");
    println!("cargo:rerun-if-env-changed=LW_APP_SIZE");
    println!("cargo:rerun-if-env-changed=LW_WV2_SIZE");
    println!("cargo:rerun-if-changed=payload/LifeWorkApp.exe.gz");
    println!("cargo:rerun-if-changed=payload/WebView2Loader.dll.gz");
    println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");

    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    let manifest_dir =
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));

    let icon_path = manifest_dir
        .join("..")
        .join("src-tauri")
        .join("icons")
        .join("icon.ico");

    if !icon_path.exists() {
        println!("cargo:warning=icon.ico not found, building launcher without icon");
        return;
    }

    let rc_path = out_dir.join("launcher.rc");
    let obj_path = out_dir.join("launcher_res.o");
    let res_path = out_dir.join("launcher.res");
    let icon_str = icon_path.to_string_lossy().replace('\\', "/");
    let rc_content = format!("1 ICON \"{icon_str}\"\n");
    if let Err(e) = std::fs::write(&rc_path, rc_content) {
        println!("cargo:warning=failed to write launcher.rc: {e}");
        return;
    }

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        if let Ok(out) = Command::new("rc.exe")
            .arg("/nologo")
            .arg("/fo")
            .arg(&res_path)
            .arg(&rc_path)
            .output()
        {
            if out.status.success() && res_path.exists() {
                println!("cargo:rustc-link-arg={}", res_path.to_string_lossy());
                return;
            }
            let err = String::from_utf8_lossy(&out.stderr);
            println!(
                "cargo:warning=rc.exe failed ({}): {}, trying windres",
                out.status,
                err.trim()
            );
        }
    }

    let spawn_windres = |bin: &str| {
        Command::new(bin)
            .arg(&rc_path)
            .arg("-O")
            .arg("coff")
            .arg("-o")
            .arg(&obj_path)
            .output()
    };

    let res = spawn_windres("windres")
        .or_else(|_| spawn_windres(r"C:\mingw64\mingw64\bin\windres.exe"))
        .or_else(|_| spawn_windres(r"C:\msys64\mingw64\bin\windres.exe"));

    match res {
        Ok(out) if out.status.success() && obj_path.exists() => {
            println!("cargo:rustc-link-arg={}", obj_path.to_string_lossy());
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr);
            println!("cargo:warning=windres failed ({}): {}", out.status, err.trim());
        }
        Err(e) => {
            println!("cargo:warning=unable to invoke windres: {e}");
        }
    }
}
