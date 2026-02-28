# backend/mock_data.py
#
# Demo data for frontend development and emergency rollback.
# Core key names are frozen — the frontend D3.js graph depends on:
#   cows[*].id, cows[*].risk_score, cows[*].status, cows[*].top_feature, adjacency
#
# New keys (dominant_disease, all_risks) are additive — frontend ignores unknown fields.
#
# status enum:  "alert" (risk > 0.70) | "watch" (0.40–0.70) | "ok" (< 0.40)
# top_feature:  null for "ok" cows — frontend must handle null
# all_risks:    {mastitis, brd, lameness} scores — null for "ok" cows
# adjacency:    N×N matrix, row/col order matches the cows list order exactly
#
# USE_MOCK: flip to False when tauron_model.pt is trained and graph_utils.py is live.
# Emergency rollback: flip back to True — demo reverts in 30 seconds.

USE_MOCK = True

MOCK_HERD = {
    "cows": [
        {
            "id": 47, "risk_score": 0.85, "status": "alert",
            "top_feature": "milk_yield_kg",
            "dominant_disease": "mastitis",
            "all_risks": {"mastitis": 0.85, "brd": 0.31, "lameness": 0.12},
        },
        {
            "id": 31, "risk_score": 0.62, "status": "watch",
            "top_feature": "ear_temp_c",
            "dominant_disease": "brd",
            "all_risks": {"mastitis": 0.41, "brd": 0.62, "lameness": 0.08},
        },
        {
            "id": 22, "risk_score": 0.55, "status": "watch",
            "top_feature": "rumination_min",
            "dominant_disease": "brd",
            "all_risks": {"mastitis": 0.22, "brd": 0.55, "lameness": 0.19},
        },
        {
            "id": 8,  "risk_score": 0.21, "status": "ok",
            "top_feature": None,
            "dominant_disease": None,
            "all_risks": None,
        },
        {
            "id": 15, "risk_score": 0.74, "status": "alert",
            "top_feature": "activity",
            "dominant_disease": "lameness",
            "all_risks": {"mastitis": 0.18, "brd": 0.29, "lameness": 0.74},
        },
        {
            "id": 3,  "risk_score": 0.18, "status": "ok",
            "top_feature": None,
            "dominant_disease": None,
            "all_risks": None,
        },
        {
            "id": 9,  "risk_score": 0.41, "status": "watch",
            "top_feature": "rumination_min",
            "dominant_disease": "mastitis",
            "all_risks": {"mastitis": 0.41, "brd": 0.28, "lameness": 0.14},
        },
        {
            "id": 27, "risk_score": 0.33, "status": "ok",
            "top_feature": None,
            "dominant_disease": None,
            "all_risks": None,
        },
    ],
    # Adjacency matrix: index matches cows list above
    # cows: [47, 31, 22, 8, 15, 3, 9, 27]
    "adjacency": [
        # 47  31  22   8  15   3   9  27
        [  0,  1,  1,  0,  0,  0,  0,  0],  # 47
        [  1,  0,  0,  1,  0,  0,  0,  0],  # 31
        [  1,  0,  0,  0,  1,  0,  1,  0],  # 22
        [  0,  1,  0,  0,  0,  1,  0,  0],  # 8
        [  0,  0,  1,  0,  0,  0,  0,  1],  # 15
        [  0,  0,  0,  1,  0,  0,  1,  0],  # 3
        [  0,  0,  1,  0,  0,  1,  0,  1],  # 9
        [  0,  0,  0,  0,  1,  0,  1,  0],  # 27
    ],
}

MOCK_EXPLAIN = {
    47: {
        "cow_id": 47,
        "risk_score": 0.85,
        "top_edge": {"from": 47, "to": 31, "weight": 0.91},
        "top_feature": "milk_yield_kg",
        "feature_delta": -0.18,
        "dominant_disease": "mastitis",
        "all_risks": {"mastitis": 0.85, "brd": 0.31, "lameness": 0.12},
        "alert_text": (
            "Isolate #47: milk yield dropped 18%, mastitis risk at 85% — "
            "shared pen with #31. Check udder and take temperature now."
        ),
    },
    31: {
        "cow_id": 31,
        "risk_score": 0.62,
        "top_edge": {"from": 31, "to": 47, "weight": 0.91},
        "top_feature": "ear_temp_c",
        "feature_delta": 0.08,
        "dominant_disease": "brd",
        "all_risks": {"mastitis": 0.41, "brd": 0.62, "lameness": 0.08},
        "alert_text": (
            "Monitor #31: ear temperature up, BRD risk at 62% — "
            "shared space with high-risk #47. Recheck breathing at next milking."
        ),
    },
    22: {
        "cow_id": 22,
        "risk_score": 0.55,
        "top_edge": {"from": 22, "to": 47, "weight": 0.76},
        "top_feature": "rumination_min",
        "feature_delta": -0.12,
        "dominant_disease": "brd",
        "all_risks": {"mastitis": 0.22, "brd": 0.55, "lameness": 0.19},
        "alert_text": (
            "Watch #22: rumination time down 12%, BRD risk at 55% — "
            "contact with #47. Separate from herd and monitor breathing."
        ),
    },
    8: {
        "cow_id": 8,
        "risk_score": 0.21,
        "top_edge": {"from": 8, "to": 31, "weight": 0.35},
        "top_feature": "feeding_visits",
        "feature_delta": 0.0,
        "dominant_disease": None,
        "all_risks": {"mastitis": 0.21, "brd": 0.14, "lameness": 0.09},
        "alert_text": "No action needed for #8 — low risk across all diseases, routine monitoring only.",
    },
    15: {
        "cow_id": 15,
        "risk_score": 0.74,
        "top_edge": {"from": 15, "to": 22, "weight": 0.82},
        "top_feature": "activity",
        "feature_delta": -0.25,
        "dominant_disease": "lameness",
        "all_risks": {"mastitis": 0.18, "brd": 0.29, "lameness": 0.74},
        "alert_text": (
            "Isolate #15: activity dropped 25%, lameness risk at 74% — "
            "shared feed station with #22. Call vet for hoof inspection today."
        ),
    },
    3: {
        "cow_id": 3,
        "risk_score": 0.18,
        "top_edge": {"from": 3, "to": 8, "weight": 0.22},
        "top_feature": "days_in_milk",
        "feature_delta": 0.0,
        "dominant_disease": None,
        "all_risks": {"mastitis": 0.18, "brd": 0.11, "lameness": 0.07},
        "alert_text": "No action needed for #3 — healthy across all disease indicators, continue normal management.",
    },
    9: {
        "cow_id": 9,
        "risk_score": 0.41,
        "top_edge": {"from": 9, "to": 22, "weight": 0.64},
        "top_feature": "rumination_min",
        "feature_delta": -0.09,
        "dominant_disease": "mastitis",
        "all_risks": {"mastitis": 0.41, "brd": 0.28, "lameness": 0.14},
        "alert_text": (
            "Watch #9: rumination time down 9%, mastitis risk at 41% — "
            "near #22. Check feed intake and milk yield at next milking."
        ),
    },
    27: {
        "cow_id": 27,
        "risk_score": 0.33,
        "top_edge": {"from": 27, "to": 15, "weight": 0.48},
        "top_feature": "activity",
        "feature_delta": 0.0,
        "dominant_disease": None,
        "all_risks": {"mastitis": 0.22, "brd": 0.17, "lameness": 0.33},
        "alert_text": "Monitor #27: moderate contact with lame #15. No immediate action — recheck tomorrow.",
    },
}
