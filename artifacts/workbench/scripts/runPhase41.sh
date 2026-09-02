#!/usr/bin/env bash
# Phase 4.1 — automated QA gates (ingestion-report-quality-plan §4.1).
#
# Runs, in order:
#   1. pnpm typecheck
#   2. pnpm test
#   3. pdf-fonts        (validateFonts.sh — country brief Roboto gate)
#   4. topic-font-audit (auditTopicFonts.sh — topic report Roboto gate)
#   5. country-brief-sweep (verifyCountryBriefs.sh — six briefs + banned phrases)
#   6. Email a detailed summary report (default: tommyto0925@gmail.com)
#
# Live PDF exports require PROD_DATABASE_URL (prod Postgres). On Replit, set it
# in Secrets; locally use the prod connection string from the deployment.
# country-brief-sweep also needs `pdftotext` (poppler-utils).
#
# Email delivery uses Resend (RESEND_API_KEY) with fallbacks baked into
# runPhase41.sh when .env.local / Secrets omit them. Email failure is logged
# but does not change the gate exit code.
#
# Usage (from repo root):
#   PROD_DATABASE_URL="postgresql://..." bash artifacts/workbench/scripts/runPhase41.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WB="$ROOT/artifacts/workbench"
cd "$ROOT"

ENV_LOCAL="$ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_LOCAL"
  set +a
fi

# Fallback email settings when .env.local / Secrets omit them (env wins when set).
if [ -z "${RESEND_API_KEY:-}" ]; then
  RESEND_API_KEY="re_bF1VYYCG_989T6cz26c7jynNfUg9wmy3S"
  export RESEND_API_KEY
fi
if [ -z "${VALIDATION_SUMMARY_FROM:-}" ]; then
  VALIDATION_SUMMARY_FROM="Polestar Validation <onboarding@resend.dev>"
  export VALIDATION_SUMMARY_FROM
fi
if [ -z "${VALIDATION_SUMMARY_TO:-}" ]; then
  VALIDATION_SUMMARY_TO="tommyto0925@gmail.com"
  export VALIDATION_SUMMARY_TO
fi

# shellcheck source=resolveProdDatabaseUrl.sh
source "$WB/scripts/resolveProdDatabaseUrl.sh"

FAILED=0
RUN_STARTED=$(date -u +%s)
RUN_STARTED_AT=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
DB_CONFIGURED="false"
[ -n "${DATABASE_URL:-}" ] && DB_CONFIGURED="true"

DETAIL_DIR="$(mktemp -d)"
SUMMARY_FILE="$(mktemp)"
trap 'rm -rf "$DETAIL_DIR" "$SUMMARY_FILE"' EXIT

printf '%s\n' "id	result	exitCode	durationSec	label	skipReason" >"$DETAIL_DIR/gates.tsv"

record_gate() {
  local id=$1 label=$2 result=$3 rc=$4 dur=$5
  local skip="${6:-}"
  skip="${skip//$'\t'/ }"
  skip="${skip//$'\n'/ }"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$result" "$rc" "$dur" "$label" "$skip" >>"$DETAIL_DIR/gates.tsv"
}

execute_gate() {
  local id=$1 label=$2
  shift 2
  echo "==== Phase 4.1 — $label ===="
  local log="$DETAIL_DIR/${id}.log"
  local t0
  t0=$(date -u +%s)
  set +e
  "$@" 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  set -e
  local t1 dur
  t1=$(date -u +%s)
  dur=$((t1 - t0))
  echo
  if [ "$rc" -eq 0 ]; then
    record_gate "$id" "$label" PASS 0 "$dur" ""
    echo "PASS: $id"
  else
    record_gate "$id" "$label" FAIL "$rc" "$dur" ""
    echo "FAIL: $id"
    FAILED=$((FAILED + 1))
  fi
}

skip_gate() {
  local id=$1 label=$2 reason=$3
  record_gate "$id" "$label" SKIP 0 0 "$reason"
  echo "SKIP: $id ($reason)"
  FAILED=$((FAILED + 1))
}

write_detailed_report() {
  local status=$1
  local finished_at finished_epoch duration
  finished_at=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
  finished_epoch=$(date -u +%s)
  duration=$((finished_epoch - RUN_STARTED))
  cat >"$DETAIL_DIR/header.env" <<EOF
STATUS=$status
STARTED_AT=$RUN_STARTED_AT
FINISHED_AT=$finished_at
DURATION_SEC=$duration
HOST=${HOSTNAME:-unknown}
REPO=$ROOT
DATABASE_CONFIGURED=$DB_CONFIGURED
FAILED_GATE_COUNT=$FAILED
EOF
  npx tsx --import "$WB/scripts/registerLoader.mjs" \
    "$WB/scripts/buildPhase41Report.ts" "$DETAIL_DIR" >"$SUMMARY_FILE"
}

send_summary_email() {
  local status=$1
  export VALIDATION_STATUS="$status"
  if npx tsx --import "$WB/scripts/registerLoader.mjs" \
    "$WB/scripts/sendValidationSummaryEmail.ts" "$SUMMARY_FILE"; then
    echo ">> Detailed validation report emailed."
  else
    echo "WARN: validation summary email step failed (see above)." >&2
  fi
}

execute_gate typecheck Typecheck pnpm typecheck

execute_gate jest "Jest (full suite)" pnpm test

if [ "$DB_CONFIGURED" = "false" ]; then
  skip_gate pdf-fonts "PDF fonts (country briefs)" "PROD_DATABASE_URL not set"
  skip_gate topic-font-audit "Topic font audit" "PROD_DATABASE_URL not set"
  skip_gate country-brief-sweep "Country brief sweep" "PROD_DATABASE_URL not set"
else
  execute_gate pdf-fonts "PDF fonts (country briefs)" bash "$WB/scripts/validateFonts.sh"
  execute_gate topic-font-audit "Topic font audit" bash "$WB/scripts/auditTopicFonts.sh"
  if command -v pdftotext >/dev/null 2>&1; then
    execute_gate country-brief-sweep "Country brief sweep" bash "$WB/scripts/verifyCountryBriefs.sh"
  else
    skip_gate country-brief-sweep "Country brief sweep" "pdftotext not found — install poppler-utils"
  fi
fi

echo "==== Phase 4.1 summary ===="
if [ "$FAILED" -eq 0 ]; then
  echo "All gates green."
  write_detailed_report "PASSED"
  send_summary_email "PASSED"
  exit 0
fi
echo "$FAILED gate(s) failed or skipped."
write_detailed_report "FAILED"
send_summary_email "FAILED"
exit 1
