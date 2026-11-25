$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env.ps1"
Set-Location "$PSScriptRoot\.."

$projRoot = (Get-Location).Path

function Compress-GzipFile {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestPath
    )
    $inStream = [System.IO.File]::OpenRead($SourcePath)
    try {
        $outStream = [System.IO.File]::Create($DestPath)
        try {
            $gzStream = New-Object System.IO.Compression.GZipStream(
                $outStream,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            try {
                $inStream.CopyTo($gzStream)
            } finally {
                $gzStream.Dispose()
            }
        } finally {
            $outStream.Dispose()
        }
    } finally {
        $inStream.Dispose()
    }
}

Write-Host "Building LifeWork main release binary (--no-bundle)..."
npx tauri build --no-bundle
if ($LASTEXITCODE -ne 0) {
    throw "tauri build --no-bundle failed with exit code $LASTEXITCODE"
}

$releaseDir = Join-Path $projRoot "src-tauri\target\release"
$appExe = Join-Path $releaseDir "app.exe"
$wv2Dll = Join-Path $releaseDir "WebView2Loader.dll"

if (-not (Test-Path $appExe)) {
    throw "Missing built executable: $appExe"
}

$payloadDir = Join-Path $projRoot "launcher\payload"
if (Test-Path $payloadDir) {
    Remove-Item -Path $payloadDir -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null

$appSize = (Get-Item $appExe).Length
Compress-GzipFile -SourcePath $appExe -DestPath (Join-Path $payloadDir "LifeWorkApp.exe.gz")

$wv2GzPath = Join-Path $payloadDir "WebView2Loader.dll.gz"
if (Test-Path $wv2Dll) {
    $wv2Size = (Get-Item $wv2Dll).Length
    Compress-GzipFile -SourcePath $wv2Dll -DestPath $wv2GzPath
} else {
    Write-Host "WebView2Loader.dll not emitted (statically linked on MSVC); embedding empty placeholder..."
    $wv2Size = 0
    [System.IO.File]::WriteAllBytes($wv2GzPath, [byte[]]@())
}

$buildId = Get-Date -Format "yyyyMMddHHmmss"
$env:LW_BUILD_ID = $buildId
$env:LW_APP_SIZE = "$appSize"
$env:LW_WV2_SIZE = "$wv2Size"

Write-Host "Building compressed single-file portable launcher (LW_BUILD_ID=$buildId)..."
cargo build --release --manifest-path (Join-Path $projRoot "launcher\Cargo.toml")
if ($LASTEXITCODE -ne 0) {
    throw "launcher cargo build --release failed with exit code $LASTEXITCODE"
}

$builtLauncher = Join-Path $projRoot "launcher\target\release\LifeWork.exe"
if (-not (Test-Path $builtLauncher)) {
    throw "Missing built launcher executable: $builtLauncher"
}

$outRoot = Join-Path $projRoot "release-portable"
New-Item -ItemType Directory -Path $outRoot -Force | Out-Null

foreach ($item in @(Get-ChildItem -Path $outRoot -Force)) {
    if ($item.Name -ne "LifeWork.exe") {
        Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

foreach ($left in @(Get-ChildItem -Path $outRoot -Force | Where-Object { $_.Name -ne "LifeWork.exe" })) {
    if (-not $left.PSIsContainer -or @(Get-ChildItem -LiteralPath $left.FullName -Recurse -File -Force).Count -gt 0) {
        throw "无法清理旧产物（包含未释放文件）：$($left.FullName)"
    }
    Write-Warning "旧版空目录正被其他程序（如文件资源管理器）占用，可稍后关闭对应窗口再手动删除：$($left.FullName)"
}

$finalExe = Join-Path $outRoot "LifeWork.exe"
try {
    Copy-Item -Path $builtLauncher -Destination $finalExe -Force
} catch {
    throw "无法覆盖 $finalExe，请先关闭正在运行的 LifeWork 后重试: $_"
}

$appMb = [Math]::Round($appSize / 1MB, 2)
$sizeBytes = (Get-Item $finalExe).Length
$sizeMb = [Math]::Round($sizeBytes / 1MB, 2)

Write-Host ""
Write-Host "Single-exe portable build ready:"
Write-Host "  App Raw  : $appMb MB ($appSize bytes)"
Write-Host "  Path     : $finalExe"
Write-Host "  Size     : $sizeMb MB ($sizeBytes bytes)"
Write-Host "  Build ID : $buildId"
