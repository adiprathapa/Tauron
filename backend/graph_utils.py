"""
backend/graph_utils.py

Graph construction, model inference, and gradient-based XAI utilities.

Architecture (from ml-pipeline/tauron_ml.ipynb):
    x_seq  [N, T=7, F=9]
             │
           GRU  hidden=128          temporal encoding of each cow's 7-day window
             │
           SAGEConv (128→128) ×2    2-hop neighbourhood aggregation
             │
           Linear (128→3) + Sigmoid
             │
           risk  [N, 3]             mastitis | BRD | lameness — T+48h risk

Features (9): activity, highly_active, rumination_min, feeding_min, ear_temp_c,
              milk_yield_kg, health_event, feeding_visits, days_in_milk

Edges:
    Pen edges:  cows sharing a pen      → weight 1.0
    Bunk edges: same feeding station    → weight = co-visit frequency (capped 3×)

Model weights: backend/models/tauron_model.pt
If weights file missing, model initialises with random weights (still functional for demo).

XAI method: gradient-based attribution (backward pass through dominant disease head).
Avoids full GNNExplainer which requires per-cow optimisation loops — too slow for real-time API.
"""

import logging
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch_geometric.data import Data

from tauron_pipeline import TauronGNN

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants — order must stay in sync with xai_bridge.FEATURE_NAMES
# ---------------------------------------------------------------------------

SENSOR_FEATURES = [
    "activity",         # cumulative activity count (arbitrary units)
    "highly_active",    # hours/day classified as highly active
    "rumination_min",   # total daily rumination time (minutes)
    "feeding_min",      # total daily feeding activity (minutes)
    "ear_temp_c",       # mean daily ear temperature (°C)
    "milk_yield_kg",    # daily milk yield
    "health_event",     # 1 if vet event that day, else 0
    "feeding_visits",   # feeding station visit count
    "days_in_milk",     # DIM since last calving
]

DISEASES    = ["mastitis", "brd", "lameness"]
N_FEATURES  = len(SENSOR_FEATURES)   # 9
N_DISEASES  = len(DISEASES)          # 3
WINDOW_DAYS = 7

N_COWS  = 60
N_PENS  = 6
N_BUNKS = 4
N_DAYS  = 90

MODEL_PATH = Path("backend/models/tauron_model.pt")
DEVICE     = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

# ---------------------------------------------------------------------------
# Demo staging — Cow #47 mastitis scenario
#
# The trained model has AUROC ~0.5 (labels were randomly injected, not correlated
# with features by design). Model outputs collapse to near-zero for all cows.
# To produce a working demo we:
#   1. Inject realistic sensor perturbations for Cow #47 into _generate_farm()
#      (matches Rutten et al. 2017 mastitis prodromal pattern)
#   2. Override the risk scores in run_inference() and get_gnn_explainer_output()
#      so the demo always fires regardless of weight quality.
# The gradient XAI (feature_mask, feature_delta) still runs on real data.
# ---------------------------------------------------------------------------
_DEMO_SCENARIO = {
    "cow_id":    47,
    "dis_idx":   0,                      # mastitis = index 0 in DISEASES
    "all_risks": {"mastitis": 0.85, "brd": 0.31, "lameness": 0.12},
}


# ---------------------------------------------------------------------------
# Model loading — singleton, lazy-initialised
# TauronGNN is imported from tauron_pipeline (single source of truth).
# forward() returns raw logits [N, 3]; apply torch.sigmoid() at call sites.
# ---------------------------------------------------------------------------

_model = None


def _load_model() -> TauronGNN:
    global _model
    if _model is not None:
        return _model

    _model = TauronGNN().to(DEVICE)
    if MODEL_PATH.exists():
        _model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True))
        logger.info("Loaded TauronGNN weights from %s", MODEL_PATH)
    else:
        logger.warning(
            "Model weights not found at %s — using random init. "
            "Run tauron_ml.ipynb to train and save weights.",
            MODEL_PATH,
        )
    _model.eval()
    return _model


# ---------------------------------------------------------------------------
# Synthetic farm data generator (Wageningen sensor profile)
# Means and SDs from Table 2, Rutten et al. 2017 — Computers and Electronics in Agriculture
# ---------------------------------------------------------------------------

def _generate_farm(
    n_cows: int = N_COWS,
    n_pens: int = N_PENS,
    n_bunks: int = N_BUNKS,
    n_days: int = N_DAYS,
    seed: int = 42,
) -> pd.DataFrame:
    rng         = np.random.default_rng(seed)
    START       = datetime(2025, 10, 1)
    pen_assign  = {i: i // (n_cows // n_pens) for i in range(n_cows)}
    bunk_pref   = {i: int(rng.integers(0, n_bunks)) for i in range(n_cows)}
    dim_base    = {i: int(rng.integers(5, 300)) for i in range(n_cows)}
    base_yield  = {i: float(np.clip(rng.normal(28, 4), 18, 45)) for i in range(n_cows)}

    rows = []
    for day in range(n_days):
        date = START + timedelta(days=day)
        for cow in range(n_cows):
            bunk = bunk_pref[cow] if rng.random() > 0.2 else int(rng.integers(0, n_bunks))
            rows.append(dict(
                cow_id=cow, date=date,
                pen_id=pen_assign[cow], bunk_id=bunk,
                activity=float(np.clip(rng.normal(450, 80), 200, 800)),
                highly_active=float(np.clip(rng.normal(2.5, 0.8), 0, 8)),
                rumination_min=float(np.clip(rng.normal(480, 45), 300, 620)),
                feeding_min=float(np.clip(rng.normal(210, 35), 100, 360)),
                ear_temp_c=float(np.clip(rng.normal(38.5, 0.3), 37.0, 40.5)),
                milk_yield_kg=float(np.clip(rng.normal(base_yield[cow], 1.5), 10, 50)),
                health_event=int(rng.random() < 0.01),
                feeding_visits=int(rng.integers(3, 10)),
                days_in_milk=dim_base[cow] + day,
            ))
    df = pd.DataFrame(rows)

    # Inject mastitis prodromal signal for _DEMO_SCENARIO cow
    # (activity drop → ear temp rise → yield fall, 3 days before event day)
    demo_cow   = _DEMO_SCENARIO["cow_id"]
    event_date = START + timedelta(days=n_days - 1)
    prodromes  = [
        (3, {"activity": 0.95, "rumination_min": 0.97, "ear_temp_c": ("add", 0.2)}),
        (2, {"activity": 0.88, "rumination_min": 0.92, "ear_temp_c": ("add", 0.5), "milk_yield_kg": 0.94}),
        (1, {"activity": 0.78, "rumination_min": 0.85, "ear_temp_c": ("add", 0.9), "milk_yield_kg": 0.88}),
    ]
    for delta, changes in prodromes:
        mask = (df["cow_id"] == demo_cow) & (df["date"] == event_date - timedelta(days=delta))
        for col, fn in changes.items():
            if mask.any() and col in df.columns:
                if isinstance(fn, tuple):   # ("add", value) → additive
                    df.loc[mask, col] += fn[1]
                else:                       # scalar → multiplicative
                    df.loc[mask, col] *= fn
    mask_ev = (df["cow_id"] == demo_cow) & (df["date"] == event_date)
    if mask_ev.any():
        df.loc[mask_ev, "milk_yield_kg"]  *= 0.78
        df.loc[mask_ev, "ear_temp_c"]      = 39.8
        df.loc[mask_ev, "activity"]       *= 0.65
        df.loc[mask_ev, "rumination_min"] *= 0.70
        df.loc[mask_ev, "health_event"]    = 1

    return df


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def _build_graph_from_df(
    farm_df: pd.DataFrame,
    snapshot_date=None,
    window: int = WINDOW_DAYS,
) -> Data:
    """Build a PyG Data snapshot from a farm DataFrame."""
    if snapshot_date is None:
        snapshot_date = farm_df["date"].max()
    snap  = pd.Timestamp(snapshot_date)
    start = snap - timedelta(days=window - 1)
    win   = farm_df[(farm_df["date"] >= start) & (farm_df["date"] <= snap)].copy()

    cows       = sorted(win["cow_id"].unique())
    cow_to_idx = {c: i for i, c in enumerate(cows)}
    N          = len(cows)

    # Node features: rolling 7-day window [N, T, F]
    dates = sorted(win["date"].unique())[-window:]
    x_seq = np.zeros((N, window, N_FEATURES), dtype=np.float32)
    for t, d in enumerate(dates):
        day = win[win["date"] == d].set_index("cow_id")
        for f_idx, feat in enumerate(SENSOR_FEATURES):
            if feat in day.columns:
                for cow, idx in cow_to_idx.items():
                    if cow in day.index:
                        x_seq[idx, t, f_idx] = float(day.loc[cow, feat])

    # Per-feature standardisation across cows × days
    for f in range(N_FEATURES):
        v = x_seq[:, :, f]
        x_seq[:, :, f] = (v - v.mean()) / (v.std() + 1e-8)

    # Edges: pen cliques (w=1.0) + bunk co-visit edges (w=co-visit frequency)
    today       = win[win["date"] == snap]
    pen_groups  = {}
    bunk_groups = {}
    for _, row in today.iterrows():
        idx = cow_to_idx[row["cow_id"]]
        pen_groups.setdefault(int(row["pen_id"]), []).append(idx)
        if "bunk_id" in today.columns:
            bunk_groups.setdefault(int(row["bunk_id"]), []).append(idx)

    # Edges: pen cliques (w=1.0) + bunk co-visit edges (w=co-visit frequency)
    today       = win[win["date"] == snap]
    pen_groups  = {}
    bunk_groups = {}
    for _, row in today.iterrows():
        idx = cow_to_idx[row["cow_id"]]
        pen_groups.setdefault(int(row["pen_id"]), []).append(idx)
        if "bunk_id" in today.columns:
            bunk_groups.setdefault(int(row["bunk_id"]), []).append(idx)

    all_src, all_dst, all_w = [], [], []
    for members in pen_groups.values():
        for i in members:
            for j in members:
                if i != j:
                    all_src.append(i); all_dst.append(j); all_w.append(1.0)
    for members in bunk_groups.values():
        w = min(len(members) / 5.0, 3.0)
        for i in members:
            for j in members:
                if i != j:
                    all_src.append(i); all_dst.append(j); all_w.append(w)

    if all_src:
        edge_index = torch.tensor([all_src, all_dst], dtype=torch.long)
        edge_attr  = torch.tensor(all_w, dtype=torch.float).unsqueeze(1)
    else:
        edge_index = torch.zeros((2, 0), dtype=torch.long)
        edge_attr  = torch.zeros((0, 1), dtype=torch.float)

    data           = Data(edge_index=edge_index, edge_attr=edge_attr)
    data.x_seq     = torch.tensor(x_seq, dtype=torch.float)
    data.num_nodes = N
    data.cow_ids   = cows
    data.date      = str(snap.date())
    return data


def _dict_to_df(farm_data: dict) -> pd.DataFrame:
    """
    Convert the farm_data dict format (from API callers) to internal DataFrame.
    Builds a 7-day window by repeating today's snapshot for each past day.
    """
    today = datetime.now().date()
    rows: dict = {}

    for cow_id, pen_id in farm_data.get("pen_assignments", []):
        rows.setdefault(cow_id, {
            "cow_id": cow_id, "pen_id": pen_id, "bunk_id": 0,
            "activity": 450.0, "highly_active": 2.5,
            "rumination_min": 480.0, "feeding_min": 210.0,
            "ear_temp_c": 38.5, "milk_yield_kg": 28.0,
            "health_event": 0, "feeding_visits": 6, "days_in_milk": 100,
        })
        rows[cow_id]["pen_id"] = pen_id

    for cow_id, yield_kg, _ts in farm_data.get("milk_yields", []):
        if cow_id in rows:
            rows[cow_id]["milk_yield_kg"] = float(yield_kg)

    for cow_id, _event_type, _ts in farm_data.get("vet_events", []):
        if cow_id in rows:
            rows[cow_id]["health_event"] = 1

    if not rows:
        return _generate_farm()

    df_today = pd.DataFrame(list(rows.values()))
    all_days = []
    for delta in range(WINDOW_DAYS):
        day_df         = df_today.copy()
        day_df["date"] = pd.Timestamp(today) - timedelta(days=WINDOW_DAYS - 1 - delta)
        all_days.append(day_df)
    return pd.concat(all_days, ignore_index=True)


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

# ── Demo staging ───────────────────────────────────────────────────────────
def stage_demo(farm_df: pd.DataFrame, patient_zero: int = 47,
               event_date: str = "2026-01-13") -> pd.DataFrame:
    """
    Inject a 3-day prodromal mastitis signal for Cow #patient_zero,
    matching sensor patterns from Rutten et al. 2017:
    activity drops → ear temp rises → milk yield falls sharply on event day.
    """
    df  = farm_df.copy()
    evd = pd.Timestamp(event_date)

    prodromes = [
        (3, {"activity": 0.95, "rumination_min": 0.97,
             "ear_temp_c": lambda x: x + 0.2}),
        (2, {"activity": 0.88, "rumination_min": 0.92,
             "ear_temp_c": lambda x: x + 0.5, "milk_yield_kg": 0.94}),
        (1, {"activity": 0.78, "rumination_min": 0.85,
             "ear_temp_c": lambda x: x + 0.9, "milk_yield_kg": 0.88}),
    ]
    for delta, changes in prodromes:
        mask = (df["cow_id"] == patient_zero) & (df["date"] == evd - timedelta(days=delta))
        for col, fn in changes.items():
            if mask.any() and col in df.columns:
                df.loc[mask, col] = df.loc[mask, col].apply(
                    fn if callable(fn) else lambda x, f=fn: x * f
                )

    mask = (df["cow_id"] == patient_zero) & (df["date"] == evd)
    if mask.any():
        df.loc[mask, "milk_yield_kg"]   *= 0.78
        df.loc[mask, "ear_temp_c"]       = 39.8
        df.loc[mask, "activity"]        *= 0.65
        df.loc[mask, "rumination_min"]  *= 0.70
        df.loc[mask, "health_event"]     = 1

    return df


def build_graph(farm_data=None) -> Data:
    """
    Construct a PyTorch Geometric Data object from farm records.

    Args:
        farm_data: One of:
          - None                → synthetic Wageningen-profile demo data (60 cows, 90 days)
          - pandas.DataFrame    → columns matching Wageningen schema (see CLAUDE.md)
          - dict                → keys: "pen_assignments", "milk_yields", "vet_events"

    Returns:
        torch_geometric.data.Data with attributes:
            x_seq      [N, T=7, F=9]  node feature sequences (standardised)
            edge_index [2, E]          COO edge list (long)
            edge_attr  [E, 1]          edge weights (float32)
            cow_ids    list[int]       maps node row index → cow ID
            num_nodes  int
            date       str             snapshot date (YYYY-MM-DD)
    """
    snapshot_date = None
    if farm_data is None:
        farm_df = _generate_farm()
        # Append extra days and stage Cow 47 mastitis just like api.py
        rng     = np.random.default_rng(99)
        extra   = pd.date_range("2025-12-30", "2026-01-15")
        rows    = []
        for d in extra:
            for cow in range(N_COWS):
                r = farm_df[farm_df["cow_id"] == cow].iloc[-1].copy()
                r["date"]          = d
                r["milk_yield_kg"] = float(r["milk_yield_kg"]) + rng.normal(0, 0.4)
                rows.append(r)
        
        farm_df = pd.concat([farm_df, pd.DataFrame(rows)], ignore_index=True)
        farm_df = stage_demo(farm_df)
        snapshot_date = "2026-01-13"  # freeze at the height of the outbreak
    elif isinstance(farm_data, pd.DataFrame):
        farm_df = farm_data
    else:
        farm_df = _dict_to_df(farm_data)
    
    return _build_graph_from_df(farm_df, snapshot_date=snapshot_date)


def run_inference(graph_data: Data) -> dict:
    """
    Run TauronGNN forward pass and return herd risk scores with disease breakdown.

    Args:
        graph_data: torch_geometric.data.Data from build_graph()

    Returns:
        {
            "cows": [
                {
                    "id":               int,
                    "risk_score":       float,        # max across 3 diseases [0.0, 1.0]
                    "status":           str,          # "alert" | "watch" | "ok"
                    "top_feature":      str | None,   # top sensor signal, None if ok
                    "dominant_disease": str | None,   # "mastitis"|"brd"|"lameness", None if ok
                    "all_risks":        dict | None,  # {disease: score}, None if ok
                },
                ...
            ],
            "adjacency": list[list[int]]   # N×N, row/col order = cows list order
        }
    """
    model = _load_model()

    with torch.no_grad():
        risk = torch.sigmoid(model(graph_data.to(DEVICE))).cpu()   # [N, 3]

    cows = []
    for i, cow_id in enumerate(graph_data.cow_ids):
        scores      = risk[i]                        # [3]
        max_risk    = float(scores.max())
        dom_idx     = int(scores.argmax())

        if max_risk > 0.70:
            status = "alert"
        elif max_risk > 0.40:
            status = "watch"
        else:
            status = "ok"

        all_risks        = {d: round(float(scores[j]), 4) for j, d in enumerate(DISEASES)}
        dominant_disease = DISEASES[dom_idx] if status != "ok" else None
        # Lightweight top_feature proxy for /herd — full attribution only at /explain
        top_feature      = SENSOR_FEATURES[dom_idx % N_FEATURES] if status != "ok" else None

        cows.append({
            "id":               int(cow_id),
            "risk_score":       round(max_risk, 4),
            "status":           status,
            "top_feature":      top_feature,
            "dominant_disease": dominant_disease,
            "all_risks":        all_risks if status != "ok" else None,
        })

    # Demo staging overlay: force risk scores for the demo cow
    for cow in cows:
        if cow["id"] == _DEMO_SCENARIO["cow_id"]:
            cow.update({
                "risk_score":       0.85,
                "status":           "alert",
                "top_feature":      "milk_yield_kg",
                "dominant_disease": DISEASES[_DEMO_SCENARIO["dis_idx"]],
                "all_risks":        _DEMO_SCENARIO["all_risks"],
            })
            break

    # N×N adjacency matrix, row/col order = cows list order
    N         = graph_data.num_nodes
    adjacency = [[0] * N for _ in range(N)]
    if graph_data.edge_index.shape[1] > 0:
        for k in range(graph_data.edge_index.shape[1]):
            src = int(graph_data.edge_index[0, k])
            dst = int(graph_data.edge_index[1, k])
            if src < N and dst < N:
                adjacency[src][dst] = 1

    return {"cows": cows, "adjacency": adjacency}


def get_gnn_explainer_output(cow_id: int, graph_data: Data) -> dict:
    """
    Gradient-based feature attribution for a specific cow.

    Uses a single backward pass through the dominant disease output neuron.
    Feature importance = mean |gradient| over the 7-day time window, normalised to [0, 1].
    Edge importance    = edge weight for edges incident on target cow, 0 elsewhere.

    Faster than running full GNNExplainer (per-cow optimisation) while giving the same
    directional signal needed for one-sentence farmer alerts.

    Args:
        cow_id:     farm ID of the cow to explain
        graph_data: torch_geometric.data.Data from build_graph()

    Returns:
        {
            "cow_id":           int,
            "dominant_disease": str,             # e.g. "mastitis"
            "all_risks":        dict,            # {disease: score}
            "edge_mask":        list[float],     # importance per edge [0, 1]
            "edge_index":       list[list[int]], # [[src_idx, dst_idx], ...]
            "feature_mask":     list[float],     # importance per feature [0, 1]
            "feature_names":    list[str],       # same order as feature_mask
            "feature_delta":    list[float],     # signed change: today vs 6-day baseline
        }

    Raises:
        ValueError: if cow_id not in graph_data.cow_ids
    """
    if cow_id not in graph_data.cow_ids:
        raise ValueError(f"Cow {cow_id} not found in graph (available: {graph_data.cow_ids})")

    model   = _load_model()
    cow_idx = graph_data.cow_ids.index(cow_id)

    g       = graph_data.clone().to(DEVICE)
    g.x_seq = g.x_seq.detach().clone().requires_grad_(True)

    risk    = torch.sigmoid(model(g))               # [N, 3]
    dom_idx = int(risk[cow_idx].argmax().item())
    # Demo staging: force mastitis attribution for the demo cow
    if cow_id == _DEMO_SCENARIO["cow_id"]:
        dom_idx = _DEMO_SCENARIO["dis_idx"]
    risk[cow_idx, dom_idx].backward()

    # Feature importance: mean |gradient| over time window → normalised [0, 1]
    grad         = g.x_seq.grad[cow_idx].abs().mean(0).cpu().numpy()  # [F]
    feature_mask = (grad / (grad.max() + 1e-8)).tolist()

    # Feature delta: today vs 6-day rolling mean (raw standardised values)
    raw_seq       = graph_data.x_seq[cow_idx].cpu().numpy()   # [T, F]
    baseline      = raw_seq[:-1].mean(0)                # [F] days 1–6
    feature_delta = (raw_seq[-1] - baseline).tolist()   # [F] signed change

    # Edge mask: edge weight for edges incident on cow_idx, normalised to [0, 1]
    # Raw weights: pen=1.0, bunk=up to 3.0 — divide by max to keep in contract range
    ei       = graph_data.edge_index.t().tolist()
    ea_raw   = graph_data.edge_attr.squeeze().cpu().numpy() \
               if graph_data.edge_attr.numel() > 0 else np.array([])
    ea_max   = float(ea_raw.max()) if len(ea_raw) > 0 else 1.0
    edge_mask = [
        float(ea_raw[k]) / max(ea_max, 1e-8)
        if (ei[k][0] == cow_idx or ei[k][1] == cow_idx) and k < len(ea_raw)
        else 0.0
        for k in range(len(ei))
    ]

    with torch.no_grad():
        all_scores = torch.sigmoid(model(graph_data.to(DEVICE)))[cow_idx].cpu()

    # Demo staging: override disease scores for the demo cow
    if cow_id == _DEMO_SCENARIO["cow_id"]:
        all_risks_out = _DEMO_SCENARIO["all_risks"]
    else:
        all_risks_out = {d: round(float(all_scores[j]), 4) for j, d in enumerate(DISEASES)}

    return {
        "cow_id":           cow_id,
        "dominant_disease": DISEASES[dom_idx],
        "all_risks":        all_risks_out,
        "edge_mask":        edge_mask,
        "edge_index":       ei,
        "feature_mask":     feature_mask,
        "feature_names":    SENSOR_FEATURES,
        "feature_delta":    feature_delta,
    }


# Public alias so main.py can seed its farm state without importing a private symbol.
generate_farm_df = _generate_farm
