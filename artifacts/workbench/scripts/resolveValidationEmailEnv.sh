#!/usr/bin/env bash
# Resolve validation summary email settings for Phase 4.1 scripts.
#
# Precedence for RESEND_API_KEY:
#   1. .env.local (local operator override)
#   2. Replit Tools → Configurations / Secrets (already in the shell env)
#   3. never use a baked-in API key fallback
#
# Replit injects Configurations (e.g. RESEND_API_KEY) into the workspace
# environment before workflows run — preserve that when .env.local is absent
# or does not define the key.

_saved_resend_api_key="${RESEND_API_KEY:-}"

_env_local="${1:-}"
if [ -n "$_env_local" ] && [ -f "$_env_local" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$_env_local"
  set +a
fi

if [ -z "${RESEND_API_KEY:-}" ] && [ -n "$_saved_resend_api_key" ]; then
  export RESEND_API_KEY="$_saved_resend_api_key"
fi

if [ -z "${VALIDATION_SUMMARY_FROM:-}" ]; then
  export VALIDATION_SUMMARY_FROM="Polestar Validation <onboarding@resend.dev>"
fi
if [ -z "${VALIDATION_SUMMARY_TO:-}" ]; then
  export VALIDATION_SUMMARY_TO="tommyto0925@gmail.com"
fi

unset _saved_resend_api_key _env_local
