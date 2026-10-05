"""CAN intrusion-detection routes: datasets, offline analysis, replay, alerts, reports."""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from replay import ReplayEngine, FEATURE_COLUMNS
from storage import Storage

router = APIRouter(prefix="/can", tags=["can"])

_engine_ref: dict[str, Any] = {"can_engine": None}
_replay: ReplayEngine | None = None
_storage: Storage | None = None


def configure(repo_root: Path, storage: Storage, can_engine_getter) -> None:
    """Wire the router to the loaded CAN model and shared storage/replay engine."""
    global _replay, _storage
    _engine_ref["get"] = can_engine_getter
    _storage = storage
    _replay = ReplayEngine(repo_root=repo_root, storage=storage, predict_fn=_predict)


def _predict(features: dict[str, float]) -> dict[str, Any]:
    engine = _engine_ref["get"]()
    if engine is None:
        raise RuntimeError("CAN model is not loaded")
    return engine.predict(features)


def _require_replay() -> ReplayEngine:
    if _replay is None:
        raise HTTPException(status_code=503, detail="CAN replay engine not initialized")
    return _replay


def _require_storage() -> Storage:
    if _storage is None:
        raise HTTPException(status_code=503, detail="CAN storage not initialized")
    return _storage


@router.get("/datasets")
def list_datasets() -> dict[str, Any]:
    return {"datasets": _require_replay().list_captures()}


class AnalyzeRequest(BaseModel):
    capture_id: str


@router.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    engine = _engine_ref["get"]()
    if engine is None:
        raise HTTPException(status_code=503, detail="CAN model is not trained or could not be loaded")

    replay_engine = _require_replay()
    storage = _require_storage()
    try:
        frame = replay_engine._capture_frame(req.capture_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    run_id = str(uuid.uuid4())
    storage.create_run(run_id, req.capture_id, kind="analyze", windows_total=len(frame))

    true_positive = false_positive = false_negative = true_negative = 0
    episode_start: float | None = None
    episode_end: float | None = None
    episode_max_prob = 0.0
    episode_count = 0

    def flush_episode() -> None:
        nonlocal episode_start, episode_end, episode_max_prob, episode_count
        if episode_start is None:
            return
        window_slice = frame[(frame["window_start_s"] >= episode_start) & (frame["window_start_s"] <= episode_end)]
        non_normal = window_slice[window_slice["attack_type"] != "normal"]["attack_type"]
        attack_type = str(non_normal.iloc[0]) if not non_normal.empty else None
        storage.insert_alert(
            alert_id=str(uuid.uuid4()),
            capture_id=req.capture_id,
            attack_type=attack_type,
            window_start_s=episode_start,
            window_end_s=episode_end,
            max_probability=episode_max_prob,
            window_count=episode_count,
            classification="suspicious",
            run_id=run_id,
        )
        episode_start = None
        episode_end = None
        episode_max_prob = 0.0
        episode_count = 0

    positive_windows = 0
    processed = 0
    for _, row in frame.iterrows():
        features = {name: float(row[name]) for name in FEATURE_COLUMNS}
        try:
            prediction = engine.predict(features)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        predicted_positive = prediction["classification"] == "suspicious"
        actual_positive = bool(row["target"] == 1)
        if predicted_positive and actual_positive:
            true_positive += 1
        elif predicted_positive and not actual_positive:
            false_positive += 1
        elif not predicted_positive and actual_positive:
            false_negative += 1
        else:
            true_negative += 1

        if predicted_positive:
            positive_windows += 1
            if episode_start is None:
                episode_start = float(row["window_start_s"])
            episode_end = float(row["window_end_s"])
            episode_max_prob = max(episode_max_prob, float(prediction["probability"]))
            episode_count += 1
        else:
            flush_episode()

        processed += 1
        if processed % 500 == 0:
            storage.update_run_progress(run_id, processed, positive_windows)

    flush_episode()
    storage.update_run_progress(run_id, processed, positive_windows)

    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else None
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else None
    fpr = false_positive / (false_positive + true_negative) if (false_positive + true_negative) else None

    summary = {
        "windows_total": len(frame),
        "positive_windows": positive_windows,
        "confusion_matrix": {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "false_negative": false_negative,
            "true_negative": true_negative,
        },
        "precision": precision,
        "recall": recall,
        "false_positive_rate": fpr,
    }
    storage.finish_run(run_id, "completed", summary)

    return {"run_id": run_id, "status": "completed", "summary": summary}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    run = _require_storage().get_run(job_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return run


class ReplayRequest(BaseModel):
    capture_id: str
    speed: float = 1.0


@router.post("/replays")
async def start_replay(req: ReplayRequest) -> dict[str, Any]:
    if _engine_ref["get"]() is None:
        raise HTTPException(status_code=503, detail="CAN model is not trained or could not be loaded")
    try:
        session = _require_replay().start(req.capture_id, req.speed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"replay_id": session.id, "capture_id": session.capture_id, "total_windows": session.total}


@router.post("/replays/{replay_id}/pause")
def pause_replay(replay_id: str) -> dict[str, str]:
    try:
        _require_replay().pause(replay_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "paused"}


@router.post("/replays/{replay_id}/resume")
def resume_replay(replay_id: str) -> dict[str, str]:
    try:
        _require_replay().resume(replay_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "running"}


@router.post("/replays/{replay_id}/stop")
def stop_replay(replay_id: str) -> dict[str, str]:
    try:
        _require_replay().stop(replay_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "stopped"}


@router.get("/replays/{replay_id}/events")
async def replay_events(replay_id: str) -> StreamingResponse:
    replay_engine = _require_replay()
    try:
        replay_engine.get(replay_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StreamingResponse(replay_engine.stream(replay_id), media_type="text/event-stream")


@router.get("/replays/{replay_id}/poll")
def poll_replay(replay_id: str, after: int = 0, max_events: int = 100) -> dict[str, Any]:
    """Plain-HTTP alternative to /events for tunnels/proxies that buffer server-sent events.

    Pass the `last` value from the previous response as `after` to receive only newer events.
    """
    try:
        return _require_replay().drain(replay_id, max(after, 0), max(1, min(max_events, 500)))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/alerts")
def list_alerts(run_id: str | None = None, replay_id: str | None = None, limit: int = 200) -> dict[str, Any]:
    return {"alerts": _require_storage().list_alerts(run_id=run_id, replay_id=replay_id, limit=limit)}


@router.get("/models")
def model_comparison(repo_root: Path | None = None) -> dict[str, Any]:
    engine = _engine_ref["get"]()
    root = repo_root or Path(__file__).resolve().parents[1]
    report_path = root / "artifacts" / "can_timing_v1" / "training_report.json"
    report: dict[str, Any] | None = None
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    return {
        "model_loaded": engine is not None,
        "schema": engine.metadata.get("schema") if engine else None,
        "feature_columns": engine.metadata.get("feature_columns") if engine else None,
        "selected_model": engine.metadata.get("selected_model") if engine else None,
        "threshold": engine.metadata.get("threshold") if engine else None,
        "training_report": report,
    }


# --- Scenario clips for the 3D Bus Lab ---------------------------------------
# Each scenario is a clip of *recorded* windows (and raw frames) from one HCRL capture,
# scored by the deployed model. The UI only chooses which clip plays; nothing is synthesised.

SCENARIOS: list[tuple[str, str, str]] = [
    # (key, capture_id, raw file relative to data/can/raw)
    ("normal", "normal_run_data", "normal_run_data/normal_run_data.txt"),
    ("dos", "DoS_dataset", "DoS_dataset.csv"),
    ("fuzzy", "Fuzzy_dataset", "Fuzzy_dataset.csv"),
    ("gear_spoof", "gear_dataset", "gear_dataset.csv"),
    ("rpm_spoof", "RPM_dataset", "RPM_dataset.csv"),
]
SCENARIO_WINDOWS = 240
SCENARIO_FRAMES = 320

_NORMAL_LINE = re.compile(r"Timestamp:\s*([\d.]+)\s+ID:\s*([0-9a-fA-F]+)\s+\S+\s+DLC:\s*(\d+)\s*(.*)")
_scenario_cache: dict[str, Any] = {}


def _parse_raw_frame(line: str) -> dict[str, Any] | None:
    """Parse one raw HCRL line (attack CSV or normal-run text) into a display frame."""
    line = line.strip()
    if not line:
        return None
    try:
        match = _NORMAL_LINE.match(line)
        if match:
            dlc = int(match.group(3))
            return {
                "t": float(match.group(1)),
                "id": match.group(2).lower().zfill(4),
                "dlc": dlc,
                "data": match.group(4).split()[:dlc],
                "injected": False,
            }
        parts = line.split(",")
        dlc = int(parts[2])
        flag = parts[3 + dlc] if len(parts) > 3 + dlc else "R"
        return {
            "t": float(parts[0]),
            "id": parts[1].lower().zfill(4),
            "dlc": dlc,
            "data": parts[3 : 3 + dlc],
            "injected": flag.strip().upper() == "T",
        }
    except (ValueError, IndexError):
        return None


def _sample_raw_frames(raw_path: Path, start_s: float, from_first_injection: bool) -> list[dict[str, Any]]:
    """Return SCENARIO_FRAMES consecutive frames at or after start_s (times made relative).

    For attack clips the sample begins at the first injected frame, so it shows the bus
    while the attack is under way rather than the quiet lead-in of the window.
    """
    frames: list[dict[str, Any]] = []
    if not raw_path.exists():
        return frames
    with raw_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            frame = _parse_raw_frame(line)
            if frame is None or frame["t"] < start_s:
                continue
            if from_first_injection and not frames and not frame["injected"]:
                continue
            frames.append(frame)
            if len(frames) >= SCENARIO_FRAMES:
                break
    if frames:
        origin = frames[0]["t"]
        for frame in frames:
            frame["t"] = round(frame["t"] - origin, 6)
    return frames


FRAMES_FALLBACK = Path("data") / "can" / "scenario_frames.json"


def scenario_clip(frame, key: str):
    """The recorded windows that make up one scenario clip (normal windows, or attack windows)."""
    return frame[frame["target"] == (0 if key == "normal" else 1)].head(SCENARIO_WINDOWS)


def load_scenario_frames(repo_root: Path, key: str, raw_path: Path, start_s: float) -> list[dict[str, Any]]:
    """Raw frames for a clip: read from the recording when present, else from the exported sample.

    The full HCRL recordings are ~900 MB and are not shipped with a hosted deployment;
    `scripts/export_scenario_frames.py` saves the same frames to a small JSON file instead.
    """
    if raw_path.exists():
        return _sample_raw_frames(raw_path, start_s, key != "normal")
    fallback = repo_root / FRAMES_FALLBACK
    if fallback.exists():
        return json.loads(fallback.read_text(encoding="utf-8")).get(key, [])
    return []


@router.get("/scenarios")
def scenarios() -> dict[str, Any]:
    engine = _engine_ref["get"]()
    if engine is None:
        raise HTTPException(status_code=503, detail="CAN model is not trained or could not be loaded")
    if _scenario_cache.get("engine_id") == id(engine):
        return _scenario_cache["payload"]

    replay_engine = _require_replay()
    raw_root = replay_engine.repo_root / "data" / "can" / "raw"
    result = []
    for key, capture_id, raw_file in SCENARIOS:
        try:
            frame = replay_engine._capture_frame(capture_id)
        except ValueError:
            continue
        clip = scenario_clip(frame, key)
        if clip.empty:
            continue
        feature_rows = [{name: float(row[name]) for name in FEATURE_COLUMNS} for _, row in clip.iterrows()]
        predictions = engine.predict_batch(feature_rows)
        windows = [
            {
                "features": features,
                "attack_fraction": float(row["attack_fraction"]),
                "ground_truth_positive": bool(row["target"] == 1),
                "probability": prediction["probability"],
                "classification": prediction["classification"],
            }
            for features, prediction, (_, row) in zip(feature_rows, predictions, clip.iterrows())
        ]
        result.append(
            {
                "key": key,
                "capture_id": capture_id,
                "windows": windows,
                "frames": load_scenario_frames(replay_engine.repo_root, key, raw_root / raw_file, float(clip.iloc[0]["window_start_s"])),
            }
        )

    payload = {
        "threshold": float(engine.metadata["threshold"]),
        "selected_model": engine.metadata.get("selected_model"),
        "window_ms": 100,
        "scenarios": result,
    }
    _scenario_cache["engine_id"] = id(engine)
    _scenario_cache["payload"] = payload
    return payload


@router.get("/reports/{run_id}")
def run_report(run_id: str) -> dict[str, Any]:
    storage = _require_storage()
    run = storage.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    alerts = storage.list_alerts(run_id=run_id, limit=1000)
    return {"run": run, "alerts": alerts}
