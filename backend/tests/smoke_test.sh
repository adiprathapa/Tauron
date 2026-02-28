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

# 7. /api/impact returns 200 with required keys
IMPACT=$(curl -s "$BASE/api/impact")
IMPACT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/impact")
if [ "$IMPACT_STATUS" = "200" ]; then
  pass "GET /api/impact returns 200"
  DOSES=$(echo "$IMPACT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('antibiotic_doses_avoided','MISSING'))")
  SAVINGS=$(echo "$IMPACT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('milk_yield_saved_usd','MISSING'))")
  info "antibiotic_doses_avoided=$DOSES  milk_yield_saved_usd=$SAVINGS"
else
  fail "GET /api/impact returned $IMPACT_STATUS"
fi

# 8. /api/history returns 200 with predictions list
HISTORY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/history")
if [ "$HISTORY_STATUS" = "200" ]; then
  TOTAL=$(curl -s "$BASE/api/history" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total','MISSING'))")
  pass "GET /api/history returns 200 (total=$TOTAL)"
else
  fail "GET /api/history returned $HISTORY_STATUS"
fi

# 9. /api/tier returns 200 with tier info
TIER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/tier")
if [ "$TIER_STATUS" = "200" ]; then
  TIER=$(curl -s "$BASE/api/tier" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tier','MISSING'))")
  pass "GET /api/tier returns 200 (tier=$TIER)"
else
  fail "GET /api/tier returned $TIER_STATUS"
fi

# 10. POST /api/ingest accepts a manual observation
INGEST_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{"cow_id":47,"yield_kg":20.5,"pen":"A1","health_event":"none","notes":"smoke test"}')
if [ "$INGEST_STATUS" = "200" ]; then
  pass "POST /api/ingest returns 200"
else
  fail "POST /api/ingest returned $INGEST_STATUS"
fi

# 11. /api/logs returns 200 (ingest log)
LOGS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/logs")
if [ "$LOGS_STATUS" = "200" ]; then
  LOGCOUNT=$(curl -s "$BASE/api/logs" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('logs',[])))")
  pass "GET /api/logs returns 200 (entries=$LOGCOUNT)"
else
  fail "GET /api/logs returned $LOGS_STATUS"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All smoke tests passed — demo ready.${NC}"
else
  echo -e "${RED}$FAILED test(s) failed — fix before demo.${NC}"
  exit 1
fi
