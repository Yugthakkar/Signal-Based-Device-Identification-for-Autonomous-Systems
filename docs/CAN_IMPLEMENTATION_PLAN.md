# SBDI: Vehicle CAN Threat Detection Implementation Plan

Prepared: 28 September 2026. Status: proposed implementation; no foundation fixes or CAN features have been implemented by writing this plan.

## 1. Final project scope

Retain the existing project and develop it into **Signal-Based Device Identification and Threat Detection for Vehicle Networks**. Keep USB keyboard/mouse identification as the original module and add a CAN intrusion-detection module using the same FastAPI service, React dashboard components, training infrastructure, and reporting workflow.

The main demonstration is recorded vehicle traffic replayed at its original timing, with model predictions, alerts, explanations, and measured detection delay. Clearly label the input as recorded-data replay. No physical vehicle, autonomous driving stack, GPU, or paid cloud service is required.

CAN arbitration IDs identify messages, not authenticated physical senders. Do not claim ECU identity verification from CAN IDs alone. The defensible claim is detection of deviations in message timing, frequency, identifier distribution, and optionally payload behaviour. Keep the connection to autonomous systems as monitoring a vehicle-network subsystem, rather than claiming an autonomous vehicle has been built.

## 2. What remains and what changes

Reuse:
- `feature_engineering/`: extend with input adapters and causal window features.
- `model/network.py`: retain the small residual MLP as one model to compare.
- `model/train.py`: retain useful training components, but replace the split and evaluation design.
- `ml_service/`: retain FastAPI, logging, health, and prediction infrastructure.
- `web/frontend/`: retain navigation, dashboard cards, charts, and existing USB demo.
- `ui_desktop/`: preserve compatibility; do not spend the CAN project budget building a second full UI.
- Existing captures and classifier: preserve as legacy artifacts and exploratory data.

Add separate USB and CAN schemas, artifacts, and evaluation reports. A unified application does not require one classifier to accept incompatible modalities.

## 3. Phase A: fix the foundation (approximately 1 week)

### A1. Define an explicit feature contract

Current defect: `artifacts/model_metadata.json` specifies seven USB packet features, but event extraction and `/demo` produce eight behavioural features. This cannot be fixed by padding, deleting arbitrary values, or editing metadata alone.

Actions:
1. Introduce `feature_engineering/schemas.py` with ordered feature names, schema version, units, modality, and window configuration.
2. Keep separate schemas such as `usb_behavior_v1`, `usb_packet_timing_v1`, and later `can_timing_v1`.
3. For the existing browser demo, collect labelled browser event sessions, extract the eight behavioural features, and train a matching model. Packet captures cannot supply missing mouse coordinates or key event semantics.
4. Retain legacy packet inference only where its input schema matches. Mark its evaluation as exploratory until leakage is addressed.
5. Include feature schema, feature order, preprocessing, class map, class count, window settings, training-data version, and model version in every artifact bundle.
6. Prefer named feature inputs plus schema ID for new APIs; validate explicit ordering if legacy arrays remain supported.

Done when: every prediction route either uses a compatible bundle or returns a readable client error; no seven/eight-column broadcasting error occurs.

### A2. Normalize browser events and fix their windows

Current defects: frontend sends `keydown`, `mousemove`, and `click`; extractor expects `key_press`, `mouse_move`, and `mouse_click`. Mouse coordinates use commas in the browser but colons in the extractor. The browser repeatedly predicts on its latest 20 events, potentially reusing stale events.

Actions:
- Normalize aliases once at the input boundary; use structured coordinates or one agreed delimiter.
- Define timestamp units as seconds and validate finite values and monotonic order within sessions.
- Use elapsed-time windows with explicit start/end times, not only the last N events.
- Compute event rate against window duration, including quiet periods; do not force idle windows into an active-device prediction.
- Consume fresh events once, bound buffers, and prevent concurrent prediction requests.
- Display API errors in the existing warning panel instead of clearing warnings on failure.
- Describe this path as browser input behaviour; it is not a substitute for USB packet timing.

Done when: controlled keyboard, movement, and click fixtures produce the expected nonzero features, and an inactive session does not repeatedly submit stale data.

### A3. Use one inference implementation

Current defects: `model/predict.py` bypasses saved normalization and hardcodes eight columns. `InferenceEngine.load()` constructs a two-class network regardless of metadata. Training also uses the default two-class network.

Actions:
- Route CLI, desktop, and API predictions through shared preprocessing and inference.
- Construct models from validated metadata, including `input_dim` and `num_classes`; encode labels consistently as contiguous indices during training.
- Validate feature count, finite values, standard deviations, class map, schema, and artifact compatibility at load time.
- Separate class probability, uncalibrated confidence, and anomaly score in responses and UI.
- Upload a model and its metadata as a matched bundle; validate in a staging location before replacing the active bundle.
- Train explicitly rather than automatically retraining on API startup. Startup should report unavailable/incompatible models without overwriting artifacts.
- Make `/health` expose readiness per module; one failing module should not prevent the other from loading.
- Declare required dependencies consistently; the backend imports `python-dotenv`, which is missing from the root requirements file.

Done when: the same fixture gives matching CLI/API predictions and normalization, multiclass loading works, and invalid uploads leave the active model intact.

### A4. Correct data provenance and evaluation

Existing data: 2,909 rows, comprising 2,609 mouse-active, 264 keyboard-active, and 18 rows for each idle label. Row count is not independent-session count.

Actions:
- Remove USB `device` and `endpoint` identifiers from the timing-only experiment, and replace the cumulative `packet_rate` column with an actual rate measured over a fixed duration.
- Store capture/session ID, device metadata, activity condition, and data source for grouping and audit, not as prediction shortcuts.
- Recover session membership from original captures where possible; do not invent provenance from the merged CSV.
- Collect repeated independent sessions for both USB classes if making generalization claims. If this cannot be done, keep USB as a clearly labelled legacy demonstration and concentrate evaluation on CAN.
- Replace random row splitting with independent capture/session splits. Fit normalization, imputation, baselines, and thresholds using training/validation data only.
- Save an immutable split manifest and keep the final test partition untouched until model selection is complete.

Done when: reports identify the split, sample counts, class distribution, provenance limitations, and preprocessing fit partition.

## 4. Phase B: CAN dataset and adapter (approximately 1 week)

Use HCRL's Car-Hacking Dataset: https://ocslab.hksecurity.net/Datasets/car-hacking-dataset

The provider documents normal traffic and DoS, fuzzy, drive-gear spoofing, and RPM spoofing recordings, with timestamps, hexadecimal CAN IDs, DLC, payload bytes, and T/R flags. It releases the data for academic purposes and asks users to cite its publications. Confirm access and download format before finalizing parser assumptions.

Tasks:
1. Add a dataset README recording provider, required citation, download date, hashes, and source-file inventory.
2. Parse in chunks; begin with a bounded development subset, then evaluate on larger partitions without loading every raw frame into memory.
3. Normalize to `capture_id`, `timestamp_s`, `can_id`, `dlc`, `payload_bytes`, and optional `ground_truth`.
4. Validate ID representation, timestamp ordering, DLC/payload agreement, missing values, and actual header/row layout. Preserve a malformed-row report.
5. Map `R` to normal. Map `T` to the documented attack type using source-file metadata. Normal frames inside an attack recording remain normal.
6. Keep flags, labels, absolute timestamps, filenames, row numbers, and capture identity out of model inputs.
7. Keep source identity and labels in a separate evaluation stream so inference cannot read them.

Proposed layout:

```text
data/can/raw/                  # downloaded files; excluded from Git
data/can/manifests/            # hashes, provenance, split definitions
data/can/processed/            # bounded feature partitions
feature_engineering/can_adapter.py
feature_engineering/can_features.py
```

Done when: a small dataset slice parses deterministically, class counts are checked, and malformed inputs fail clearly.

## 5. Phase C: causal CAN features and splits (approximately 1 week)

Begin with non-overlapping 100 ms windows. Compare 250 ms and 500 ms on validation data. These are starting configurations, not proven optimal values. Each prediction uses only frames at or before its decision time.

Timing-only feature family:
- Frames per second over the actual window duration.
- Inter-arrival gap mean, standard deviation, median, selected percentiles, and minimum.
- Burst ratio with a threshold selected on training/validation data.
- Unique CAN-ID count and ID-frequency entropy.
- Per-ID cadence deviation relative to normal training traffic, summarized over active IDs.
- DLC mean and variation.
- Unknown-ID fraction relative to the training reference.

CAN ID may serve as a grouping key for cadence references. Compare models with and without ID-dependent features because identifier shortcuts can overfit one vehicle. Do not equate an unknown ID with a confirmed attack.

Optional payload feature family:
- Consecutive payload change magnitude within the same ID.
- Byte variability and repeated-payload fraction.
- Add these only after timing-only evaluation so their contribution can be measured.

Window labels: define a window as attack-positive if it contains at least one injected frame; preserve attack fraction to examine sparse injections. For multiclass training, normal windows remain normal; mixed attack-type windows receive an explicit mixed label or are excluded with counts reported. Never feed attack fraction to the predictor.

Split strategy:
- Prefer independent recordings/sessions with enough class coverage for train, validation, and test.
- If there is only one recording per attack type, partition each recording chronologically, approximately 60/20/20, and acknowledge that this tests within-recording temporal generalization, not new vehicles or independent captures.
- Choose boundaries away from attack episodes; keep each episode and its context within one partition.
- Purge windows that cross boundaries and insert a gap covering the feature lookback. Do not compute features over the entire recording before splitting.
- Reset state at boundaries. Fit normal cadence references on normal training traffic only; allow inference-time warmup using past observed frames without labels.
- Retain natural class proportions for validation/test. Balance or sample training data only, with any cap documented.
- Add a second vehicle/dataset as a stretch experiment only after verifying compatible formats and claims.

Done when: no feature window, raw-frame interval, or attack episode crosses partitions; state and learned reference statistics have an audited origin.

## 6. Phase D: train, compare, and evaluate (approximately 1 week)

Start with **binary normal versus suspicious detection**. Add five-way classification (normal, DoS, fuzzy, gear spoofing, RPM spoofing) only after binary detection and evaluation work.

Compare:
1. A simple rate/cadence threshold detector: establishes whether ML improves on basic signal rules.
2. Logistic regression and a bounded Random Forest: inexpensive tabular baselines.
3. The existing residual PyTorch MLP: reuse the completed model work with corrected schemas and class count.
4. Optional Isolation Forest trained on normal traffic: evaluate anomaly detection on an attack family withheld from training.

Treat imbalance with one justified method initially, such as class-weighted loss. The current focal loss plus inverse-frequency alpha plus weighted sampling should be compared against simpler weighting rather than carried over automatically.

Tune thresholds and alert persistence on validation data. If probabilities are shown as confidence, check calibration and fit any calibration on validation data. Isolation Forest scores must not be displayed as calibrated probabilities.

Save:
- Per-class precision, recall, F1, macro-F1, confusion matrix, and binary PR-AUC.
- False-positive rate and deduplicated false alerts per minute of normal traffic.
- Attack-episode recall and onset-to-first-alert delay, counting missed episodes separately.
- Median and p95 inference time, end-to-end alert delay, throughput, peak process memory, and model size.
- Thresholds, window configuration, train/validation/test manifest, software versions, random seeds, and class counts.

For uncertainty, resample independent episodes or time blocks rather than pretending adjacent frames are independent. Repeat model seeds only after a sound split is established.

Research questions:
- How much does timing-only detection achieve compared with timing plus payload features?
- What is the detection/false-alarm tradeoff across window durations?
- Does an anomaly model detect a withheld attack family?

Withheld attack families provide a controlled novelty test; success does not establish universal zero-day detection. Replay is not a supplied HCRL class. If added, generate it as a separately labelled experiment and exclude copies of training segments from test data.

Done when: a reproducible comparison table exists and the chosen model is justified by detection quality, false alarms, latency, and resource use.

## 7. Phase E: backend, replay, and local persistence (approximately 1 week)

Add CAN routes separately from the existing `/predict` USB path:

```text
POST /can/datasets                 upload/register and validate a recording
POST /can/analyze                  start an offline analysis job
GET  /can/jobs/{job_id}             status and progress
POST /can/replays                  start timed replay of a registered recording
POST /can/replays/{replay_id}/pause
POST /can/replays/{replay_id}/resume
POST /can/replays/{replay_id}/stop
GET  /can/replays/{replay_id}/events  server-sent event stream
GET  /can/alerts                    structured alert records
GET  /can/models                    model/schema/threshold information
GET  /can/reports/{run_id}          evaluation or run report
```

Use server-sent events for one-way chart updates. Publish aggregated windows instead of sending every frame to the browser. Preserve event timestamps; replay speed affects presentation time, not feature values or event-time detection delay.

Use a single local worker queue initially for imports and analysis. Prevent expensive training from blocking requests; keep training in an explicit CLI workflow until a job-based training UI is needed. Support cancellation, bounded queues, and structured errors.

Store datasets, analysis runs, model runs, windows, and deduplicated alerts in local SQLite. Keep raw frames in source files rather than duplicating millions of records in a cloud database. Existing Supabase remains optional for the USB module or later synchronization.

An alert should include run ID, start/end times, relevant CAN IDs, model result or anomaly score, model version, feature schema, and evidence such as an observed rate compared with its normal reference. These are measured reasons; do not claim they are causal proof of an attack.

Done when: pause/resume/stop work, a run survives page refresh, model output matches offline inference, and replay remains bounded in memory.

## 8. Phase F: dashboard and presentation (approximately 1 week)

Extend the existing React app with:
- **Vehicle Monitor:** replay controls, source label, window duration, model version, frames/sec, alert count, and recorded time.
- **Traffic charts:** message rate, cadence deviation, active IDs, and model score with attack annotations revealed only for evaluation.
- **Alert timeline:** severity, suspected class, affected message IDs, evidence, and deduplicated incidents.
- **Model Comparison:** real saved evaluation results, confusion matrix, PR curve, timing-only/payload comparison, and hardware measurements.
- **Reports:** downloadable CSV and printable HTML report; PDF export is optional.

Reuse the existing dashboard cards and chart library. Replace log-parsing metrics with structured API records; the current bounded runtime log is not a durable count of all predictions today. Show empty/loading/error states and distinguish model probability from measured test performance.

Keep the original USB page as a working module in navigation. UI labels must distinguish browser behaviour, USB capture analysis, and CAN recorded-data replay.

Viva demonstration (about 5 minutes):
1. Show the preserved USB module and explain its corrected schema.
2. Start a held-out normal CAN recording; show stable traffic and low alert activity.
3. Replay an attack segment and show model output and measured evidence.
4. Show episode detection delay and missed/false alerts honestly.
5. Compare baselines and feature ablations using saved test results.
6. Export the run report.

Done when: the demonstration works offline with genuine model output and can be reproduced from a documented command sequence.

## 9. Proposed new files

```text
feature_engineering/schemas.py
feature_engineering/can_adapter.py
feature_engineering/can_features.py
model/train_can.py
model/evaluate.py
model/baselines.py
ml_service/can_routes.py
ml_service/replay.py
ml_service/storage.py
web/frontend/src/app/pages/VehicleMonitor.tsx
web/frontend/src/app/pages/ThreatTimeline.tsx
web/frontend/src/app/pages/ModelComparison.tsx
artifacts/usb_behavior_v1/
artifacts/can_timing_v1/
reports/evaluation/
tests/test_feature_contracts.py
tests/test_can_pipeline.py
tests/test_split_integrity.py
tests/test_inference_parity.py
```

File boundaries may be adjusted during implementation. Avoid a framework rewrite.

## 10. Verification gates

Meaningful tests are required for the model/data boundary and causal pipeline:
- Feature order, count, units, normalization, and class-map consistency.
- Browser aliases and coordinates; wrong schema and NaN/Infinity rejection.
- Known CAN fixtures with correct gap/rate calculations, mixed-window labels, malformed rows, and chunk-boundary continuity.
- Split integrity and training-only preprocessing; future-frame changes must not affect an earlier prediction.
- CLI/API/batch/replay parity and replay-speed independence of features.
- Multiclass bundle loading, failed-upload rollback, and independent module readiness.
- Alert deduplication, cancellation, and bounded processing of a larger recording.

Complete frontend production build and one integrated offline demo after the API/UI work. Performance targets are provisional: aim for processing each window faster than its duration at 1x replay and measure actual p95 latency. Do not promise a grade, accuracy percentage, or latency before evaluation.

## 11. Schedule and budget

Estimated duration: **6–8 weeks** for one student familiar with the current code. Foundation → dataset → causal features → evaluation → backend/replay → UI/report → final verification. Dataset access or weak results may require additional time.

Minimum credible submission: corrected USB module, binary CAN detection, two simple baselines plus the existing MLP, leakage-aware evaluation, timed replay dashboard, saved alerts, and report export.

Stretch work: multiclass attack attribution, payload ablation, withheld-family anomaly evaluation, second-dataset testing, and separately labelled replay experiments. Add these in that order only after the minimum submission works.

Budget assumes existing laptop and local deployment:
- Python/React/FastAPI/SQLite and open-source ML tools: ₹0 software licence cost.
- HCRL data: academic release; no dataset purchase planned, confirm access/terms.
- Local dashboard and backend: ₹0 hosting cost.
- Additional CAN adapter, vehicle, cloud GPU, domain, and robot: not required.
- **Required additional spending: ₹0**, excluding existing electricity/internet and student time.

Planning hardware estimate: 8 GB RAM and a conventional four-core CPU should support bounded tabular development and replay; 16 GB is more comfortable. No GPU is planned. Reserve approximately 5–10 GB free disk initially and revise after checking download sizes. Use chunked parsing, bounded training subsets, bounded trees, limited worker counts, and no full raw-frame frontend stream. These are estimates pending a local benchmark.

## 12. Sources

- HCRL Car-Hacking Dataset: https://ocslab.hksecurity.net/Datasets/car-hacking-dataset
- scikit-learn grouped validation: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.StratifiedGroupKFold.html
- Current repository source: model training/network/prediction, inference and service routes, browser LiveDemo, dashboard, artifact metadata, dataset, and persistence schema.

The dataset provider's paper citations should be included in the final dissertation. Grouped stratification requires sufficient independent groups with class coverage; it is not a cure for having one capture per class.
