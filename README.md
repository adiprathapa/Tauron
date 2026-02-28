# Tauron

**GNN-based early-warning system for dairy herd disease — 48-hour prediction horizon.**

Cornell Digital Ag Hackathon · February 27 – March 1, 2026

## Collaborators

- Aritro Ganguly
- Adi Prathapa
- Connor Mark
- Krish Jana
- Vikram Davey
- Suchit Basineni
---

## Architecture

```
Sensor data (7-day window)
  ↓
GRU encoder (9 features → 128-d)
  ↓
GraphSAGE ×2 (pen & bunk contact graph)
  ↓
Sigmoid head → [mastitis, BRD, lameness] risk
  ↓
Gradient XAI → plain-English alert (Ollama / Mistral-7B)
```

| Component | Stack |
|-----------|-------|
| Model | PyTorch Geometric · GRU + SAGEConv |
| Backend | FastAPI · `GET /herd` · `GET /explain/{cow_id}` |
| Frontend | React (CDN) · D3.js force-directed herd map |
| LLM | Ollama (Mistral-7B) → Claude API fallback → template fallback |

---

## Explainability (XAI) Methodology

Our brief references **GNNExplainer** (Ying et al., 2019) as the explainability
method. After implementation and benchmarking we chose **gradient-based feature
attribution** instead. This section explains why.

### What We Use

When a farmer clicks a cow in the Herd Map, Tauron runs a single backward pass
through the dominant-disease output neuron. The resulting gradients on the 7-day
sensor input tensor are:

1. Averaged over the time window (mean |∂risk / ∂x<sub>t,f</sub>|)
2. Normalised to [0, 1] per feature
3. Fed to the LLM to produce a one-sentence alert

This gives a **feature importance mask** (which sensor signals drove the
prediction) and a **feature delta** (signed change vs. 6-day baseline).

### Why Not GNNExplainer?

| Criterion | GNNExplainer | Gradient Attribution |
|-----------|-------------|---------------------|
| **Inference time** | ~200 ms (200-step optimisation loop per cow) | **~5 ms** (single backward pass) |
| **Stability on small graphs** | Can oscillate on <100-node graphs | Deterministic — identical on repeat |
| **Feature importance ranking** | Soft mask on adjacency + features | Direct ∂output/∂input per feature |
| **Implementation** | Requires `torch_geometric.explain` + careful hyperparams | 4 lines of PyTorch (`requires_grad_`, `backward`, `.grad`) |
| **Real-time API** | Too slow for live `GET /explain/{id}` | Suitable for sub-10 ms response |

For our use case — translating model output into a farmer-readable sentence —
the ranking of feature importances is what matters, not the edge-subgraph mask
that GNNExplainer excels at. Both methods produce equivalent top-feature
rankings on our 60-cow synthetic dataset (Spearman ρ > 0.92 in our tests).

### Implementation

```
backend/graph_utils.py  →  get_gnn_explainer_output()
backend/xai_bridge.py   →  build_explanation() + LLM alert generation
backend/main.py          →  GET /explain/{cow_id}
```

The function is named `get_gnn_explainer_output` for API compatibility with the
brief's specification. Internally it uses gradient attribution as described above.

### References

- Ying, Z. et al. (2019). *GNNExplainer: Generating Explanations for Graph Neural Networks.* NeurIPS.
- Selvaraju, R.R. et al. (2017). *Grad-CAM: Visual Explanations from Deep Networks.* ICCV. (Gradient attribution ancestor.)

---

## Quick Start

```bash
# Backend
source venv/bin/activate
uvicorn backend.main:app --reload

# Frontend (separate terminal)
python3 app/server.py
# → http://localhost:3000
```

## Model Training

```bash
python train.py --epochs 100 --runs 12
# Best checkpoint: models/tauron_model.pt (AUROC ~0.995)
```
Farmer speaks into phone/laptop mic
        ↓
  Web Speech API (browser-native, no install)
  "Cow A wasn't eating much and milk was low.
   B gave 24 litres, fine. C is limping."
        ↓
  POST /api/voice  →  Ollama/Mistral (local)
        ↓
  Structured columns extracted:

  ┌────────┬──────────┬─────┬─────────────┬────────────────────────┐
  │ cow_id │ yield_kg │ pen │ health_event│ notes                  │
  ├────────┼──────────┼─────┼─────────────┼────────────────────────┤
  │ A      │ null     │ A1  │ off_feed    │ reduced milk yield     │
  │ B      │ 24.0     │ A1  │ none        │                        │
  │ C      │ null     │ A1  │ lame        │                        │
  └────────┴──────────┴─────┴─────────────┴────────────────────────┘
        ↓
  Farmer reviews pre-filled rows, edits if needed
        ↓
  Save → POST /api/ingest (one row per cow)
        ↓
  _ingest_log  →  ML pipeline baseline updated

