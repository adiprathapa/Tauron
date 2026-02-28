"""
data/external/adapter.py
────────────────────────
Adapts the Cattle-Disease-Prediction CSV (thyagarajank, GitHub) to
Tauron's 9-feature temporal format.

Source dataset:
    93 binary symptom columns + 1 "prognosis" column with 26 cattle diseases.
    Each row is a single clinical snapshot.

Strategy:
    1. Map 26 diseases → Tauron's 3 targets (mastitis, BRD, lameness) using
       veterinary clinical groupings.
    2. Convert binary symptom flags → continuous sensor estimates by mapping
       symptom clusters to each of Tauron's 9 SensOor-profile features.
    3. Synthesise a 7-day temporal window per row (prodromal ramp) so the
       GRU encoder has temporal signal to learn from.
    4. Assign synthetic pen/bunk IDs so the graph builder can create edges.

Reference for clinical symptom-disease mapping:
    Radostits et al. Veterinary Medicine 10th ed. (2007)
    Constable et al. Veterinary Medicine 11th ed. (2017)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Tuple

# ── Disease mapping ────────────────────────────────────────────────────────
# Group the 26 prognosis labels into Tauron's 3 disease categories.
# Diseases that don't map cleanly are assigned to the closest clinical analogue.

DISEASE_MAP = {
    # → mastitis (udder/milk-related)
    "mastitis":                         "mastitis",
    "fatty_liver_syndrome":             "mastitis",     # metabolic, milk impact
    "acetonaemia":                      "mastitis",     # ketosis, milk production ↓
    "displaced_abomasum":               "mastitis",     # metabolic, milk ↓

    # → BRD (respiratory / systemic febrile)
    "calf_pneumonia":                   "brd",
    "fog_fever":                        "brd",          # bovine pulmonary emphysema
    "infectious_bovine_rhinotracheitis":"brd",          # IBR — classic BRD pathogen
    "schmallen_berg_virus":             "brd",          # systemic febrile
    "rift_valley_fever":                "brd",          # febrile, respiratory involvement
    "calf_diphtheria":                  "brd",          # upper respiratory
    "listeriosis":                      "brd",          # CNS/systemic
    "blackleg":                         "brd",          # acute systemic/febrile

    # → lameness (locomotion / GI-associated lameness)
    "foot_rot":                         "lameness",
    "foot_and_mouth":                   "lameness",
    "wooden_tongue":                    "lameness",     # oral → reduced feeding → condition loss
    "bloat":                            "lameness",     # rumen, reluctance to move
    "rumen_acidosis":                   "lameness",     # laminitis secondary to acidosis
    "traumatic_reticulitis":            "lameness",     # pain → reluctance to move

    # → GI parasitic → lameness (debilitation, poor condition, reluctance to move)
    "gut_worms":                        "lameness",
    "liver_fluke":                      "lameness",
    "coccidiosis":                      "lameness",
    "cryptosporidiosis":                "lameness",
    "necrotic_enteritis":               "lameness",
    "peri_weaning_diarrhoea":           "lameness",
    "trypanosomosis":                   "lameness",     # wasting/debilitation
    "ragwort_poisoning":                "lameness",     # hepatotoxic, poor condition
}

# ── Symptom → sensor feature mapping ──────────────────────────────────────
# Each sensor feature is estimated from a weighted combination of binary symptom
# columns. Weights reflect clinical significance.
# Feature order: activity(0), highly_active(1), rumination_min(2), feeding_min(3),
#   ear_temp_c(4), milk_yield_kg(5), health_event(6), feeding_visits(7), days_in_milk(8)

# Healthy baseline values (from Rutten et al. 2017 SensOor profile)
_BASELINE = {
    "activity": 450.0,
    "highly_active": 2.5,
    "rumination_min": 480.0,
    "feeding_min": 210.0,
    "ear_temp_c": 38.5,
    "milk_yield_kg": 28.0,
    "health_event": 0.0,
    "feeding_visits": 6.0,
    "days_in_milk": 150.0,
}

_BASELINE_SD = {
    "activity": 80.0,
    "highly_active": 0.8,
    "rumination_min": 45.0,
    "feeding_min": 35.0,
    "ear_temp_c": 0.3,
    "milk_yield_kg": 4.0,
    "health_event": 0.0,
    "feeding_visits": 2.0,
    "days_in_milk": 60.0,
}


# Symptom groups that depress each sensor feature (symptom_col, SD_shift)
_SYMPTOM_SENSOR_MAP = {
    "activity": [
        # Symptoms indicating reduced activity
        ("depression", -1.2), ("lethargy", -1.5), ("dull", -0.8),
        ("lameness", -1.8), ("unwillingness_to_move", -2.0),
        ("weakness", -1.3), ("discomfort", -0.6), ("pain", -0.8),
        ("isolation_from_herd", -1.0),
    ],
    "highly_active": [
        ("depression", -1.0), ("lethargy", -1.3), ("lameness", -1.5),
        ("unwillingness_to_move", -1.8), ("weakness", -1.0),
    ],
    "rumination_min": [
        # Reduced rumination — oral/GI/respiratory distress
        ("reduced_rumination", -2.0), ("rumenstasis", -2.5),
        ("anorexia", -1.0), ("colic", -1.2), ("bloat", -1.5),
        ("gaseous_stomach", -1.0), ("nausea", -0.8), ("vomiting", -0.8),
        ("painful_tongue", -1.3), ("swollen_tongue", -1.5),
        ("coughing", -0.6), ("dyspnea", -0.5),
    ],
    "feeding_min": [
        # Reduced feeding time
        ("loss_of_appetite", -1.5), ("anorexia", -1.8),
        ("reduces_feed_intake", -1.5),
        ("painful_tongue", -1.2), ("swollen_tongue", -1.3),
        ("blisters", -0.7), ("ulcers", -0.8),
        ("colic", -0.8), ("abdominal_pain", -1.0),
        ("nausea", -0.6), ("stomach_pain", -0.8),
    ],
    "ear_temp_c": [
        # Elevated temperature
        ("fever", +2.5), ("high_temp", +2.0), ("intermittent_fever", +1.5),
        ("hyperaemia", +0.8),
    ],
    "milk_yield_kg": [
        # Reduced milk yield
        ("reduction_milk_vields", -2.0),
        ("milk_fever", -1.5),
        ("milk_watery", -0.8), ("milk_clots", -1.0), ("milk_flakes", -0.8),
        ("reduced_fat", -0.5),
        ("anorexia", -0.6), ("dehydration", -0.8),
        ("ketosis", -1.2),
        ("udder_swelling", -0.7), ("udder_heat", -0.5),
        ("udder_hardeness", -0.8), ("udder_pain", -0.6),
    ],
    "health_event": [
        # Any severe symptom triggers a vet event
        ("blood_poisoning", 1.0), ("blood_loss", 0.8),
        ("encephalitis", 1.0), ("pneumonia", 1.0),
        ("fever", 0.5), ("convulsions", 1.0),
    ],
    "feeding_visits": [
        # Reduced feeding station visits
        ("loss_of_appetite", -1.2), ("anorexia", -1.5),
        ("lameness", -1.0), ("unwillingness_to_move", -1.3),
        ("depression", -0.6), ("weakness", -0.8),
    ],
    # days_in_milk is not symptom-derived — we assign randomly
}


def _symptom_to_sensor_value(row: pd.Series, feature: str,
                             rng: np.random.Generator) -> float:
    """Convert binary symptom columns to a continuous sensor reading."""
    base = _BASELINE[feature]
    sd = _BASELINE_SD[feature]

    if feature == "days_in_milk":
        return float(rng.integers(30, 280))

    if feature == "health_event":
        mappings = _SYMPTOM_SENSOR_MAP.get(feature, [])
        prob = 0.0
        for col, weight in mappings:
            if col in row.index and row[col] == 1:
                prob += weight
        return 1.0 if rng.random() < min(prob, 1.0) else 0.0

    # Accumulate SD shifts from active symptoms
    total_shift = 0.0
    mappings = _SYMPTOM_SENSOR_MAP.get(feature, [])
    for col, sd_shift in mappings:
        if col in row.index and row[col] == 1:
            # Add noise per symptom (±30%)
            noise = 1.0 + rng.uniform(-0.3, 0.3)
            total_shift += sd_shift * noise

    # Cap the total shift at ±3 SDs
    total_shift = np.clip(total_shift, -3.0, 3.0)

    # Add random baseline variation
    value = base + (total_shift * sd) + rng.normal(0, sd * 0.2)

    # Clamp to physiological ranges
    clamps = {
        "activity":       (200, 800),
        "highly_active":  (0, 8),
        "rumination_min": (100, 620),
        "feeding_min":    (60, 360),
        "ear_temp_c":     (37.0, 41.5),
        "milk_yield_kg":  (5, 50),
        "feeding_visits": (0, 12),
    }
    lo, hi = clamps.get(feature, (-1e9, 1e9))
    return float(np.clip(value, lo, hi))


def adapt_csv(csv_path: str | Path, seed: int = 123) -> pd.DataFrame:
    """
    Load the Cattle-Disease-Prediction CSV and convert to Tauron farm format.

    Returns a DataFrame with columns matching tauron_pipeline.generate_farm():
        cow_id, date, pen_id, bunk_id, + 9 sensor features
    Plus label columns: label_mastitis, label_brd, label_lameness

    Each CSV row becomes a synthetic "cow" with a 7-day temporal window.
    """
    rng = np.random.default_rng(seed)
    df = pd.read_csv(csv_path)

    # Strip whitespace from column names and prognosis values
    df.columns = df.columns.str.strip()
    if "prognosis" in df.columns:
        df["prognosis"] = df["prognosis"].str.strip()

    # Filter rows with mappable diseases
    df = df[df["prognosis"].isin(DISEASE_MAP)].reset_index(drop=True)
    n_rows = len(df)
    print(f"  Loaded {csv_path}: {n_rows} rows with mappable diseases")

    # Assign cow IDs, pens, bunks
    n_pens = 6
    n_bunks = 4
    base_date = datetime(2025, 11, 1)

    all_rows = []
    for row_idx in range(n_rows):
        row = df.iloc[row_idx]
        disease = DISEASE_MAP[row["prognosis"]]
        cow_id = 1000 + row_idx  # offset from synthetic cow IDs (0–59)
        pen_id = int(rng.integers(0, n_pens))
        bunk_id = int(rng.integers(0, n_bunks))
        dim = int(rng.integers(30, 280))

        # Generate 7 days of data: first 4–6 days are "healthy baseline",
        # last 1–3 days show prodromal → acute symptom signal
        onset_day = int(rng.integers(4, 7))  # day symptoms start (0-indexed)

        for day in range(7):
            date = base_date + timedelta(days=row_idx * 7 + day)

            if day < onset_day:
                # Healthy days — baseline with noise
                record = {
                    "cow_id": cow_id,
                    "date": date,
                    "pen_id": pen_id,
                    "bunk_id": bunk_id,
                }
                for feat in [
                    "activity", "highly_active", "rumination_min", "feeding_min",
                    "ear_temp_c", "milk_yield_kg", "feeding_visits",
                ]:
                    base = _BASELINE[feat]
                    sd = _BASELINE_SD[feat]
                    record[feat] = float(np.clip(
                        rng.normal(base, sd * 0.3),
                        _BASELINE[feat] - 2 * sd,
                        _BASELINE[feat] + 2 * sd,
                    ))
                record["health_event"] = 0
                record["days_in_milk"] = dim + day
            else:
                # Symptomatic days — severity ramps up
                days_since_onset = day - onset_day
                max_days = 6 - onset_day
                severity_frac = (days_since_onset + 1) / (max_days + 1)

                record = {
                    "cow_id": cow_id,
                    "date": date,
                    "pen_id": pen_id,
                    "bunk_id": bunk_id,
                }
                for feat in [
                    "activity", "highly_active", "rumination_min", "feeding_min",
                    "ear_temp_c", "milk_yield_kg", "health_event", "feeding_visits",
                ]:
                    # Blend healthy baseline with symptom-derived value
                    healthy_val = _BASELINE[feat] + rng.normal(0, _BASELINE_SD[feat] * 0.2)
                    sick_val = _symptom_to_sensor_value(row, feat, rng)

                    if feat == "health_event":
                        record[feat] = int(sick_val > 0.5 and severity_frac > 0.7)
                    else:
                        blended = healthy_val + severity_frac * (sick_val - healthy_val)
                        clamps = {
                            "activity":       (200, 800),
                            "highly_active":  (0, 8),
                            "rumination_min": (100, 620),
                            "feeding_min":    (60, 360),
                            "ear_temp_c":     (37.0, 41.5),
                            "milk_yield_kg":  (5, 50),
                            "feeding_visits": (0, 12),
                        }
                        lo, hi = clamps.get(feat, (-1e9, 1e9))
                        record[feat] = float(np.clip(blended, lo, hi))

                record["days_in_milk"] = dim + day

            # Labels — set on ALL days (the label is the T+48h prognosis)
            record["label_mastitis"] = 1.0 if disease == "mastitis" else 0.0
            record["label_brd"] = 1.0 if disease == "brd" else 0.0
            record["label_lameness"] = 1.0 if disease == "lameness" else 0.0

            all_rows.append(record)

    result = pd.DataFrame(all_rows)
    # Ensure date column is datetime
    result["date"] = pd.to_datetime(result["date"])
    print(f"  Adapted: {len(result)} rows ({n_rows} cows × 7 days)")

    # Disease distribution
    labels = result.groupby("cow_id")[["label_mastitis", "label_brd", "label_lameness"]].first()
    print(f"  Disease split: mastitis={int(labels.label_mastitis.sum())}, "
          f"brd={int(labels.label_brd.sum())}, lameness={int(labels.label_lameness.sum())}")

    return result


def load_external_data(data_dir: str | Path = "data/external",
                       seed: int = 123) -> pd.DataFrame:
    """Load and adapt all external CSVs. Returns combined DataFrame."""
    data_dir = Path(data_dir)
    frames = []
    for csv_file in sorted(data_dir.glob("*.csv")):
        frames.append(adapt_csv(csv_file, seed=seed))

    if not frames:
        raise FileNotFoundError(f"No CSV files found in {data_dir}")

    combined = pd.concat(frames, ignore_index=True)
    print(f"\nExternal data total: {len(combined)} rows, "
          f"{combined['cow_id'].nunique()} unique cows")
    return combined


if __name__ == "__main__":
    # Quick test
    df = load_external_data()
    print(df.head(14).to_string())
    print(f"\nColumns: {list(df.columns)}")
