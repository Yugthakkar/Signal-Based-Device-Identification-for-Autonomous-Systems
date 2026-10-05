from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import Client, create_client
from uuid import UUID, uuid4
from dotenv import load_dotenv

from inference import InferenceEngine

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

load_dotenv(ROOT / ".env")

from feature_engineering.extract_features import extract_features_from_records
from model.train import train_from_dataset
from can_inference import CanInferenceEngine
import can_routes
from storage import Storage


class EventRecord(BaseModel):
    event_type: str
    timestamp: float
    value: str


class SessionContext(BaseModel):
    session_id: str | None = None
    source: str | None = None
    client_label: str | None = None
    notes: str | None = None
    metadata: dict[str, Any] | None = None


class FeedbackPayload(BaseModel):
    user_label: str | None = None
    is_correct: bool | None = None
    rating: int | None = None
    comments: str | None = None


class PredictRequest(BaseModel):
    features: list[float] | None = None
    events: list[EventRecord] | None = None
    session: SessionContext | None = None
    ground_truth_device: str | None = None
    feedback: FeedbackPayload | None = None


BASE_DIR = Path(__file__).resolve().parent


def _resolve_path(env_name: str, default_relative_to_repo_root: str) -> Path:
    raw = os.getenv(env_name)
    if raw:
        path = Path(raw)
        return path if path.is_absolute() else (BASE_DIR / path).resolve()
    return (BASE_DIR.parent / default_relative_to_repo_root).resolve()


MODEL_PATH = _resolve_path("MODEL_PATH", "artifacts/usb_behavior_v1/model.pt")
META_PATH = _resolve_path("META_PATH", "artifacts/usb_behavior_v1/model_metadata.json")
TRAIN_DATASET_PATH = _resolve_path("TRAIN_DATASET_PATH", "data/usb/behavior/usb_behavior_v1_sessions.csv")
LEGACY_MODEL_PATH = _resolve_path("LEGACY_MODEL_PATH", "artifacts/device_classifier.pt")
LEGACY_META_PATH = _resolve_path("LEGACY_META_PATH", "artifacts/model_metadata.json")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
MODEL_VERSION = os.getenv("MODEL_VERSION") or MODEL_PATH.stem
CAN_ARTIFACT_DIR = _resolve_path("CAN_ARTIFACT_DIR", "artifacts/can_timing_v1")
CAN_DB_PATH = _resolve_path("CAN_DB_PATH", "data/can/manifests/can_app.db")

# When the demo is shared over a public link (scripts/start_demo.ps1 sets this automatically),
# endpoints that overwrite model files or retrain are disabled for visitors.
PUBLIC_DEMO = os.getenv("PUBLIC_DEMO", "").strip().lower() in {"1", "true", "yes"}


def _forbid_in_public_demo() -> None:
    if PUBLIC_DEMO:
        raise HTTPException(status_code=403, detail="Disabled in public demo mode. Run the demo locally to use this.")

app = FastAPI(title="SBDI Device Identification Service", version="1.0.0")
# Browsers allowed to call this API. Locally that is the Vite dev server; in production set
# CORS_ORIGINS to your frontend URL(s), comma-separated (e.g. https://my-app.vercel.app).
# CORS_ORIGIN_REGEX optionally allows Vercel preview URLs (e.g. https://my-app-.*\.vercel\.app).
CORS_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX") or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(can_routes.router)

runtime_logs: list[str] = []
supabase_client: Client | None = None

ALLOWED_SOURCES = {"web", "desktop", "api"}


def _normalized_source(raw: str | None) -> str:
    if raw:
        candidate = raw.lower().strip()
        if candidate in ALLOWED_SOURCES:
            return candidate
    return "web"


def _coerce_session_id(raw: str | None) -> str:
    if raw:
        try:
            return str(UUID(raw))
        except (ValueError, TypeError):
            pass
    return str(uuid4())


def _persist_session(session_id: str, session_ctx: SessionContext | None, request: Request) -> None:
    if supabase_client is None:
        return
    payload: dict[str, Any] = {
        "id": session_id,
        "source": _normalized_source((session_ctx.source if session_ctx else None)),
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "client_label": session_ctx.client_label if session_ctx else None,
        "notes": session_ctx.notes if session_ctx else None,
        "metadata": session_ctx.metadata if session_ctx else None,
    }
    try:
        supabase_client.table("prediction_sessions").upsert(payload, on_conflict="id").execute()
    except Exception as exc:
        log(f"[WARN] Supabase session upsert failed: {exc}")


def _window_context(events: list[dict[str, Any]] | None) -> tuple[str | None, int | None]:
    if not events:
        return None, None
    try:
        ordered = sorted(events, key=lambda evt: float(evt.get("timestamp", 0)))
        start_ts = float(ordered[0]["timestamp"])
        end_ts = float(ordered[-1]["timestamp"])
        start_iso = datetime.fromtimestamp(start_ts, tz=timezone.utc).isoformat()
        duration_ms = max(int((end_ts - start_ts) * 1000), 0)
        return start_iso, duration_ms
    except Exception:
        return None, None


def _persist_prediction_window(
    session_id: str | None,
    result: dict[str, Any],
    feature_vector: list[float],
    events: list[dict[str, Any]] | None,
    ground_truth: str | None,
    latency_ms: int,
) -> int | None:
    if supabase_client is None:
        return None

    window_started_at, window_duration_ms = _window_context(events)
    payload: dict[str, Any] = {
        "session_id": session_id,
        "predicted_device": result.get("device"),
        "prediction_confidence": result.get("confidence"),
        "ground_truth_device": ground_truth,
        "feature_vector": feature_vector,
        "raw_events": events,
        "model_version": MODEL_VERSION,
        "window_started_at": window_started_at,
        "window_duration_ms": window_duration_ms,
        "latency_ms": latency_ms,
    }
    try:
        response = supabase_client.table("prediction_windows").insert(payload).execute()
        if response.data and isinstance(response.data, list) and response.data:
            inserted = response.data[0]
            return inserted.get("id")
    except Exception as exc:
        log(f"[WARN] Supabase prediction insert failed: {exc}")
    return None


def _persist_prediction_feedback(prediction_id: int | None, feedback: FeedbackPayload | None) -> None:
    if supabase_client is None or prediction_id is None or feedback is None:
        return
    payload: dict[str, Any] = {
        "prediction_id": prediction_id,
        "user_label": feedback.user_label,
        "is_correct": feedback.is_correct,
        "rating": feedback.rating,
        "comments": feedback.comments,
    }
    try:
        supabase_client.table("prediction_feedback").insert(payload).execute()
    except Exception as exc:
        log(f"[WARN] Supabase feedback insert failed: {exc}")


def log(message: str) -> None:
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
    runtime_logs.append(line)
    if len(runtime_logs) > 300:
        del runtime_logs[:100]
    print(line)


def save_to_supabase(table: str, payload: dict[str, Any]) -> None:
    if supabase_client is None:
        return
    try:
        supabase_client.table(table).insert(payload).execute()
    except Exception as exc:
        log(f"[WARN] Supabase insert failed ({table}): {exc}")


engine: InferenceEngine | None = None
legacy_engine: InferenceEngine | None = None
can_engine: CanInferenceEngine | None = None


def _train_and_load_model(dataset_path: Path, epochs: int = 35, lr: float = 1e-3) -> dict[str, Any]:
    global engine

    if not dataset_path.exists():
        raise FileNotFoundError(f"Training dataset not found: {dataset_path}")

    log(f"[INFO] Training vanilla neural network from {dataset_path.name}...")
    result = train_from_dataset(
        dataset_path=dataset_path,
        epochs=epochs,
        lr=lr,
        model_out=MODEL_PATH,
        meta_out=META_PATH,
    )
    engine = InferenceEngine(MODEL_PATH, META_PATH)
    acc = float(result["test_accuracy"])
    log(f"[RESULT] Training complete. Test accuracy: {acc * 100:.2f}%")
    return {
        "status": "trained",
        "dataset": str(dataset_path),
        "test_accuracy": acc,
        "feature_columns": result["feature_columns"],
        "rows": result["rows"],
    }


@app.on_event("startup")
def startup_event() -> None:
    global engine, legacy_engine, can_engine, supabase_client
    try:
        if not MODEL_PATH.exists() or not META_PATH.exists():
            _train_and_load_model(TRAIN_DATASET_PATH)
        engine = InferenceEngine(MODEL_PATH, META_PATH)
        log("[INFO] Model loaded successfully (usb_behavior_v1)")
    except Exception as exc:
        log(f"[WARN] Model load failed: {exc}")

    try:
        if LEGACY_MODEL_PATH.exists() and LEGACY_META_PATH.exists():
            legacy_engine = InferenceEngine(LEGACY_MODEL_PATH, LEGACY_META_PATH)
            log("[INFO] Legacy packet-timing model loaded (exploratory reference only)")
    except Exception as exc:
        log(f"[INFO] Legacy model unavailable: {exc}")

    try:
        can_engine = CanInferenceEngine(CAN_ARTIFACT_DIR)
        log("[INFO] CAN model loaded successfully")
    except Exception as exc:
        log(f"[INFO] CAN model unavailable: {exc}")

    try:
        can_routes.configure(repo_root=ROOT, storage=Storage(CAN_DB_PATH), can_engine_getter=lambda: can_engine)
        log("[INFO] CAN routes initialized")
    except Exception as exc:
        log(f"[WARN] CAN routes unavailable: {exc}")

    if SUPABASE_URL and SUPABASE_KEY:
        try:
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
            log("[INFO] Supabase connected")
        except Exception as exc:
            log(f"[WARN] Supabase init failed: {exc}")
    else:
        log("[WARN] Supabase credentials missing. Skipping persistence.")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model_loaded": engine is not None, "can_model_loaded": can_engine is not None}


class CanPredictRequest(BaseModel):
    features: dict[str, float]


@app.get("/can/health")
def can_health() -> dict[str, Any]:
    return {"status": "ok" if can_engine else "model_unavailable", "model_loaded": can_engine is not None}


@app.get("/can/model-info")
def can_model_info() -> dict[str, Any]:
    if can_engine is None:
        return {"model_loaded": False}
    return {"model_loaded": True, "schema": can_engine.metadata.get("schema"), "feature_columns": can_engine.metadata.get("feature_columns"), "threshold": can_engine.metadata.get("threshold"), "selected_model": can_engine.metadata.get("selected_model")}


@app.post("/can/predict")
def can_predict(req: CanPredictRequest) -> dict[str, Any]:
    if can_engine is None:
        raise HTTPException(status_code=503, detail="CAN model is not trained or could not be loaded")
    try:
        return {"prediction": can_engine.predict(req.features), "timestamp": time.time()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/logs")
def get_logs() -> dict[str, Any]:
    return {"logs": runtime_logs[-120:]}


@app.get("/model-info")
def model_info() -> dict[str, Any]:
    if engine is None:
        return {"model_loaded": False, "feature_columns": [], "classes": {}, "legacy_model_loaded": legacy_engine is not None}
    return {
        "model_loaded": True,
        "schema": "usb_behavior_v1",
        "feature_columns": engine.feature_columns,
        "classes": engine.classes,
        "legacy_model_loaded": legacy_engine is not None,
        "legacy_schema": "usb_packet_timing_v1" if legacy_engine else None,
        "legacy_feature_columns": legacy_engine.feature_columns if legacy_engine else None,
    }


@app.post("/predict")
def predict(req: PredictRequest, request: Request) -> dict[str, Any]:
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    log("[INFO] Running model...")
    request_started = time.perf_counter()

    events_payload: list[dict[str, Any]] | None = None
    if req.features is not None:
        feature_vector = req.features
    elif req.events is not None:
        events_payload = [evt.model_dump() for evt in req.events]
        fv = extract_features_from_records(events_payload)
        feature_vector = fv.as_list()
        log("[INFO] Extracting features...")
    else:
        raise HTTPException(status_code=400, detail="Provide either features or events")

    try:
        result = engine.predict(feature_vector)
    except ValueError as exc:
        log(f"[WARN] Prediction rejected: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    latency_ms = int((time.perf_counter() - request_started) * 1000)
    msg = f"[RESULT] Device: {result['device']} ({result['confidence'] * 100:.2f}%)"
    log(msg)

    session_id = _coerce_session_id(req.session.session_id if req.session else None)
    _persist_session(session_id, req.session, request)
    prediction_id = _persist_prediction_window(
        session_id=session_id,
        result=result,
        feature_vector=feature_vector,
        events=events_payload,
        ground_truth=req.ground_truth_device,
        latency_ms=latency_ms,
    )
    _persist_prediction_feedback(prediction_id, req.feedback)

    return {
        "prediction": result,
        "features": feature_vector,
        "timestamp": time.time(),
        "session_id": session_id,
        "prediction_id": prediction_id,
    }


@app.post("/train-model")
def train_model_endpoint(epochs: int = 35, lr: float = 1e-3, dataset_path: str | None = None) -> dict[str, Any]:
    _forbid_in_public_demo()
    path = Path(dataset_path) if dataset_path else TRAIN_DATASET_PATH
    try:
        return _train_and_load_model(path, epochs=epochs, lr=lr)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/upload-model")
async def upload_model(file: UploadFile = File(...)) -> dict[str, str]:
    global engine
    _forbid_in_public_demo()
    content = await file.read()
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_bytes(content)

    if not META_PATH.exists():
        META_PATH.write_text(
            '{"classes":{"0":"Keyboard","1":"Mouse"},"feature_columns":["event_rate","avg_time_gap","std_time_gap","burst_density","avg_packet_size","movement_speed","click_frequency","key_press_rate"]}',
            encoding="utf-8",
        )

    engine = InferenceEngine(MODEL_PATH, META_PATH)
    log("[INFO] New model uploaded and loaded")
    save_to_supabase(
        "upload_logs",
        {
            "upload_type": "model",
            "file_name": file.filename,
            "created_at": datetime.utcnow().isoformat(),
        },
    )
    return {"status": "model_uploaded"}


@app.get("/demo")
def demo_prediction() -> dict[str, Any]:
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    reference_features = [11.2, 0.09, 0.03, 0.76, 0.0, 0.0, 0.1, 7.5]
    expected = len(engine.feature_columns)
    demo_features = (reference_features + [0.0] * expected)[:expected]
    try:
        result = engine.predict(demo_features)
    except ValueError as exc:
        log(f"[WARN] Demo prediction rejected: {exc}")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log("[INFO] Auto demo mode prediction")
    log(f"[RESULT] Device: {result['device']} ({result['confidence'] * 100:.2f}%)")
    return {"prediction": result, "features": demo_features}


# --- Built website (optional) -------------------------------------------------
# If `npm run build` has produced web/frontend/dist, serve it from this same server so a
# single URL (e.g. one Cloudflare Tunnel) carries both the site and the API. This block
# must stay last: its catch-all route only handles paths no API route claimed.
from fastapi.responses import FileResponse  # noqa: E402

FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST") or ROOT / "web" / "frontend" / "dist").resolve()

if (FRONTEND_DIST / "index.html").exists():

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST):
            return FileResponse(candidate)
        if "." in full_path.rsplit("/", 1)[-1]:  # a missing file such as /assets/x.js
            raise HTTPException(status_code=404, detail="Not found")
        # Client-side routes (/bus-lab, /predict, ...) all load the single-page app.
        return FileResponse(FRONTEND_DIST / "index.html")
