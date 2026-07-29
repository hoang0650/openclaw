#!/usr/bin/env bash
# Mint Nest Bearer JWT for PHHotel hotel-ops APIs (/rooms, /sepay, …).
# Prefers static NEST_API_TOKEN when valid; else POST /users/create-token
# with NEST_SERVICE_AUTH_SECRET + service user subject.
#
# Usage (from OpenClaw agent):
#   JWT="$(bash skills/phhotel/scripts/mint-nest-jwt.sh)"
#   curl ... -H "Authorization: Bearer $JWT"
set -euo pipefail

BASE="${PHHOTEL_API_URL:-${NEST_BACKEND_URL:-https://api.phhotel.vn}}"
BASE="${BASE%/}"
SECRET="${NEST_SERVICE_AUTH_SECRET:-}"
TMP_VERIFY="$(mktemp)"
TMP_CREATE="$(mktemp)"
trap 'rm -f "$TMP_VERIFY" "$TMP_CREATE"' EXIT

extract_token() {
  local file="$1"
  if command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.token||""))' "$file"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("token") or "", end="")' "$file"
    return
  fi
  # last-resort grep (fragile)
  sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n1
}

is_valid_env_token() {
  local code
  code="$(
    curl -sS -o "$TMP_VERIFY" -w '%{http_code}' \
      -X POST "${BASE}/users/verify-token" \
      -H "Authorization: Bearer ${NEST_API_TOKEN}" \
      -H "Accept: application/json" \
      || true
  )"
  [[ "$code" == "200" ]] || return 1
  grep -q '"valid"[[:space:]]*:[[:space:]]*true' "$TMP_VERIFY"
}

if [[ -n "${NEST_API_TOKEN:-}" ]] && is_valid_env_token; then
  printf '%s' "$NEST_API_TOKEN"
  exit 0
fi

if [[ -z "$SECRET" ]]; then
  echo "ERROR: NEST_SERVICE_AUTH_SECRET is required to mint JWT (do not ask operators to edit Render)." >&2
  exit 1
fi

BODY=""
if [[ -n "${NEST_SERVICE_USER_ID:-}" ]]; then
  BODY="$(printf '{"userId":"%s"}' "$NEST_SERVICE_USER_ID")"
elif [[ -n "${NEST_SERVICE_USERNAME:-}" ]]; then
  BODY="$(printf '{"username":"%s"}' "$NEST_SERVICE_USERNAME")"
elif [[ -n "${NEST_SERVICE_EMAIL:-}" ]]; then
  BODY="$(printf '{"email":"%s"}' "$NEST_SERVICE_EMAIL")"
else
  echo "ERROR: gateway needs NEST_SERVICE_USER_ID or NEST_SERVICE_USERNAME or NEST_SERVICE_EMAIL." >&2
  exit 1
fi

HTTP_CODE="$(
  curl -sS -o "$TMP_CREATE" -w '%{http_code}' \
    -X POST "${BASE}/users/create-token" \
    -H "X-Service-Secret: ${SECRET}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$BODY"
)"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: create-token HTTP ${HTTP_CODE}: $(head -c 400 "$TMP_CREATE" 2>/dev/null || true)" >&2
  exit 1
fi

TOKEN="$(extract_token "$TMP_CREATE")"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: create-token response missing token" >&2
  exit 1
fi

printf '%s' "$TOKEN"
