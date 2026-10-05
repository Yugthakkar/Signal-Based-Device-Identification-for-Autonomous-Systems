"""Generate a synthetic, session-level dataset for the usb_behavior_v1 schema.

No real labelled browser-event sessions exist in this repository yet (only two
8-row illustrative samples under data/raw/). This script procedurally generates
labelled keyboard/mouse sessions with realistic timing distributions, sends them
through the *actual production* event aliasing + feature extraction pipeline
(feature_engineering.extract_features), and writes one feature row per session.

Because every row is one independent session, a plain row-level train/test split
is equivalent to a session-level split (no window-leakage across splits), and a
manifest recording each session's id/class/split is written alongside the CSV.

This is exploratory synthetic data, not captured user behavior. It exists so the
Live Demo pipeline has a schema-matched model to run against; it should be
replaced with real, IRB/consent-appropriate captured sessions before any claim of
real-world accuracy is made.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from extract_features import extract_features_from_records

SEED = 42
CLASSES = {"Keyboard": 0, "Mouse": 1}


def _generate_keyboard_session(rng: np.random.Generator, duration_s: float) -> list[dict]:
    events: list[dict] = []
    t = 0.0
    mean_gap = rng.uniform(0.12, 0.35)
    while t < duration_s:
        gap = max(rng.normal(mean_gap, mean_gap * 0.4), 0.03)
        t += gap
        if t >= duration_s:
            break
        events.append({"event_type": "keydown", "timestamp": t, "value": chr(rng.integers(97, 123))})

    # occasional incidental mouse movement (not the dominant behavior)
    for _ in range(rng.integers(0, 3)):
        ts = rng.uniform(0, duration_s)
        x, y = rng.integers(0, 1200), rng.integers(0, 800)
        events.append({"event_type": "mousemove", "timestamp": ts, "value": f"{x},{y}"})

    return events


def _generate_mouse_session(rng: np.random.Generator, duration_s: float) -> list[dict]:
    events: list[dict] = []
    t = 0.0
    x, y = rng.integers(100, 1100), rng.integers(100, 700)
    mean_gap = rng.uniform(0.03, 0.1)
    while t < duration_s:
        gap = max(rng.normal(mean_gap, mean_gap * 0.5), 0.01)
        t += gap
        if t >= duration_s:
            break
        x = float(np.clip(x + rng.normal(0, 25), 0, 1200))
        y = float(np.clip(y + rng.normal(0, 25), 0, 800))
        events.append({"event_type": "mousemove", "timestamp": t, "value": f"{x:.0f},{y:.0f}"})
        if rng.random() < 0.04:
            events.append({"event_type": "click", "timestamp": t, "value": "0"})

    # occasional incidental keystroke
    for _ in range(rng.integers(0, 2)):
        ts = rng.uniform(0, duration_s)
        events.append({"event_type": "keydown", "timestamp": ts, "value": chr(rng.integers(97, 123))})

    return events


def generate_dataset(
    sessions_per_class: int, seed: int = SEED
) -> tuple[pd.DataFrame, list[dict]]:
    rng = np.random.default_rng(seed)
    rows: list[dict] = []
    manifest_entries: list[dict] = []
    session_index = 0

    generators = {"Keyboard": _generate_keyboard_session, "Mouse": _generate_mouse_session}

    for class_name, class_id in CLASSES.items():
        gen_fn = generators[class_name]
        for _ in range(sessions_per_class):
            session_id = f"synth_{class_name.lower()}_{session_index:04d}"
            session_index += 1
            duration_s = float(rng.uniform(3.0, 12.0))
            events = gen_fn(rng, duration_s)
            if len(events) < 2:
                continue

            fv = extract_features_from_records(events)
            row = {
                "session_id": session_id,
                "label": class_name,
                "device_class": class_id,
                **dict(zip(
                    [
                        "event_rate", "avg_time_gap", "std_time_gap", "burst_density",
                        "avg_packet_size", "movement_speed", "click_frequency", "key_press_rate",
                    ],
                    fv.as_list(),
                )),
            }
            rows.append(row)

            split = rng.choice(["train", "train", "train", "val", "test"])  # ~60/20/20
            manifest_entries.append({
                "session_id": session_id,
                "label": class_name,
                "split": str(split),
                "duration_s": duration_s,
                "event_count": len(events),
            })

    df = pd.DataFrame(rows)
    return df, manifest_entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic usb_behavior_v1 session dataset.")
    parser.add_argument("--sessions_per_class", type=int, default=300)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--out_csv", default="../data/usb/behavior/usb_behavior_v1_sessions.csv")
    parser.add_argument("--out_manifest", default="../data/usb/behavior/manifest.json")
    args = parser.parse_args()

    df, manifest_entries = generate_dataset(args.sessions_per_class, seed=args.seed)

    out_csv = Path(args.out_csv)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_csv, index=False)

    manifest = {
        "schema": "usb_behavior_v1",
        "source": "synthetic",
        "generator": "feature_engineering/generate_behavior_sessions.py",
        "seed": args.seed,
        "sessions_per_class": args.sessions_per_class,
        "class_counts": {name: int((df["label"] == name).sum()) for name in CLASSES},
        "split_counts": pd.DataFrame(manifest_entries)["split"].value_counts().to_dict() if manifest_entries else {},
        "disclosure": (
            "Procedurally generated session data, not captured real user behavior. "
            "Each row is one independent session, so a row-level split is a session-level "
            "split with no cross-session feature leakage. Replace with real labelled "
            "sessions before reporting real-world accuracy."
        ),
        "sessions": manifest_entries,
    }
    out_manifest = Path(args.out_manifest)
    out_manifest.parent.mkdir(parents=True, exist_ok=True)
    out_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"[INFO] Wrote {len(df)} session rows to {out_csv}")
    print(f"[INFO] Wrote manifest to {out_manifest}")
    print(f"[INFO] Class counts: {manifest['class_counts']}")


if __name__ == "__main__":
    main()
