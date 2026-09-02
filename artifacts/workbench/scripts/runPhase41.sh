#!/usr/bin/env bash
# Phase 4.1 — automated QA gates (ingestion-report-quality-plan §4.1).
#
# Runs, in order:
#   1. pnpm typecheck
#   2. pnpm test
#   3. pdf-fonts        (validateFonts.sh — country brief Roboto gate)
#   4. topic-font-audit (auditTopicFonts.sh — topic report Roboto gate)
#   5. country-brief-sweep (verifyCountryBriefs.sh — six briefs + banned phrases)
#
# Live PDF exports require PROD_DATABASE_URL (prod Postgres). On Replit, set it
# in Secrets; locally use the prod connection string from the deployment.
# country-brief-sweep also needs `pdftotext` (poppler-utils).
#
# Usage (from repo root):
#   PROD_DATABASE_URL="postgresql://..." bash artifacts/workbench/scripts/runPhase41.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WB="$ROOT/artifacts/workbench"
cd "$ROOT"

# shellcheck source=resolveProdDatabaseUrl.sh
source "$WB/scripts/resolveProdDatabaseUrl.sh"

FAILED=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=$((FAILED + 1)); }
skip() { echo "SKIP: $1"; FAILED=$((FAILED + 1)); }

echo "==== Phase 4.1 — typecheck ===="
if pnpm typecheck; then pass typecheck; else fail typecheck; fi
echo

echo "==== Phase 4.1 — jest (full suite) ===="
if pnpm test; then pass jest; else fail jest; fi
echo

if [ -z "${DATABASE_URL:-}" ]; then
  skip "pdf-fonts (PROD_DATABASE_URL not set)"
  skip "topic-font-audit (PROD_DATABASE_URL not set)"
  skip "country-brief-sweep (PROD_DATABASE_URL not set)"
else
  echo "==== Phase 4.1 — pdf-fonts ===="
  if bash "$WB/scripts/validateFonts.sh"; then pass pdf-fonts; else fail pdf-fonts; fi
  echo

  echo "==== Phase 4.1 — topic-font-audit ===="
  if bash "$WB/scripts/auditTopicFonts.sh"; then pass topic-font-audit; else fail topic-font-audit; fi
  echo

  echo "==== Phase 4.1 — country-brief-sweep ===="
  if command -v pdftotext >/dev/null 2>&1; then
    if bash "$WB/scripts/verifyCountryBriefs.sh"; then pass country-brief-sweep; else fail country-brief-sweep; fi
  else
    skip "country-brief-sweep (pdftotext not found — install poppler-utils)"
  fi
  echo
fi

echo "==== Phase 4.1 summary ===="
if [ "$FAILED" -eq 0 ]; then
  echo "All gates green."
  exit 0
fi
echo "$FAILED gate(s) failed or skipped."
exit 1
