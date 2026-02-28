"""
train.py
--------
Build dataset, train TauronGNN, save checkpoint.

Usage:
    python train.py
    python train.py --epochs 100 --runs 10
"""

import argparse
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import roc_auc_score, average_precision_score
from sklearn.model_selection import train_test_split
from torch.optim import Adam

import tauron_pipeline as tp

# ── Seeds ──────────────────────────────────────────────────────────────────
torch.manual_seed(42)
np.random.seed(42)
random.seed(42)

# External data adapter
import sys, importlib
sys.path.insert(0, "data/external")
try:
    import adapter as ext_adapter
except ImportError:
    ext_adapter = None


# ── CLI args ───────────────────────────────────────────────────────────────
def get_args():
    p = argparse.ArgumentParser()
    p.add_argument("--epochs",   type=int, default=50,  help="training epochs")
    p.add_argument("--runs",     type=int, default=7,   help="disease injection runs per snapshot")
    p.add_argument("--lr",       type=float, default=3e-4)
    p.add_argument("--hidden",   type=int, default=128)
    p.add_argument("--dropout",  type=float, default=0.3)
    p.add_argument("--data",     type=str,   default="data/wageningen.csv",
                   help="real dataset CSV; falls back to synthetic if not found")
    p.add_argument("--out",      type=str,   default="models/tauron_model.pt")
    return p.parse_args()


# ── Training helpers ───────────────────────────────────────────────────────
def train_epoch(model, graphs, criterion, optimizer):
    model.train()
    total = 0.0
    random.shuffle(graphs)
    for g in graphs:
        g = g.to(tp.DEVICE)
        optimizer.zero_grad()
        loss = criterion(model(g), g.y.to(tp.DEVICE))
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        total += loss.item()
    return total / len(graphs)


@torch.no_grad()
def evaluate(model, graphs, criterion):
    model.eval()
    preds, trues, loss_sum = [], [], 0.0
    for g in graphs:
        g = g.to(tp.DEVICE)
        logits = model(g)
        loss_sum += criterion(logits, g.y.to(tp.DEVICE)).item()
        preds.append(logits.cpu())
        trues.append(g.y.cpu())

    P = torch.cat(preds).numpy()
    T = torch.cat(trues).numpy()
    aurocs = {}
    for i, d in enumerate(tp.DISEASES):
        yt, yp = T[:, i], P[:, i]
        aurocs[d] = (roc_auc_score(yt, yp)
                     if yt.sum() > 0 and (1 - yt).sum() > 0
                     else float("nan"))
    return loss_sum / len(graphs), aurocs, P, T


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    args = get_args()
    Path("data").mkdir(exist_ok=True)
    Path("models").mkdir(exist_ok=True)

    # Load data
    if Path(args.data).exists():
        import pandas as pd
        farm_df = pd.read_csv(args.data, parse_dates=["date"])
        print(f"Loaded real dataset: {farm_df.shape}")
    else:
        print("Real dataset not found — using synthetic Wageningen-profile data")
        farm_df = tp.generate_farm()
        farm_df.to_csv("data/farm_synthetic.csv", index=False)

    # Build labelled dataset (synthetic)
    dataset = tp.build_dataset(farm_df, n_runs=args.runs)

    # Merge external Cattle-Disease-Prediction data if available
    ext_dir = Path("data/external")
    if ext_adapter and ext_dir.exists() and list(ext_dir.glob("*.csv")):
        print("\n── Loading external cattle disease data ──")
        ext_df = ext_adapter.load_external_data(ext_dir)
        ext_graphs = tp.build_external_dataset(ext_df)
        print(f"Merging {len(ext_graphs)} external + {len(dataset)} synthetic graphs")
        dataset = dataset + ext_graphs
        print(f"Combined dataset: {len(dataset)} graphs")
    else:
        print("No external data found — using synthetic only")

    torch.save(dataset, "data/dataset.pt")

    # Train / val split
    idx = list(range(len(dataset)))
    train_idx, val_idx = train_test_split(idx, test_size=0.2, random_state=42)
    train_set = [dataset[i] for i in train_idx]
    val_set   = [dataset[i] for i in val_idx]
    print(f"Train: {len(train_set)}   Val: {len(val_set)}")

    # Class-weighted loss
    all_y      = torch.cat([g.y for g in dataset])
    pos_frac   = all_y.mean(0).clamp(1e-4, 1 - 1e-4)
    pos_weight = ((1 - pos_frac) / pos_frac).to(tp.DEVICE)
    criterion  = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    # Model + optimiser
    model     = tp.TauronGNN(hidden=args.hidden, dropout=args.dropout).to(tp.DEVICE)
    optimizer = Adam(model.parameters(), lr=args.lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_auroc = -1.0
    print(f"\nTraining for {args.epochs} epochs on {tp.DEVICE}\n")

    for epoch in range(1, args.epochs + 1):
        tl = train_epoch(model, train_set, criterion, optimizer)
        vl, aurocs, _, _ = evaluate(model, val_set, criterion)
        scheduler.step()

        mean_a = np.nanmean(list(aurocs.values()))
        if mean_a > best_auroc:
            best_auroc = mean_a
            torch.save(model.state_dict(), args.out)

        if epoch % 10 == 0 or epoch == 1:
            astr = "  ".join(f"{d[:3].upper()} {aurocs[d]:.3f}" for d in tp.DISEASES)
            print(f"ep {epoch:3d}/{args.epochs}  "
                  f"train {tl:.4f}  val {vl:.4f}  [{astr}]  best {best_auroc:.3f}")

    print(f"\nDone. Best mean AUROC: {best_auroc:.4f}")
    print(f"Checkpoint saved → {args.out}")

    # Final evaluation
    model.load_state_dict(torch.load(args.out, map_location=tp.DEVICE))
    _, final_aurocs, val_preds, val_trues = evaluate(model, val_set, criterion)

    print("\nFinal validation metrics:")
    for i, d in enumerate(tp.DISEASES):
        ap = average_precision_score(val_trues[:, i], val_preds[:, i])
        print(f"  {d:10s}  AUROC {final_aurocs[d]:.4f}  AP {ap:.4f}")


if __name__ == "__main__":
    main()
