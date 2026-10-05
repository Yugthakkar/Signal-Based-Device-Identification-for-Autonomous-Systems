# CAN deployment readiness

The CAN API is part of the existing FastAPI service and remains dormant until a trained artifact is present. It does not need a separate server.

## Local run

After `model/train_can.py` finishes, start the service:

```powershell
cd ml_service
uvicorn main:app --host 0.0.0.0 --port 8000
```

Check these routes:

```text
GET  /can/health
GET  /can/model-info
POST /can/predict
```

`/can/predict` expects named features. The server validates feature names, finite values, normalization, threshold, and model type. It never accepts an anonymous array where feature order could silently be wrong.

Example request body:

```json
{
  "features": {
    "frames_per_second": 420.0,
    "gap_mean_ms": 2.3,
    "gap_std_ms": 0.7,
    "gap_min_ms": 0.4,
    "burst_fraction": 0.16,
    "unique_id_count": 12,
    "id_entropy": 2.8,
    "dlc_mean": 6.1,
    "dlc_std": 1.4,
    "dominant_id_fraction": 0.22
  }
}
```

## Environment

The default artifact directory is `artifacts/can_timing_v1`. Set `CAN_ARTIFACT_DIR` if a deployment uses a different location. Keep the artifact directory together: `model_metadata.json` plus either `model.pt` or `model.joblib`.

Do not upload raw HCRL data to a public frontend or commit it to the repository. For deployment, serve only the trained artifact and inference API. A future replay feature can read pre-registered local recordings through a background job.

## Before public deployment

1. Run the training command and inspect `training_report.json`.
2. Run the FastAPI service and check `/can/health` reports `model_loaded: true`.
3. Send a feature fixture to `/can/predict`.
4. Set frontend production origin(s) in FastAPI CORS instead of retaining only localhost.
5. Put secrets in deployment environment variables; never commit `.env`.
6. Deploy the frontend separately and set `VITE_API_BASE_URL` to the HTTPS API URL.

The current CAN runtime deploys inference only. Dataset ingestion, replay workers, authentication, rate limits, and durable alert storage are the next application layer once the dataset and model have been validated.
