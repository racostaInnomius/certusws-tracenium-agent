Write-Host "==============================="
Write-Host "   Tracenium Agent Uninstaller"
Write-Host "==============================="

$ErrorActionPreference = "Continue"

# Check admin rights
If (-NOT ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent() `
    ).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator"))
{
    Write-Host "❌ ERROR: Please run PowerShell as Administrator."
    exit 1
}

Write-Host "🔍 Stopping scheduled task (if exists)..."
$taskName = "TraceniumAgentDaily"
schtasks.exe /Delete /TN $taskName /F 2>$null

# App installation directory (default Electron MSI location)
$installPath = "C:\Program Files\Tracenium Agent"

if (Test-Path $installPath) {
    Write-Host "🗑 Removing application folder: $installPath"
    Remove-Item -Recurse -Force $installPath
} else {
    Write-Host "⚠ Not found: $installPath"
}

# Remove logs
$logPath = "$env:ProgramData\TraceniumAgent"

if (Test-Path $logPath) {
    Write-Host "🗑 Removing log folder: $logPath"
    Remove-Item -Recurse -Force $logPath
}

Write-Host "--------------------------------"
Write-Host "✅ Uninstallation completed."
Write-Host "--------------------------------"
