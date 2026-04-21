# ml-labs — Upgrade Roadmap

Eight phases from v0.6.x → v1.0. Each phase is a releasable unit with concrete scope, a **definition of done**, and an embedded **testing strategy**. Phases are ordered by dependency, not ambition — earlier phases unlock later ones.

Research basis: [see the analysis that produced this plan](#research-sources) at the end. Sources cited inline where they drive specific design calls.

---

## Reading this document

Every phase has the same skeleton:

- **Goal** — one sentence, what changes for users
- **Scope** — the concrete deliverables
- **Out of scope** — what we *won't* do in this phase (so we don't sprawl)
- **Depends on** — earlier phases / external packages required
- **Testing strategy** — how we prove it works and prevent regressions
- **Definition of done** — checklist that gates the release
- **Ships as** — target version number

**Ordering convention**: phases are sequential. Each phase assumes the prior one is released and stable. Skipping ahead requires a note on why the dependency is satisfied another way.

**Scope discipline**: if something "would be nice" but isn't load-bearing for the phase's goal, push it to a later phase or a `NOT_NOW.md` file. Scope creep kills multi-phase plans.

---

## Phase 1 — Test & Benchmark Foundation

**Status**: ✅ **Shipped as v0.7.0 on 2026-04-21.** See retro below.

**Goal**: Prevent silent regressions. Give us a safety net before we touch anything that matters.

### Scope

- **Unit tests for controller + planner + rules**. Property-based where possible:
  - `rules.ts`: given a `SignalBundle` with specific fixtures (overfit, underfit, early-converge, imbalanced), assert which rules fire and that the proposed configs are in-range.
  - `signals.ts`: given synthetic runs with known loss curves, assert convergence_epoch / still_improving / overfit_gap / per_class_variance are correct.
  - `patterns.ts`: fingerprint determinism, save/load round-trip.
  - `verdict.ts`: score function (classification with overfit penalty, regression) matches expected values on fixture inputs.
- **Benchmark harness** (`neuron/test/bench/`): five datasets — iris, wine, breast-cancer, california-housing, digits. Each bench:
  - Runs `auto_train` (non-tournament, deterministic seed) twice, asserts same verdict both times (reproducibility).
  - Records `{accuracy, wall_clock_s, waves_used, configs_tried}` and writes to `neuron/test/bench/results/{date}.json`.
  - Fails if accuracy regresses >2% vs. the committed baseline JSON.
- **Seed plumbing**. Thread a `NEURON_SEED` env var through `createRun`, rs-tensor init, planner query. Needed for reproducible benchmarks. (If rs-tensor init doesn't currently accept a seed, add one in this phase — it's a tiny change that unblocks everything else.)
- **GitHub Actions CI** (or a local `bun run ci` script): on every push, runs typecheck + unit tests + a fast subset of benchmarks (iris + wine) with a 2-minute budget cap.

### Out of scope

- Full CI on GPU (no GPU path yet)
- Dashboard visual regression (Phase 7)
- E2E integration tests through the MCP server (existing e2e* covers that)

### Depends on

- Nothing. This is the foundation.

### Testing strategy

- **Unit**: > 80% coverage of `core/auto/*.ts` (controller, planner, rules, signals, verdict, patterns).
- **Integration**: each benchmark runs end-to-end against real rs-tensor + real SQLite.
- **Regression**: baseline JSON committed to repo. Bench fails on > 2% drop.
- **Reproducibility**: same seed + same data → same verdict (assert in benchmark).

### Definition of done

- [ ] `bun test` runs in < 10 s and passes
- [ ] `bun run bench` runs iris + wine in < 2 min, wine + digits in < 5 min, full suite in < 15 min
- [ ] Baseline `results.json` committed with current accuracy numbers
- [ ] CI runs typecheck + unit + fast benches on every push to main
- [ ] `NEURON_SEED` produces deterministic `auto_train` output across two runs

### Ships as

**v0.7.0**. No user-visible features, so minor bump rather than patch — clear signal that the underlying contract is stronger now.

### Retro (2026-04-21)

**Shipped as planned.** Unit tests: 90 pass across 6 files in 35 ms. Full benchmark suite runs in ~3 s deterministic (seed=42, rules-only planner, sequential sweep).

**Baselines committed** (`neuron/test/bench/results/baseline.json`):
- iris: accuracy 0.967 (5 configs, 2 waves)
- wine: accuracy 0.993 (3 configs, 1 wave)
- breast-cancer: accuracy 0.969 (3 configs, 1 wave)
- housing: R² 0.890 (3 configs, 1 wave)

**Real bug caught by the first bench run**: for regression tasks, `computeDataHealth` was treating each unique target value as a "class" — a housing CSV with 70 unique prices produced `K=70`, leading `auto_train` to build a `[D, 32, 70]` head for a single-output regression. Runaway CPU, meaningless outputs. Fixed to force `K=1` for regression; new test `data-health.test.ts` guards against it.

**Scope deltas from the plan**:
- Shipped 4 datasets (iris, wine, breast-cancer, housing) instead of 5 — digits deferred because our current full-batch SGD is too slow on 64-dim × 1797-sample data; will re-add once Phase 3 lands mini-batch.
- Added `NEURON_SWEEP_MODE=sequential` (not in the original plan) — needed to eliminate Claude sub-agents from the bench path. Cleanly isolates benchmark determinism from production behavior.
- Skipped a dedicated GitHub Actions workflow; `bun run ci` locally is the DoD escape hatch in the original plan.

**Time**: ~2 hours.

---

## Phase 2 — Training Pipeline Fundamentals

**Goal**: Every number auto_train reports is trustworthy and reproducible.

### Scope

- **Stratified train/val/test splits**. `load_csv` / `load_json` grow a `stratify: boolean` param; when true and task is classification, splits preserve class proportions. Default: true when class imbalance is detectable, false otherwise.
- **K-fold cross-validation** as a first-class mode:
  - New MCP tool `cv_train(task_id, k=5, hyperparams?)`: runs k training runs with rotating folds, stores each as a regular `runs` record with `cv_fold_id` + `cv_parent_id` fields, reports mean ± std accuracy.
  - `auto_train` gains `cv?: number` optional param; when set, every sweep config uses k-fold internally and the reported metric is the mean across folds.
  - Schema: add `cv_fold_id INT NULL, cv_parent_id INT NULL` to `runs`, index `(cv_parent_id, cv_fold_id)`.
- **Implicit run context** (MLflow-style — no ceremony):
  - Each run automatically captures: `git_sha`, `neuron_version`, `rs_tensor_sha` (hash of binary), `cli_args` (if launched via MCP tool, the tool call), `rng_seed`, `hostname`, `start_ts`.
  - New `run_context TEXT` JSON column on `runs`. Auto-filled by `createRun`.
- **Dataset hash**. Add `dataset_hash TEXT` to `runs` = SHA-256 of `(ordered sample_ids × label × features)` at run start. Lets us assert "these two runs used the same data."
- **Built-in tabular preprocessors** in `neuron.config.ts`:
  - `preprocessors: [OneHot("category"), Quantile("price"), LogOne("count"), Robust("age")]` syntax.
  - Applied in order, deterministic, with fit-on-train-apply-to-test semantics (no leakage).
  - Helpers live in `neuron/src/adapter/preprocessors.ts`, exported from the `@neuron/mcp` package entry.

### Out of scope

- Image preprocessors (Phase 3 after backbone story)
- Feature selection / dimensionality reduction
- Categorical encoding beyond one-hot + target encoding

### Depends on

- Phase 1 (benchmarks — we need to measure that stratified splits reduce variance on imbalanced datasets)
- `NEURON_SEED` plumbing (Phase 1)

### Testing strategy

- **Unit**: stratified split preserves class ratios to within ±1 sample. K-fold: sum of test-fold sizes = N, no sample appears in two test folds. Dataset hash: permuting sample order but keeping content produces the same hash (after sorting by id). Preprocessors: quantile scaler fit on train produces fit-on-train-only stats even when applied to test.
- **Integration**: add a benchmark variant `iris_imbalanced` (drop 90% of one class). Run auto_train with and without stratification. Stratified variance < unstratified variance over 5 trials.
- **Reproducibility test**: two runs with same seed + same config + same data → identical `dataset_hash`, identical `accuracy`, identical winner selection.

### Definition of done

- [ ] `cv_train` ships and iris k=5 completes in < 30 s, std < 1%
- [ ] Stratification reduces accuracy variance on `iris_imbalanced` by > 30% over 5 seeds
- [ ] `run_context` populated on every new run (asserted in unit tests)
- [ ] `dataset_hash` stable across runs (asserted)
- [ ] Preprocessor pipeline beats raw features on `california-housing` bench by > 3% RMSE

### Ships as

**v0.8.0**. User-visible: `cv_train`, stratified splits, preprocessors. All additive.

---

## Phase 3 — Modern Training Loop (rs-tensor)

**Goal**: rs-tensor stops being a teaching toy. Real datasets become tractable.

### Scope

- **Wire autograd tape through `train_mlp`** (or cleanly factor out the backward pass so adding new ops stops requiring handwritten gradients).
- **Mini-batch support**: `batch_size: Option<usize>` on `train_mlp`. Default: full-batch (backward compat). With batching: iterate minibatches per epoch, shuffle between epochs (seeded).
- **Optimizers**: `optimizer: "sgd" | "adam" | "adamw"` with reasonable defaults (`adam β1=0.9, β2=0.999, ε=1e-8`). Each stores its state in the tensor store alongside weights.
- **LR schedules**: `lr_schedule: "constant" | "cosine" | "linear_warmup"`. Parameters: `warmup_epochs`, `min_lr`. Default: constant (backward compat).
- **Activations**: ReLU, GELU, LeakyReLU. Selected via new param on `init_mlp`: `activation: "tanh" | "relu" | "gelu" | "leaky_relu"`. Default: tanh (backward compat).
- **Better init**: Kaiming for ReLU/GELU, Xavier for tanh. Auto-selected based on activation. Optionally overridable.
- **CrossEntropyWithLogits loss**. New tool `cross_entropy_loss(predicted_logits, targets)` — numerically stable via log-sum-exp trick. Classification task training path switches from MSE on one-hot → CE on logits. Huge accuracy win.
- **Gradient clipping**: `grad_clip: Option<f32>` param.
- **Neuron plumbing**: `TrainHyperparams` grows `optimizer`, `lr_schedule`, `batch_size`, `grad_clip`, `activation`. Sweep config + planner + rules all aware. Planner proposes `optimizer=adamw` by default for classification.

### Out of scope

- Metal / GPU acceleration (Phase 9+)
- BatchNorm / LayerNorm (Phase 4)
- CNN / Transformer wiring (separate future work)

### Depends on

- Phase 1 (benchmarks to catch regressions)
- Phase 2 (run context + dataset hash — we want to compare old-vs-new on same data)

### Testing strategy

- **Rust unit tests** (new): each optimizer converges on a known convex problem (e.g., 2D quadratic bowl) to within ε in < 100 steps. LR schedules produce the expected values at specific epochs. Init produces tensors with the expected std.
- **Backward-compat test**: `train_mlp(... lr, epochs)` with no new args produces identical results to v0.6.x (same final loss ± numerical noise). Baseline checked in.
- **Accuracy benchmarks**: on the digits dataset (harder than iris), new loop with `adamw + cosine + relu + cross_entropy` should hit ≥ 92% test accuracy where current loop hits < 85%.
- **Speed**: mini-batch on a synthetic 50k-sample dataset — wall-clock < 25% of full-batch for equivalent accuracy.

### Definition of done

- [ ] Rust `cargo test` suite passes with the new unit tests
- [ ] Backward-compat benchmark: v0.7 verdicts match v0.6.x on iris + wine within 0.5% accuracy
- [ ] Digits benchmark: v0.7 > v0.6.x by ≥ 5% absolute accuracy with the new defaults
- [ ] Mini-batch speedup demonstrated on the synthetic 50k bench
- [ ] `train` tool schema + sweep + planner + rules all expose the new levers

### Ships as

**v0.9.0**. Major capability jump. Users must `ml-labs update` (rebuilds rs-tensor).

---

## Phase 4 — Calibration & Small-Model Wins

**Goal**: Predictions you can trust. Free accuracy from techniques that cost near zero.

### Scope

- **Temperature scaling** (post-training, 1-param fit on validation logits, per Guo et al. 2017):
  - New tool `calibrate(run_id)`: fits optimal temperature T, stores it on the run (`calibration_temperature` column).
  - `predict` and `batch_predict` divide logits by T before softmax when present.
  - `auto_train` calls `calibrate` automatically on the winner after promotion (when val split exists).
- **Stochastic Weight Averaging (SWA)**:
  - During the last N% of training (default 25%), maintain a running average of weights.
  - At end, re-evaluate SWA weights; if better, use them.
  - Exposed via `swa: boolean` on `train_mlp`. `auto_train` enables by default when epochs > 200.
- **Label smoothing**:
  - For classification with cross-entropy (Phase 3): soft targets replace hard one-hot. `label_smoothing: f32` on `train_mlp`, default 0.0.
  - Planner/rules: enable `label_smoothing=0.1` when `severity=moderate` and `still_improving=false` (classic regularization trigger).
- **Calibration dashboard**: dashboard shows reliability diagram for the active model (bucketed confidence vs. actual accuracy).
- **Predict output includes calibrated confidence**: `predict(task_id, features)` returns `{label, confidence, calibrated: true|false}` so downstream consumers know.

### Out of scope

- SAM (sharpness-aware minimization) — gated for a future opt-in release once SWA is proven
- MC-dropout / Bayesian last layer — Phase 6 with active learning

### Depends on

- Phase 3 (autograd tape for SWA weight accumulation; cross-entropy for meaningful calibration)

### Testing strategy

- **Unit**: temperature fit is strictly positive; post-calibration ECE (expected calibration error) on fixture logits is < pre-calibration ECE.
- **Accuracy benchmarks**: SWA produces final accuracy ≥ non-SWA on every bench dataset.
- **Calibration benchmark**: on digits + breast-cancer, pre-calibration ECE > 0.05, post-calibration ECE < 0.02. (Threshold from Guo et al.)
- **Label smoothing**: digits with noisy labels (synthetically flip 5% of labels) — label smoothing variant beats hard-label variant by > 1% accuracy.

### Definition of done

- [ ] `calibrate(run_id)` tool ships and is called by `auto_train` on every winner with val split
- [ ] Reliability diagram rendered in dashboard run detail view
- [ ] SWA enabled by default in auto_train for long runs; benchmarks show non-regression
- [ ] `predict` response includes calibrated confidence flag

### Ships as

**v0.10.0**. User-visible: calibrated confidence scores + reliability diagram + better accuracy.

---

## Phase 5 — MCP Tasks + Progress Streaming

**Goal**: Kill the timeout band-aid structurally. Long trainings become first-class.

### Scope

- **rs-tensor adopts MCP Tasks (SEP-1686, MCP spec 2025-11-25)**:
  - `train_mlp` returns a task handle immediately instead of blocking.
  - Client polls `tasks/get(task_id)` for status, receives progress notifications via the subscription pattern.
  - Existing synchronous call pattern remains as a fallback when the client doesn't declare task support.
- **Progress notifications** carry `{epoch, loss, val_loss?, elapsed_s, eta_s}`. Neuron's `mcp_client.ts` subscribes, forwards to the events bus, which becomes visible on the dashboard SSE stream.
- **Neuron `trainHead`** uses the async flow. Existing `onProgress` callback pipes through unchanged at the call site.
- **Controller / planner** react to live progress: a wave can be cancelled mid-run if loss NaNs or if all configs so far converged within 30 s (obvious task).
- **Dashboard**: the `ActiveRunCard` shows a live loss sparkline + ETA + epoch counter, driven by progress events.
- **Claude live commentary** (small): when auto_train is running, the planner sub-agent receives progress summaries every 100 epochs and can emit one-line notes into the decision_log ("loss plateau around 0.3, LR may be too low"). Opt-in via `auto_train({ live_commentary: true })`.

### Out of scope

- Multi-machine task distribution (future)
- Task persistence across neuron restarts — initial pass lets in-flight tasks die with the process

### Depends on

- Phase 3 (new training loop — we want to plumb progress through it, not the old one)
- MCP SDK version that supports Tasks (verify `@modelcontextprotocol/sdk` compatibility before scoping final release)

### Testing strategy

- **Unit**: progress event serializer round-trips through `recordEvent`. Dashboard SSE subscription receives events in order.
- **Integration**: submit a 2000-epoch training, verify:
  - Task handle returned in < 100 ms
  - Progress events arrive at least every 500 ms
  - Final result eventually delivered
  - Cancellation kills the rs-tensor training loop within 2 s
- **Fallback test**: with an older `@modelcontextprotocol/sdk` pinned, synchronous call path still works.
- **Timeout test**: submit a 4-hour training (simulated via `epochs=1000000` on synthetic data). Confirm no MCP timeout, progress continues streaming, and cancellation works.

### Definition of done

- [ ] rs-tensor implements MCP Tasks behind a feature flag in the Rust crate; default-on
- [ ] Neuron `mcp_client.ts` uses tasks when available; falls back otherwise
- [ ] 4-hour synthetic training completes without timeout
- [ ] Dashboard shows live loss sparkline + ETA during training
- [ ] `RS_TENSOR_TIMEOUT_MS` env var removed from docs (still works as a safety net)

### Ships as

**v0.11.0**. Protocol-level change; requires rs-tensor rebuild.

---

## Phase 6 — Smarter AutoML (hybrid planner + critic)

**Goal**: The planner stops being a one-shot prompt and starts being a learning system.

### Scope

- **LLM → TPE handoff** (per LB-MCTS 2025):
  - Waves 1-2: planner proposes (warm-start with priors).
  - Wave 3+: a TPE study (ported to TS as `core/auto/tpe.ts` or via `optuna-js` if it exists; otherwise implement the minimal TPE — it's ~200 lines) takes over, with all prior runs as observations.
  - Planner remains as a **critic**: it can veto a TPE suggestion if it's pathologically bad (e.g., lr > 0.5 on a task where lr < 0.01 was already best).
- **Diagnoser sub-agent**:
  - Called only when wave completes with `severity=critical` OR overfit_gap > 0.2.
  - Input: signal bundle + last 10 decision log entries + top-3 confused class pairs.
  - Output: strict JSON `{primary_cause, evidence[], recommendations[]}`.
  - Controller uses `primary_cause` to pick which rules to enable in the next wave.
- **Rule-effectiveness tracking**:
  - New `rule_effectiveness` table: `(rule_name, fired_count, produced_winner_count, task_fingerprint)`.
  - After each completed auto_run, update counts for the rules that fired in each winning config's trajectory.
  - Planner prompt includes "rule X: fires Y%, produces winner Z%" so it learns over time which rules are actually predictive on this user's workload.
- **Typed tool outputs**:
  - Every MCP tool gains a Zod `outputSchema` in addition to `schema` (input).
  - MCP response includes `structuredContent` matching the schema (MCP spec 2024+).
  - Claude agents see typed outputs, improves chain-of-tool accuracy.
- **Meta-tools**:
  - `data_audit(task_id)` = `inspect_data` + `preflight_check` + class-wise summary + scale warnings, in one call.
  - `auto_preflight(task_id)` = `data_audit` + `suggest_hyperparams` + seed-config generation.
  - Reduces typical Claude-agent tool chains from 4-5 calls to 1-2.

### Out of scope

- Bayesian optimization alternatives beyond TPE (SMAC, BoHB) — defer until TPE proves itself
- Meta-model warm-start (predicts configs from fingerprints) — defer; rule-effectiveness is a cheaper proxy

### Depends on

- Phase 1 (benchmarks — measuring whether hybrid beats single-planner)
- Phase 3 (new lever space — TPE operates over a bigger search space now)
- Phase 4 (calibration — confidence signals for the critic)

### Testing strategy

- **Unit**: TPE implementation converges to known-optimal `lr` on a mock objective within 20 trials. Diagnoser output parses as JSON with required fields. Rule-effectiveness increments correctly.
- **Integration benchmark**: auto_train with Phase 6 vs. auto_train Phase 5 on the full 5-dataset bench:
  - Target: average waves_used drops by ≥ 20%
  - Target: average wall_clock drops by ≥ 15%
  - Target: accuracy non-regressing (no dataset loses > 1%)
- **Diagnoser smoke test**: inject a synthetically overfit run, assert diagnoser identifies "overfitting" as primary cause with > 80% recall over 20 trials.

### Definition of done

- [ ] TPE implementation passes unit tests and produces reproducible suggestions (seeded)
- [ ] Hybrid benchmark beats single-planner on 3/5 datasets in fewer waves
- [ ] Diagnoser's output structure validated by schema in production
- [ ] `data_audit` and `auto_preflight` meta-tools visible in Claude tool list
- [ ] Rule-effectiveness table populated after 20 real auto_runs; planner prompt shows it

### Ships as

**v0.12.0**. The "AutoML actually getting smarter" release.

---

## Phase 7 — Active Learning Loop + Dashboard UX

**Goal**: Close the loop from "here's uncertain samples" to "here's a better model." Make the dashboard match the intelligence of the backend.

### Scope

**Backend — active learning**:
- **Hybrid uncertainty + diversity sampling** in `suggest_samples` (per Bahri & Jiang 2023, re-affirmed 2025):
  - Score each unlabeled sample by softmax entropy (uncertainty).
  - Top-K by entropy → k-center coreset for diversity.
  - Return a diverse ranked list of ≤ N samples.
- **Auto-collect loop** (opt-in): `auto_train({ auto_collect: true })` — if a `collect(recommendations): Sample[]` callback is defined in `neuron.config.ts`, the controller loops (train → suggest → collect → retrain) up to `max_collect_rounds` (default 3) or until target hit.
- **MC-dropout for epistemic uncertainty** (better signal than softmax entropy alone):
  - Add `dropout_p` param to `train_mlp` (requires Phase 3 autograd tape extended with dropout op — include this in Phase 3 if tractable, else here).
  - At predict time, run 10 forward passes with dropout-on, compute predictive variance.

**Dashboard UX**:
- **Labeling UI**: new route `/tasks/:id/label`. Shows one uncertain sample at a time: features table (or image), top-3 predicted labels with probabilities, text input + keyboard shortcuts for class selection, "submit and next" workflow. Posts to `POST /api/tasks/:id/samples` + optional `POST /api/tasks/:id/retrain`.
- **Training-curves overlay** (the single highest-leverage dashboard upgrade):
  - Run list has a "compare" checkbox per row.
  - Compare view shows overlaid loss + val-loss + val-accuracy curves across selected runs, with smoothing slider and run legend.
  - Chart library: recharts (already-familiar React ecosystem) or visx. Pick one, don't bikeshed.
- **Confusion matrix drill-through**: click cell → sample list filtered to `true_label=A AND predicted_label=B` (in a drawer). Each row: sample id, features (or thumbnail), confidence. Click "correct this" → labeling UI pre-filled.
- **HP-importance chart**: after a sweep, bar chart of `|max_accuracy - accuracy_given_this_hp_fixed_to_nth_value|` per HP per value. Answers "which knob actually mattered."
- **Run tags + notes + search**: tag chips on `RunsAll`, text search across hyperparams + notes.

### Out of scope

- Full drift monitoring (Phase 8)
- Multi-annotator labeling workflow
- Image augmentation library (add-on)

### Depends on

- Phase 3 or 7 (dropout op) — pick Phase 3 if feasible; otherwise implement dropout here
- Phase 4 (calibrated confidence — uncertainty sampling requires trustworthy probs)
- Phase 6 (typed tool outputs — labeling UI calls `suggest_samples` and gets typed responses)

### Testing strategy

- **Unit**: k-center coreset produces spatially-diverse set (pairwise min-distance > threshold). Entropy computation matches expected values. Labeling UI: submitting a sample writes correct row to DB.
- **Integration**: active-learning loop on a synthetic task with known minority class — after 3 collection rounds, accuracy on minority class > 80% (started < 50%).
- **Dashboard visual regression**: playwright/puppeteer screenshots of compare view, confusion drill-through, labeling UI. Diff vs. committed baselines; threshold for tolerable pixel delta.
- **E2E**: scripted session — upload data, auto_train, open labeling UI, label 10 samples, re-train, verify new accuracy.

### Definition of done

- [ ] `suggest_samples` returns hybrid uncertainty + diversity rankings
- [ ] `auto_collect` loop demonstrably improves accuracy on the benchmark with synthetic minority class
- [ ] Training-curves overlay works for up to 6 runs simultaneously
- [ ] Confusion matrix cells are clickable; drawer shows matching samples
- [ ] Labeling UI round-trips: label → DB → next sample, with keyboard shortcuts
- [ ] Visual regression suite runs in CI

### Ships as

**v0.13.0**. The "feels like a real ML platform" release.

---

## Phase 8 — Production Story (serving, drift, monitoring)

**Goal**: Models users train can actually be served, monitored, and retrained in response to drift.

### Scope

- **Bundle-serving endpoint**:
  - `POST /api/registry/:name@:version/predict` — loads weights from the registry bundle (existing `publish_model` output), runs inference.
  - Batch variant: `POST /api/registry/:name@:version/batch_predict`.
  - Auth: simple bearer-token model (single user) — the token is set via env var `NEURON_SERVE_TOKEN`; docs warn it's for local dev / trusted network.
- **Prediction logging**: new `predictions` table: `(id, task_id, run_id, model_uri, features JSON, output JSON, ts, latency_ms)`. Sampled (config: `NEURON_PREDICTION_SAMPLE_RATE`, default 100%) to avoid DB bloat.
- **Drift detection**:
  - PSI + KS two-sample test per feature, reference window = training data, current window = last 1k predictions (configurable).
  - New tool `drift_check(task_id)` returns `{feature, psi, ks_p, verdict: "stable" | "drifting" | "severe"}` per feature.
  - Dashboard route `/drift`: bar chart of drift scores per feature, timeline of drift-over-time.
- **Shadow / canary**:
  - `active_models` table gains `weight REAL` (default 1.0). Prediction endpoint picks among weighted rows.
  - "Promote with shadow" tool: sets new model to weight=0, logs both predictions to `shadow_comparisons` table for offline analysis.
  - Dashboard shows agreement rate between live and shadow; one-click promote-for-real when confidence is high.
- **Auto-retrain proposals** (where the loop closes):
  - When drift_check reports "drifting" for > 20% of features, emit an event `drift_detected`.
  - Dashboard shows a banner: "model is drifting, consider retraining" with a `/neuron-auto` one-click button.
  - Not auto-retraining (yet) — the human approves.

### Out of scope

- Multi-user auth
- Cloud deployment guides beyond local
- ONNX export (defer — tractable only once autograd tape is clean enough)

### Depends on

- Phase 5 (progress streaming — retrains kicked off from drift events need to show progress)
- Phase 6 (typed tool outputs — drift_check returns structured JSON consumed by the dashboard)
- Phase 7 (labeling UI — drift often surfaces new classes that need labeling)

### Testing strategy

- **Unit**: PSI/KS implementations pass known-reference test vectors (reference fixtures from Evidently or NannyML docs). Weighted routing returns expected distribution over 10k draws.
- **Integration**: trained model served via `/api/registry/.../predict`, 100 requests, latency P99 < 50 ms.
- **Drift simulation**: synthetic task where we shift one feature's mean by 2σ after 500 predictions; `drift_check` detects within 100 additional predictions.
- **Shadow test**: run two models side-by-side for 1000 predictions, verify both rows logged, agreement rate computed correctly.

### Definition of done

- [ ] Published model can be served via HTTP and returns predictions under 50 ms P99 locally
- [ ] Shadow traffic logged and compared in dashboard
- [ ] Drift detection catches synthetic shift within the test budget
- [ ] `/drift` dashboard route renders per-feature drift
- [ ] `drift_detected` event triggers dashboard retrain banner

### Ships as

**v1.0.0**. The "ml-labs is a platform" milestone.

---

## Phase 9 (optional / aspirational) — Acceleration

**Goal**: Real-sized datasets (>100k samples, deeper networks) become tractable on a laptop.

### Scope sketch (not a commitment)

- **Candle migration** for rs-tensor compute — keeps Rust, gains Metal + CUDA via a single crate swap. Or:
- **wgpu compute shaders** for matmul/conv hot paths — portable, more work.
- Benchmarks demonstrating ≥ 10× speedup on a 10k × 100-dim dataset.

### Why optional

- Phases 1-8 make ml-labs a legitimate AutoML platform on CPU.
- Acceleration is a big diff and risks destabilizing the stack.
- Worth doing only after measuring where real users hit a wall.

---

## Cross-cutting themes (present in every phase)

1. **Reproducibility**: every phase asserts that `NEURON_SEED=X` produces identical output. This is the contract.
2. **Backward compatibility**: every phase runs the prior benchmarks and must match ± the documented tolerance. No silent regressions.
3. **Documentation as code**: each shipped tool/schema change updates `README.md`, `CHANGELOG.md`, and the auto-generated tool reference in the same commit. No "docs PR later."
4. **Testing as definition-of-done**: a phase isn't done until its tests are green on CI. Not just "it works on my machine."

---

## What we're explicitly NOT doing in this roadmap

- Multi-machine distributed training
- Custom kernel development (CUDA / Metal shaders from scratch)
- Multi-tenant SaaS story
- End-to-end notebook / IDE replacement (we're a platform, not an IDE)
- Mobile / edge inference
- Proprietary model marketplace

These may become future work; they're out of v1.0 scope to keep focus.

---

## Execution protocol

When we start a phase:
1. **Spawn a dedicated planning document** at `.claude/plans/phase-N.md` with the concrete file-level plan (which files change, in what order, with what tests).
2. **Create TaskCreate entries** for each deliverable in the plan.
3. **Commit per-deliverable** on a feature branch `phase-N-<slug>`, not one giant commit. Easier to revert if a specific change breaks something.
4. **Run benchmarks before and after** every non-trivial change. Diff the baseline JSON. Commit any intentional updates to the baseline with the rationale.
5. **Release at phase end** with a git tag, a GitHub release, and a CHANGELOG entry.
6. **Retro**: short note in `ROADMAP.md` after each phase — what actually shipped vs. planned, what surprised us, what we deferred.

---

## Research sources

Design decisions above informed by:
- [MCP Spec 2025-11-25 — Tasks (SEP-1686)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) — Phase 5
- LB-MCTS (arXiv 2601.12355) — Phase 6 LLM→TPE handoff
- "Can LLMs Beat Classical HPO Algorithms?" (arXiv 2603.24647) — Phase 6
- Bahri & Jiang, "Rediscovering Uncertainty Sampling for Tabular AL" (arXiv 2306.08954) — Phase 7
- Guo et al. 2017, "On Calibration of Modern Neural Networks" — Phase 4 temperature scaling
- Andriushchenko et al. (JMLR 2025), "Stabilizing SAM" — Phase 4 notes
- [NannyML CBPE docs](https://www.nannyml.com/) — Phase 8 drift
- [Evidently drift detection methods](https://www.evidentlyai.com/blog/data-drift-detection-large-datasets) — Phase 8
- MLflow data model — Phase 2 run context design
