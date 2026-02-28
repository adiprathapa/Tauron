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

import json
import os
from datetime import date, datetime
from typing import List, Optional, Union

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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
    top_feature: Optional[str]       # highest-gradient sensor signal; null for "ok" cows
    dominant_disease: Optional[str]  # (new) "mastitis" | "brd" | "lameness"; null if ok
    all_risks: Optional[dict]        # (new) {disease: score}; null if ok


class HerdResponse(BaseModel):
    cows: List[CowSummary]
    adjacency: List[List[int]]


class ExplainResponse(BaseModel):
    cow_id: int
    risk_score: float
    top_edge: dict                   # {"from": int, "to": int, "weight": float}
    top_feature: str                 # e.g. "milk_yield_kg"
    feature_delta: float             # signed change vs 6-day baseline
    dominant_disease: Optional[str]  # (new) primary disease risk
    all_risks: Optional[dict]        # (new) full disease breakdown
    alert_text: str                  # plain-English farmer alert


class IngestPayload(BaseModel):
    cow_id: Union[int, str]          # numeric tag (47) or named tag ("A", "Bessie")
    yield_kg: Optional[float] = None
    pen: Optional[str] = None
    health_event: Optional[str] = "none"   # none|lame|mastitis|calving|off_feed|other
    notes: Optional[str] = ""
    via_voice: Optional[bool] = False


class VoicePayload(BaseModel):
    transcript: str


# In-memory log — resets on server restart (fine for hackathon demo)
_ingest_log: list[dict] = []


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# In-memory record store — per-process, reset on restart (upgrade to DB later)
# ---------------------------------------------------------------------------

_records: List[dict] = []


# ---------------------------------------------------------------------------
# Normalisation helpers — all return List[{cow_id, date, metric, value}]
# ---------------------------------------------------------------------------

def _normalize_manual(body: dict) -> List[dict]:
    """Single manual-entry JSON: {cow_id, date?, milk_yield_kg?, pen_id?, health_event?}"""
    cow_id = int(body["cow_id"])
    dt = str(body.get("date") or date.today().isoformat())
    out = []
    if body.get("milk_yield_kg") is not None:
        out.append({"cow_id": cow_id, "date": dt, "metric": "milk_yield_kg",
                    "value": float(body["milk_yield_kg"])})
    if body.get("pen_id"):
        out.append({"cow_id": cow_id, "date": dt, "metric": "pen_id",
                    "value": str(body["pen_id"])})
    event = body.get("health_event")
    if event and event != "none":
        out.append({"cow_id": cow_id, "date": dt, "metric": "health_event", "value": 1.0})
        out.append({"cow_id": cow_id, "date": dt, "metric": "health_event_type",
                    "value": str(event)})
    return out


def _normalize_webhook(body: dict) -> List[dict]:
    """Single webhook record: {cow_id, metric, value, timestamp?}"""
    ts = body.get("timestamp") or date.today().isoformat()
    try:
        dt = str(datetime.fromisoformat(str(ts).replace("Z", "+00:00")).date())
    except (ValueError, AttributeError):
        dt = date.today().isoformat()
    return [{"cow_id": int(body["cow_id"]), "date": dt,
             "metric": str(body["metric"]), "value": body["value"]}]


def _normalize_batch(records: list) -> List[dict]:
    """Batch mode: {records: [{cow_id, date?, ...}, ...]}"""
    out = []
    for r in records:
        out.extend(_normalize_manual(r))
    return out


def _normalize_csv(df: pd.DataFrame) -> List[dict]:
    """Wide-format CSV: columns = [cow_id, date?, metric1, metric2, ...]"""
    if "date" not in df.columns:
        df = df.copy()
        df["date"] = date.today().isoformat()
    id_cols = {"cow_id", "date"}
    metric_cols = [c for c in df.columns if c not in id_cols]
    out = []
    for _, row in df.iterrows():
        cow_id = int(row["cow_id"])
        dt = str(row["date"])
        for col in metric_cols:
            val = row[col]
            if pd.notna(val):
                out.append({"cow_id": cow_id, "date": dt, "metric": col, "value": val})
    return out


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


@app.get("/api/logs")
async def get_logs():
    """
    Returns the in-memory ingest log for the DataEntryLog component.
    """
    return {"logs": _ingest_log}

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
    # Prepend instead of append to show newest first
    _ingest_log.insert(0, record)
    return {"status": "ok", "rows": 1, "total": len(_ingest_log)}


@app.post("/api/voice")
async def voice_to_data(payload: VoicePayload):
    """
    Parse a farmer's voice/text note into structured farm data using Claude.

    Handles multiple cows in a single note. Returns:
      { cows: [{cow_id, yield_kg, pen, health_event, notes}, ...], confidence, raw_transcript }

    Requires ANTHROPIC_API_KEY environment variable.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not set")

    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed; run: pip install anthropic")

    prompt = f"""You are a farm data assistant for dairy farmers. Extract structured observations from this farmer's note. There may be ONE or MULTIPLE cows mentioned.

Return ONLY a valid JSON object with exactly this structure:
{{
  "cows": [
    {{
      "cow_id": string or null,
      "yield_kg": float or null,
      "pen": string or null,
      "health_event": "none" | "lame" | "mastitis" | "calving" | "off_feed" | "other",
      "notes": string
    }}
  ],
  "confidence": float
}}

Rules:
- Create ONE entry per cow mentioned. If only one cow, the array has one element.
- cow_id: the cow tag, number, or name ("47", "A", "Bessie"); null if unclear.
- yield_kg: only if a specific number is given; null if vague ("less milk", "not much").
- pen: "A1", "A2", "B1", or "Hospital"; null if not mentioned.
- health_event: "lame" for limping/hoof, "mastitis" for udder issues, "calving" for birth, "off_feed" for not eating/reduced appetite, "other" for other concerns, "none" if healthy.
- notes: concise summary of anything not captured above; empty string if nothing extra.
- confidence: 0.0–1.0 overall confidence across all cows.

Examples:
  "Cow A was fine, 24 litres. B gave 18 and looked lame. C is in hospital."
  → {{"cows":[{{"cow_id":"A","yield_kg":24,"pen":null,"health_event":"none","notes":""}},{{"cow_id":"B","yield_kg":18,"pen":null,"health_event":"lame","notes":""}},{{"cow_id":"C","yield_kg":null,"pen":"Hospital","health_event":"none","notes":""}}],"confidence":0.95}}

  "47 wasn't eating much and milk was low"
  → {{"cows":[{{"cow_id":"47","yield_kg":null,"pen":null,"health_event":"off_feed","notes":"reduced milk yield"}}],"confidence":0.9}}

Farmer's note: "{payload.transcript}"

Return only the JSON object, no markdown, no explanation."""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raw = raw.strip("` \n")
        if raw.startswith("json"):
            raw = raw[4:]
        parsed = json.loads(raw)

    # Normalise: if Claude returned a flat single-cow object, wrap it
    if "cows" not in parsed:
        parsed = {"cows": [parsed], "confidence": parsed.get("confidence", 1.0)}

    parsed["raw_transcript"] = payload.transcript
    return parsed
