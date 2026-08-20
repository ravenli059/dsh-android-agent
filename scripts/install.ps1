# dsh-android-agent 一键安装脚本（Windows PowerShell 5.1+ / pwsh）
# 用法：在这一目录下运行  .\scripts\install.ps1   或
#       powershell -ExecutionPolicy Bypass -File scripts\install.ps1
param(
    [string]$DshProfile = 'web'
)
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgDir    = Split-Path -Parent $scriptDir

Write-Host "==> 插件目录 : $pkgDir"

$libIndex = Join-Path $pkgDir 'lib\index.js'
if (-not (Test-Path $libIndex)) {
    Write-Host '==> 未找到构建产物 lib/index.js，开始构建…'
    Push-Location $pkgDir
    try {
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build 失败（exit code ' + $LASTEXITCODE + '）' }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host '==> 已存在构建产物，跳过构建'
}

Write-Host "==> 通过 dsh plugin 安装到 profile '$DshProfile' …"
dsh plugin --profile $DshProfile add link:$pkgDir
if ($LASTEXITCODE -ne 0) { throw 'dsh plugin add 失败（exit code ' + $LASTEXITCODE + '）' }

Write-Host ''
Write-Host '✅ 命令执行完成。'
Write-Host '   下一步：重启 dsh web（或刷新 GUI），侧边栏应出现「手机」入口；'
Write-Host '   在「手机」面板添加设备（ws://手机IP:8080/ws + token）后即可连接测试。'
