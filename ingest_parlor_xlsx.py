"""
ingest_parlor_xlsx.py
---------------------
Convert parlor milking Excel exports (e.g. template_dairy_comp.xlsx)
into the Tauron pipeline's internal DataFrame format.

Column mapping (Parlor → Tauron):
    Animal Number     → cow_id
    Date              → date
    Group Number      → pen_id   (closest proxy: milking group ≈ housing group)
    Batch Number      → bunk_id  (batch ≈ feeding station assignment)
    Total Yield       → milk_yield_kg  (assumes lbs, converted to kg)
    Peak Flow         → peak_flow (retained as extra feature)
    Average Flow      → average_flow (retained as extra feature)
    Milk Duration     → milking_duration_sec (parsed from mm:ss)

Columns NOT available in basic parlor data (filled with population defaults):
    activity, highly_active, rumination_min, feeding_min, ear_temp_c,
    health_event, feeding_visits, days_in_milk

Usage:
    python ingest_parlor_xlsx.py data/template_dairy_comp.xlsx
    python ingest_parlor_xlsx.py data/template_dairy_comp.xlsx --output data/parlor_farm.csv
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd


# ── Constants ─────────────────────────────────────────────────────────────────
LBS_TO_KG = 0.453592

# Tauron pipeline expected columns (from tauron_pipeline.SENSOR_FEATURES + graph cols)
PIPELINE_COLUMNS = [
    "cow_id", "date", "pen_id", "bunk_id",
    "activity", "highly_active", "rumination_min", "feeding_min",
    "ear_temp_c", "milk_yield_kg", "health_event", "feeding_visits",
    "days_in_milk",
]


def parse_duration(val) -> float:
    """Parse 'mm:ss' string to seconds. Returns 0.0 on failure."""
    if pd.isna(val) or val is None:
        return 0.0
    try:
        parts = str(val).split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return 0.0


def load_parlor_xlsx(path: str, yield_unit: str = "lbs") -> pd.DataFrame:
    """
    Load parlor milking Excel and convert to Tauron pipeline format.

    Args:
        path: Path to the .xlsx file
        yield_unit: 'lbs' or 'kg' — unit of the Total Yield column

    Returns:
        DataFrame with columns matching tauron_pipeline.generate_farm() output
    """
    df = pd.read_excel(path, engine="openpyxl")

    # Normalise column names (strip whitespace)
    df.columns = df.columns.str.strip()

    # --- Required mappings ---
    out = pd.DataFrame()
    out["cow_id"] = df["Animal Number"].astype(int)
    out["date"] = pd.to_datetime(df["Date"])

    # Group Number → pen_id (milking group ≈ housing pen)
    out["pen_id"] = df["Group Number"].fillna(0).astype(int)

    # Batch Number → bunk_id (batch ≈ feeding station)
    out["bunk_id"] = df.get("Batch Number", pd.Series(0, index=df.index)).fillna(0).astype(int)

    # Total Yield → milk_yield_kg
    yield_raw = df["Total Yield"].fillna(0.0).astype(float)
    if yield_unit == "lbs":
        out["milk_yield_kg"] = yield_raw * LBS_TO_KG
    else:
        out["milk_yield_kg"] = yield_raw

    # --- Columns derivable from parlor data ---
    out["milking_duration_sec"] = df.get(
        "Milk Duration (mm:ss)", pd.Series(None)
    ).apply(parse_duration)

    out["average_flow"] = df.get("Average Flow", pd.Series(0.0)).fillna(0.0).astype(float)
    out["peak_flow"] = df.get("Peak Flow", pd.Series(0.0)).fillna(0.0).astype(float)

    # Reattach / Slips / Kick-Offs — parlor events as health signal proxies
    out["reattach"] = df.get("Reattach", pd.Series(False)).fillna(False).astype(int)
    out["slips"] = df.get("Slips", pd.Series(False)).fillna(False).astype(int)
    out["kick_offs"] = df.get("Kick-Offs", pd.Series(False)).fillna(False).astype(int)

    # health_event = 1 if any parlor issue occurred
    out["health_event"] = (
        (out["reattach"] + out["slips"] + out["kick_offs"]) > 0
    ).astype(int)

    # --- Columns NOT in parlor data — fill with population defaults ---
    # (from Rutten et al. 2017 — Wageningen SensOor sensor profile)
    rng = np.random.default_rng(42)
    n = len(out)
    out["activity"] = np.clip(rng.normal(450, 80, n), 200, 800).astype(float)
    out["highly_active"] = np.clip(rng.normal(2.5, 0.8, n), 0, 8).astype(float)
    out["rumination_min"] = np.clip(rng.normal(480, 45, n), 300, 620).astype(float)
    out["feeding_min"] = np.clip(rng.normal(210, 35, n), 100, 360).astype(float)
    out["ear_temp_c"] = np.clip(rng.normal(38.5, 0.3, n), 37.0, 40.5).astype(float)
    out["feeding_visits"] = rng.integers(3, 10, n).astype(int)
    out["days_in_milk"] = rng.integers(5, 300, n).astype(int)

    # Reorder to match pipeline expectations
    final_cols = PIPELINE_COLUMNS + [
        c for c in out.columns if c not in PIPELINE_COLUMNS
    ]
    out = out[[c for c in final_cols if c in out.columns]]

    return out


def aggregate_sessions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate multiple milking sessions per cow per day into a single daily row.

    Parlor data often has 2-3 sessions/day. Tauron expects one row per cow per day.
    """
    agg_funcs = {
        "pen_id": "first",
        "bunk_id": "first",
        "milk_yield_kg": "sum",          # total daily yield
        "health_event": "max",           # 1 if any session had an issue
        "activity": "first",
        "highly_active": "first",
        "rumination_min": "first",
        "feeding_min": "first",
        "ear_temp_c": "first",
        "feeding_visits": "first",
        "days_in_milk": "first",
    }

    # Only include extra columns if they exist
    for col in ["milking_duration_sec", "average_flow", "peak_flow",
                "reattach", "slips", "kick_offs"]:
        if col in df.columns:
            agg_funcs[col] = "sum" if col in ["milking_duration_sec", "reattach",
                                                "slips", "kick_offs"] else "mean"

    agg = df.groupby(["cow_id", "date"]).agg(agg_funcs).reset_index()
    return agg


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Convert parlor milking Excel to Tauron pipeline CSV"
    )
    parser.add_argument("input", help="Path to .xlsx file")
    parser.add_argument("--output", "-o", default=None,
                        help="Output CSV path (default: data/<input_stem>_tauron.csv)")
    parser.add_argument("--yield-unit", choices=["lbs", "kg"], default="lbs",
                        help="Unit for Total Yield column (default: lbs)")
    parser.add_argument("--no-aggregate", action="store_true",
                        help="Don't aggregate multiple sessions per day")
    args = parser.parse_args()

    # Load and convert
    df = load_parlor_xlsx(args.input, yield_unit=args.yield_unit)

    if not args.no_aggregate:
        df = aggregate_sessions(df)

    # Output
    if args.output is None:
        stem = Path(args.input).stem
        args.output = f"data/{stem}_tauron.csv"

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)

    print(f"✓ Converted {len(df)} rows → {args.output}")
    print(f"  Cows: {sorted(df['cow_id'].unique())}")
    print(f"  Dates: {df['date'].min()} → {df['date'].max()}")
    print(f"  Columns: {list(df.columns)}")


if __name__ == "__main__":
    main()
