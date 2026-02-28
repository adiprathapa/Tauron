#!/usr/bin/env bash
# setup.sh — One-shot setup for the Tauron backend
#
# Installs:
#   1. Python dependencies (from backend/requirements.txt)
#   2. Ollama (via Homebrew, macOS only)
#   3. Mistral-7B Q4_K_M model (~4.1GB)
#
# Run once before starting the server:
#   chmod +x setup.sh && ./setup.sh
#
# Start the server after setup:
#   uvicorn backend.main:app --reload

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
fail() { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── Step 1: Python deps ───────────────────────────────────────────────────────
echo ""
echo "=== [1/4] Installing Python dependencies ==="
pip install -r backend/requirements.txt
ok "Python dependencies installed"

# ── Step 2: Ollama ────────────────────────────────────────────────────────────
echo ""
echo "=== [2/4] Installing Ollama ==="
if command -v ollama &>/dev/null; then
    ok "Ollama already installed: $(ollama --version)"
else
    if ! command -v brew &>/dev/null; then
        fail "Homebrew not found. Install Homebrew first: https://brew.sh"
    fi
    brew install ollama
    ok "Ollama installed"
fi

# ── Step 3: Start daemon ──────────────────────────────────────────────────────
echo ""
echo "=== [3/4] Starting Ollama daemon ==="
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    ok "Ollama daemon already running on localhost:11434"
else
    warn "Starting Ollama in background..."
    ollama serve &>/tmp/ollama.log &
    OLLAMA_PID=$!
    # Wait up to 15s for daemon to be ready
    for i in $(seq 1 15); do
        if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
            ok "Ollama daemon ready (PID $OLLAMA_PID)"
            break
        fi
        sleep 1
    done
    if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        fail "Ollama daemon did not start within 15s. Check /tmp/ollama.log"
    fi
fi

# ── Step 4: Pull Mistral ──────────────────────────────────────────────────────
echo ""
echo "=== [4/4] Pulling Mistral-7B (Q4_K_M, ~4.1GB) ==="
EXISTING=$(curl -sf http://localhost:11434/api/tags | python3 -c \
    "import sys,json; print('\n'.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" \
    2>/dev/null || echo "")

if echo "$EXISTING" | grep -q "^mistral"; then
    ok "Mistral already pulled: $(echo "$EXISTING" | grep "^mistral" | head -1)"
else
    warn "Downloading Mistral-7B — this may take 10-15 minutes on first run..."
    ollama pull mistral
    ok "Mistral-7B downloaded"
fi

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Verification ==="
MODELS=$(curl -sf http://localhost:11434/api/tags | python3 -c \
    "import sys,json; print(', '.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" \
    2>/dev/null || echo "could not parse")
echo "  Ollama models available: $MODELS"

if echo "$MODELS" | grep -q "mistral"; then
    ok "Mistral confirmed"
else
    warn "Mistral not found in model list — try: ollama pull mistral"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo " Setup complete. Run the server with:"
echo "   uvicorn backend.main:app --reload"
echo ""
echo " API will be live at http://localhost:8000"
echo " Ollama health:    http://localhost:11434/api/tags"
echo "================================================"
echo ""
