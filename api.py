"""
api.py
------
FastAPI backend for Tauron.

Endpoints:
    GET  /herd              — all cow risk scores + graph edges
    GET  /alert/{cow_id}    — GNNExplainer JSON for one cow
    GET  /explain/{cow_id}  — plain-English alert via llm_engine (Ollama → Claude → template)
    POST /api/ingest        — CSV upload

Usage:
    source venv/bin/activate
    uvicorn api:app --reload
"""

import json
import os
from typing import Optional, Union

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import tauron_pipeline as tp
from backend.llm_engine import generate_alert


# ── Data entry models ──────────────────────────────────────────────────────────

class IngestPayload(BaseModel):
    cow_id: Union[int, str]
    yield_kg: Optional[float] = None
    pen: Optional[str] = None
    health_event: Optional[str] = "none"
    notes: Optional[str] = ""
    via_voice: Optional[bool] = False


class VoicePayload(BaseModel):
    transcript: str


# In-memory log — resets on server restart
_ingest_log: list = []


def _sanitize(obj):
    """Recursively convert numpy types to native Python for JSON serialization."""
    if isinstance(obj, dict):
        return {_sanitize(k): _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


app = FastAPI(title="Tauron", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# State loaded once at startup
_graph  = None
_scores = None


@app.on_event("startup")
def load():
    global _graph, _scores

    # Build demo farm with staged Cow #47 mastitis event
    farm_df = tp.generate_farm()
    rng     = np.random.default_rng(99)
    extra   = pd.date_range("2025-12-30", "2026-01-15")
    rows    = []
    for d in extra:
        for cow in range(tp.N_COWS):
            r = farm_df[farm_df["cow_id"] == cow].iloc[-1].copy()
            r["date"]          = d
            r["milk_yield_kg"] = float(r["milk_yield_kg"]) + rng.normal(0, 0.4)
            rows.append(r)

    demo_df = pd.concat([farm_df, pd.DataFrame(rows)], ignore_index=True)
    demo_df = tp.stage_demo(demo_df)

    tp.load_model("models/tauron_model.pt")

    _graph  = tp.build_graph(demo_df, "2026-01-13")
    _scores = tp.predict(_graph)
    print(f"Tauron API ready — {len(_scores)} cows | demo date 2026-01-13")


@app.get("/herd")
def herd():
    """All cow risk scores + graph edges for the pre-seeded demo farm."""
    if _scores is None:
        raise HTTPException(503, "model not loaded")

    cows = []
    for cow_id, risks in _scores.items():
        risk_score = max(risks.values())
        if risk_score > 0.70:
            status = "alert"
        elif risk_score >= 0.40:
            status = "watch"
        else:
            status = "ok"

        dominant_disease = max(risks, key=risks.get) if status != "ok" else None
        all_risks = {d: round(float(v), 3) for d, v in risks.items()} if status != "ok" else None

        # Get top_feature via explain_cow for non-ok cows
        top_feature = None
        if status != "ok" and cow_id in _graph.cow_ids:
            try:
                xai = tp.explain_cow(_graph, _graph.cow_ids.index(cow_id))
                top_feature = xai.get("top_feature")
            except Exception:
                pass

        cows.append({
            "id": int(cow_id),
            "risk_score": round(float(risk_score), 3),
            "status": status,
            "top_feature": top_feature,
            "dominant_disease": dominant_disease,
            "all_risks": all_risks,
        })

    ei = _graph.edge_index.t().tolist()
    ew = _graph.edge_attr.squeeze(-1).tolist()
    return JSONResponse(_sanitize({
        "cows":  cows,
        "edges": [{"src": e[0], "dst": e[1], "w": w} for e, w in zip(ei, ew)],
    }))


@app.get("/alert/{cow_id}")
def alert(cow_id: int):
    """GNNExplainer structured output for one cow."""
    if _graph is None:
        raise HTTPException(503, "model not loaded")
    if cow_id not in _graph.cow_ids:
        raise HTTPException(404, f"cow {cow_id} not found")
    return JSONResponse(_sanitize(tp.explain_cow(_graph, _graph.cow_ids.index(cow_id))))


@app.get("/explain/{cow_id}")
async def explain(cow_id: int):
    """
    Plain-English farmer alert via llm_engine 3-tier fallback:
    Ollama (local) → Claude API (if ANTHROPIC_API_KEY set) → template.
    Works with zero API keys configured.
    """
    if _graph is None:
        raise HTTPException(503, "model not loaded")
    if cow_id not in _graph.cow_ids:
        raise HTTPException(404, f"cow {cow_id} not found")

    xai = _sanitize(tp.explain_cow(_graph, _graph.cow_ids.index(cow_id)))

    # Map tauron_pipeline.explain_cow() output → llm_engine.generate_alert() input
    all_risks = xai.get("all_risks", {})
    risk_score = xai.get("risk", 0.0)
    dominant_disease = xai.get("dominant_disease")

    top_feature = xai.get("top_feature", "unknown")
    feature_delta = 0.0  # tauron_pipeline doesn't provide delta; llm_engine handles this

    # Convert top_edge format: {neighbour_cow, edge_weight} → {from, to, weight}
    raw_edge = xai.get("top_edge") or {}
    top_edge = {
        "from":   cow_id,
        "to":     raw_edge.get("neighbour_cow", cow_id),
        "weight": raw_edge.get("edge_weight", 0.0),
    }

    xai_json = {
        "cow_id":           cow_id,
        "risk_score":       risk_score,
        "top_feature":      top_feature,
        "feature_delta":    feature_delta,
        "top_edge":         top_edge,
        "dominant_disease": dominant_disease,
        "all_risks":        all_risks or None,
    }

    alert_text = await generate_alert(xai_json)
    return JSONResponse({"cow_id": f"#{cow_id}", "alert_text": alert_text, **xai})


@app.post("/api/ingest")
async def ingest(payload: IngestPayload):
    """Accept a single manual or voice-parsed farm observation. Stores in-memory."""
    from datetime import datetime
    record = payload.model_dump()
    record["timestamp"] = datetime.utcnow().isoformat()
    _ingest_log.insert(0, record)
    return {"status": "ok", "rows": 1, "total": len(_ingest_log)}


@app.get("/api/logs")
async def get_logs():
    """Return in-memory ingest log for the DataEntryLog component."""
    return {"logs": _ingest_log}


@app.post("/api/voice")
async def voice_to_data(payload: VoicePayload):
    """
    Parse a farmer's plain-English note into structured cow observations.
    Uses local Ollama/Mistral (no API key required). Handles multiple cows.
    Returns: { cows: [{cow_id, yield_kg, pen, health_event, notes},...], confidence, raw_transcript }
    """
    prompt = (
        "You are a farm data assistant. Extract dairy cow observations from the farmer's note. "
        "Output ONLY valid JSON matching this exact schema — no extra text:\n"
        '{"cows":[{"cow_id":"string or null","yield_kg":"number or null",'
        '"pen":"A1|A2|B1|Hospital|null","health_event":"none|lame|mastitis|calving|off_feed|other",'
        '"notes":"string"}],"confidence":0.0}\n\n'
        "Rules:\n"
        "- One object per cow mentioned.\n"
        "- cow_id: tag/number/name (e.g. \"47\", \"A\", \"Bessie\"); null if unclear.\n"
        "- yield_kg: number only if explicitly stated; null if vague (\"less milk\", \"not much\").\n"
        "- pen: exact value from list or null.\n"
        "- health_event: lame=limping/hoof, mastitis=udder, calving=birth, off_feed=not eating, other=other concern, none=healthy.\n"
        "- notes: brief summary of anything not captured above.\n"
        "- confidence: 0.0-1.0.\n\n"
        f'Farmer\'s note: "{payload.transcript}"\n\n'
        "JSON output:"
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": "mistral",
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",          # Ollama JSON mode — constrains output to valid JSON
                    "options": {"temperature": 0.1, "num_predict": 400},
                },
            )
            response.raise_for_status()
            raw = response.json()["response"].strip()

    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start it with: ollama serve"
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ollama error: {e}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raw = raw.strip("` \n")
        if raw.startswith("json"):
            raw = raw[4:]
        parsed = json.loads(raw)

    if "cows" not in parsed:
        parsed = {"cows": [parsed], "confidence": parsed.get("confidence", 1.0)}

    parsed["raw_transcript"] = payload.transcript
    return parsed
