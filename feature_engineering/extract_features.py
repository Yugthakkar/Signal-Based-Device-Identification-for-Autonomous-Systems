import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


@dataclass
class FeatureVector:
    event_rate: float
    avg_time_gap: float
    std_time_gap: float
    burst_density: float
    avg_packet_size: float
    movement_speed: float
    click_frequency: float
    key_press_rate: float

    def as_list(self) -> list[float]:
        return [
            self.event_rate,
            self.avg_time_gap,
            self.std_time_gap,
            self.burst_density,
            self.avg_packet_size,
            self.movement_speed,
            self.click_frequency,
            self.key_press_rate,
        ]


def _safe_duration(timestamps: np.ndarray) -> float:
    if timestamps.size < 2:
        return 1.0
    duration = float(timestamps[-1] - timestamps[0])
    return duration if duration > 0 else 1.0


def _compute_time_features(timestamps: np.ndarray) -> tuple[float, float, float, float]:
    if timestamps.size == 0:
        return 0.0, 0.0, 0.0, 0.0

    duration = _safe_duration(timestamps)
    event_rate = float(timestamps.size / duration)

    if timestamps.size < 2:
        return event_rate, 0.0, 0.0, 0.0

    gaps = np.diff(timestamps)
    avg_gap = float(np.mean(gaps))
    std_gap = float(np.std(gaps))
    burst_density = float(np.mean(gaps < 0.2))
    return event_rate, avg_gap, std_gap, burst_density


EVENT_TYPE_ALIASES = {
    "keydown": "key_press",
    "key_down": "key_press",
    "mousemove": "mouse_move",
    "click": "mouse_click",
    "mouseclick": "mouse_click",
}


def _normalize_event_types(df: pd.DataFrame) -> pd.DataFrame:
    if "event_type" not in df.columns:
        return df
    df = df.copy()
    df["event_type"] = df["event_type"].astype(str).str.strip().replace(EVENT_TYPE_ALIASES)
    return df


def _split_coordinate(value: str) -> tuple[float, float] | None:
    delimiter = ":" if ":" in value else ("," if "," in value else None)
    if delimiter is None:
        return None
    parts = value.split(delimiter)
    if len(parts) < 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def _extract_mouse_speed(df: pd.DataFrame) -> float:
    move_df = df[df["event_type"] == "mouse_move"]
    if move_df.empty:
        return 0.0

    coords = []
    times = []
    for _, row in move_df.iterrows():
        value = str(row["value"])
        parsed = _split_coordinate(value)
        if parsed is None:
            continue
        x, y = parsed
        try:
            t = float(row["timestamp"])
        except ValueError:
            continue
        coords.append((x, y))
        times.append(t)

    if len(coords) < 2:
        return 0.0

    dist_sum = 0.0
    time_sum = 0.0
    for i in range(1, len(coords)):
        dx = coords[i][0] - coords[i - 1][0]
        dy = coords[i][1] - coords[i - 1][1]
        dist_sum += float(np.sqrt(dx * dx + dy * dy))
        dt = times[i] - times[i - 1]
        if dt > 0:
            time_sum += dt

    if time_sum <= 0:
        return 0.0
    return dist_sum / time_sum


def _extract_rate_by_event(df: pd.DataFrame, event_name: str) -> float:
    if df.empty:
        return 0.0
    timestamps = df["timestamp"].to_numpy(dtype=float)
    duration = _safe_duration(timestamps)
    count = int((df["event_type"] == event_name).sum())
    return float(count / duration)


def extract_features(df: pd.DataFrame) -> FeatureVector:
    if "timestamp" not in df.columns:
        raise ValueError("Input must contain a timestamp column")

    df = df.copy()
    df["timestamp"] = pd.to_numeric(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"]).sort_values("timestamp")
    df = _normalize_event_types(df)

    timestamps = df["timestamp"].to_numpy(dtype=float)
    event_rate, avg_gap, std_gap, burst_density = _compute_time_features(timestamps)

    avg_packet_size = 0.0
    if "packet_size" in df.columns:
        packet_series = pd.to_numeric(df["packet_size"], errors="coerce").dropna()
        avg_packet_size = float(packet_series.mean()) if not packet_series.empty else 0.0

    movement_speed = _extract_mouse_speed(df) if "event_type" in df.columns else 0.0
    click_frequency = _extract_rate_by_event(df, "mouse_click") if "event_type" in df.columns else 0.0
    key_press_rate = _extract_rate_by_event(df, "key_press") if "event_type" in df.columns else 0.0

    return FeatureVector(
        event_rate=event_rate,
        avg_time_gap=avg_gap,
        std_time_gap=std_gap,
        burst_density=burst_density,
        avg_packet_size=avg_packet_size,
        movement_speed=movement_speed,
        click_frequency=click_frequency,
        key_press_rate=key_press_rate,
    )


def extract_features_from_csv(csv_path: Path) -> FeatureVector:
    df = pd.read_csv(csv_path)
    return extract_features(df)


def extract_features_from_records(records: Iterable[dict]) -> FeatureVector:
    df = pd.DataFrame(records)
    return extract_features(df)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract feature vector from event/USB CSV.")
    parser.add_argument("--input", required=True, help="Input CSV path")
    args = parser.parse_args()

    fv = extract_features_from_csv(Path(args.input))
    print("[INFO] Extracting features...")
    print(f"[RESULT] Feature vector: {fv.as_list()}")


if __name__ == "__main__":
    main()
