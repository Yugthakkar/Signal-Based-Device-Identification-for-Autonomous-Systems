# SBDI Device Type Identification Platform

Internal-data prototype for identifying device type (Keyboard vs Mouse) using behavioral features.

## Updated Workflow

Data collection has been removed from this repository.

You now:
1. Keep dataset managed by your internal team
2. Train model (defaults to final device dataset)
3. Start backend (auto-loads model, auto-trains if missing)
4. Run prediction from live events or controlled feature inputs

## Project Structure

```text
/feature_engineering
  extract_features.py

/model
  network.py
  train.py
  predict.py

/ui_desktop
  app.py

/web
  /frontend
    /figma-design
  /backend

/ml_service
  main.py
  inference.py

/data
  /raw
  /datasets
```

## 1) Setup Python Environment

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
```

## Full Stack One-Command Start

From project root, install Node helper dependency once:

```bash
npm install
```

Then start backend + frontend together:

```bash
npm run dev
```

This runs FastAPI on port 8000 and the High-End AI Vite frontend on port 3000 in one terminal.

## 2) Use Internal Dataset

Expected event CSV columns:
- event_type
- timestamp
- value

Expected feature CSV columns for training:
- event_rate
- avg_time_gap
- std_time_gap
- burst_density
- avg_packet_size
- movement_speed
- click_frequency
- key_press_rate
- label

If your source data is in `.pcapng` format, convert it to CSV internally before adding it to the training dataset.

## 3) Feature Extraction (Optional Check)

```bash
cd feature_engineering
python extract_features.py --input ../data/raw/sample_keyboard_events.csv
```

Feature vector order:
```text
[rate, avg_gap, std_gap, burst, size, speed, clicks, key_rate]
```

## 4) Train Imbalance-Aware Neural Network

```bash
cd model
python train.py --dataset ../data/datasets/final_device_dataset.csv --epochs 60 --batch_size 256
```

What changed:
- Residual LayerNorm MLP (64 → 64 → 32) with SiLU and dropout for more expressive tabular learning.
- Focal loss + `WeightedRandomSampler` automatically counter class imbalance (no manual weights needed).
- AdamW optimizer and normalization metadata are saved for inference.

Artifacts:
- artifacts/device_classifier.pt
- artifacts/model_metadata.json

## 5) Batch Prediction

```bash
cd model
python predict.py --model ../artifacts/device_classifier.pt --meta ../artifacts/model_metadata.json --raw_csv ../data/raw/sample_mouse_events.csv
```

## 6) Run FastAPI ML Service

```bash
cd ml_service
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Endpoints:
- GET /health
- GET /logs
- GET /model-info
- POST /train-model
- POST /predict
- POST /upload-model
- GET /demo

Optional Supabase env vars:

```bash
set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
set SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY  # must be the service-role secret, not the anon key
set MODEL_VERSION=mlp-residual-v2
```

Create tables with:
- web/backend/supabase_schema.sql

That schema provisions:
- `prediction_sessions` – one row per visitor/device test with metadata and source (web, desktop, API).
- `prediction_windows` – stores every feature window sent to the model, predicted class, confidence, raw events, and timing so you can retrain later.
- `prediction_feedback` – optional ground-truth/quality labels you capture from the user after a prediction.
- `upload_logs` – audit trail for any dataset/model files uploaded through the UI.
- Set `MODEL_VERSION` before starting FastAPI if you want Supabase prediction rows to track which training run produced each inference.
> The backend automatically loads the project `.env` via `python-dotenv`, but only the Supabase **service role** key has permission to insert rows. Keep this key server-side.

## 7) Run Desktop UI (Upload + Predict)

```bash
cd ui_desktop
python app.py
```

Desktop features now:
- Load Dataset CSV button
- Convert PCAPNG to CSV button
- Run Prediction button (5-second windows over uploaded data)
- Event logs panel
- Graphs: events/sec and time gaps
- Prediction + confidence bar

## 8) Run Web Frontend

```bash
cd web/frontend
copy .env.example .env
npm install
npm run dev
```

Pages:
- /
- /predict
- /live-demo
- /upload

## 9) USB Input + Prediction + Supabase Logging

Live Demo page behavior:
1. Click `Connect USB` (WebHID permission in compatible browsers)
2. Click `Start Stream`
3. Interact with keyboard/mouse
4. Frontend sends event windows to `POST /predict`
5. Backend returns predicted device and writes each prediction into Supabase table `prediction_logs`

If WebHID is not available, the page still captures browser keyboard/mouse events and predicts device class.

## 10) Deployment (Vercel)

The Vite frontend in `web/frontend` can be deployed directly to Vercel while the FastAPI backend continues to run on your preferred infrastructure (VM, Railway, Render, etc.).

Local prep:

```bash
cd web/frontend
copy .env.example .env
npm run build
npm run preview
```

Configure Vercel:
1. Create a new Vercel project pointing to `web/frontend` as the root directory.
2. Build command: `npm run build`.
3. Output directory: `dist` (default Vite output).
4. Set the following Environment Variables in Vercel (Production + Preview):
  - `VITE_API_BASE_URL` → URL of your deployed FastAPI service (e.g., `https://api.yourdomain.com`).
  - `SUPABASE_URL`
  - `SUPABASE_KEY`
5. Trigger a deploy; Vercel will handle future git-based deployments automatically.

Backend reminder: expose the FastAPI service over HTTPS and allow CORS for the Vercel domain so the frontend can call `/predict`, `/train-model`, etc.

## Notes for Extending to Mic/Camera

To add more classes:
1. Add labels/classes in dataset and metadata
2. Extend feature extraction with modality-specific features
3. Increase output classes in model/network.py
4. Retrain and upload new model
