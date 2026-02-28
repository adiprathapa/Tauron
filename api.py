"""
api.py
------
FastAPI backend for Tauron.

Endpoints:
    GET  /herd              — all cow risk scores + graph edges
    GET  /alert/{cow_id}    — GNNExplainer JSON for one cow
    GET  /explain/{cow_id}  — Claude API plain-English alert
    POST /api/ingest        — CSV upload

Usage:
    source venv/bin/activate
    export ANTHROPIC_API_KEY=sk-...
    uvicorn api:app --reload
"""

import io
import json
import os
from typing import Optional

import numpy as np
import pandas as pd
import anthropic
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import tauron_pipeline as tp

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
    return {
        "cows":  _scores,
        "edges": [{"src": e[0], "dst": e[1], "w": w} for e, w in zip(ei, ew)],
    }


@app.get("/alert/{cow_id}")
def alert(cow_id: int):
    """GNNExplainer structured output for one cow."""
    if _graph is None:
        raise HTTPException(503, "model not loaded")
    if cow_id not in _graph.cow_ids:
        raise HTTPException(404, f"cow {cow_id} not found")
    return tp.explain_cow(_graph, _graph.cow_ids.index(cow_id))


@app.get("/explain/{cow_id}")
def explain(cow_id: int):
    """Call Claude API to convert XAI output → plain-English farmer alert."""
    if _graph is None:
        raise HTTPException(503, "model not loaded")
    if cow_id not in _graph.cow_ids:
        raise HTTPException(404, f"cow {cow_id} not found")

    xai    = tp.explain_cow(_graph, _graph.cow_ids.index(cow_id))
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg    = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=120,
        messages=[{"role": "user", "content":
            f"You are a dairy herd advisor. Write one plain-English action sentence "
            f"a farmer can act on immediately based on this model output: {json.dumps(xai)}"}],
    )
    return {"cow_id": f"#{cow_id}", "alert": msg.content[0].text, "xai": xai}


@app.post("/api/ingest")
async def ingest(file: Optional[UploadFile] = None, tier: int = 1):
    """Ingest farm data via CSV upload."""
    if file is None:
        raise HTTPException(400, "provide a CSV file")
    df = pd.read_csv(io.StringIO((await file.read()).decode()))
    return {"status": "ok", "rows": len(df), "tier": tier}
