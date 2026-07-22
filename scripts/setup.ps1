# Clarus Heal - Windows setup script
#
# What this does:
#   1. Verifies Node.js >= 20 is installed
#   2. Installs pnpm if missing
#   3. Installs project dependencies
#   4. Creates .env from .env.example if missing, with auto-generated secrets
#   5. Builds the runtime SDK bundle
#   6. Prints next steps
#
# Usage (PowerShell):
#   .\scripts\setup.ps1
#
# If you get an execution-policy error, run this first:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# Then re-run the script.

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ok " -NoNewline -ForegroundColor Green; Write-Host $msg }
function Write-Warn($msg) { Write-Host "  ! " -NoNewline -ForegroundColor Yellow; Write-Host $msg }
function Write-Fail($msg) { Write-Host "  X " -NoNewline -ForegroundColor Red; Write-Host $msg; exit 1 }

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
Write-Step "Checking Node.js"
try {
    $nodeVersion = (& node --version).TrimStart('v')
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -lt 20) {
        Write-Fail "Node.js >= 20 is required. Found v$nodeVersion. Install from https://nodejs.org/en/download"
    }
    Write-Ok "Node.js v$nodeVersion"
} catch {
    Write-Fail "Node.js is not installed. Get it from https://nodejs.org/en/download (pick the LTS version)."
}

# ---------------------------------------------------------------------------
# 2. pnpm
# ---------------------------------------------------------------------------
Write-Step "Checking pnpm"
$pnpmInstalled = $false
try {
    $null = & pnpm --version
    $pnpmInstalled = $true
} catch {
    $pnpmInstalled = $false
}

if (-not $pnpmInstalled) {
    Write-Warn "pnpm not found. Installing globally via npm..."
    & npm install -g pnpm@latest
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to install pnpm. Try manually: npm install -g pnpm"
    }
}
$pnpmVersion = (& pnpm --version)
Write-Ok "pnpm v$pnpmVersion"

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------
Write-Step "Installing dependencies (this may take a couple minutes)"
Push-Location $projectRoot
try {
    # pnpm + npm wrappers print progress to stderr. In Windows PowerShell 5.1
    # those lines get wrapped as ErrorRecords; with $ErrorActionPreference =
    # 'Stop' the script throws on benign output. Relax locally + use exit code.
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & pnpm install
    $installExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref

    if ($installExit -ne 0) {
        Write-Fail "pnpm install failed (exit $installExit). Check the output above."
    }
    Write-Ok "Dependencies installed"
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 4. .env scaffolding
# ---------------------------------------------------------------------------
Write-Step "Setting up .env"
$envPath = Join-Path $projectRoot '.env'
$envExample = Join-Path $projectRoot '.env.example'

if (-not (Test-Path $envExample)) {
    Write-Fail ".env.example missing. Did you delete it? Re-clone the repo."
}

if (Test-Path $envPath) {
    Write-Warn ".env already exists; leaving it alone. Edit it manually to fill in any missing values."
} else {
    $template = Get-Content $envExample -Raw

    # Generate secrets via node (already verified in step 1 - works the same on
    # any Node version, avoids PowerShell-edition gotchas with crypto APIs).
    $authSecret = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($authSecret)) {
        Write-Fail "Failed to generate AUTH_SECRET via node."
    }
    $keyEnc = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($keyEnc)) {
        Write-Fail "Failed to generate KEY_ENCRYPTION_KEY via node."
    }
    $cronSecret = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cronSecret)) {
        Write-Fail "Failed to generate CRON_SECRET via node."
    }

    $populated = $template `
        -replace 'AUTH_SECRET=""', "AUTH_SECRET=`"$authSecret`"" `
        -replace 'KEY_ENCRYPTION_KEY=""', "KEY_ENCRYPTION_KEY=`"$keyEnc`"" `
        -replace 'CRON_SECRET=""', "CRON_SECRET=`"$cronSecret`""

    # Write UTF-8 without BOM so .env parsers don't choke on it.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envPath, $populated, $utf8NoBom)
    Write-Ok ".env created with auto-generated AUTH_SECRET / KEY_ENCRYPTION_KEY / CRON_SECRET"
    Write-Warn "You still need to fill in DATABASE_URL and EMAIL_SERVER_* by hand. See GETTING_STARTED.md."
}

# ---------------------------------------------------------------------------
# 5. SDK bundle
# ---------------------------------------------------------------------------
Write-Step "Building the runtime SDK bundle"
Push-Location $projectRoot
try {
    # esbuild + pnpm both write progress to stderr; redirecting stderr in
    # Windows PowerShell 5.1 wraps those lines in ErrorRecords and trips
    # $ErrorActionPreference = 'Stop'. Drop the strict policy locally and
    # rely on $LASTEXITCODE.
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & pnpm sdk:build:min | Out-Null
    $sdkExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref

    if ($sdkExit -ne 0) {
        Write-Warn "SDK build failed (exit $sdkExit). Re-run with: pnpm sdk:build:min"
    } else {
        Write-Ok "SDK bundle: public/sdk.min.js"
    }
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 6. Next steps
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Open .env and fill in DATABASE_URL (Postgres connection string)"
Write-Host "       and EMAIL_SERVER_* (SMTP, e.g. Resend or Mailtrap)"
Write-Host "  2. Run database migrations:"
Write-Host "       pnpm db:migrate" -ForegroundColor Cyan
Write-Host "  3. Start the dev server:"
Write-Host "       pnpm dev" -ForegroundColor Cyan
Write-Host "  4. Open http://localhost:3000"
Write-Host ""
Write-Host "For step-by-step instructions, see GETTING_STARTED.md."
Write-Host ""
