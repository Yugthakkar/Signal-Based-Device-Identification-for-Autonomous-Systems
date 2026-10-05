"""Causal fixed-window features for CAN intrusion detection."""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd

FEATURE_COLUMNS = ["frames_per_second", "gap_mean_ms", "gap_std_ms", "gap_min_ms", "burst_fraction", "unique_id_count", "id_entropy", "dlc_mean", "dlc_std", "dominant_id_fraction"]


def _entropy(values: pd.Series) -> float:
    probs = values.value_counts(normalize=True).to_numpy(dtype=float)
    return float(-(probs * np.log2(probs + 1e-12)).sum())


def make_windows(df: pd.DataFrame, window_ms: int, verbose: bool = False) -> pd.DataFrame:
    df = df.sort_values("timestamp_s").copy()
    if df.empty:
        return pd.DataFrame(columns=[*FEATURE_COLUMNS, "window_start_s", "window_end_s", "attack_fraction", "target", "capture_id", "attack_type"])
    duration = window_ms / 1000.0
    start = float(df["timestamp_s"].iloc[0])
    df["window_index"] = np.floor((df["timestamp_s"] - start) / duration).astype(int)
    rows: list[dict] = []
    groups = df.groupby("window_index", sort=True)
    total_groups = len(groups)
    for i, (index, group) in enumerate(groups):
        timestamps = group["timestamp_s"].to_numpy(dtype=float)
        gaps = np.diff(timestamps) * 1000.0
        count = len(group)
        flags = group["flag"].astype(str).str.upper().eq("T")
        id_counts = group["can_id"].value_counts()
        rows.append({
            "frames_per_second": count / duration,
            "gap_mean_ms": float(gaps.mean()) if len(gaps) else 0.0,
            "gap_std_ms": float(gaps.std()) if len(gaps) else 0.0,
            "gap_min_ms": float(gaps.min()) if len(gaps) else 0.0,
            "burst_fraction": float((gaps < 1.0).mean()) if len(gaps) else 0.0,
            "unique_id_count": int(group["can_id"].nunique()),
            "id_entropy": _entropy(group["can_id"]),
            "dlc_mean": float(pd.to_numeric(group["dlc"], errors="coerce").mean()),
            "dlc_std": float(np.nan_to_num(pd.to_numeric(group["dlc"], errors="coerce").std(ddof=0), nan=0.0)),
            "dominant_id_fraction": float(id_counts.iloc[0] / count),
            "window_start_s": start + index * duration,
            "window_end_s": start + (index + 1) * duration,
            "attack_fraction": float(flags.mean()),
            "target": int(flags.any()),
            "capture_id": str(group["capture_id"].iloc[0]),
            "attack_type": str(group["attack_type"].iloc[0]) if flags.any() else "normal",
        })
        if verbose and (i + 1) % 10000 == 0:
            print(f"      ... {i+1:,}/{total_groups:,} windows processed")
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build causal CAN feature windows from normalised capture files.")
    parser.add_argument("--input", nargs="+", required=True)
    parser.add_argument("--output", default="data/can/processed/can_windows_100ms.csv")
    parser.add_argument("--window_ms", type=int, default=100)
    args = parser.parse_args()
    if args.window_ms <= 0:
        raise ValueError("window_ms must be positive")
    
    print(f"\n{'='*60}")
    print(f"  CAN Feature Window Builder")
    print(f"  Window size: {args.window_ms} ms")
    print(f"  Input files: {len(args.input)}")
    print(f"{'='*60}")
    
    all_windows = []
    for i, path in enumerate(args.input, 1):
        t0 = time.time()
        p = Path(path)
        print(f"\n  [{i}/{len(args.input)}] Processing: {p.name}")
        df = pd.read_csv(path)
        print(f"    Loaded {len(df):,} normalised frames")
        windows = make_windows(df, args.window_ms, verbose=True)
        attack_count = int(windows["target"].sum()) if len(windows) else 0
        print(f"    -> {len(windows):,} windows ({attack_count:,} attack) in {time.time()-t0:.1f}s")
        all_windows.append(windows)
    
    result = pd.concat(all_windows, ignore_index=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output, index=False)
    
    print(f"\n{'='*60}")
    print(f"  Feature Extraction Complete")
    print(f"  Total windows: {len(result):,}")
    print(f"  Attack windows: {int(result['target'].sum()):,} ({result['target'].mean()*100:.1f}%)")
    print(f"  Normal windows: {int((result['target']==0).sum()):,}")
    print(f"  Output: {output}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
