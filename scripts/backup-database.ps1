param(
  [Parameter(Mandatory = $false)][string]$OutputDirectory = "./backups"
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "DATABASE_URL must be set." }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump is required and was not found on PATH." }

$resolved = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolved) | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backup = Join-Path $resolved "agentpay-$stamp.dump"
$manifest = Join-Path $resolved "agentpay-$stamp.sha256"

& pg_dump --dbname=$env:DATABASE_URL --format=custom --no-owner --no-privileges --file=$backup
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backup).Hash.ToLowerInvariant()
"$hash  $([System.IO.Path]::GetFileName($backup))" | Set-Content -LiteralPath $manifest -Encoding ascii
Write-Output "Backup created: $backup"
Write-Output "Checksum: $manifest"

