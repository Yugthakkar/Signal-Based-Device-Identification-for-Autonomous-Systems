"""Train reproducible CAN intrusion models from causal window features.

This command chooses a model with validation data, then reports the untouched
chronological test partition.  It never uses labels or capture metadata as
model features.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_recall_fscore_support

try:
    from network import DeviceClassifier
except ImportError:
    from model.network import DeviceClassifier

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in __import__("sys").path:
    __import__("sys").path.append(str(ROOT))
from feature_engineering.can_features import FEATURE_COLUMNS


def make_chronological_split(frame: pd.DataFrame, purge_windows: int = 1) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Split every capture chronologically; remove windows beside split boundaries."""
    pieces = {"train": [], "validation": [], "test": []}
    for _, capture in frame.sort_values(["capture_id", "window_start_s"]).groupby("capture_id", sort=False):
        n = len(capture)
        train_end, valid_end = int(n * 0.60), int(n * 0.80)
        if n < 20:
            raise ValueError("A capture has fewer than 20 windows; use a larger recording.")
        pieces["train"].append(capture.iloc[: max(0, train_end - purge_windows)])
        pieces["validation"].append(capture.iloc[min(n, train_end + purge_windows) : max(0, valid_end - purge_windows)])
        pieces["test"].append(capture.iloc[min(n, valid_end + purge_windows) :])
    return tuple(pd.concat(pieces[name], ignore_index=True) for name in ("train", "validation", "test"))


def fit_normalizer(train: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    mean = train[FEATURE_COLUMNS].mean().to_numpy(dtype=np.float32)
    std = train[FEATURE_COLUMNS].std(ddof=0).to_numpy(dtype=np.float32)
    return mean, np.where(std < 1e-7, 1.0, std).astype(np.float32)


def normalise(frame: pd.DataFrame, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    x = frame[FEATURE_COLUMNS].to_numpy(dtype=np.float32)
    if not np.isfinite(x).all():
        raise ValueError("Feature matrix contains NaN or infinity.")
    return (x - mean) / std


def metrics(y: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    pred = (scores >= threshold).astype(int)
    precision, recall, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {"precision": float(precision), "recall": float(recall), "f1": float(f1), "pr_auc": float(average_precision_score(y, scores)), "threshold": float(threshold), "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]]}


def best_threshold(y: np.ndarray, scores: np.ndarray) -> float:
    candidates = np.unique(np.quantile(scores, np.linspace(0.02, 0.98, 97)))
    return float(max(candidates, key=lambda t: f1_score(y, scores >= t, zero_division=0)))


def train_mlp(x_train: np.ndarray, y_train: np.ndarray, x_val: np.ndarray, y_val: np.ndarray, seed: int, epochs: int = 45) -> tuple[DeviceClassifier, np.ndarray]:
    torch.manual_seed(seed)
    model = DeviceClassifier(input_dim=x_train.shape[1], num_classes=2)
    weights = np.bincount(y_train, minlength=2).sum() / (2 * np.maximum(np.bincount(y_train, minlength=2), 1))
    criterion = torch.nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32))
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    x_tensor, y_tensor = torch.tensor(x_train), torch.tensor(y_train, dtype=torch.long)
    best_state, best_f1 = None, -1.0
    print(f"    Training Residual MLP ({epochs} epochs, {x_train.shape[1]} features, {len(y_train):,} samples)")
    for epoch in range(epochs):
        model.train()
        epoch_loss = 0.0
        n_batches = 0
        order = torch.randperm(len(y_train))
        for ids in order.split(256):
            logits = model(x_tensor[ids])
            loss = criterion(logits, y_tensor[ids])
            optimizer.zero_grad(); loss.backward(); optimizer.step()
            epoch_loss += loss.item()
            n_batches += 1
        model.eval()
        with torch.no_grad():
            scores = torch.softmax(model(torch.tensor(x_val)), dim=1)[:, 1].numpy()
        score = f1_score(y_val, scores >= 0.5, zero_division=0)
        if score > best_f1:
            best_f1, best_state = score, {k: v.detach().clone() for k, v in model.state_dict().items()}
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"      Epoch {epoch+1:3d}/{epochs}  loss={epoch_loss/n_batches:.4f}  val_f1={score:.4f}  best_f1={best_f1:.4f}")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        val_scores = torch.softmax(model(torch.tensor(x_val)), dim=1)[:, 1].numpy()
    return model, val_scores


def main() -> None:
    start_time = time.time()
    parser = argparse.ArgumentParser(description="Train CAN intrusion detection models.")
    parser.add_argument("--dataset", default="data/can/processed/can_windows_100ms.csv")
    parser.add_argument("--output_dir", default="artifacts/can_timing_v1")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    
    print(f"\n{'='*60}")
    print(f"  CAN Intrusion Detection - Model Training")
    print(f"{'='*60}")
    print(f"  Dataset: {args.dataset}")
    print(f"  Output:  {args.output_dir}")
    print(f"  Seed:    {args.seed}")
    
    print(f"\n  [1/6] Loading dataset...")
    frame = pd.read_csv(args.dataset)
    required = set(FEATURE_COLUMNS + ["target", "capture_id", "window_start_s"])
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Dataset misses required columns: {missing}")
    print(f"         Loaded {len(frame):,} windows")
    print(f"         Attack windows: {int(frame['target'].sum()):,} ({frame['target'].mean()*100:.1f}%)")
    print(f"         Captures: {frame['capture_id'].nunique()}")
    for cap_id, grp in frame.groupby("capture_id"):
        print(f"           {cap_id}: {len(grp):,} windows ({int(grp['target'].sum()):,} attack)")
    
    print(f"\n  [2/6] Chronological train/val/test split...")
    train, val, test = make_chronological_split(frame)
    mean, std = fit_normalizer(train)
    x_train, x_val, x_test = (normalise(part, mean, std) for part in (train, val, test))
    y_train, y_val, y_test = (part["target"].to_numpy(dtype=int) for part in (train, val, test))
    print(f"         Train:      {len(train):,} windows ({int(y_train.sum()):,} attack)")
    print(f"         Validation: {len(val):,} windows ({int(y_val.sum()):,} attack)")
    print(f"         Test:       {len(test):,} windows ({int(y_test.sum()):,} attack)")
    
    print(f"\n  [3/6] Training classical models...")
    models = {
        "logistic_regression": LogisticRegression(class_weight="balanced", max_iter=1000, random_state=args.seed),
        "random_forest": RandomForestClassifier(n_estimators=200, max_depth=16, min_samples_leaf=3, class_weight="balanced", n_jobs=1, random_state=args.seed),
    }
    candidates: dict[str, tuple[object, np.ndarray, float, dict]] = {}
    for name, model in models.items():
        t0 = time.time()
        print(f"    Training {name}...")
        model.fit(x_train, y_train)
        scores = model.predict_proba(x_val)[:, 1]
        threshold = best_threshold(y_val, scores)
        m = metrics(y_val, scores, threshold)
        candidates[name] = (model, scores, threshold, m)
        print(f"    [OK] {name} -- val_f1={m['f1']:.4f} pr_auc={m['pr_auc']:.4f} threshold={threshold:.3f} ({time.time()-t0:.1f}s)")
    
    print(f"\n  [4/6] Training residual MLP...")
    t0 = time.time()
    mlp, mlp_scores = train_mlp(x_train, y_train, x_val, y_val, args.seed)
    mlp_threshold = best_threshold(y_val, mlp_scores)
    mlp_metrics = metrics(y_val, mlp_scores, mlp_threshold)
    candidates["residual_mlp"] = (mlp, mlp_scores, mlp_threshold, mlp_metrics)
    print(f"    [OK] residual_mlp -- val_f1={mlp_metrics['f1']:.4f} pr_auc={mlp_metrics['pr_auc']:.4f} threshold={mlp_threshold:.3f} ({time.time()-t0:.1f}s)")
    
    print(f"\n  [5/6] Model selection and test evaluation...")
    name = max(candidates, key=lambda key: candidates[key][3]["f1"])
    chosen, _, threshold, validation = candidates[name]
    print(f"    Selected model: {name} (best validation F1)")
    
    print(f"\n    Validation comparison:")
    for cname, (_, _, _, cm) in candidates.items():
        marker = " <-- SELECTED" if cname == name else ""
        print(f"      {cname:25s}  F1={cm['f1']:.4f}  Precision={cm['precision']:.4f}  Recall={cm['recall']:.4f}  PR-AUC={cm['pr_auc']:.4f}{marker}")
    
    if name == "residual_mlp":
        with torch.no_grad():
            test_scores = torch.softmax(chosen(torch.tensor(x_test)), dim=1)[:, 1].numpy()
    else:
        test_scores = chosen.predict_proba(x_test)[:, 1]
    
    test_result = metrics(y_test, test_scores, threshold)
    cm = test_result["confusion_matrix"]
    print(f"\n    Test Results ({name}):")
    print(f"      Precision: {test_result['precision']:.4f}")
    print(f"      Recall:    {test_result['recall']:.4f}")
    print(f"      F1 Score:  {test_result['f1']:.4f}")
    print(f"      PR-AUC:    {test_result['pr_auc']:.4f}")
    print(f"      Threshold: {threshold:.4f}")
    print(f"      Confusion Matrix:")
    print(f"        TN={cm[0][0]:,}  FP={cm[0][1]:,}")
    print(f"        FN={cm[1][0]:,}  TP={cm[1][1]:,}")
    
    print(f"\n  [6/6] Saving artifacts...")
    output = Path(args.output_dir); output.mkdir(parents=True, exist_ok=True)
    metadata = {"schema": "can_timing_v1", "modality": "can", "task": "binary_intrusion_detection", "feature_columns": FEATURE_COLUMNS, "classes": {"0": "normal", "1": "suspicious"}, "normalization": {"mean": mean.tolist(), "std": std.tolist()}, "selected_model": name, "threshold": threshold, "seed": args.seed}
    (output / "model_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    if name == "residual_mlp":
        torch.save(chosen.state_dict(), output / "model.pt")
        print(f"    Saved: {output / 'model.pt'}")
    else:
        import joblib
        joblib.dump(chosen, output / "model.joblib")
        print(f"    Saved: {output / 'model.joblib'}")
    print(f"    Saved: {output / 'model_metadata.json'}")
    
    report = {"dataset": str(args.dataset), "split": "per-capture chronological 60/20/20 with one-window purge", "rows": {"train": len(train), "validation": len(val), "test": len(test)}, "positive_windows": {"train": int(y_train.sum()), "validation": int(y_val.sum()), "test": int(y_test.sum())}, "validation": {key: value[3] for key, value in candidates.items()}, "chosen_model": name, "test": test_result}
    report_path = output / "training_report.json"; report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"    Saved: {report_path}")
    
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"  TRAINING COMPLETE")
    print(f"  Model:     {name}")
    print(f"  Test F1:   {test_result['f1']:.4f}")
    print(f"  PR-AUC:    {test_result['pr_auc']:.4f}")
    print(f"  Time:      {elapsed:.1f}s")
    print(f"  Artifacts: {output}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
