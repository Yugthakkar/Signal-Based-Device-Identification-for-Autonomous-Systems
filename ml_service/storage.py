"""Local SQLite persistence for CAN analysis runs and alerts."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    windows_total INTEGER DEFAULT 0,
    windows_processed INTEGER DEFAULT 0,
    positive_windows INTEGER DEFAULT 0,
    summary_json TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    replay_id TEXT,
    capture_id TEXT NOT NULL,
    attack_type TEXT,
    window_start_s REAL,
    window_end_s REAL,
    max_probability REAL,
    window_count INTEGER,
    classification TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_run ON alerts (run_id);
CREATE INDEX IF NOT EXISTS idx_alerts_replay ON alerts (replay_id);
"""


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class Storage:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def create_run(self, run_id: str, capture_id: str, kind: str, windows_total: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO runs (id, capture_id, kind, status, created_at, windows_total) VALUES (?,?,?,?,?,?)",
                (run_id, capture_id, kind, "running", _now(), windows_total),
            )

    def update_run_progress(self, run_id: str, windows_processed: int, positive_windows: int) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE runs SET windows_processed = ?, positive_windows = ? WHERE id = ?",
                (windows_processed, positive_windows, run_id),
            )

    def finish_run(self, run_id: str, status: str, summary: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?",
                (status, _now(), json.dumps(summary), run_id),
            )

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            if row is None:
                return None
            data = dict(row)
            data["summary"] = json.loads(data.pop("summary_json") or "null")
            return data

    def list_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            results = []
            for row in rows:
                data = dict(row)
                data["summary"] = json.loads(data.pop("summary_json") or "null")
                results.append(data)
            return results

    def insert_alert(
        self,
        alert_id: str,
        capture_id: str,
        attack_type: str | None,
        window_start_s: float,
        window_end_s: float,
        max_probability: float,
        window_count: int,
        classification: str,
        run_id: str | None = None,
        replay_id: str | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO alerts
                (id, run_id, replay_id, capture_id, attack_type, window_start_s, window_end_s,
                 max_probability, window_count, classification, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    alert_id, run_id, replay_id, capture_id, attack_type,
                    window_start_s, window_end_s, max_probability, window_count,
                    classification, _now(),
                ),
            )

    def list_alerts(
        self, run_id: str | None = None, replay_id: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM alerts"
        clauses = []
        params: list[Any] = []
        if run_id:
            clauses.append("run_id = ?")
            params.append(run_id)
        if replay_id:
            clauses.append("replay_id = ?")
            params.append(replay_id)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY window_start_s DESC LIMIT ?"
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
            return [dict(row) for row in rows]
