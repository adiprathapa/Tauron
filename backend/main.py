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

from datetime import UTC, date, datetime
from typing import List, Optional

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
    if USE_MOCK:
        return MOCK_HERD

    if _herd_result is None:
        return _rebuild_herd()
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

    return {"status": "ok", "rows": len(payload.records), "cows_updated": len(cows_updated)}
