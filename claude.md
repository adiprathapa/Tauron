# Tauron — XAI + Backend Documentation

> **Hackathon requirement**: This document fulfils the Human-Centric and Ethical AI criteria
> by documenting the explainability methodology, data sovereignty decisions, and prompt versioning.

---

## 1. System Overview

Tauron is an early warning system for dairy herd disease detection. A **GraphSAGE + GRU** model
predicts disease risk per cow up to 48 hours before clinical symptoms. The XAI + Backend layer
translates model outputs into plain-English farmer alerts using a **local Mistral-7B LLM**.

Data flow:
```
Farm records (CSV / manual)
    → build_graph()              graph_utils.py — construct PyG contact graph
    → run_inference()            graph_utils.py — GraphSAGE+GRU forward pass
    → get_gnn_explainer_output() graph_utils.py — GNNExplainer attribution masks
    → build_xai_json()           xai_bridge.py  — tensor masks → structured JSON
    → generate_alert()           llm_engine.py  — Mistral-7B → plain-English sentence
    → FastAPI response           main.py        — served to React/D3.js frontend
```

---

## 2. XAI Methodology: GNNExplainer

### What it does

GNNExplainer (Ying et al., 2019) is a post-hoc explanation method for Graph Neural Networks.
For a specific cow prediction, it identifies:

1. **Top edge** — the contact graph edge (shared pen, feeding station, bunk) that most
   influenced the prediction. This is the highest-weight edge after applying the
   GNNExplainer edge mask to the cow's local subgraph.

2. **Top feature** — the node feature (milk yield, rumination time, activity index, etc.)
   with the highest importance score in GNNExplainer's feature mask.

### What it does NOT do

- GNNExplainer does **not** identify causation — it identifies which input features and
  graph edges had the most mathematical influence on the model output.
- The "top contact" cow is not necessarily the source of infection — it is the cow whose
  proximity most affected this prediction.
- Alerts are **advisory only**. The farmer makes the final decision.

### How the bridge works

`xai_bridge.extract_top_edge()` filters GNNExplainer's edge mask to edges incident on
the target cow, then selects the maximum-weight edge. The neighbor node index is mapped
back to a farm cow ID via `cow_ids` list (node index → cow ID).

`xai_bridge.extract_top_feature()` selects the feature with the highest mask score.
The `feature_delta` field shows the signed change from the cow's 7-day baseline, providing
directional context (e.g., -18% milk yield vs. +25% lameness score).

---

## 3. Local LLM: Mistral-7B via Ollama

### Why local instead of a cloud API

| Concern | Local (Ollama + Mistral-7B) | Cloud API (GPT-4, Claude) |
|---|---|---|
| **Data sovereignty** | Farm health data never leaves the device | Data transmitted to third-party servers |
| **Rural connectivity** | Works fully offline | Requires internet |
| **Cost** | Zero per-query cost | Pay-per-token, adds up at scale |
| **Latency** | ~1–2s on M4 Pro (Metal) | ~1–5s + network round-trip |
| **Demo reliability** | No API key, no rate limits, no outages | External dependency can fail |

**Data sovereignty** is the primary reason. Dairy farms are regulated environments.
Cow health records, veterinary events, and production data are commercially sensitive.
Transmitting this data to cloud APIs raises GDPR/CCPA compliance questions and breaks
trust with farmers who have limited connectivity and high data privacy expectations.

### Model: mistral:7b-instruct Q4_K_M

- Quantization: 4-bit (Q4_K_M GGUF format via Ollama)
- Memory: ~4.1 GB unified RAM on M4 Pro
- Inference speed: ~40–60 tokens/second with Metal acceleration
- Alert generation: ~1–2 seconds per alert (60 token cap)

### Setup (one-time per machine)

```bash
brew install ollama
ollama serve &          # starts daemon on localhost:11434
ollama pull mistral     # downloads ~4.1 GB — do this before demo day
ollama list             # verify: should show "mistral:latest"
```

### Fallback behaviour

If Ollama is unreachable, `llm_engine.generate_alert()` returns a template-formatted string
(e.g. "Check #47: milk yield drop detected, shared space with #31. Inspect immediately.").
The API never returns a 500 error due to LLM unavailability.

---

## 4. Prompt Versioning

All prompts are in `backend/llm_engine.py`. Reproduced here for judging and audit.

### System Prompt (v1.0)

```
You are an AI assistant for dairy farmers.
Convert structured cow health data into ONE clear, actionable sentence.
Use plain English. No veterinary jargon.
Be specific: name the cow, name the risk, name the action.
Never say "I" or "the model" — speak directly: "Isolate #47..." not "You should isolate...".
Maximum 25 words.
```

**Design rationale:**
- "ONE sentence" enforces the 25-word limit and prevents multi-paragraph responses.
- "No veterinary jargon" ensures farmers without vet training understand the alert.
- Direct imperative voice ("Isolate #47") creates urgency appropriate to the 5am barn context.
- 25-word limit enforces mobile-readable brevity.

### User Prompt Template (v1.0)

```
Cow ID: #{cow_id}
Risk score: {risk_score:.0%}
Top risk factor: {top_feature} (change from baseline: {feature_delta:+.0%})
Highest-risk contact: #{edge_from} shared space with #{edge_to} (connection strength: {edge_weight:.0%})
Generate a one-sentence farmer alert.
```

**Inference parameters:**
- `temperature: 0.2` — low variance for consistent, repeatable alerts (not creative)
- `num_predict: 60` — hard cap prevents runaway generation, keeps latency predictable

---

## 5. API Contract (Frozen — do not change after frontend starts)

### GET /herd

```json
{
  "cows": [
    {
      "id": 47,
      "risk_score": 0.85,
      "status": "alert",
      "top_feature": "milk_yield_drop"
    }
  ],
  "adjacency": [[0, 1], [1, 0]]
}
```

**Rules:**
- `status` is always one of: `"alert"` (>0.70), `"watch"` (0.40–0.70), `"ok"` (<0.40)
- `top_feature` is `null` (JSON null) for `"ok"` cows — **not absent**. Frontend must handle null.
- `adjacency` row/col order exactly matches the `cows` list order. D3.js indexes by position.

### GET /explain/{cow_id}

```json
{
  "cow_id": 47,
  "risk_score": 0.85,
  "top_edge": {"from": 47, "to": 31, "weight": 0.91},
  "top_feature": "milk_yield_drop",
  "feature_delta": -0.18,
  "alert_text": "Isolate #47: milk yield dropped 18% and she shared Bunk C with #31."
}
```

**Error response (404):**
```json
{"detail": "Cow 9999 not found. Available IDs: [47, 31, 22, 8, 15, 3, 9, 27]"}
```

**Rules:**
- `top_edge["from"]` is always the requested cow ID.
- `feature_delta` is a signed float (negative = drop, positive = increase from baseline).
- `weight` is in range [0.0, 1.0].

---

## 6. CORS Configuration

`main.py` uses `allow_origins=["*"]` intentionally for localhost development.
The frontend runs on a different port (e.g., 3000) during hackathon development.
This is safe because the API is never exposed to the internet — it runs only on localhost:8000.
If deployed, restrict to the specific frontend origin.

---

## 7. ML Team Handoff

### What the ML team delivers

1. `backend/models/tauron_model.pt` — PyTorch saved model weights
2. Real implementation bodies for the three stubs in `backend/graph_utils.py`:
   - `build_graph()` — constructs PyG Data object
   - `run_inference()` — GraphSAGE+GRU forward pass
   - `get_gnn_explainer_output()` — runs GNNExplainer
3. **Confirmation** that the feature column order in their training data matches `FEATURE_NAMES`
   in `backend/xai_bridge.py`. This is a cross-file dependency — misalignment silently produces
   wrong top-feature attributions.

### What the ML team must NOT change

- Function signatures in `graph_utils.py`
- Return shapes (documented in docstrings as contracts)
- JSON key names anywhere in the response chain

### Integration procedure

1. ML team opens a PR on `feat/local-mistral-xai` with their `graph_utils.py` changes
2. Backend dev reviews return shapes against documented interfaces
3. Run `pytest backend/tests/` — all tests must pass
4. Manually confirm `FEATURE_NAMES` alignment with ML team
5. Set `USE_MOCK = False` in `backend/mock_data.py`
6. Spot-check: `curl localhost:8000/explain/47` → `alert_text` reads like a real farmer alert

### Emergency rollback

Set `USE_MOCK = True` in `backend/mock_data.py` — demo reverts to hardcoded data in 30 seconds.

---

## 8. Ethical AI Commitments

1. **Advisory only** — Tauron alerts are recommendations. The farmer decides.
   Alert text uses language like "Check" and "Monitor" rather than commanding action.
   Only high-certainty alerts (risk > 0.70) use imperative "Isolate".

2. **Explainability by default** — Every alert links to a causal feature and contact edge.
   Farmers are never told "the AI says so" without an explanation.

3. **Data stays on the farm** — No farm data leaves the device. No cloud APIs, no telemetry.

4. **Transparency about limitations** — The model was trained on synthetic data derived from
   the Wageningen dataset. It has not been validated on real commercial farm data.
   Performance may differ on farms with different breeds, housing systems, or sensor coverage.

5. **Human-readable threshold control** — The risk thresholds (0.40, 0.70) are configurable
   constants. Farm managers can adjust sensitivity vs. specificity based on their tolerance
   for false positives.
