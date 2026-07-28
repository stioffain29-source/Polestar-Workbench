#!/usr/bin/env bash
# Repeatable narrative-quality sweep for EVERY supported structured country
# brief (task 474). For each theatre it:
#   1. exports the brief headlessly against LIVE Postgres data
#      (exportReportPdfHeadless.ts, same code path as the font audit),
#   2. asserts the §33 fail-closed gate PASSED (from the [countryGate] log,
#      which also reports hasPriorData for the §16 check),
#   3. extracts the PDF text (pdftotext) and fails on any §30 banned phrase,
#   4. when the theatre had NO prior-window data, additionally fails on any
#      §16 trend/comparison wording in the assessed prose.
#
# Fails loudly (non-zero exit + per-theatre FAIL lines) on any violation.
#
# Run from the workbench package root:
#   DATABASE_URL=... bash scripts/verifyCountryBriefs.sh
set -uo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="screenshots/country_sweep"
mkdir -p "$OUT_DIR"

# Every supported COUNTRY_SLUG (see scripts/countryReportData.ts SLUG_TO_NAME).
SLUGS=(papua-new-guinea papua indonesia thailand philippines jakarta)

FAILED=0
SUMMARY=()

for slug in "${SLUGS[@]}"; do
  pdf="$OUT_DIR/${slug}.pdf"
  log="$OUT_DIR/${slug}.log"
  txt="$OUT_DIR/${slug}.txt"

  echo ">> [$slug] exporting headless PDF"
  if ! TOPIC=country COUNTRY_SLUG="$slug" OUT_PATH="$pdf" \
      npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts \
      >"$log" 2>&1; then
    echo "FAIL $slug: headless export crashed (see $log)"
    tail -n 20 "$log"
    SUMMARY+=("FAIL $slug: export crashed")
    FAILED=1
    continue
  fi

  # --- §33 gate: the exporter logs `[countryGate] <name>: passed=... hasPriorData=...`
  gate_line="$(grep -F '[countryGate]' "$log" | tail -n 1 || true)"
  if [ -z "$gate_line" ]; then
    echo "FAIL $slug: no [countryGate] line in export log (see $log)"
    SUMMARY+=("FAIL $slug: gate result missing")
    FAILED=1
    continue
  fi
  echo "   $gate_line"
  if ! grep -q 'passed=true' <<<"$gate_line"; then
    echo "FAIL $slug: §33 gate failed -> $gate_line"
    SUMMARY+=("FAIL $slug: §33 gate failed")
    FAILED=1
    continue
  fi
  has_prior="false"
  if grep -q 'hasPriorData=true' <<<"$gate_line"; then has_prior="true"; fi

  # --- §30 banned phrases + §16 trend gate over the extracted PDF text.
  # pdftotext floods stderr with cosmetic "Adobe-Identity-H" syntax errors
  # from the embedded Roboto font (see memory: openable-pdf-export.md).
  # Filter that exact chatter but keep any OTHER stderr output visible.
  pdf_err="$OUT_DIR/${slug}.pdftotext.err"
  pdftotext "$pdf" "$txt" 2>"$pdf_err"
  pdftotext_status=$?
  grep -v "Unknown character collection 'Adobe-Identity-H'" "$pdf_err" || true
  rm -f "$pdf_err"
  if [ $pdftotext_status -ne 0 ]; then
    echo "FAIL $slug: pdftotext could not extract $pdf"
    SUMMARY+=("FAIL $slug: pdftotext failed")
    FAILED=1
    continue
  fi
  if npx tsx --import ./scripts/registerLoader.mjs \
      scripts/checkCountryNarrativeText.ts "$txt" "$has_prior" "$slug"; then
    SUMMARY+=("PASS $slug (hasPriorData=$has_prior)")
  else
    SUMMARY+=("FAIL $slug: banned-phrase/trend check")
    FAILED=1
  fi
done

echo
echo "==== country brief sweep summary ===="
for line in "${SUMMARY[@]}"; do echo "$line"; done
exit $FAILED
