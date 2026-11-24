$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install it and run this script again."
    }
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Step) {
    Write-Host "`n$Step" -ForegroundColor Cyan
    & $Command @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Command '$Command $($Arguments -join ' ')' failed with exit code $code."
    }
}

Require-Command "node"
Require-Command "npm"
Require-Command "rustc"
Require-Command "cargo"

Write-Host "[1/6] Toolchain versions" -ForegroundColor Cyan
node --version
npm --version
rustc --version
cargo --version

Invoke-Checked "npm" @("--prefix", "app", "install") "[2/6] Installing frontend dependencies"
Invoke-Checked "npm" @("--prefix", "app", "run", "build") "[3/6] Building React / TypeScript / Vite"

if (-not (Test-Path (Join-Path $root "app/dist/index.html"))) {
    throw "Vite did not create app/dist/index.html."
}

Invoke-Checked "cargo" @("check", "--manifest-path", "src-tauri/Cargo.toml") "[4/6] Checking Rust / Tauri dependencies"

$tauri = Join-Path $root "app/node_modules/.bin/tauri.cmd"
if (-not (Test-Path $tauri)) {
    throw "Tauri CLI was not found at '$tauri'. npm install may have failed."
}

$buildStarted = Get-Date
Invoke-Checked $tauri @("build", "--bundles", "nsis") "[5/6] Building the Windows NSIS installer"

$installerDir = Join-Path $root "src-tauri/target/release/bundle/nsis"
$installer = Get-ChildItem $installerDir -Filter "*.exe" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $buildStarted.AddSeconds(-2) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw "Tauri build did not create a fresh NSIS installer in '$installerDir'. Existing EXE files from older builds are not accepted."
}

if ($installer.Length -lt 1MB) {
    throw "The generated installer is unexpectedly small ($($installer.Length) bytes): '$($installer.FullName)'."
}

Write-Host "[6/6] BUILD SUCCEEDED" -ForegroundColor Green
Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
Write-Host "Size: $([math]::Round($installer.Length / 1MB, 2)) MB"
