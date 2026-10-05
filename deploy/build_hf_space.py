"""Assemble a self-contained Hugging Face Space folder at deploy/hf_space/.

Only what the backend needs at runtime is copied; the 900 MB raw CAN recordings,
the virtualenv, node_modules and any .env file are never included.

    python deploy/build_hf_space.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = Path(__file__).resolve().parent
OUT = DEPLOY / "hf_space"

CODE_DIRS = ["ml_service", "model", "feature_engineering"]
FILES = [  # (source relative to repo root, destination relative to the Space)
    ("artifacts/can_timing_v1/model.joblib", "artifacts/can_timing_v1/model.joblib"),
    ("artifacts/can_timing_v1/model_metadata.json", "artifacts/can_timing_v1/model_metadata.json"),
    ("artifacts/can_timing_v1/training_report.json", "artifacts/can_timing_v1/training_report.json"),
    ("artifacts/usb_behavior_v1/model.pt", "artifacts/usb_behavior_v1/model.pt"),
    ("artifacts/usb_behavior_v1/model_metadata.json", "artifacts/usb_behavior_v1/model_metadata.json"),
    ("artifacts/usb_behavior_v1/training_report.json", "artifacts/usb_behavior_v1/training_report.json"),
    ("artifacts/device_classifier.pt", "artifacts/device_classifier.pt"),
    ("artifacts/model_metadata.json", "artifacts/model_metadata.json"),
    ("data/can/processed/can_windows_100ms.csv", "data/can/processed/can_windows_100ms.csv"),
    ("data/can/scenario_frames.json", "data/can/scenario_frames.json"),
    ("data/usb/behavior/usb_behavior_v1_sessions.csv", "data/usb/behavior/usb_behavior_v1_sessions.csv"),
    ("deploy/Dockerfile", "Dockerfile"),
    ("deploy/requirements.txt", "requirements.txt"),
    ("deploy/HF_README.md", "README.md"),
]


def main() -> None:
    missing = [src for src, _ in FILES if not (ROOT / src).exists()]
    if missing:
        sys.exit(
            "Missing files:\n  " + "\n  ".join(missing)
            + "\nTrain the models / run scripts/export_scenario_frames.py first."
        )

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for name in CODE_DIRS:
        shutil.copytree(ROOT / name, OUT / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.db"))
    for src, dst in FILES:
        target = OUT / dst
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / src, target)

    # Hugging Face stores large/binary files via Xet automatically; no LFS setup needed.
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"Built {OUT}  ({total / 1024 / 1024:.1f} MB, {sum(1 for f in OUT.rglob('*') if f.is_file())} files)")
    leaked = [p for p in OUT.rglob("*") if p.name.startswith(".env")]
    assert not leaked, f"refusing: secrets in bundle {leaked}"


if __name__ == "__main__":
    main()
