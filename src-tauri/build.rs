use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" && target_env == "gnu" {
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new_without_app_manifest(),
            ),
        )
        .expect("tauri build failed");

        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let app_manifest = manifest_dir.join("windows").join("app.manifest");
        let app_manifest_slash = app_manifest.to_string_lossy().replace('\\', "/");

        let rc_path = out_dir.join("manifest.rc");
        let rc_content = format!("1 24 \"{app_manifest_slash}\"\n");
        fs::write(&rc_path, rc_content).expect("write manifest.rc failed");

        let obj_path = out_dir.join("lifework-manifest.o");
        let status = Command::new("windres")
            .arg("-i")
            .arg(&rc_path)
            .arg("-O")
            .arg("coff")
            .arg("-o")
            .arg(&obj_path)
            .status()
            .expect("未找到 windres，请先运行 scripts/env.ps1（把 C:\\mingw64\\mingw64\\bin 加入 PATH）");
        assert!(status.success(), "windres failed with exit status: {status}");

        let obj_slash = obj_path.to_string_lossy().replace('\\', "/");
        let specs_path = out_dir.join("no-default-manifest.specs");
        let specs_content = format!(
            "*endfile:\n%{{mdaz-ftz:crtfastmath.o%s;Ofast|ffast-math|funsafe-math-optimizations:%{{!shared:%{{!mno-daz-ftz:crtfastmath.o%s}}}}}}    %{{!shared:{obj_slash}}}   %{{fvtable-verify=none:%s;     fvtable-verify=preinit:vtv_end.o%s;     fvtable-verify=std:vtv_end.o%s}}   crtend.o%s\n"
        );
        fs::write(&specs_path, specs_content).expect("write no-default-manifest.specs failed");

        let specs_slash = specs_path.to_string_lossy().replace('\\', "/");
        println!("cargo:rustc-link-arg=-specs={specs_slash}");
        println!("cargo:rerun-if-changed=windows/app.manifest");
        println!("cargo:rerun-if-changed=build.rs");
    } else {
        tauri_build::build();
    }
}
