# Publish MyDiary in the selected Cloudflare account and configure private registration.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

npm ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
npx wrangler login
if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed." }

# Wrangler reuses mydiary-db by name or creates it when missing.
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Deployment failed. Check Worker and D1 permissions." }

$secretList = & npx wrangler secret list --format json
if ($LASTEXITCODE -ne 0) { throw "Could not check the Worker's secrets." }
$secrets = ($secretList -join [Environment]::NewLine) | ConvertFrom-Json
if ("MYDIARY_SIGNUP_CODE" -notin @($secrets | ForEach-Object { $_.name })) {
    Write-Host "Enter a new private signup code (at least 12 characters)."
    npx wrangler secret put MYDIARY_SIGNUP_CODE
    if ($LASTEXITCODE -ne 0) { throw "Could not configure the signup code." }
}
Write-Host "Open /api/health on the deployed Worker to initialize and check MyDiary's D1 tables."
