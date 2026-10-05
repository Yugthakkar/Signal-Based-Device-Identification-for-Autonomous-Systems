"""Timed replay of precomputed CAN windows with live model scoring."""
from __future__ import annotations

import asyncio
import json
from collections import deque
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from storage import Storage

WINDOWS_CSV = "data/can/processed/can_windows_100ms.csv"

FEATURE_COLUMNS = [
    "frames_per_second",
    "gap_mean_ms",
    "gap_std_ms",
    "gap_min_ms",
    "burst_fraction",
    "unique_id_count",
    "id_entropy",
    "dlc_mean",
    "dlc_std",
    "dominant_id_fraction",
]

MAX_STEP_SLEEP_S = 1.5


def _load_windows(repo_root: Path) -> pd.DataFrame:
    path = repo_root / WINDOWS_CSV
    if not path.exists():
        raise FileNotFoundError(f"CAN windows dataset not found: {path}")
    df = pd.read_csv(path)
    return df.sort_values(["capture_id", "window_start_s"]).reset_index(drop=True)


@dataclass
class ReplaySession:
    id: str
    capture_id: str
    speed: float
    status: str = "running"
    position: int = 0
    total: int = 0
    # Shared, append-only event log. Every consumer (SSE stream or HTTP poll) tracks its own
    # position, so consumers never steal events from each other.
    events: "deque[dict[str, Any]]" = field(default_factory=lambda: deque(maxlen=3000))
    seq: int = 0
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    task: "asyncio.Task[None] | None" = None

    def __post_init__(self) -> None:
        self.pause_event.set()

    def publish(self, event: dict[str, Any]) -> None:
        self.seq += 1
        event["seq"] = self.seq
        self.events.append(event)

    def events_after(self, after: int, limit: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for event in self.events:
            if event["seq"] > after:
                out.append(event)
                if len(out) >= limit:
                    break
        return out


class ReplayEngine:
    def __init__(self, repo_root: Path, storage: Storage, predict_fn) -> None:
        self.repo_root = repo_root
        self.storage = storage
        self.predict_fn = predict_fn
        self.windows = _load_windows(repo_root)
        self.sessions: dict[str, ReplaySession] = {}

    def list_captures(self) -> list[dict[str, Any]]:
        summaries = []
        grouped = self.windows.groupby("capture_id")
        for capture_id, group in grouped:
            attack_types = sorted(t for t in group["attack_type"].unique() if t != "normal")
            summaries.append(
                {
                    "capture_id": capture_id,
                    "window_count": int(len(group)),
                    "positive_windows": int((group["target"] == 1).sum()),
                    "attack_types": attack_types,
                    "duration_s": float(group["window_end_s"].max() - group["window_start_s"].min()),
                }
            )
        return summaries

    def _capture_frame(self, capture_id: str) -> pd.DataFrame:
        frame = self.windows[self.windows["capture_id"] == capture_id]
        if frame.empty:
            raise ValueError(f"Unknown capture_id: {capture_id}")
        return frame

    def start(self, capture_id: str, speed: float) -> ReplaySession:
        frame = self._capture_frame(capture_id)
        replay_id = str(uuid.uuid4())
        session = ReplaySession(id=replay_id, capture_id=capture_id, speed=max(speed, 0.1), total=len(frame))
        self.sessions[replay_id] = session
        session.task = asyncio.create_task(self._run(session, frame))
        return session

    async def _run(self, session: ReplaySession, frame: pd.DataFrame) -> None:
        prev_start: float | None = None
        episode_start: float | None = None
        episode_end: float | None = None
        episode_max_prob = 0.0
        episode_count = 0

        def flush_episode() -> None:
            nonlocal episode_start, episode_end, episode_max_prob, episode_count
            if episode_start is None:
                return
            attack_row = frame[
                (frame["window_start_s"] >= episode_start) & (frame["window_start_s"] <= episode_end)
            ]
            attack_type = None
            non_normal = attack_row[attack_row["attack_type"] != "normal"]["attack_type"]
            if not non_normal.empty:
                attack_type = str(non_normal.iloc[0])
            self.storage.insert_alert(
                alert_id=str(uuid.uuid4()),
                capture_id=session.capture_id,
                attack_type=attack_type,
                window_start_s=episode_start,
                window_end_s=episode_end,
                max_probability=episode_max_prob,
                window_count=episode_count,
                classification="suspicious",
                replay_id=session.id,
            )
            episode_start = None
            episode_end = None
            episode_max_prob = 0.0
            episode_count = 0

        try:
            for _, row in frame.iterrows():
                await session.pause_event.wait()
                if session.status == "stopped":
                    break

                if prev_start is not None:
                    gap = max(float(row["window_start_s"]) - prev_start, 0.0)
                    sleep_s = min(gap / session.speed, MAX_STEP_SLEEP_S)
                    if sleep_s > 0:
                        await asyncio.sleep(sleep_s)
                prev_start = float(row["window_start_s"])

                features = {name: float(row[name]) for name in FEATURE_COLUMNS}
                try:
                    prediction = self.predict_fn(features)
                except Exception as exc:  # model unavailable mid-replay
                    prediction = {"classification": "unknown", "probability": 0.0, "error": str(exc)}

                suspicious = prediction.get("classification") == "suspicious"
                if suspicious:
                    if episode_start is None:
                        episode_start = float(row["window_start_s"])
                    episode_end = float(row["window_end_s"])
                    episode_max_prob = max(episode_max_prob, float(prediction.get("probability", 0.0)))
                    episode_count += 1
                else:
                    flush_episode()

                session.position += 1
                event = {
                    "type": "window",
                    "capture_id": session.capture_id,
                    "window_start_s": float(row["window_start_s"]),
                    "window_end_s": float(row["window_end_s"]),
                    "attack_type": str(row["attack_type"]),
                    "ground_truth_positive": bool(row["target"] == 1),
                    "features": features,
                    "prediction": prediction,
                    "position": session.position,
                    "total": session.total,
                }
                session.publish(event)

            flush_episode()
            if session.status != "stopped":
                session.status = "completed"
        except asyncio.CancelledError:
            session.status = "stopped"
        finally:
            session.publish({"type": "status", "status": session.status})

    def get(self, replay_id: str) -> ReplaySession:
        session = self.sessions.get(replay_id)
        if session is None:
            raise KeyError(f"Unknown replay_id: {replay_id}")
        return session

    def pause(self, replay_id: str) -> None:
        session = self.get(replay_id)
        session.status = "paused"
        session.pause_event.clear()

    def resume(self, replay_id: str) -> None:
        session = self.get(replay_id)
        session.status = "running"
        session.pause_event.set()

    def stop(self, replay_id: str) -> None:
        session = self.get(replay_id)
        session.status = "stopped"
        session.pause_event.set()

    def drain(self, replay_id: str, after: int = 0, max_events: int = 100) -> dict[str, Any]:
        """Events newer than `after` without blocking — for networks that break SSE."""
        session = self.get(replay_id)
        events = session.events_after(after, max_events)
        return {"events": events, "status": session.status, "last": events[-1]["seq"] if events else after}

    async def stream(self, replay_id: str):
        session = self.get(replay_id)
        cursor = 0
        last_heartbeat = time.monotonic()
        while True:
            batch = session.events_after(cursor, 50)
            if batch:
                for event in batch:
                    cursor = event["seq"]
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") == "status" and event.get("status") in ("completed", "stopped"):
                        return
                last_heartbeat = time.monotonic()
                continue
            if session.status in ("completed", "stopped") and cursor >= session.seq:
                return
            if time.monotonic() - last_heartbeat > 5.0:
                yield ": heartbeat\n\n"
                last_heartbeat = time.monotonic()
            await asyncio.sleep(0.05)
