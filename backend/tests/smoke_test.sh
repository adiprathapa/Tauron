#!/usr/bin/env bash
# backend/tests/smoke_test.sh
#
# Demo-day smoke test — run 30 minutes before presenting.
# Requires the server and Ollama to be running.
#
# Usage:
#   uvicorn backend.main:app --reload &    # in a separate terminal
#   ollama serve &                         # in a separate terminal
#   bash backend/tests/smoke_test.sh

set -euo pipefail

BASE="http://localhost:8000"
OLLAMA="http://localhost:11434"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED+1)); }
info() { echo -e "${YELLOW}  →${NC} $1"; }

FAILED=0
echo ""
echo "=== Tauron Backend Smoke Test ==="
echo ""

# 1. API server health
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/herd")
if [ "$STATUS" = "200" ]; then
  pass "GET /herd returns 200"
else
  fail "GET /herd returned $STATUS (is uvicorn running?)"
fi

# 2. /herd has cows and adjacency
HERD=$(curl -s "$BASE/herd")
COW_COUNT=$(echo "$HERD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['cows']))")
ADJ_SIZE=$(echo "$HERD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['adjacency']))")
if [ "$COW_COUNT" = "$ADJ_SIZE" ] && [ "$COW_COUNT" -gt 0 ]; then
  pass "/herd has $COW_COUNT cows with matching adjacency matrix"
else
  fail "/herd cow count ($COW_COUNT) != adjacency size ($ADJ_SIZE)"
fi

# 3. /explain/47 returns alert text
EXPLAIN=$(curl -s "$BASE/explain/47")
ALERT=$(echo "$EXPLAIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('alert_text',''))")
if [ -n "$ALERT" ]; then
  pass "GET /explain/47 returned alert_text"
  info "Alert: $ALERT"
else
  fail "GET /explain/47 missing alert_text"
fi

# 4. Unknown cow returns 404
STATUS_404=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/explain/9999")
if [ "$STATUS_404" = "404" ]; then
  pass "GET /explain/9999 returns 404"
else
  fail "GET /explain/9999 returned $STATUS_404 (expected 404)"
fi

# 5. Response time for /explain/47
START=$(python3 -c "import time; print(int(time.time()*1000))")
curl -s "$BASE/explain/47" > /dev/null
END=$(python3 -c "import time; print(int(time.time()*1000))")
ELAPSED=$((END - START))
if [ "$ELAPSED" -lt 10000 ]; then
  pass "/explain/47 responded in ${ELAPSED}ms (< 10s)"
else
  fail "/explain/47 took ${ELAPSED}ms (> 10s — may be too slow for demo)"
fi

# 6. Ollama health (skip if using mock mode)
OLLAMA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$OLLAMA/api/tags" 2>/dev/null || echo "000")
if [ "$OLLAMA_STATUS" = "200" ]; then
  MODELS=$(curl -s "$OLLAMA/api/tags" | python3 -c "import sys,json; tags=json.load(sys.stdin); print([m['name'] for m in tags.get('models',[])])")
  pass "Ollama running — models: $MODELS"
else
  info "Ollama not running (OK if USE_MOCK=True — alerts will use template fallback)"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All smoke tests passed — demo ready.${NC}"
else
  echo -e "${RED}$FAILED test(s) failed — fix before demo.${NC}"
  exit 1
fi
