#!/usr/bin/env bash
# AC2 proof (spec §7, plan §9.1): an adviser calling the save API directly with a 7.25% line and
# no owner approval is refused with a 4xx and nothing is persisted. Also checks AC5 (adviser cannot
# set the global rate → 403) and AC3 (order rate 7,999 → 422, never clamped).
#
# Usage: BASE_URL=http://localhost:3000 scripts/prove-server-refusal.sh
# Needs: bash, curl, node (for JSON parsing — no jq). Exits 0 only if every assertion holds.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

# json <file> <js expression over `d`>  → prints the value (strings raw, others as JSON)
json() {
  node -e '
    const fs = require("fs");
    let d; try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { d = null; }
    const v = (new Function("d", "return (" + process.argv[2] + ")"))(d);
    process.stdout.write(v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));
  ' "$1" "$2"
}

# request <METHOD> <path> <body-or-empty> [token]  → sets STATUS, response body in $TMP/body
request() {
  local method="$1" path="$2" body="$3" token="${4:-}"
  local args=(-sS -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  STATUS="$(curl "${args[@]}")" || { echo "curl failed for $method $path (is the server running at $BASE_URL?)"; exit 2; }
}

show() {
  printf '  → %s %s\n' "$1" "$2"
  [[ -n "${3:-}" ]] && printf '    request:  %s\n' "$3"
  printf '    response: HTTP %s %s\n' "$STATUS" "$(cat "$TMP/body")"
}

bold "AC2 server-refusal proof against $BASE_URL"

bold "1. Log in as the adviser (E1 demo login)"
request POST /api/auth/demo-login '{"role":"adviser"}'
[[ "$STATUS" == 200 ]] || { show POST /api/auth/demo-login '{"role":"adviser"}'; echo "login failed"; exit 1; }
TOKEN="$(json "$TMP/body" 'd.token')"
printf '  logged in as %s (role %s); bearer token %s…\n' "$(json "$TMP/body" 'd.user.name')" "$(json "$TMP/body" 'd.user.role')" "${TOKEN:0:16}"

bold "2. Fetch the catalog (E4)"
request GET /api/catalog "" "$TOKEN"
[[ "$STATUS" == 200 ]] || { show GET /api/catalog; exit 1; }
cp "$TMP/body" "$TMP/catalog"
DEALER="$(json "$TMP/catalog" 'd.dealers[0].id')"
PUMP="$(json "$TMP/catalog" 'd.products.find(p => p.sku === "PUMP-01").id')"
FILT="$(json "$TMP/catalog" 'd.products.find(p => p.sku === "FILT-02").id')"
BATT="$(json "$TMP/catalog" 'd.products.find(p => p.sku === "BATT-03").id')"
BATT_PRICE="$(json "$TMP/catalog" 'd.products.find(p => p.sku === "BATT-03").unitPriceCents')"
printf '  dealer %s; Battery price %s cents; global rate %s\n' "$DEALER" "$BATT_PRICE" "$(json "$TMP/catalog" 'd.globalRate')"

ORDER_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
L1="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
L2="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
L3="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"

bold "3. POST /api/orders/$ORDER_ID/save — fresh id (never PUT), AC1 lines incl. line 3 at 7.25%, no approval"
# Line 3: 1 × Battery ($2,070) with a $150 discount = 7.25% → blocked without an owner approval.
# Forged fields (role, approval, unitPriceCents) are included on purpose: the server must ignore them.
SAVE_BODY="{\"dealerId\":\"$DEALER\",\"rate\":8200,\"role\":\"owner\",\"lines\":[
{\"id\":\"$L1\",\"productId\":\"$PUMP\",\"qty\":4,\"discountCents\":4000},
{\"id\":\"$L2\",\"productId\":\"$FILT\",\"qty\":2,\"discountCents\":7000},
{\"id\":\"$L3\",\"productId\":\"$BATT\",\"qty\":1,\"discountCents\":15000,\"unitPriceCents\":1000000,\"approval\":{\"status\":\"approved\"}}]}"
SAVE_BODY="$(printf '%s' "$SAVE_BODY" | tr -d '\n')"
request POST "/api/orders/$ORDER_ID/save" "$SAVE_BODY" "$TOKEN"
show POST "/api/orders/$ORDER_ID/save" "$SAVE_BODY"
CODE="$(json "$TMP/body" 'd && d.error && d.error.code')"
LINE_IDS="$(json "$TMP/body" 'd && d.error && d.error.details && d.error.details.lineIds')"
[[ "$STATUS" == 422 ]] && pass "HTTP 422" || fail "expected HTTP 422, got $STATUS"
[[ "$CODE" == UNAPPROVED_BLOCKED_LINES ]] && pass "error.code = UNAPPROVED_BLOCKED_LINES" || fail "expected UNAPPROVED_BLOCKED_LINES, got '$CODE'"
[[ "$LINE_IDS" == "[\"$L3\"]" ]] && pass "details.lineIds names line 3 only ($L3)" || fail "expected lineIds [\"$L3\"], got $LINE_IDS"

bold "4. GET /api/orders/$ORDER_ID — nothing was persisted"
request GET "/api/orders/$ORDER_ID" "" "$TOKEN"
show GET "/api/orders/$ORDER_ID"
[[ "$STATUS" == 404 ]] && pass "HTTP 404 — no order row exists for that id" || fail "expected 404, got $STATUS"

bold "5. AC5 — adviser PUT /api/settings/global-rate → 403"
request PUT /api/settings/global-rate '{"globalRate":9000,"role":"owner"}' "$TOKEN"
show PUT /api/settings/global-rate '{"globalRate":9000,"role":"owner"}'
[[ "$STATUS" == 403 && "$(json "$TMP/body" 'd.error.code')" == FORBIDDEN ]] && pass "HTTP 403 FORBIDDEN" || fail "expected 403 FORBIDDEN, got $STATUS"

bold "6. AC3 — order with rate 7,999 → 422 (refused, not clamped)"
RATE_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
RATE_BODY="{\"dealerId\":\"$DEALER\",\"rate\":7999,\"lines\":[{\"id\":\"$L1\",\"productId\":\"$PUMP\",\"qty\":1,\"discountCents\":0}]}"
request PUT "/api/orders/$RATE_ID" "$RATE_BODY" "$TOKEN"
show PUT "/api/orders/$RATE_ID" "$RATE_BODY"
[[ "$STATUS" == 422 && "$(json "$TMP/body" 'd.error.code')" == RATE_BELOW_MINIMUM ]] && pass "HTTP 422 RATE_BELOW_MINIMUM" || fail "expected 422 RATE_BELOW_MINIMUM, got $STATUS"
request GET "/api/orders/$RATE_ID" "" "$TOKEN"
[[ "$STATUS" == 404 ]] && pass "no order row created (GET → 404)" || fail "expected 404, got $STATUS"

echo
if [[ "$FAILURES" -eq 0 ]]; then
  printf '\033[32mAll assertions passed: the server refuses the unapproved 7.25%% line and persists nothing.\033[0m\n'
  exit 0
fi
printf '\033[31m%s assertion(s) failed.\033[0m\n' "$FAILURES"
exit 1
