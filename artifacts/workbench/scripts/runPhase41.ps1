# Phase 4.1 — automated QA gates (Windows / PowerShell).
# Mirrors artifacts/workbench/scripts/runPhase41.sh.
#
# Usage:
#   $env:DATABASE_URL = "postgresql://..."
#   .\artifacts\workbench\scripts\runPhase41.ps1

$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $Root

$Failed = 0

function Step-Pass($name) { Write-Host "PASS: $name" -ForegroundColor Green }
function Step-Fail($name) { Write-Host "FAIL: $name" -ForegroundColor Red; $script:Failed++ }
function Step-Skip($name) { Write-Host "SKIP: $name" -ForegroundColor Yellow; $script:Failed++ }

Write-Host "==== Phase 4.1 — typecheck ===="
if (pnpm typecheck) { Step-Pass "typecheck" } else { Step-Fail "typecheck" }
Write-Host ""

Write-Host "==== Phase 4.1 — jest (full suite) ===="
if (pnpm test) { Step-Pass "jest" } else { Step-Fail "jest" }
Write-Host ""

$Wb = Join-Path $Root "artifacts\workbench"
if (-not $env:DATABASE_URL) {
    Step-Skip "pdf-fonts (DATABASE_URL not set)"
    Step-Skip "topic-font-audit (DATABASE_URL not set)"
    Step-Skip "country-brief-sweep (DATABASE_URL not set)"
} else {
    Write-Host "==== Phase 4.1 — pdf-fonts ===="
    if (bash "$Wb/scripts/validateFonts.sh") { Step-Pass "pdf-fonts" } else { Step-Fail "pdf-fonts" }
    Write-Host ""

    Write-Host "==== Phase 4.1 — topic-font-audit ===="
    if (bash "$Wb/scripts/auditTopicFonts.sh") { Step-Pass "topic-font-audit" } else { Step-Fail "topic-font-audit" }
    Write-Host ""

    Write-Host "==== Phase 4.1 — country-brief-sweep ===="
    $pdftotext = Get-Command pdftotext -ErrorAction SilentlyContinue
    if (-not $pdftotext) {
        Step-Skip "country-brief-sweep (pdftotext not found — install poppler)"
    } elseif (bash "$Wb/scripts/verifyCountryBriefs.sh") {
        Step-Pass "country-brief-sweep"
    } else {
        Step-Fail "country-brief-sweep"
    }
    Write-Host ""
}

Write-Host "==== Phase 4.1 summary ===="
if ($Failed -eq 0) {
    Write-Host "All gates green." -ForegroundColor Green
    exit 0
}
Write-Host "$Failed gate(s) failed or skipped." -ForegroundColor Red
exit 1
