"""
backend/main.py

Tauron FastAPI server — localhost:8000

Endpoints:
  GET /herd              — risk scores + adjacency matrix for D3.js graph
  GET /explain/{cow_id}  — gradient XAI + LLM alert for a specific cow

Mock mode:
  Set USE_MOCK = True in mock_data.py to serve hardcoded responses.
  Flip to False once tauron_model.pt is trained and graph_utils.py is implemented.
  Emergency rollback: flip USE_MOCK back to True — demo reverts in 30 seconds.

CORS: allow_origins=["*"] is intentional for localhost dev — lock down if deployed.
"""

from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.mock_data import MOCK_HERD, MOCK_EXPLAIN, USE_MOCK


# ---------------------------------------------------------------------------
# Response models
# Fields marked (new) are additions from multi-disease model — frontend can ignore
# unknown fields (additive changes are backwards-compatible with existing D3.js consumers).
# ---------------------------------------------------------------------------

class CowSummary(BaseModel):
    id: int
    risk_score: float
    status: str                      # "alert" | "watch" | "ok"
    top_feature: str | None          # highest-gradient sensor signal; null for "ok" cows
    dominant_disease: str | None     # (new) "mastitis" | "brd" | "lameness"; null if ok
    all_risks: dict | None           # (new) {disease: score}; null if ok


class HerdResponse(BaseModel):
    cows: list[CowSummary]
    adjacency: list[list[int]]


class ExplainResponse(BaseModel):
    cow_id: int
    risk_score: float
    top_edge: dict                   # {"from": int, "to": int, "weight": float}
    top_feature: str                 # e.g. "milk_yield_kg"
    feature_delta: float             # signed change vs 6-day baseline
    dominant_disease: str | None     # (new) primary disease risk
    all_risks: dict | None           # (new) full disease breakdown
    alert_text: str                  # plain-English farmer alert


class IngestPayload(BaseModel):
    cow_id: int
    yield_kg: Optional[float] = None
    pen: Optional[str] = None
    health_event: Optional[str] = "none"
    notes: Optional[str] = ""


# In-memory log — resets on server restart (fine for hackathon demo)
_ingest_log: list[dict] = []


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Tauron API",
    description=(
        "Early warning system for dairy herd disease detection. "
        "GraphSAGE + GRU model predicting mastitis, BRD, and lameness risk "
        "48 hours ahead. Gradient-based XAI with local Mistral-7B farmer alerts."
    ),
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # intentional for localhost dev — see claude.md
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/herd", response_model=HerdResponse)
async def get_herd():
    """
    Returns risk scores for all cows and the adjacency matrix.

    Each cow entry includes:
    - risk_score: max risk across mastitis, BRD, and lameness [0.0, 1.0]
    - status: "alert" (>0.70), "watch" (0.40–0.70), "ok" (<0.40)
    - dominant_disease: which disease is driving the risk (null if ok)
    - all_risks: individual scores per disease (null if ok)

    Adjacency matrix row/col order matches the cows list order exactly.
    """
    if USE_MOCK:
        return MOCK_HERD

    from backend.graph_utils import build_graph, run_inference
    graph = build_graph()
    return run_inference(graph)


@app.get("/explain/{cow_id}", response_model=ExplainResponse)
async def get_explain(cow_id: int):
    """
    Returns gradient XAI output + LLM-generated plain-English alert for one cow.

    Runs the full explanation pipeline:
    1. Builds contact graph from farm records
    2. Runs TauronGNN forward + backward pass for gradient attribution
    3. Identifies highest-importance sensor signal and contact edge
    4. Generates plain-English alert via local Mistral-7B (Ollama) or Claude API

    The alert text tells the farmer:
    - Which cow (#ID)
    - What disease risk (mastitis / BRD / lameness)
    - What sensor signal triggered it (e.g. milk yield dropped 18%)
    - Which contact cow is most relevant
    - What action to take (isolate / check / monitor)
    """
    if USE_MOCK:
        if cow_id not in MOCK_EXPLAIN:
            raise HTTPException(
                status_code=404,
                detail=f"Cow {cow_id} not found. Available IDs: {list(MOCK_EXPLAIN.keys())}",
            )
        return MOCK_EXPLAIN[cow_id]

    from backend.xai_bridge import explain_cow
    try:
        return await explain_cow(cow_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/ingest")
async def ingest(payload: IngestPayload):
    """
    Accept a single manual farm observation.
    Stores in-memory for the session (resets on restart).
    Returns: {status, rows}
    """
    from datetime import datetime
    record = payload.model_dump()
    record["timestamp"] = datetime.utcnow().isoformat()
    _ingest_log.append(record)
    return {"status": "ok", "rows": 1, "total": len(_ingest_log)}
