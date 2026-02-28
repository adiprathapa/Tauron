"""
tauron_pipeline.py
------------------
Core pipeline: farm data generation, graph construction, TauronGNN model,
inference, and XAI. Imported by train.py and api.py.
"""

import warnings
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv

warnings.filterwarnings("ignore")

# ── Constants ──────────────────────────────────────────────────────────────
DEVICE      = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
N_COWS      = 60
N_PENS      = 6
N_BUNKS     = 4
N_DAYS      = 90
START       = datetime(2025, 10, 1)
WINDOW_DAYS = 7
DISEASES    = ["mastitis", "brd", "lameness"]

SENSOR_FEATURES = [
    "activity",       # cumulative activity count (SensOor ear-tag)
    "highly_active",  # hours/day classified as highly active
    "rumination_min", # daily rumination time (min)
    "feeding_min",    # daily feeding activity (min)
    "ear_temp_c",     # mean daily ear temperature (°C)
    "milk_yield_kg",  # daily milk yield
    "health_event",   # 1 = vet treatment recorded
    "feeding_visits", # feeding station visit count
    "days_in_milk",   # DIM since last calving
]
N_FEATURES = len(SENSOR_FEATURES)

# Transmission rates per edge contact per day — from published literature:
# Mastitis: Zadoks et al. 2011, J Dairy Sci
# BRD:      Snowder et al. 2006, J Anim Sci
# Lameness: Fourichon et al. 2003, J Dairy Sci
TRANSMISSION = {"mastitis": 0.15, "brd": 0.25, "lameness": 0.05}
BACKGROUND   = {"mastitis": 0.008, "brd": 0.005, "lameness": 0.006}


# ── Farm data generator ────────────────────────────────────────────────────
def generate_farm(n_cows: int = N_COWS, n_pens: int = N_PENS,
                  n_bunks: int = N_BUNKS, n_days: int = N_DAYS,
                  seed: int = 42) -> pd.DataFrame:
    """
    Synthetic dairy farm dataset matching the Wageningen SensOor sensor profile
    (Rutten et al. 2017, Computers and Electronics in Agriculture 132:108-118).
    Swap for real data by loading data/wageningen.csv with matching column names.
    """
    rng        = np.random.default_rng(seed)
    pen_assign = {i: i // (n_cows // n_pens) for i in range(n_cows)}
    bunk_pref  = {i: int(rng.integers(0, n_bunks)) for i in range(n_cows)}
    dim_base   = {i: int(rng.integers(5, 300)) for i in range(n_cows)}
    base_yield = {i: float(rng.normal(28, 4).clip(18, 45)) for i in range(n_cows)}

    rows = []
    for day in range(n_days):
        date = START + timedelta(days=day)
        for cow in range(n_cows):
            bunk = bunk_pref[cow] if rng.random() > 0.2 else int(rng.integers(0, n_bunks))
            rows.append(dict(
                cow_id        = cow,
                date          = date,
                pen_id        = pen_assign[cow],
                bunk_id       = bunk,
                activity      = float(rng.normal(450, 80).clip(200, 800)),
                highly_active = float(rng.normal(2.5, 0.8).clip(0, 8)),
                rumination_min= float(rng.normal(480, 45).clip(300, 620)),
                feeding_min   = float(rng.normal(210, 35).clip(100, 360)),
                ear_temp_c    = float(rng.normal(38.5, 0.3).clip(37.0, 40.5)),
                milk_yield_kg = float(rng.normal(base_yield[cow], 1.5).clip(10, 50)),
                health_event  = int(rng.random() < 0.01),
                feeding_visits= int(rng.integers(3, 10)),
                days_in_milk  = dim_base[cow] + day,
            ))
    return pd.DataFrame(rows)


# ── Graph builder ──────────────────────────────────────────────────────────
def build_graph(farm_df: pd.DataFrame, snapshot_date,
                window: int = WINDOW_DAYS) -> Data:
    """
    Build a PyG Data snapshot for a single day.

    Edges:
      - Pen edge:  cows sharing a pen         → weight 1.0
      - Bunk edge: cows at the same feed bunk → weight = co-visit freq (capped 3×)

    Node features: rolling `window`-day history, zero-padded for missing days,
    standardised per feature across all cows × days in the window.
    """
    snap  = pd.Timestamp(snapshot_date)
    start = snap - timedelta(days=window - 1)
    win   = farm_df[(farm_df["date"] >= start) & (farm_df["date"] <= snap)].copy()

    cows       = sorted(win["cow_id"].unique())
    cow_to_idx = {c: i for i, c in enumerate(cows)}
    N          = len(cows)
    dates      = sorted(win["date"].unique())[-window:]
    x_seq      = np.zeros((N, window, N_FEATURES), dtype=np.float32)

    for t, d in enumerate(dates):
        day = win[win["date"] == d].set_index("cow_id")
        for f_idx, feat in enumerate(SENSOR_FEATURES):
            if feat in day.columns:
                for cow, idx in cow_to_idx.items():
                    if cow in day.index:
                        x_seq[idx, t, f_idx] = day.loc[cow, feat]

    for f in range(N_FEATURES):
        v = x_seq[:, :, f]
        x_seq[:, :, f] = (v - v.mean()) / (v.std() + 1e-8)

    today       = win[win["date"] == snap]
    pen_groups: Dict[int, List[int]]  = {}
    bunk_groups: Dict[int, List[int]] = {}
    for _, row in today.iterrows():
        idx = cow_to_idx[row["cow_id"]]
        if "pen_id"  in today.columns:
            pen_groups.setdefault(int(row["pen_id"]), []).append(idx)
        if "bunk_id" in today.columns:
            bunk_groups.setdefault(int(row["bunk_id"]), []).append(idx)

    def clique_edges(groups: Dict[int, List[int]], weight_fn):
        src, dst, w = [], [], []
        for members in groups.values():
            for i in members:
                for j in members:
                    if i != j:
                        src.append(i); dst.append(j)
                        w.append(weight_fn(len(members)))
        return src, dst, w

    ps, pd_, pw = clique_edges(pen_groups,  lambda n: 1.0)
    bs, bd,  bw = clique_edges(bunk_groups, lambda n: min(n / 5.0, 3.0))
    all_src = ps + bs
    all_dst = pd_ + bd
    all_w   = pw + bw

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


# ── Synthetic disease injection ────────────────────────────────────────────
def inject_disease(graph: Data, disease: str, n_seeds: int = 1,
                   rng: Optional[np.random.Generator] = None) -> torch.Tensor:
    """
    Inject a disease event and propagate for 2 rounds (= 48 h) through the
    contact graph. Returns binary label tensor [N] — sick at T+48h.
    """
    if rng is None:
        rng = np.random.default_rng()
    N  = graph.num_nodes
    ei = graph.edge_index.numpy()
    ew = graph.edge_attr.squeeze(-1).numpy()
    p  = TRANSMISSION[disease]

    labels = (rng.random(N) < BACKGROUND[disease]).astype(int)
    if n_seeds > 0:
        labels[rng.choice(N, size=min(n_seeds, N), replace=False)] = 1

    for _ in range(2):
        new = labels.copy()
        for k in range(ei.shape[1]):
            src, dst = ei[0, k], ei[1, k]
            if labels[src] == 1 and new[dst] == 0:
                if rng.random() < min(p * float(ew[k]), 1.0):
                    new[dst] = 1
        labels = new

    return torch.tensor(labels, dtype=torch.float)


def make_labels(graph: Data,
                rng: Optional[np.random.Generator] = None) -> torch.Tensor:
    """Return [N, 3] label tensor — one column per disease."""
    if rng is None:
        rng = np.random.default_rng()
    return torch.stack([
        inject_disease(graph, d, n_seeds=int(rng.integers(0, 3)), rng=rng)
        for d in DISEASES
    ], dim=1)


def build_dataset(farm_df: pd.DataFrame, n_runs: int = 7,
                  window: int = WINDOW_DAYS) -> List[Data]:
    """
    Build labelled dataset: n_runs disease-injection runs per snapshot date.
    With n_runs=7 and 83 valid dates → 581 labelled graphs (>500 target).
    """
    dates   = sorted(farm_df["date"].unique())[window:]
    dataset = []
    rng     = np.random.default_rng(42)
    print(f"Building {len(dates)} × {n_runs} = {len(dates) * n_runs} labelled snapshots…")

    for i, date in enumerate(dates):
        base = build_graph(farm_df, date, window)
        for _ in range(n_runs):
            g   = base.clone()
            g.y = make_labels(g, rng)
            dataset.append(g)
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(dates)}")

    print(f"Done — {len(dataset)} graphs")
    return dataset


# ── Model ──────────────────────────────────────────────────────────────────
class TauronGNN(nn.Module):
    """
    GraphSAGE + GRU early-warning model.

    Architecture:
        x_seq [N, T=7, F=9]
            │
        GRU (hidden=128)          temporal encoding per cow
            │
        SAGEConv × 2 (2-hop)      neighbourhood message passing
            │
        Linear (128 → 3)          three-head decoder
            │
        logits [N, 3]             mastitis | BRD | lameness — T+48h
    """
    def __init__(self, n_features: int = N_FEATURES, hidden: int = 128,
                 n_diseases: int = 3, dropout: float = 0.3):
        super().__init__()
        self.gru     = nn.GRU(input_size=n_features, hidden_size=hidden,
                              num_layers=1, batch_first=True)
        self.sage1   = SAGEConv(hidden, hidden)
        self.sage2   = SAGEConv(hidden, hidden)
        self.norm1   = nn.LayerNorm(hidden)
        self.norm2   = nn.LayerNorm(hidden)
        self.drop    = nn.Dropout(dropout)
        self.decoder = nn.Linear(hidden, n_diseases)

    def forward(self, data: Data) -> torch.Tensor:
        _, h_n = self.gru(data.x_seq)          # [1, N, H]
        h = h_n.squeeze(0)                     # [N, H]
        h = self.drop(F.relu(self.norm1(self.sage1(h, data.edge_index))))
        h = self.drop(F.relu(self.norm2(self.sage2(h, data.edge_index))))
        return self.decoder(h)                 # raw logits [N, 3]


# Global model — call load_model() before predict() / explain_cow()
model = TauronGNN().to(DEVICE)


def load_model(ckpt: str = "models/tauron_model.pt") -> None:
    path = Path(ckpt)
    if path.exists():
        model.load_state_dict(torch.load(path, map_location=DEVICE))
        model.eval()
        print(f"Loaded {ckpt}")
    else:
        print(f"WARNING: {ckpt} not found — run python train.py first")


# ── Inference ──────────────────────────────────────────────────────────────
@torch.no_grad()
def predict(graph: Data) -> Dict:
    """Return cow_id → {mastitis, brd, lameness} risk scores in [0, 1]."""
    model.eval()
    risk = torch.sigmoid(model(graph.to(DEVICE))).cpu()
    return {
        cid: {d: round(float(risk[i, j]), 3) for j, d in enumerate(DISEASES)}
        for i, cid in enumerate(graph.cow_ids)
    }


def explain_cow(graph: Data, cow_idx: int) -> Dict:
    """
    Gradient-based feature importance + top contact edge.
    Returns structured JSON for the Claude API alert prompt.
    """
    model.eval()
    g = graph.clone().to(DEVICE)
    g.x_seq.requires_grad_(True)

    risk = torch.sigmoid(model(g))[cow_idx]
    dom  = risk.argmax().item()
    risk[dom].backward()

    grad      = g.x_seq.grad[cow_idx].abs().mean(0).cpu().numpy()
    total     = grad.sum() + 1e-8
    ranked    = sorted(range(N_FEATURES), key=lambda i: -grad[i])
    top_feats = [
        {"feature": SENSOR_FEATURES[i], "importance": round(float(grad[i] / total), 3)}
        for i in ranked[:3]
    ]

    with torch.no_grad():
        all_risk_herd = torch.sigmoid(model(graph.to(DEVICE))).cpu()
    all_risk = all_risk_herd[cow_idx]

    ei        = graph.edge_index.cpu().numpy()
    ea        = graph.edge_attr.squeeze(-1).cpu().numpy()
    connected = [(k, int(ei[1, k])) for k in range(ei.shape[1]) if ei[0, k] == cow_idx]

    top_edge = None
    if connected:
        k, nbr   = max(connected, key=lambda x: float(ea[x[0]]) if x[0] < len(ea) else 0)
        top_edge = {"neighbour_cow": graph.cow_ids[nbr],
                    "edge_weight":   round(float(ea[k]), 2)}

    seen, pen_mates_elevated = set(), []
    for _, nbr_idx in connected:
        nbr_cid = graph.cow_ids[nbr_idx]
        if nbr_cid in seen:
            continue
        seen.add(nbr_cid)
        nbr_r = round(float(all_risk_herd[nbr_idx, dom]), 3)
        if nbr_r > 0.3:
            pen_mates_elevated.append({"cow_id": nbr_cid, "risk": nbr_r})

    return {
        "cow_id":             f"#{graph.cow_ids[cow_idx]}",
        "date":               graph.date,
        "risk":               round(float(all_risk[dom]), 3),
        "dominant_disease":   DISEASES[dom],
        "all_risks":          {d: round(float(all_risk[i]), 3) for i, d in enumerate(DISEASES)},
        "top_feature":        top_feats[0]["feature"],
        "top_features":       top_feats,
        "top_edge":           top_edge,
        "pen_mates_elevated": pen_mates_elevated,
    }


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
