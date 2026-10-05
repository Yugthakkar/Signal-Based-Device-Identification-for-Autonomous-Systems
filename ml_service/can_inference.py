"""Runtime loader for the separately trained CAN intrusion model."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch

from model.network import DeviceClassifier


class CanInferenceEngine:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.metadata: dict[str, Any] = {}
        self.model: Any = None
        self.model_kind = ""
        self.load()

    def load(self) -> None:
        metadata_path = self.artifact_dir / "model_metadata.json"
        if not metadata_path.exists():
            raise FileNotFoundError(f"CAN model metadata not found: {metadata_path}")
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        features = self.metadata.get("feature_columns")
        if not isinstance(features, list) or not features:
            raise ValueError("CAN metadata has no valid feature_columns")
        if (self.artifact_dir / "model.pt").exists():
            model = DeviceClassifier(input_dim=len(features), num_classes=len(self.metadata.get("classes", {})))
            model.load_state_dict(torch.load(self.artifact_dir / "model.pt", map_location="cpu"))
            model.eval()
            self.model, self.model_kind = model, "residual_mlp"
        elif (self.artifact_dir / "model.joblib").exists():
            import joblib
            self.model, self.model_kind = joblib.load(self.artifact_dir / "model.joblib"), "sklearn"
        else:
            raise FileNotFoundError("CAN artifact contains neither model.pt nor model.joblib")

    def predict_batch(self, rows: list[dict[str, float]]) -> list[dict[str, Any]]:
        """Score many windows in one model call (same maths as predict, far faster)."""
        columns = self.metadata["feature_columns"]
        matrix = np.asarray([[float(row[name]) for name in columns] for row in rows], dtype=np.float32)
        if not np.isfinite(matrix).all():
            raise ValueError("CAN features must be finite numbers")
        normalization = self.metadata["normalization"]
        matrix = (matrix - np.asarray(normalization["mean"], dtype=np.float32)) / np.asarray(normalization["std"], dtype=np.float32)
        if self.model_kind == "residual_mlp":
            with torch.no_grad():
                probabilities = torch.softmax(self.model(torch.tensor(matrix)), dim=1)[:, 1].numpy()
        else:
            probabilities = self.model.predict_proba(matrix)[:, 1]
        threshold = float(self.metadata["threshold"])
        return [
            {
                "label": int(p >= threshold),
                "classification": "suspicious" if p >= threshold else "normal",
                "probability": float(p),
                "threshold": threshold,
                "model_kind": self.model_kind,
                "schema": self.metadata["schema"],
            }
            for p in probabilities
        ]

    def predict(self, raw_features: dict[str, float]) -> dict[str, Any]:
        columns = self.metadata["feature_columns"]
        missing = [name for name in columns if name not in raw_features]
        if missing:
            raise ValueError(f"Missing CAN features: {missing}")
        vector = np.asarray([[float(raw_features[name]) for name in columns]], dtype=np.float32)
        if not np.isfinite(vector).all():
            raise ValueError("CAN features must be finite numbers")
        normalization = self.metadata["normalization"]
        mean = np.asarray(normalization["mean"], dtype=np.float32)
        std = np.asarray(normalization["std"], dtype=np.float32)
        vector = (vector - mean) / std
        if self.model_kind == "residual_mlp":
            with torch.no_grad():
                probability = float(torch.softmax(self.model(torch.tensor(vector)), dim=1)[0, 1])
        else:
            probability = float(self.model.predict_proba(vector)[0, 1])
        threshold = float(self.metadata["threshold"])
        suspicious = probability >= threshold
        return {"label": int(suspicious), "classification": "suspicious" if suspicious else "normal", "probability": probability, "threshold": threshold, "model_kind": self.model_kind, "schema": self.metadata["schema"]}
