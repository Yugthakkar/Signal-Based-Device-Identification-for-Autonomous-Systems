"""Export the raw CAN frames used by the 3D Bus Lab into one small JSON file.

The hosted backend cannot ship the ~900 MB HCRL recordings, so it reads these
frames from data/can/scenario_frames.json instead. Run once, locally:

    python scripts/export_scenario_frames.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml_service"))
sys.path.insert(0, str(ROOT))

import can_routes  # noqa: E402
from replay import _load_windows  # noqa: E402


def main() -> None:
    windows = _load_windows(ROOT)
    raw_root = ROOT / "data" / "can" / "raw"
    out: dict[str, list] = {}
    for key, capture_id, raw_file in can_routes.SCENARIOS:
        frame = windows[windows["capture_id"] == capture_id]
        if frame.empty:
            print(f"skip {key}: no windows for {capture_id}")
            continue
        clip = can_routes.scenario_clip(frame, key)
        start = float(clip.iloc[0]["window_start_s"])
        frames = can_routes._sample_raw_frames(raw_root / raw_file, start, key != "normal")
        if not frames:
            raise SystemExit(f"No raw frames found for {key}; is {raw_root / raw_file} present?")
        out[key] = frames
        print(f"{key:12s} {len(frames)} frames")

    target = ROOT / can_routes.FRAMES_FALLBACK
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {target} ({target.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
