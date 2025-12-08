Param(
  [string]$ExePath = "C:\Program Files\Tracenium Agent\Tracenium Agent.exe"
)

Write-Host "Configurando tarea programada para Tracenium Agent..."

$now = Get-Date
$runTime = $now.AddMinutes(5).ToString("HH:mm")

schtasks /Create `
  /SC DAILY `
  /TN "Tracenium Agent" `
  /TR "`"$ExePath`"" `
  /ST $runTime `
  /F

if ($LASTEXITCODE -eq 0) {
  Write-Host "✅ Tarea programada creada. Se ejecutará diariamente a las $runTime."
} else {
  Write-Warning "⚠️ No se pudo crear la tarea programada. Revisa permisos."
}
