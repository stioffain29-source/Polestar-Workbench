#!/usr/bin/env bash
# Resolve the Postgres URL for headless export / validation scripts.
# @workspace/db reads DATABASE_URL; prod operators set PROD_DATABASE_URL
# (see exportProdIncidentsSnapshot.ts for the same precedence).
if [ -n "${PROD_DATABASE_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$PROD_DATABASE_URL"
fi
