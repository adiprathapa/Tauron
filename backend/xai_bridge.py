"""
backend/xai_bridge.py

XAI Bridge: transforms gradient-based attribution output into the /explain/{cow_id}
response schema, then calls the local Mistral-7B LLM to generate a plain-English
farmer alert.

Data flow:
    graph_utils.get_gnn_explainer_output()  gradient attribution per cow
        → extract_top_edge()        highest-weight contact edge for this cow
        → extract_top_feature()     highest-gradient sensor feature
        → build_xai_json()          structured intermediate dict (no alert_text yet)
        → llm_engine.generate_alert()  Ollama → plain-English sentence
        → final response dict       matches /explain/{cow_id} schema exactly

FEATURE_NAMES must exactly match SENSOR_FEATURES in graph_utils.py.
They are imported directly from graph_utils to guarantee alignment.

Pure functions (extract_top_edge, extract_top_feature, build_xai_json) have no side
effects and no ML/network dependencies — fully unit-testable in isolation.
"""

from backend.llm_engine import generate_alert
from backend.mock_data import MOCK_EXPLAIN, USE_MOCK

# Single source of truth: import from graph_utils so order never drifts
# (lazy import to avoid pulling in PyTorch at module load in mock mode)
def _get_feature_names() -> list:
    from backend.graph_utils import SENSOR_FEATURES
    return SENSOR_FEATURES

# Module-level alias used by tests and the rest of the bridge
# Resolved once on first import — safe because graph_utils is a pure constant list
try:
    from backend.graph_utils import SENSOR_FEATURES as FEATURE_NAMES
except ImportError:
    # Fallback if torch/torch_geometric not installed (e.g. test environment without ML deps)
    FEATURE_NAMES = [
        "activity", "highly_active", "rumination_min", "feeding_min", "ear_temp_c",
        "milk_yield_kg", "health_event", "feeding_visits", "days_in_milk",
    ]

DISEASES = ["mastitis", "brd", "lameness"]

# Human-readable labels for the LLM prompt — maps internal feature names to plain English
FEATURE_LABELS = {
    "activity":       "activity level",
    "highly_active":  "hours of high activity",
    "rumination_min": "rumination time",
    "feeding_min":    "feeding time",
    "ear_temp_c":     "ear temperature",
    "milk_yield_kg":  "milk yield",
    "health_event":   "recent vet event",
    "feeding_visits": "feeding station visits",
    "days_in_milk":   "days in milk",
}

DISEASE_LABELS = {
    "mastitis": "mastitis (udder infection)",
    "brd":      "BRD (bovine respiratory disease)",
    "lameness": "lameness (hoof/leg issue)",
}


# ---------------------------------------------------------------------------
# Pure extraction functions — no side effects, fully testable
# ---------------------------------------------------------------------------

def extract_top_edge(
    edge_index: list,
    edge_mask: list,
    cow_ids: list,
    target_cow_id: int,
) -> dict:
    """
    Find the edge with the highest mask weight incident on the target cow.

    Args:
        edge_index:     list of [from_node_idx, to_node_idx] pairs (node indices, not cow IDs)
        edge_mask:      list of float importance scores, same length as edge_index
        cow_ids:        list mapping node index → cow ID (e.g. [47, 31, 22, ...])
        target_cow_id:  the cow we're explaining

    Returns:
        {"from": cow_id, "to": neighbor_cow_id, "weight": float}
        Returns self-loop with weight 0.0 if no incident edges found.
    """
    if target_cow_id not in cow_ids:
        return {"from": target_cow_id, "to": target_cow_id, "weight": 0.0}

    target_idx = cow_ids.index(target_cow_id)

    incident = [
        (i, float(mask_val))
        for i, (edge, mask_val) in enumerate(zip(edge_index, edge_mask))
        if edge[0] == target_idx or edge[1] == target_idx
    ]

    if not incident:
        return {"from": target_cow_id, "to": target_cow_id, "weight": 0.0}

    best_i, best_weight = max(incident, key=lambda x: x[1])
    src_idx, dst_idx    = edge_index[best_i]

    neighbor_idx    = dst_idx if src_idx == target_idx else src_idx
    neighbor_cow_id = cow_ids[neighbor_idx]

    return {
        "from":   target_cow_id,
        "to":     neighbor_cow_id,
        "weight": round(best_weight, 4),
    }


def extract_top_feature(
    feature_mask: list,
    feature_delta: list | None = None,
) -> tuple[str, float]:
    """
    Find the most important feature from the gradient-based feature mask.

    Args:
        feature_mask:  list of float importance scores, one per feature (order = FEATURE_NAMES)
        feature_delta: optional list of signed deltas (change from 6-day baseline)
                       same order as feature_mask; provides directional context for the alert

    Returns:
        (feature_name: str, delta: float)
    """
    if not feature_mask or len(feature_mask) > len(FEATURE_NAMES):
        return FEATURE_NAMES[0], 0.0

    top_idx  = max(range(len(feature_mask)), key=lambda i: feature_mask[i])
    top_name = FEATURE_NAMES[top_idx]
    delta    = (
        float(feature_delta[top_idx])
        if feature_delta and len(feature_delta) > top_idx
        else 0.0
    )

    return top_name, round(delta, 4)


def build_xai_json(
    cow_id: int,
    risk_score: float,
    explainer_output: dict,
    cow_ids: list,
) -> dict:
    """
    Assemble the structured XAI intermediate dict (without alert_text).

    Pure function — no async, no side effects, no ML dependencies.
    Passed directly to llm_engine.generate_alert().

    Args:
        cow_id:           farm ID of the cow being explained
        risk_score:       model output risk score [0.0, 1.0]
        explainer_output: dict from graph_utils.get_gnn_explainer_output()
                          required keys: edge_mask, edge_index, feature_mask
                          optional keys: feature_delta, dominant_disease, all_risks
        cow_ids:          list mapping node index → cow ID

    Returns:
        {
            "cow_id":           int,
            "risk_score":       float,
            "top_edge":         {"from": int, "to": int, "weight": float},
            "top_feature":      str,
            "feature_delta":    float,          # signed change of top feature vs baseline
            "dominant_disease": str | None,     # "mastitis" | "brd" | "lameness"
            "all_risks":        dict | None,    # {disease: score}
        }
    """
    top_edge = extract_top_edge(
        explainer_output["edge_index"],
        explainer_output["edge_mask"],
        cow_ids,
        cow_id,
    )

    top_feature, feature_delta = extract_top_feature(
        explainer_output["feature_mask"],
        explainer_output.get("feature_delta"),
    )

    return {
        "cow_id":           cow_id,
        "risk_score":       round(float(risk_score), 4),
        "top_edge":         top_edge,
        "top_feature":      top_feature,
        "feature_delta":    feature_delta,
        "dominant_disease": explainer_output.get("dominant_disease"),
        "all_risks":        explainer_output.get("all_risks"),
    }


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

async def explain_cow(cow_id: int) -> dict:
    """
    Full pipeline: build_graph → gradient XAI → structured JSON → LLM → response.

    Called by main.py when USE_MOCK = False.

    Args:
        cow_id: farm ID of the cow to explain

    Returns:
        dict matching the /explain/{cow_id} response schema (including alert_text)

    Raises:
        ValueError: if cow_id not found in inference result
    """
    if USE_MOCK:
        return MOCK_EXPLAIN.get(cow_id, _not_found_response(cow_id))

    from backend.graph_utils import build_graph, run_inference, get_gnn_explainer_output

    graph            = build_graph()
    inference_result = run_inference(graph)

    cow_data = next((c for c in inference_result["cows"] if c["id"] == cow_id), None)
    if cow_data is None:
        raise ValueError(f"Cow {cow_id} not found in inference result")

    risk_score = cow_data["risk_score"]
    cow_ids    = [c["id"] for c in inference_result["cows"]]

    explainer_output = get_gnn_explainer_output(cow_id, graph)
    xai_json         = build_xai_json(cow_id, risk_score, explainer_output, cow_ids)

    alert_text = await generate_alert(xai_json)

    return {**xai_json, "alert_text": alert_text}


def _not_found_response(cow_id: int) -> dict:
    """Safe empty response for unknown cow IDs (mock mode edge case only)."""
    return {
        "cow_id":           cow_id,
        "risk_score":       0.0,
        "top_edge":         {"from": cow_id, "to": cow_id, "weight": 0.0},
        "top_feature":      "unknown",
        "feature_delta":    0.0,
        "dominant_disease": None,
        "all_risks":        None,
        "alert_text":       f"No data available for cow #{cow_id}.",
    }
