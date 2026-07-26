param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [Parameter(Mandatory = $true)][switch]$ConfirmDatabase
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmDatabase) { throw "Pass -ConfirmDatabase after confirming DATABASE_URL points to the intended restore target." }
if (-not $env:DATABASE_URL) { throw "DATABASE_URL must be set." }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw "pg_restore is required and was not found on PATH." }
$resolved = (Resolve-Path -LiteralPath $BackupFile).Path

& pg_restore --dbname=$env:DATABASE_URL --clean --if-exists --no-owner --no-privileges --exit-on-error $resolved
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE." }
Write-Output "Restore completed from: $resolved"
Write-Output "Run dashboard database migrations and readiness checks before serving traffic."

