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
from datetime import UTC, date, datetime
from typing import List, Optional, Union

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.mock_data import MOCK_HERD, MOCK_EXPLAIN, USE_MOCK

# ---------------------------------------------------------------------------
# Live herd state — module-level singletons, reset only on process restart
#
# _farm_df        : 60-cow synthetic base DataFrame, generated once on first use
# _field_overrides: {cow_id (int): {sensor_feature: float}} — applied to the
#                   last 7 days of _farm_df before each graph build
# _herd_result    : cached run_inference() output, invalidated after each ingest
# ---------------------------------------------------------------------------
_farm_df:         Optional[pd.DataFrame] = None
_field_overrides: dict                   = {}
_herd_result:     Optional[dict]         = None

# Sensor features accepted from CSV / JSON ingest
_INGESTABLE_FIELDS = frozenset({
    "activity", "highly_active", "rumination_min", "feeding_min",
    "ear_temp_c", "milk_yield_kg", "health_event", "feeding_visits",
    "days_in_milk", "pen_id", "bunk_id",
})


def _ensure_farm_df() -> pd.DataFrame:
    global _farm_df
    if _farm_df is None:
        from backend.graph_utils import generate_farm_df
        _farm_df = generate_farm_df()
    return _farm_df


def _rebuild_herd() -> dict:
    """Apply field overrides, rebuild graph, run inference, cache and return result."""
    global _herd_result
    from backend.graph_utils import build_graph, run_inference

    farm = _ensure_farm_df().copy()
    if _field_overrides:
        last_date = farm["date"].max()
        cutoff    = last_date - pd.Timedelta(days=6)
        for cow_id, fields in _field_overrides.items():
            mask = (farm["cow_id"] == cow_id) & (farm["date"] >= cutoff)
            for field, value in fields.items():
                if field in farm.columns:
                    farm.loc[mask, field] = value

    graph        = build_graph(farm)
    _herd_result = run_inference(graph)
    return _herd_result


def _snapshot_predictions() -> None:
    """Snapshot current alert/watch cows into _prediction_log."""
    global _prediction_counter
    if _herd_result is None:
        return
    ts = datetime.now(UTC).isoformat()
    cows = _herd_result.get("cows", []) if isinstance(_herd_result, dict) else _herd_result.cows
    for cow in cows:
        if isinstance(cow, dict):
            cow_id, risk_score, status = cow["id"], cow["risk_score"], cow["status"]
            dominant_disease, all_risks = cow.get("dominant_disease"), cow.get("all_risks")
        else:
            cow_id, risk_score, status = cow.id, cow.risk_score, cow.status
            dominant_disease, all_risks = cow.dominant_disease, cow.all_risks
        if status in ("alert", "watch"):
            _prediction_counter += 1
            _prediction_log.insert(0, {
                "id": _prediction_counter,
                "timestamp": ts,
                "cow_id": cow_id,
                "risk_score": round(risk_score, 3),
                "dominant_disease": dominant_disease,
                "all_risks": all_risks,
                "status": status,
                "outcome": None,
            })


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
    cow_id: Union[int, str]          # numeric tag (47) or named tag ("A", "Bessie")
    yield_kg: Optional[float] = None
    pen: Optional[str] = None
    health_event: Optional[str] = "none"   # none|lame|mastitis|calving|off_feed|other
    notes: Optional[str] = ""
    via_voice: Optional[bool] = False


class VoicePayload(BaseModel):
    transcript: str


class OutcomePayload(BaseModel):
    outcome: str  # "confirmed" | "unconfirmed"


# In-memory log — resets on server restart (fine for hackathon demo)
_ingest_log: list[dict] = []
_prediction_log: list[dict] = []
_prediction_counter: int = 0
_initial_snapshot_done: bool = False


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
    Result is cached and only rebuilt when new data is ingested via /api/ingest.
    """
    global _initial_snapshot_done
    if USE_MOCK:
        return MOCK_HERD

    if _herd_result is None:
        result = _rebuild_herd()
        if not _initial_snapshot_done:
            _snapshot_predictions()
            _initial_snapshot_done = True
        return result
    return _herd_result


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
    Stores in-memory and rebuilds herd risk scores if measurable fields are provided.
    Returns: {status, rows, total, herd_updated}
    """
    global _field_overrides
    record = payload.model_dump()
    record["timestamp"] = datetime.now(UTC).isoformat()
    _ingest_log.insert(0, record)

    herd_updated = False
    if not USE_MOCK:
        new_fields: dict = {}
        if payload.yield_kg is not None:
            new_fields["milk_yield_kg"] = float(payload.yield_kg)
        if payload.health_event and payload.health_event != "none":
            new_fields["health_event"] = 1.0
        if new_fields:
            _field_overrides[payload.cow_id] = {
                **_field_overrides.get(payload.cow_id, {}),
                **new_fields,
            }
            _rebuild_herd()
            _snapshot_predictions()
            herd_updated = True

    return {"status": "ok", "rows": 1, "total": len(_ingest_log), "herd_updated": herd_updated}


class _CsvIngestPayload(BaseModel):
    records: List[dict]


@app.post("/api/ingest/csv")
async def ingest_csv(payload: _CsvIngestPayload):
    """
    Accept batch farm observations from a CSV upload.

    Expected format (parsed by the frontend into JSON):
        records: [{cow_id, milk_yield_kg?, activity?, health_event?, ...}, ...]

    Rebuilds herd risk scores after applying overrides to the last 7-day window.
    Returns: {status, rows, cows_updated}
    """
    global _field_overrides
    cows_updated: set = set()

    for row in payload.records:
        if "cow_id" not in row:
            continue
        try:
            cow_id = int(row["cow_id"])
        except (ValueError, TypeError):
            continue

        fields: dict = {}
        for key in _INGESTABLE_FIELDS:
            raw = row.get(key)
            if raw not in (None, ""):
                try:
                    fields[key] = float(raw)
                except (ValueError, TypeError):
                    pass

        if fields:
            _field_overrides[cow_id] = {**_field_overrides.get(cow_id, {}), **fields}
            cows_updated.add(cow_id)

    if not USE_MOCK and cows_updated:
        _rebuild_herd()
        _snapshot_predictions()

    return {"status": "ok", "rows": len(payload.records), "cows_updated": len(cows_updated)}


@app.get("/api/history")
async def get_history():
    """
    Returns prediction history for the DataEntryLog component.

    Each entry includes cow_id, risk_score, dominant_disease, status (alert/watch),
    timestamp, and outcome (null = pending, "confirmed" = accurate, "unconfirmed" = false alarm).

    Also returns accuracy percentage (only over predictions that have received feedback).
    """
    with_outcome = [p for p in _prediction_log if p["outcome"] is not None]
    confirmed = sum(1 for p in with_outcome if p["outcome"] == "confirmed")
    accuracy = round(confirmed / len(with_outcome) * 100) if with_outcome else None
    return {
        "predictions": _prediction_log,
        "accuracy": accuracy,
        "total": len(_prediction_log),
        "confirmed": confirmed,
    }


@app.post("/api/history/{prediction_id}/outcome")
async def set_prediction_outcome(prediction_id: int, body: OutcomePayload):
    """
    Record a farmer's verdict on a past prediction.
    outcome must be "confirmed" (alert was accurate) or "unconfirmed" (false alarm).
    """
    if body.outcome not in ("confirmed", "unconfirmed"):
        raise HTTPException(status_code=422, detail="outcome must be 'confirmed' or 'unconfirmed'")
    for pred in _prediction_log:
        if pred["id"] == prediction_id:
            pred["outcome"] = body.outcome
            return {"status": "ok", "id": prediction_id, "outcome": body.outcome}
    raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")


# ---------------------------------------------------------------------------
# Impact metrics — single endpoint consumed by the Sustainability Impact screen.
# Computes all 4 metric cards from live herd state + prediction history.
# ---------------------------------------------------------------------------

@app.get("/api/impact")
async def get_impact():
    """
    Returns the 4 sustainability metric card values for the Impact screen.

    Metrics:
    - antibiotic_doses_avoided : alert_count*2 + watch_count*1
    - milk_yield_saved_usd     : alert_count*280 + watch_count*85 (7-day projection)
    - avg_lead_time_hours      : mean((risk-0.70)/0.30*48) over alert cows; null if none
    - alerts_confirmed_pct     : % of farmer-confirmed outcomes; null if no outcomes yet

    In mock mode returns static representative values so the UI is always populated.
    """
    if USE_MOCK:
        return {
            "antibiotic_doses_avoided": 5,
            "milk_yield_saved_usd":     645,
            "avg_lead_time_hours":      22,
            "alerts_confirmed_pct":     None,  # no history in mock mode
        }

    # Use cached herd result; fall back to MOCK_HERD before first ingest
    herd = _herd_result or MOCK_HERD
    cows = herd.get("cows", [])

    alert_cows = [c for c in cows if c.get("status") == "alert"]
    watch_cows = [c for c in cows if c.get("status") == "watch"]
    alert_count = len(alert_cows)
    watch_count  = len(watch_cows)

    doses   = alert_count * 2 + watch_count
    savings = alert_count * 280 + watch_count * 85

    if alert_count > 0:
        lead_time = round(
            sum((c["risk_score"] - 0.70) / 0.30 * 48 for c in alert_cows) / alert_count
        )
    else:
        lead_time = None

    with_outcome = [p for p in _prediction_log if p.get("outcome") is not None]
    confirmed    = sum(1 for p in with_outcome if p["outcome"] == "confirmed")
    accuracy_pct = round(confirmed / len(with_outcome) * 100) if with_outcome else None

    return {
        "antibiotic_doses_avoided": doses,
        "milk_yield_saved_usd":     savings,
        "avg_lead_time_hours":      lead_time,
        "alerts_confirmed_pct":     accuracy_pct,
    }


# ---------------------------------------------------------------------------
# Data tier tiers — tracks data richness and drives the upgrade nudge on the
# Impact screen. Tier 1 = manual records only (demo default). Tier 2 would
# require an automated milking system integration (future work).
# ---------------------------------------------------------------------------

_DATA_TIERS = [
    {
        "tier": 1,
        "label": "Manual Records Only",
        "accuracy": 51,
        "next_tier": 2,
        "next_tier_label": "Automated Milking System",
        "next_tier_accuracy": 74,
        "next_tier_description": "Connect your parlor's automated milking system to capture real-time yield, conductivity, and somatic cell counts.",
    },
    {
        "tier": 2,
        "label": "Automated Milking Connected",
        "accuracy": 74,
        "next_tier": 3,
        "next_tier_label": "Full Sensor Suite",
        "next_tier_accuracy": 89,
        "next_tier_description": "Add ear-tag accelerometers and rumen bolus sensors to capture activity and rumination in real time.",
    },
]


@app.get("/api/tier")
async def get_tier():
    """
    Returns the current data tier and next upgrade path.

    Tier 1 (default): manual records only — demo starting point.
    Tier 2: automated milking data connected (future integration).

    Upgrade detection is based on _field_overrides data sources;
    for the demo this always returns Tier 1.
    """
    return _DATA_TIERS[0]


# ---------------------------------------------------------------------------
# Voice / text observation parsing — local Ollama/Mistral, no API key needed.
# ---------------------------------------------------------------------------

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
        '- cow_id: tag/number/name (e.g. "47", "A", "Bessie"); null if unclear.\n'
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
                    "format": "json",
                    "options": {"temperature": 0.1, "num_predict": 400},
                },
            )
            response.raise_for_status()
            raw = response.json()["response"].strip()

    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start it with: ollama serve && ollama pull mistral",
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
