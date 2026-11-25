$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env.ps1"
Set-Location "$PSScriptRoot\.."
npx tauri build
