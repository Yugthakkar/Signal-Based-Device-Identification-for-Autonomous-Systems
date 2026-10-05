import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

try:
    from .network import DeviceClassifier
except ImportError:
    from network import DeviceClassifier

DEFAULT_FEATURE_SETS = [
    [
        "event_rate",
        "avg_time_gap",
        "std_time_gap",
        "burst_density",
        "avg_packet_size",
        "movement_speed",
        "click_frequency",
        "key_press_rate",
    ],
    [
        "packet_length",
        "transfer_type",
        "endpoint",
        "device",
        "time_gap",
        "packet_rate",
        "burst_flag",
    ],
]


class FocalLoss(nn.Module):
    def __init__(self, alpha: torch.Tensor | None = None, gamma: float = 2.0, reduction: str = "mean") -> None:
        super().__init__()
        self.gamma = gamma
        self.reduction = reduction
        if alpha is not None:
            self.register_buffer("alpha", alpha)
        else:
            self.alpha = None

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        log_probs = F.log_softmax(logits, dim=-1)
        probs = log_probs.exp()
        target_log_probs = log_probs.gather(1, target.unsqueeze(1)).squeeze(1)
        target_probs = probs.gather(1, target.unsqueeze(1)).squeeze(1)

        focal_factor = (1 - target_probs).clamp(min=1e-6).pow(self.gamma)
        loss = -focal_factor * target_log_probs

        if self.alpha is not None:
            alpha_factor = self.alpha.gather(0, target)
            loss = loss * alpha_factor

        if self.reduction == "mean":
            return loss.mean()
        if self.reduction == "sum":
            return loss.sum()
        return loss


def compute_balancing_weights(y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    unique_labels, counts = np.unique(y, return_counts=True)
    num_classes = int(unique_labels.max()) + 1
    class_weights = np.ones(num_classes, dtype=np.float32)
    total = counts.sum()
    for label, count in zip(unique_labels, counts):
        if count == 0:
            continue
        class_weights[label] = total / (len(unique_labels) * count)

    sample_weights = class_weights[y]
    return class_weights, sample_weights.astype(np.float32)


def infer_feature_columns(df: pd.DataFrame, explicit_columns: list[str] | None = None) -> list[str]:
    if explicit_columns:
        missing = [col for col in explicit_columns if col not in df.columns]
        if missing:
            raise ValueError(f"Requested feature columns not found in dataset: {missing}")
        return explicit_columns

    for candidate in DEFAULT_FEATURE_SETS:
        if all(col in df.columns for col in candidate):
            return candidate

    raise ValueError(
        "Could not infer feature columns from dataset. Provide --feature_columns explicitly. "
        f"Known sets: {DEFAULT_FEATURE_SETS}"
    )


def _build_class_map(df: pd.DataFrame, target: pd.Series) -> dict[str, str]:
    labels = sorted(pd.to_numeric(target, errors="coerce").dropna().astype(int).unique().tolist())
    if not labels:
        return {"0": "Keyboard", "1": "Mouse"}

    if "device_class" in df.columns and "label" in df.columns:
        mapping: dict[str, str] = {}
        pairs = df[["label", "device_class"]].dropna().copy()
        pairs["device_class"] = pd.to_numeric(pairs["device_class"], errors="coerce")
        pairs = pairs.dropna(subset=["device_class"])
        for _, row in pairs.iterrows():
            class_id = str(int(row["device_class"]))
            raw_name = str(row["label"]).strip().lower()
            if raw_name.startswith("keyboard"):
                name = "Keyboard"
            elif raw_name.startswith("mouse"):
                name = "Mouse"
            else:
                name = str(row["label"]).replace("_", " ").strip().title()
            if name:
                mapping[class_id] = name
        if mapping:
            return mapping

    if set(labels) == {0, 1}:
        return {"0": "Keyboard", "1": "Mouse"}

    return {str(label): f"Class {label}" for label in labels}


def _select_target(df: pd.DataFrame) -> pd.Series:
    if "device_class" in df.columns:
        numeric = pd.to_numeric(df["device_class"], errors="coerce")
        if numeric.notna().any():
            return numeric.astype("Int64")

    if "label" in df.columns:
        numeric_label = pd.to_numeric(df["label"], errors="coerce")
        if numeric_label.notna().any():
            return numeric_label.astype("Int64")
        encoded, _ = pd.factorize(df["label"].astype(str))
        return pd.Series(encoded, index=df.index)

    raise ValueError("Dataset must include either numeric device_class or label column")


def load_dataset(dataset_path: Path, feature_columns: list[str] | None = None) -> tuple[np.ndarray, np.ndarray, list[str], dict[str, str]]:
    df = pd.read_csv(dataset_path)
    selected_columns = infer_feature_columns(df, feature_columns)
    has_target = "device_class" in df.columns or "label" in df.columns
    missing = [col for col in selected_columns if col not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required columns: {missing}")
    if not has_target:
        raise ValueError("Dataset missing target column: expected 'device_class' or 'label'")

    target = _select_target(df)

    cleaned = df[selected_columns].copy()
    cleaned["target"] = target
    for col in selected_columns + ["target"]:
        cleaned[col] = pd.to_numeric(cleaned[col], errors="coerce")
    cleaned = cleaned.dropna(subset=selected_columns + ["target"])

    x = cleaned[selected_columns].to_numpy(dtype=np.float32)
    y = cleaned["target"].to_numpy(dtype=np.int64)
    class_map = _build_class_map(df, target)
    return x, y, selected_columns, class_map


def split_train_test(x: np.ndarray, y: np.ndarray, test_ratio: float = 0.2, seed: int = 42):
    np.random.seed(seed)
    idx = np.arange(len(x))
    np.random.shuffle(idx)

    split = int(len(idx) * (1 - test_ratio))
    train_idx = idx[:split]
    test_idx = idx[split:]

    return x[train_idx], x[test_idx], y[train_idx], y[test_idx]


def fit_normalization(x_train: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std = np.where(std < 1e-8, 1.0, std)
    return mean.astype(np.float32), std.astype(np.float32)


def apply_normalization(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((x - mean) / std).astype(np.float32)


def train_model(
    x_train: np.ndarray,
    y_train: np.ndarray,
    epochs: int,
    lr: float,
    *,
    batch_size: int = 128,
    class_weights: np.ndarray | None = None,
    sample_weights: np.ndarray | None = None,
    use_focal_loss: bool = True,
):
    model = DeviceClassifier(input_dim=x_train.shape[1])

    alpha_tensor = torch.from_numpy(class_weights.astype(np.float32)) if class_weights is not None else None
    if use_focal_loss:
        criterion: nn.Module = FocalLoss(alpha=alpha_tensor, gamma=2.0)
    else:
        criterion = nn.CrossEntropyLoss(weight=alpha_tensor)

    optimizer = optim.AdamW(model.parameters(), lr=lr)

    dataset = TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train))
    if sample_weights is not None:
        weight_tensor = torch.from_numpy(sample_weights.astype(np.float64))
        sampler = WeightedRandomSampler(weights=weight_tensor, num_samples=len(weight_tensor), replacement=True)
        loader = DataLoader(dataset, batch_size=batch_size, sampler=sampler)
    else:
        loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        running_correct = 0
        running_total = 0

        for batch_x, batch_y in loader:
            logits = model(batch_x)
            loss = criterion(logits, batch_y)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item() * batch_x.size(0)
            preds = torch.argmax(logits, dim=1)
            running_correct += (preds == batch_y).sum().item()
            running_total += batch_x.size(0)

        if epoch % 5 == 0 or epoch == 1:
            epoch_loss = running_loss / max(running_total, 1)
            epoch_acc = running_correct / max(running_total, 1)
            print(f"[INFO] Epoch {epoch}/{epochs} | loss={epoch_loss:.4f} | train_acc={epoch_acc:.3f}")

    return model


def evaluate(model: DeviceClassifier, x_test: np.ndarray, y_test: np.ndarray) -> float:
    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(x_test))
        pred = torch.argmax(logits, dim=1).numpy()
    return float((pred == y_test).mean())


def save_artifacts(
    model: DeviceClassifier,
    output_model: Path,
    metadata_path: Path,
    feature_columns: list[str],
    classes: dict[str, str],
    mean: np.ndarray,
    std: np.ndarray,
) -> None:
    output_model.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), output_model)

    metadata = {
        "classes": classes,
        "feature_columns": feature_columns,
        "architecture": "Residual LayerNorm MLP (64-64-32)",
        "normalization": {
            "mean": mean.tolist(),
            "std": std.tolist(),
        },
    }
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def train_from_dataset(
    dataset_path: Path,
    epochs: int = 30,
    lr: float = 1e-3,
    batch_size: int = 128,
    feature_columns: list[str] | None = None,
    model_out: Path | None = None,
    meta_out: Path | None = None,
) -> dict[str, Any]:
    x, y, selected_columns, class_map = load_dataset(dataset_path, feature_columns)
    x_train, x_test, y_train, y_test = split_train_test(x, y)

    mean, std = fit_normalization(x_train)
    x_train_norm = apply_normalization(x_train, mean, std)
    x_test_norm = apply_normalization(x_test, mean, std)

    class_weights: np.ndarray | None = None
    sample_weights: np.ndarray | None = None
    if np.unique(y_train).size > 1:
        class_weights, sample_weights = compute_balancing_weights(y_train)

    model = train_model(
        x_train_norm,
        y_train,
        epochs=epochs,
        lr=lr,
        batch_size=batch_size,
        class_weights=class_weights,
        sample_weights=sample_weights,
    )
    test_acc = evaluate(model, x_test_norm, y_test)

    if model_out is not None and meta_out is not None:
        save_artifacts(model, model_out, meta_out, selected_columns, class_map, mean, std)

    return {
        "model": model,
        "test_accuracy": test_acc,
        "feature_columns": selected_columns,
        "classes": class_map,
        "normalization": {
            "mean": mean,
            "std": std,
        },
        "rows": int(x.shape[0]),
        "class_weights": class_weights,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a vanilla neural network for device classification.")
    parser.add_argument("--dataset", default="../data/datasets/final_device_dataset.csv")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--batch_size", type=int, default=128)
    parser.add_argument("--model_out", default="../artifacts/device_classifier.pt")
    parser.add_argument("--meta_out", default="../artifacts/model_metadata.json")
    parser.add_argument(
        "--feature_columns",
        default="",
        help="Comma-separated feature columns. If omitted, columns are inferred.",
    )
    args = parser.parse_args()

    selected_columns = [c.strip() for c in args.feature_columns.split(",") if c.strip()] or None

    print("[INFO] Running model training...")
    result = train_from_dataset(
        dataset_path=Path(args.dataset),
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        feature_columns=selected_columns,
        model_out=Path(args.model_out),
        meta_out=Path(args.meta_out),
    )

    test_acc = float(result["test_accuracy"])
    print(f"[RESULT] Test accuracy: {test_acc * 100:.2f}%")
    print(f"[INFO] Feature columns: {result['feature_columns']}")
    print(f"[INFO] Classes: {result['classes']}")
    print(f"[INFO] Training rows used: {result['rows']}")
    print(f"[INFO] Model saved: {args.model_out}")
    print(f"[INFO] Metadata saved: {args.meta_out}")


if __name__ == "__main__":
    main()
