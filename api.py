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

import io
import json
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import tauron_pipeline as tp
from backend.llm_engine import generate_alert


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
    ei = _graph.edge_index.t().tolist()
    ew = _graph.edge_attr.squeeze(-1).tolist()
    return JSONResponse(_sanitize({
        "cows":  _scores,
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
    return JSONResponse({"cow_id": f"#{cow_id}", "alert": alert_text, "xai": xai})


@app.post("/api/ingest")
async def ingest(file: Optional[UploadFile] = None, tier: int = 1):
    """Ingest farm data via CSV upload."""
    if file is None:
        raise HTTPException(400, "provide a CSV file")
    df = pd.read_csv(io.StringIO((await file.read()).decode()))
    return {"status": "ok", "rows": len(df), "tier": tier}
