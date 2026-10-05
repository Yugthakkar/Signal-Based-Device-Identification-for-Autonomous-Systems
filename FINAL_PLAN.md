# SBDI Admission Console v1 — 1-Week Sprint Plan (Final)

**Goal (one line):** Turn the current prototype into an honest, working, presentable
final-year artefact: timing-only device identification with unknown-device rejection
and calibrated abstention, served as an admission console — in 4 working days, $0 cost.

**Demo story (30 seconds):** *"A device plugs into the console. We don't trust what it
declares — we fingerprint its timing. Known keyboard? Allowed. Never-seen device?
Rejected. Unsure? Abstained for human review. And here's the table proving our first
model was cheating on leaked features, and what it really scores."*

---

## 1. Why this is presentable as a final-year project

A 1-week build can't win on scale, so it wins on **rigour and honesty**:

1. **Leakage analysis (your killer viva asset).** The shipped model trains on `device`
   and `endpoint` (USB addresses ≈ the label) and `packet_rate` (a row counter), and
   splits neighbouring packets randomly into train/test. You will show a before/after
   table: leaked accuracy vs honest accuracy. Examiners love this.
2. **Working end-to-end system.** Live Demo currently crashes (7-vs-8 feature mismatch)
   and silently zeroes features (browser event-name mismatch). You will make it actually work.
3. **Two real research capabilities, demo-sized:** open-set rejection ("unknown device")
   and abstention ("not sure → human review"), with AUROC and coverage numbers.
4. **Admission-console framing.** Allow / review / reject verdicts map to zero-trust
   admission control (NIST SP 800-207), which justifies the "Autonomous Systems" title
   without needing robots.

## 2. Scope

**IN:**
- Leak-free retrain on the 8 behavioural features only
- Session/time-blocked cross-validation + real metrics (macro-F1, balanced acc, confusion matrix, bootstrap CI) + 3 classical baselines
- Live path repair (event-name aliases, 8-feature inference)
- `POST /identify` with confidence, `unknown` flag, `abstain` flag (temperature scaling)
- Open-set rejection demo (held-out class, energy threshold, AUROC)
- Few-shot enrolment demo (prototype + kNN, script-level)
- Admission verdict panel in the frontend + results docs + demo script

**OUT (explicitly — say this in the viva):**
ROS 2 / DDS, CAN bus, federated learning, RF, physical injector hardware, full
conformal prediction, new Supabase tables, dataset collection. All listed as future work.

## 3. Day-by-day plan

### Day 1 — Honest baseline (`model/`, `feature_engineering/`)
**Goal:** a leak-free model with trustworthy numbers.

1. `model/train.py:19-39` — delete the leaky 7-column feature set; train on the 8
   behavioural features only (`event_rate … key_press_rate`).
2. Add `scikit-learn` to `requirements.txt` (needed for GroupKFold + baselines).
3. The dataset has no `session_id` column, so build **time-blocked groups**: sort by
   timestamp within each label, cut into 5 contiguous blocks per label (≈20 groups),
   evaluate with `GroupKFold`. This is standard for packet/time-series data — state it.
4. Replace accuracy-only `evaluate()` (`model/train.py:252`) with: macro-F1, balanced
   accuracy, per-class confusion matrix, 1,000-sample bootstrap 95% CI.
5. Add baselines on identical splits: logistic regression, random forest, kNN.
   Your MLP becomes one row in the table, not the whole table.
6. Fit a **temperature** T on the validation split (simple line search over
   T ∈ [0.1, 10] minimising NLL), save it into `artifacts/model_metadata.json`.
7. Archive the old leaky artefacts to `artifacts/leaky_baseline/` (do not delete —
   you need them for the before/after table), then retrain and overwrite `artifacts/`.

**Commands:**
```bash
pip install -r requirements.txt
cd model
python train.py --dataset ../data/datasets/final_device_dataset.csv --epochs 60 --batch_size 256
```

**Acceptance:** training prints macro-F1 + confusion matrix + CI; `model_metadata.json`
contains 8 feature columns and a `temperature` field; before/after table drafted (§5).

### Day 2 — Repair the live path (`ml_service/`, `web/frontend/`)
**Goal:** Live Demo works end-to-end with zero crashes.

1. `feature_engineering/extract_features.py:125-126` — add an event-name alias map so
   both layers work: `keydown→key_press`, `mousemove→mouse_move`, `click→mouse_click`.
   (Fix at the extractor, not the frontend — the canonical schema must accept both.)
2. Nothing to change in `ml_service/inference.py` structurally — it already reads
   `feature_columns` from metadata, so the 7-vs-8 `ValueError` disappears once Day-1
   metadata has 8 columns. Verify with the `/demo` endpoint.
3. Apply temperature scaling in `InferenceEngine.predict()` (divide logits by T).
4. Add `POST /identify`: same as `/predict` but returns
   `{device, confidence, unknown: max_prob < tau_u, abstain: max_prob < tau_a}` with
   thresholds `tau_u`, `tau_a` tuned on validation for ~95% coverage. Keep `/predict`
   untouched for compatibility.
5. Verify: `web/frontend/src/app/pages/LiveDemo.tsx:69-71` events → `/predict` returns
   200 with non-zero `movement_speed/click_frequency/key_press_rate`.

**Acceptance:** type + move mouse on the Live Demo page → live prediction, no errors,
`/identify` returns verdict flags.

### Day 3 — Open-set rejection + few-shot enrolment (`scripts/`)
**Goal:** two research-grade capabilities, honestly labelled as capability demos.

1. New `scripts/open_set_demo.py`: train on active classes, hold out the idle classes
   as "unknown". Score = energy `E(x) = −T·logsumexp(logits/T)`; threshold at the 95th
   percentile of validation in-distribution energies. Report **AUROC + rejection rate
   at 95% in-distribution retention**.
2. New `scripts/few_shot_demo.py`: prototype = mean of 10 standardised 8-dim windows
   per class; classify by nearest prototype; report accuracy vs 5/10/20 windows.
3. Honesty note (put it in the report, say it in the viva): the idle classes have
   ~18 rows each, so these are *capability demonstrations on limited data*, not
   generalisation claims. The full dataset is future work.

**Acceptance:** both scripts run and print AUROC / few-shot accuracy tables.

### Day 4 — Console polish + docs + demo (`web/frontend/`, `docs/`)
**Goal:** it looks like a product and presents like research.

1. Extend the Live Demo page with an **Admission Verdict panel**: declared identity
   (user dropdown: Keyboard / Mouse / Unknown device) vs fingerprinted identity from
   `/identify` → verdict badge **ALLOW / REVIEW / REJECT** + confidence bar + a small
   event feed of rejections/abstentions (local state is fine).
2. Write `docs/RESULTS.md` — fill the §5 tables with your real numbers.
3. Write `docs/DEMO_SCRIPT.md` — the 60-second script (§6).
4. Update `README.md` quickstart (install → `npm run dev` → open `:3000` → Live Demo).
5. Screen-record the demo (phone-quality is fine) as backup for presentation day.

**Acceptance:** cold machine → `npm run dev` → working verdict demo in < 5 minutes;
RESULTS.md contains real numbers, not placeholders.

## 4. Stretch goals (only if a day remains, in this order)
1. `POST /enroll`: store a prototype from N windows in `artifacts/prototypes.json`,
   `/identify` checks prototypes first (true few-shot enrolment in the product).
2. Latency table: per-window p50/p95 on laptop CPU via `/identify` timing.
3. Calibration plot (reliability diagram) in RESULTS.md.

## 5. Results tables (fill on Days 1–3)

**Table 1 — Leakage before/after (the viva table):**
| Model | Features | Split | Accuracy | Macro-F1 |
|---|---|---|---|---|
| Leaky MLP (shipped) | 7 incl. `device`,`endpoint` | random rows | — | — |
| Honest MLP | 8 behavioural | time-blocked GroupKFold | — | — |
| LogReg / RF / kNN | 8 behavioural | same splits | — | — |

**Table 2 — Open-set (held-out idle classes):** AUROC, rejection rate @95% retention.
**Table 3 — Few-shot:** accuracy @ 5 / 10 / 20 windows.
**Table 4 — Calibration:** ECE before/after temperature scaling; coverage @ chosen thresholds.

## 6. Demo script (60 seconds)
1. (0–10s) "Devices lie about identity — we fingerprint timing, not declared IDs."
2. (10–30s) Type + move mouse on Live Demo → verdict flips Keyboard↔Mouse live.
3. (30–45s) Select "Unknown device" as declared → REJECT badge (open-set).
4. (45–55s) Show Table 1: "our first model cheated; here's the honest score."
5. (55–60s) "Next: real multi-session dataset, CAN bus, fleet middleware."

## 7. Risks
| Risk | Mitigation |
|---|---|
| Honest accuracy is low (~60–70%) | Expected with 4 captures; frame as *the finding*, not failure. The leakage story carries the presentation. |
| Time-blocked groups still leak slightly | State it as a limitation; it is strictly better than random rows. |
| Frontend edits overrun | Cap at the verdict panel; local-state feed, no new backend tables. |
| sklearn/torch version friction | Pin `scikit-learn` in requirements; CPU-only everywhere. |

## 8. Repo cleanup
**Done:** removed `web/backend/package-lock.json` (stray, no package.json there) and the
generated copy in `data/uploads/` (gitignored, regenerable via the Upload page).
**Pending decision:** `docs/RESEARCH_ROADMAP.md` (keep as future-work appendix),
`ui_desktop/` (keep as offline capture tool vs remove as duplicate), sample CSVs/raw
pcaps (keep for tests/demos), `TECH_STACK_RATIONALE.md` (keep).
**Regenerate, don't delete:** `artifacts/*` (Day 1 retrain overwrites them).
