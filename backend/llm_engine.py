"""
backend/llm_engine.py

Local LLM wrapper using Ollama's REST API (primary) with optional Anthropic Claude
fallback when ANTHROPIC_API_KEY is set in the environment.

Setup for Ollama (one-time):
    brew install ollama
    ollama serve &          # starts daemon on localhost:11434
    ollama pull mistral     # downloads mistral:7b-instruct Q4_K_M (~4.1 GB)

Why Ollama over cloud APIs (primary rationale):
    - Farm health data stays on the device — data sovereignty for regulated environments
    - Works fully offline — critical for rural farms with poor connectivity
    - Zero per-query cost — sustainable at scale
    - ~1–2s on M4 Pro (Metal) with no network round-trip
    See claude.md for full rationale.

Optional Claude API fallback:
    Set ANTHROPIC_API_KEY in environment to use Claude when Ollama is not available.
    Useful during development or hackathon demo without a local Ollama install.
    Cloud fallback ONLY — never used as primary to preserve data sovereignty guarantees.

Inference parameters (Ollama):
    temperature=0.2   — low variance: consistent, predictable alerts (not creative)
    num_predict=80    — hard cap ~80 tokens (~2 sentences max), keeps latency < 2s on M4

Alert design principles:
    - Name the cow (#47)
    - Name the disease (mastitis, BRD, lameness)  ← NEW: from multi-disease model
    - Name the specific sensor signal that triggered it
    - Name the action (isolate / check / monitor)
    - Name the closest at-risk contact cow
    - Maximum 30 words — mobile-readable, readable at 5am in a barn
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL    = "mistral"
OLLAMA_TIMEOUT  = 30.0  # generous for demo conditions


# ---------------------------------------------------------------------------
# Human-readable labels — keep prompts farmer-friendly
# ---------------------------------------------------------------------------

_FEATURE_LABELS = {
    "activity":       "activity level",
    "highly_active":  "hours of high activity",
    "rumination_min": "rumination time",
    "feeding_min":    "feeding time",
    "ear_temp_c":     "ear temperature",
    "milk_yield_kg":  "milk yield",
    "health_event":   "recent vet event",
    "feeding_visits": "feeding station visits",
    "days_in_milk":   "days in milk",
}

_DISEASE_LABELS = {
    "mastitis": "mastitis (udder infection)",
    "brd":      "BRD (respiratory disease)",
    "lameness": "lameness (hoof/leg issue)",
}


# ---------------------------------------------------------------------------
# Prompts — versioned here for documentation and hackathon judging (see claude.md)
# ---------------------------------------------------------------------------

# System prompt v2.0 — includes disease context from multi-disease model output
SYSTEM_PROMPT = (
    "You are an AI assistant helping dairy farmers protect their herd. "
    "Convert structured cow health sensor data into ONE clear, actionable sentence a farmer "
    "can act on immediately. "
    "Rules: Use plain English — no veterinary jargon. "
    "Name the cow number, name the disease risk, name the specific sensor signal, name the action. "
    "Speak directly in imperative voice: 'Isolate #47...' not 'You should isolate...'. "
    "Never say 'I' or 'the model'. "
    "Maximum 30 words."
)


def _build_user_prompt(xai_json: dict) -> str:
    """
    Build the LLM user prompt from structured XAI data.

    Includes disease breakdown so the LLM can name the specific health risk —
    this is the key upgrade from v1 (which only had a generic risk score).

    Args:
        xai_json: dict from xai_bridge.build_xai_json() with keys:
                  cow_id, risk_score, top_feature, feature_delta, top_edge,
                  dominant_disease (new), all_risks (new)
    """
    cow          = xai_json["cow_id"]
    risk         = xai_json["risk_score"]
    feature_raw  = xai_json["top_feature"]
    feature      = _FEATURE_LABELS.get(feature_raw, feature_raw.replace("_", " "))
    delta        = xai_json["feature_delta"]
    edge_from    = xai_json["top_edge"]["from"]
    edge_to      = xai_json["top_edge"]["to"]
    edge_weight  = xai_json["top_edge"]["weight"]

    # Disease context — the critical new field from the multi-disease model
    dominant_disease = xai_json.get("dominant_disease")
    disease_label    = _DISEASE_LABELS.get(dominant_disease, dominant_disease or "unknown risk")
    all_risks        = xai_json.get("all_risks") or {}

    # delta is a z-score (standardised change); convert to approx % for readability
    # Rule of thumb: ~15% per SD, capped at 50 — gives "down ~26%" for z=-1.76
    if delta > 0.2:
        pct = min(int(abs(delta) * 15), 50)
        delta_str = f"up ~{pct}% above normal"
    elif delta < -0.2:
        pct = min(int(abs(delta) * 15), 50)
        delta_str = f"down ~{pct}% below normal"
    else:
        delta_str = "near baseline"

    # Secondary disease risks for context (exclude dominant)
    secondary = [
        f"{_DISEASE_LABELS.get(d, d)} {s:.0%}"
        for d, s in all_risks.items()
        if d != dominant_disease and s > 0.30
    ]
    secondary_str = (
        f"  Secondary risks: {', '.join(secondary)}.\n" if secondary else ""
    )

    return (
        f"Cow #{cow}\n"
        f"Overall risk: {risk:.0%}\n"
        f"Primary disease risk: {disease_label}\n"
        f"Key sensor signal: {feature} ({delta_str})\n"
        f"Closest at-risk contact: Cow #{edge_to} "
        f"(shared space strength: {edge_weight:.0%})\n"
        f"{secondary_str}"
        f"Write one farmer alert sentence."
    )


def _fallback_alert(xai_json: dict) -> str:
    """
    Template-based fallback used when both Ollama and Claude API are unreachable.
    Always returns a usable, specific string — API never returns 500 due to LLM failure.
    """
    cow          = xai_json["cow_id"]
    feature_raw  = xai_json["top_feature"]
    feature      = _FEATURE_LABELS.get(feature_raw, feature_raw.replace("_", " "))
    contact      = xai_json["top_edge"]["to"]
    dominant     = xai_json.get("dominant_disease")
    disease_str  = _DISEASE_LABELS.get(dominant, "health issue") if dominant else "health issue"
    delta        = xai_json["feature_delta"]
    risk         = xai_json["risk_score"]

    # Actionable verb based on risk level
    action = "Isolate" if risk > 0.70 else "Check"

    if abs(delta) > 0.2:
        direction = "dropped" if delta < 0 else "increased"
        pct       = min(int(abs(delta) * 15), 50)
        signal    = f"{feature} {direction} ~{pct}%"
    else:
        signal = f"abnormal {feature} detected"

    return (
        f"{action} #{cow}: {signal}, {disease_str} risk — "
        f"recently shared space with #{contact}. Inspect now."
    )


async def _try_claude_api(prompt: str) -> str | None:
    """
    Attempt to generate an alert using the Anthropic Claude API.
    Returns None if ANTHROPIC_API_KEY is not set or the call fails.
    Used only when Ollama is unreachable — data sovereignty note applies.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    try:
        import anthropic  # optional dependency
        client = anthropic.AsyncAnthropic(api_key=api_key)
        message = await client.messages.create(
            model="claude-haiku-4-5-20251001",   # fastest, lowest cost
            max_tokens=80,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text.strip()
    except Exception as e:
        logger.warning("Claude API fallback failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def generate_alert(xai_json: dict) -> str:
    """
    Generate a plain-English farmer alert from structured XAI data.

    Priority order:
        1. Ollama (local Mistral-7B) — primary, data stays on farm
        2. Anthropic Claude API      — if ANTHROPIC_API_KEY is set and Ollama fails
        3. Template fallback          — always works, no external dependencies

    Always returns a string — never raises. API never returns 500 due to LLM failure.

    Args:
        xai_json: structured dict from xai_bridge.build_xai_json()
                  must contain: cow_id, risk_score, top_feature, feature_delta,
                                top_edge, dominant_disease, all_risks

    Returns:
        Plain-English one-sentence alert, e.g.:
        "Isolate #47: milk yield dropped 18%, high mastitis risk — shared pen with #31."
    """
    prompt = _build_user_prompt(xai_json)

    # 1. Try Ollama (local, primary)
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "system": SYSTEM_PROMPT,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 80,
                    },
                },
            )
            response.raise_for_status()
            alert_text = response.json()["response"].strip()
            logger.info("Ollama alert for cow %d: %.60s…", xai_json["cow_id"], alert_text)
            return alert_text

    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logger.warning("Ollama unreachable (%s) — trying Claude API fallback", e)
    except Exception as e:
        logger.error("Unexpected Ollama error: %s — trying Claude API fallback", e)

    # 2. Try Claude API (cloud, secondary)
    claude_alert = await _try_claude_api(prompt)
    if claude_alert:
        logger.info("Claude API alert for cow %d: %.60s…", xai_json["cow_id"], claude_alert)
        return claude_alert

    # 3. Template fallback — always works
    logger.warning("All LLM backends failed for cow %d — using template", xai_json["cow_id"])
    return _fallback_alert(xai_json)
