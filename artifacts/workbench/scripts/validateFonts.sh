#!/usr/bin/env bash
# CI font gate for the structured country briefs (PNG / West Papua / Indonesia).
# The project's hard rule is that every exported PDF must embed only Roboto — any
# Helvetica/standard-font fallback is forbidden. This script exports each brief
# headlessly (reading live data straight from Postgres — no owner-gated API or
# running server needed) into a throwaway temp dir and runs the per-page
# Tf-operator font inventory. It exits NON-ZERO if any non-Roboto font is ever
# selected, so it can be wired into the validation system as an automatic gate.
#
# Unlike auditCountryFonts.sh (the manual proof-refresh flow), this script does
# NOT read or write screenshots/font_proof/FONT_AUDIT.txt — it is side-effect
# free so a validation run never mutates tracked files.
#
# Requires PROD_DATABASE_URL (preferred) or DATABASE_URL. Run from anywhere:
#   PROD_DATABASE_URL=... bash artifacts/workbench/scripts/validateFonts.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=resolveProdDatabaseUrl.sh
source "$(dirname "$0")/resolveProdDatabaseUrl.sh"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "validateFonts: PROD_DATABASE_URL or DATABASE_URL is not set — cannot export country briefs." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

declare -A SLUGS=(
  ["png_country"]="papua-new-guinea"
  ["west_papua_country"]="papua"
  ["indonesia_country"]="indonesia"
)

ARGS=()
for name in png_country west_papua_country indonesia_country; do
  slug="${SLUGS[$name]}"
  pdf="$TMP_DIR/${name}.pdf"
  echo ">> Exporting $slug -> $pdf"
  TOPIC=country COUNTRY_SLUG="$slug" OUT_PATH="$pdf" \
    npx tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
  ARGS+=("${name}.pdf (${slug})::$pdf")
done

echo ">> Auditing fonts (PASS = only /Roboto selected via Tf)"
python3 scripts/fontAuditTf.py "${ARGS[@]}"
