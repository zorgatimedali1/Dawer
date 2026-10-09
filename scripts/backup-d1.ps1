# Nightly D1 backup: exports the REMOTE (production) database to backups\d1\
# as a gzipped SQL dump, keeps the newest $Keep dumps.
#
# Manual run:   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-d1.ps1
# Scheduled by: "CampaignFlow D1 Backup" (daily 03:00, registered by schtasks).
param(
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $repoRoot 'backups\d1'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$sqlFile = Join-Path $backupDir "campaignflow-$stamp.sql"
$gzFile = "$sqlFile.gz"

Push-Location $repoRoot
try {
  npx wrangler d1 export campaignflow --remote -c wrangler.jsonc --output $sqlFile -y
  if ($LASTEXITCODE -ne 0) { throw "wrangler d1 export failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $sqlFile)) { throw "export produced no file at $sqlFile" }
  if ((Get-Item -LiteralPath $sqlFile).Length -eq 0) { throw "export produced an empty file" }

  $source = [System.IO.File]::OpenRead($sqlFile)
  $target = [System.IO.File]::Create($gzFile)
  try {
    $gzip = New-Object System.IO.Compression.GZipStream($target, [System.IO.Compression.CompressionLevel]::Optimal)
    try { $source.CopyTo($gzip) } finally { $gzip.Dispose() }
  } finally {
    $source.Dispose()
    $target.Dispose()
  }
  Remove-Item -LiteralPath $sqlFile -Force

  # Prune: keep the newest $Keep dumps.
  Get-ChildItem -LiteralPath $backupDir -Filter 'campaignflow-*.sql.gz' |
    Sort-Object Name -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Force

  $sizeKb = [Math]::Round((Get-Item -LiteralPath $gzFile).Length / 1kb, 1)
  $count = (Get-ChildItem -LiteralPath $backupDir -Filter 'campaignflow-*.sql.gz').Count
  Write-Output "D1 backup ok: $gzFile ($sizeKb KB, $count dumps kept)"
} finally {
  Pop-Location
}
