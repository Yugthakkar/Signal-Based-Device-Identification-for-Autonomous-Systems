from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from model.network import DeviceClassifier


class InferenceEngine:
    def __init__(self, model_path: Path, metadata_path: Path) -> None:
        self.model_path = model_path
        self.metadata_path = metadata_path
        self.feature_columns = [
            "event_rate",
            "avg_time_gap",
            "std_time_gap",
            "burst_density",
            "avg_packet_size",
            "movement_speed",
            "click_frequency",
            "key_press_rate",
        ]
        self.classes = {"0": "Keyboard", "1": "Mouse"}
        self.norm_mean: np.ndarray | None = None
        self.norm_std: np.ndarray | None = None
        self.model: DeviceClassifier | None = None

        self.load()

    def load(self) -> None:
        if self.metadata_path.exists():
            metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            self.feature_columns = metadata.get("feature_columns", self.feature_columns)
            self.classes = metadata.get("classes", self.classes)
            normalization = metadata.get("normalization", {})
            mean = normalization.get("mean")
            std = normalization.get("std")
            if isinstance(mean, list) and isinstance(std, list) and len(mean) == len(std):
                self.norm_mean = np.array(mean, dtype=np.float32)
                self.norm_std = np.array(std, dtype=np.float32)

        model = DeviceClassifier(input_dim=len(self.feature_columns))
        model.load_state_dict(torch.load(self.model_path, map_location="cpu"))
        model.eval()
        self.model = model

    def _normalize(self, matrix: np.ndarray) -> np.ndarray:
        if self.norm_mean is None or self.norm_std is None:
            return matrix
        return (matrix - self.norm_mean) / self.norm_std

    def predict(self, feature_vector: list[float]) -> dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Model not loaded")

        if len(feature_vector) != len(self.feature_columns):
            raise ValueError(
                f"Feature count mismatch: this model expects {len(self.feature_columns)} features "
                f"({', '.join(self.feature_columns)}), but received {len(feature_vector)}. "
                "The loaded model artifact uses a different feature schema than the caller."
            )

        matrix = np.array([feature_vector], dtype=np.float32)
        matrix = self._normalize(matrix)
        x = torch.tensor(matrix)
        with torch.no_grad():
            logits = self.model(x)
            probs = torch.softmax(logits, dim=1).numpy()[0]

        label = int(np.argmax(probs))
        confidence = float(probs[label])
        return {
            "label": label,
            "device": self.classes.get(str(label), str(label)),
            "confidence": confidence,
            "probabilities": {self.classes.get(str(i), str(i)): float(p) for i, p in enumerate(probs)},
        }

    def predict_batch(self, feature_matrix: np.ndarray) -> dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Model not loaded")
        if feature_matrix.size == 0:
            raise ValueError("Empty feature matrix")

        normalized = self._normalize(feature_matrix.astype(np.float32))
        x = torch.tensor(normalized)

        with torch.no_grad():
            logits = self.model(x)
            probs = torch.softmax(logits, dim=1).numpy()

        mean_probs = probs.mean(axis=0)
        label = int(np.argmax(mean_probs))
        confidence = float(mean_probs[label])
        return {
            "label": label,
            "device": self.classes.get(str(label), str(label)),
            "confidence": confidence,
            "probabilities": {self.classes.get(str(i), str(i)): float(p) for i, p in enumerate(mean_probs)},
            "windows": int(feature_matrix.shape[0]),
        }
