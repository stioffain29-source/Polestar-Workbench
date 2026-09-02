# Phase 4.1 — automated QA gates (Windows / PowerShell).
# Mirrors artifacts/workbench/scripts/runPhase41.sh.
#
# Usage:
#   $env:PROD_DATABASE_URL = "postgresql://..."
#   .\artifacts\workbench\scripts\runPhase41.ps1

$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $Root

$EnvLocal = Join-Path $Root ".env.local"
if (Test-Path $EnvLocal) {
    Get-Content $EnvLocal | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
        $pair = $_ -split '=', 2
        if ($pair.Length -eq 2) {
            Set-Item -Path "Env:$($pair[0].Trim())" -Value $pair[1].Trim().Trim('"')
        }
    }
}

# Fallback email settings when .env.local omits them (env wins when set).
if (-not $env:RESEND_API_KEY) {
    $env:RESEND_API_KEY = "re_bF1VYYCG_989T6cz26c7jynNfUg9wmy3S"
}
if (-not $env:VALIDATION_SUMMARY_FROM) {
    $env:VALIDATION_SUMMARY_FROM = "Polestar Validation <onboarding@resend.dev>"
}
if (-not $env:VALIDATION_SUMMARY_TO) {
    $env:VALIDATION_SUMMARY_TO = "tommyto0925@gmail.com"
}

if ($env:PROD_DATABASE_URL -and -not $env:DATABASE_URL) {
    $env:DATABASE_URL = $env:PROD_DATABASE_URL
}

$Failed = 0
$RunStarted = Get-Date
$RunStartedAt = $RunStarted.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
$DbConfigured = [bool]($env:PROD_DATABASE_URL -or $env:DATABASE_URL)

$DetailDir = Join-Path ([System.IO.Path]::GetTempPath()) ("phase41-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $DetailDir | Out-Null
$SummaryFile = [System.IO.Path]::GetTempFileName()
$GatesTsv = Join-Path $DetailDir "gates.tsv"
"id`tresult`texitCode`tdurationSec`tlabel`tskipReason" | Set-Content $GatesTsv -Encoding utf8

function Record-Gate($id, $label, $result, $exitCode, $durationSec, $skipReason = "") {
    $skipReason = ($skipReason -replace "`t", " " -replace "`n", " ").Trim()
    "$id`t$result`t$exitCode`t$durationSec`t$label`t$skipReason" | Add-Content $GatesTsv -Encoding utf8
}

function Execute-Gate($id, $label, [scriptblock]$Command) {
    Write-Host "==== Phase 4.1 — $label ===="
    $log = Join-Path $DetailDir "$id.log"
    $t0 = Get-Date
    & $Command 2>&1 | Tee-Object -FilePath $log
    $rc = $LASTEXITCODE
    if ($null -eq $rc) { $rc = 0 }
    $dur = [int]((Get-Date) - $t0).TotalSeconds
    Write-Host ""
    if ($rc -eq 0) {
        Record-Gate $id $label "PASS" 0 $dur ""
        Write-Host "PASS: $id" -ForegroundColor Green
    } else {
        Record-Gate $id $label "FAIL" $rc $dur ""
        Write-Host "FAIL: $id" -ForegroundColor Red
        $script:Failed++
    }
}

function Skip-Gate($id, $label, $reason) {
    Record-Gate $id $label "SKIP" 0 0 $reason
    Write-Host "SKIP: $id ($reason)" -ForegroundColor Yellow
    $script:Failed++
}

function Write-DetailedReport($status) {
    $finishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"
    $durationSec = [int]((Get-Date) - $RunStarted).TotalSeconds
    $headerPath = Join-Path $DetailDir "header.env"
    @(
        "STATUS=$status"
        "STARTED_AT=$RunStartedAt"
        "FINISHED_AT=$finishedAt"
        "DURATION_SEC=$durationSec"
        "HOST=$env:COMPUTERNAME"
        "REPO=$Root"
        "DATABASE_CONFIGURED=$DbConfigured"
        "FAILED_GATE_COUNT=$Failed"
    ) | Set-Content $headerPath -Encoding utf8

    $Wb = Join-Path $Root "artifacts\workbench"
    npx tsx --import "$Wb/scripts/registerLoader.mjs" `
        "$Wb/scripts/buildPhase41Report.ts" `
        $DetailDir | Set-Content $SummaryFile -Encoding utf8
}

function Send-SummaryEmail($status) {
    $env:VALIDATION_STATUS = $status
    $Wb = Join-Path $Root "artifacts\workbench"
    npx tsx --import "$Wb/scripts/registerLoader.mjs" `
        "$Wb/scripts/sendValidationSummaryEmail.ts" `
        $SummaryFile
    if ($LASTEXITCODE -eq 0) {
        Write-Host ">> Detailed validation report emailed."
    } else {
        Write-Host "WARN: validation summary email step failed (see above)." -ForegroundColor Yellow
    }
}

Execute-Gate "typecheck" "Typecheck" { pnpm typecheck }

Execute-Gate "jest" "Jest (full suite)" { pnpm test }

$Wb = Join-Path $Root "artifacts\workbench"
if (-not $DbConfigured) {
    Skip-Gate "pdf-fonts" "PDF fonts (country briefs)" "PROD_DATABASE_URL not set"
    Skip-Gate "topic-font-audit" "Topic font audit" "PROD_DATABASE_URL not set"
    Skip-Gate "country-brief-sweep" "Country brief sweep" "PROD_DATABASE_URL not set"
} else {
    Execute-Gate "pdf-fonts" "PDF fonts (country briefs)" { bash "$Wb/scripts/validateFonts.sh" }
    Execute-Gate "topic-font-audit" "Topic font audit" { bash "$Wb/scripts/auditTopicFonts.sh" }
    $pdftotext = Get-Command pdftotext -ErrorAction SilentlyContinue
    if (-not $pdftotext) {
        Skip-Gate "country-brief-sweep" "Country brief sweep" "pdftotext not found — install poppler"
    } else {
        Execute-Gate "country-brief-sweep" "Country brief sweep" { bash "$Wb/scripts/verifyCountryBriefs.sh" }
    }
}

Write-Host "==== Phase 4.1 summary ===="
try {
    if ($Failed -eq 0) {
        Write-Host "All gates green." -ForegroundColor Green
        Write-DetailedReport "PASSED"
        Send-SummaryEmail "PASSED"
        exit 0
    }
    Write-Host "$Failed gate(s) failed or skipped." -ForegroundColor Red
    Write-DetailedReport "FAILED"
    Send-SummaryEmail "FAILED"
    exit 1
} finally {
    Remove-Item $DetailDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $SummaryFile -ErrorAction SilentlyContinue
}
