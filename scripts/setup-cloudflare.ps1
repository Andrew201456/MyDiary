# MyDiary Cloudflare one-time setup (Windows PowerShell).
# Requires Node.js, a Cloudflare account and permission to create Workers/D1.
# NEVER paste passwords, signup secrets or private FPC data into GitHub.
$ErrorActionPreference="Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "MyDiary Cloudflare setup"
if (-not (Test-Path "package.json")) { throw "Open this script from the MyDiary repo." }
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
npx wrangler login
if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed." }
Write-Host "Creating D1 mydiary-db (or supply existing UUID if already created)..."
$output = (& npx wrangler d1 create mydiary-db 2>&1 | Out-String)
$uuidPattern='(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
$found=[regex]::Match($output,$uuidPattern)
if ($found.Success) {
  $databaseId=$found.Value
} else {
  Write-Host "Cloudflare did not return a new D1 ID. This is normal if the DB already exists."
  $databaseId=(Read-Host "Paste the existing mydiary-db database_id UUID").Trim()
}
if ($databaseId -notmatch "^$uuidPattern$") { throw "Invalid D1 database UUID." }
$configPath=Join-Path (Get-Location) "wrangler.jsonc"
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$config.d1_databases[0].database_id=$databaseId
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Configured D1 binding DB for database $databaseId"
Write-Host "Creating D1 schema..."
npx wrangler d1 execute mydiary-db --remote --file=./schema.sql
if ($LASTEXITCODE -ne 0) { throw "D1 schema apply failed. Do not deploy until fixed." }
Write-Host "Next, enter a new random signup secret (minimum 12 characters)."
Write-Host "The value is stored as a Cloudflare Secret, NOT in GitHub."
npx wrangler secret put MYDIARY_SIGNUP_CODE
if ($LASTEXITCODE -ne 0) { throw "Cloudflare secret setup failed." }
Write-Host "Publishing Worker..."
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Deployment failed. Review the error above." }
Write-Host "Deployment command completed. Check /api/health and perform a real login before importing FPC."
Write-Host "IMPORTANT: Commit ONLY the wrangler.jsonc database_id (not any secret) if you use GitHub auto-deploy."
