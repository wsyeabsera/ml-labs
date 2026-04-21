# Changelog

All notable changes to ML-Labs are documented here.

---

## v0.12.0 — 2026-04-21

### Added — Phase 6 (smarter AutoML)

Four pieces that take the planner from a "one-shot prompt" to a system with its own memory, search strategy, and ergonomic surface.

- **TPE (Tree-structured Parzen Estimator)** — `neuron/src/core/auto/tpe.ts`. Minimal self-contained implementation: splits observations into top-γ "good" set, samples from it with perturbation (jitter), handles log_uniform / int_uniform / uniform / categorical params. Deterministic with seed. Used by the controller starting at wave 3+ when rules+planner have had their pass.
- **Hybrid controller handoff** — waves 1-2 keep rules + Claude planner. Wave 3+ calls TPE with all prior `RunSignals` as observations. Inherits non-TPE fields (head_arch, activation, loss, …) from the best prior run so modern-variant wins don't get lost.
- **Meta-tools** — `data_audit` (inspect_data + preflight_check, one call) and `auto_preflight` (data_audit + hyperparameter suggestion, with imbalance-aware suggestion). Halves typical Claude-agent tool chains at the start of a session.
- **Rule-effectiveness tracking** — new `rule_effectiveness` SQL table. After each wave, every rule that fired gets a `fired_count++`. After winner selection, the rules that produced the winner get a `produced_winner_count++`. Helpers: `recordRulesFired`, `recordRulesProducedWinner`, `getRuleStats`, `totalTrialsFor`. Fingerprint-scoped, so stats accumulate per (kind, K, D-bucket, N-bucket, imbalance-bucket) cell.

### Schema

- New `rule_effectiveness (rule_name, task_fingerprint, fired_count, produced_winner_count, updated_at)` — keyed by (rule_name, task_fingerprint).

### Tests

- 148 unit tests (+7 for rule-stats, +8 for TPE).
- TPE determinism verified; categorical + numeric perturbation tested.
- Rule-stats: atomic upsert + fingerprint isolation.

### Deferred (with rationale in ROADMAP retro)

- **Diagnoser sub-agent** — Phase 6.5. Separate Claude agent with JSON schema, conditionally invoked on `severity=critical` / `overfit_gap > 0.2`.
- **Typed `outputSchema` on MCP tools** — Phase 6.5. Every tool gets an output schema; wider refactor deserving its own pass.
- **Bayesian optimization beyond TPE (SMAC, BoHB)** — unchanged; defer until TPE proves or fails.

### Backward compat

- Existing benches (iris, wine, breast-cancer, housing, digits) hit target in wave 1 with the Phase 3 modern seed, so TPE doesn't activate and Δ=+0.000 across all datasets.

### Upgrade

```bash
ml-labs update
```

TS-only changes plus a new SQLite table (auto-migrated). No rs-tensor rebuild needed.

---

## v0.11.0 — 2026-04-21

### Added — Phase 5 (progress streaming + timeout hygiene)

Long trainings no longer need the 1-hour timeout band-aid. rs-tensor streams progress back during `train_mlp`, and the MCP client resets the per-call timeout each time a notification arrives — so a training that keeps reporting progress can run indefinitely.

**rs-tensor**:
- `train_mlp` handler reads the caller's `progressToken` from request meta and emits `notify_progress` per epoch with `{ progress, total, message = "epoch X/Y, loss=..., elapsed=..." }`.
- Throttled: max 1 notification per 200 ms wall clock. No-op when caller doesn't supply a token (backward compat — all prior callers work unchanged).
- Handler signature gained `meta: Meta, peer: Peer<RoleServer>` params (the rmcp `#[tool]` macro auto-injects these).

**Neuron**:
- `mcp_client.call()` refactored to take a `CallOpts { timeoutMs, signal, onProgress }` object. Passes `onprogress` + `resetTimeoutOnProgress: true` + `maxTotalTimeout` to the SDK.
- `rsTensor.trainMlp(...)` accepts an `onProgress` callback.
- `trainHead` threads it into rs-tensor; each epoch tick becomes a `TrainProgress{stage="train", i=epoch, n=total}`, and `trainBg`'s existing throttled forwarder writes `run_progress` events to the DB. **Dashboard gets live per-epoch training updates automatically** — no dashboard-side changes needed.

**Timeout strategy**:
- Default per-call timeout: 1 hour → **5 minutes**. That's the idle ceiling; any progress notification resets it.
- `maxTotalTimeout`: **4 hours** hard ceiling regardless of progress resets.
- New env var `RS_TENSOR_MAX_TIMEOUT_MS` overrides the total ceiling for truly long runs. `RS_TENSOR_TIMEOUT_MS` still overrides the per-call timeout.

### Integration test

- `neuron/test/integration/progress.ts`: 3000-epoch training on a 500×32 synthetic dataset with AdamW+ReLU. **Received 199 progress notifications in 41s**, reached epoch 2971/3000, completed without timeout. Proves the end-to-end pipeline.

### Deferred

- **Dashboard live loss sparkline** on ActiveRunCard → Phase 7 (dashboard UX). Events are flowing now; visualization is a small follow-up.
- **Live Claude commentary** (opt-in `auto_train({ live_commentary: true })`) → Phase 6. Planner sub-agent subscribes to progress events and emits notes.
- **Mid-wave cancellation** (NaN detection, fast-convergence early-out) → Phase 6.
- **MCP Tasks adoption (SEP-1686)** — experimental in TS SDK, absent from rmcp 0.16. Revisit when both ship stable support.

### Upgrade

```bash
ml-labs update
```

Rebuilds rs-tensor (new progress emission path). Existing calls without progress tokens produce identical results to v0.10.

---

## v0.10.0 — 2026-04-21

### Added — Phase 4 (calibration & small-model wins)
Goal: predictions you can trust. Accuracy stayed the same; confidence scores became honest.

- **`calibrate(run_id)` MCP tool** — post-hoc temperature scaling (Guo et al. 2017). Log-space grid search over T > 0 minimizing NLL on held-out val logits. Stores T on `runs.calibration_temperature`. Reports ECE before/after.
- **Auto-calibration in `auto_train`** — controller automatically calls `calibrate` on the winning classification run after register_model. Runs with no val split or on regression tasks are skipped with an explicit log line.
- **`predict` / `batch_predict` apply T** — divide logits by T before softmax when the registered model has a calibration temperature. Response includes `calibrated: true | false` so downstream consumers know whether to trust the confidence numbers.
- **SWA (Stochastic Weight Averaging)** in rs-tensor `train_mlp` — new `swa` + `swa_start_epoch` params (default off, start at last 25% of epochs). Maintains running weight average, swaps in at end. Low cost, modest regularization.
- **Label smoothing** in rs-tensor CE loss — new `label_smoothing: f32` param. Replaces one-hot target with `(1 - α) × onehot + α / K uniform`. Standard regularizer for CE training.
- **Rules upgrade** — the seed-wave modern variant enables `label_smoothing=0.1` (classification) and `swa=true` (when `epochs ≥ 200`). Legacy SGD+tanh variant unchanged.

### Tests
- +9 unit tests (`calibration.test.ts`, updated `rules.test.ts`)
- Total: 133 tests, ~115 ms
- Backward-compat bench: Δ=+0.000 on all 5 datasets (calibration doesn't affect argmax; SWA + label smoothing off by default)

### Baseline (v0.9 → v0.10)
No accuracy changes — v0.10 adds honesty to confidence scores, not accuracy. Every classification winner now has `calibration_temperature` populated (range observed: T ∈ [0.22, 0.26]).

### Upgrade

```bash
ml-labs update
```

Rebuilds rs-tensor (new SWA + label smoothing params). Existing calls without new flags produce identical results to v0.9.

---

## v0.9.0 — 2026-04-21

### Added — Phase 3 (modern training loop)
rs-tensor stops being a teaching toy. Every baseline accuracy improved.

**New `train_mlp` capabilities** (all additive; defaults match v0.8 exactly):
- **`optimizer`** — `"sgd"` (default), `"adam"`, or `"adamw"`. Adam/AdamW maintain per-weight first and second moment tensors.
- **`batch_size`** — mini-batch training with per-epoch Fisher-Yates shuffle (seeded).
- **`lr_schedule`** — `"constant"` (default), `"cosine"` (decays `lr → min_lr` over epochs), `"linear_warmup"` (ramps over `warmup_epochs`).
- **`grad_clip`** — clips global L2 norm of gradients.
- **`loss`** — `"mse"` (default) or `"cross_entropy"` (numerically stable softmax+CE for classification; output layer is linear under CE).

**New `init_mlp` capabilities**:
- **`activation`** — `"tanh"` (default), `"relu"`, `"gelu"`, `"leaky_relu"`. Stored per-MLP in a new `meta` map on the `TensorServer`; `train_mlp`, `evaluate_mlp`, `mlp_predict` all respect it.
- **`init`** — `"auto"` (default), `"xavier"`, `"kaiming"`. Auto picks Kaiming for ReLU/GELU/LeakyReLU, Xavier for tanh.

**Neuron plumbing**:
- `TrainHyperparams`, `train` tool schema, `SweepConfig`, `startTrainBackground`, and `runSweepSequential` all thread the new levers end-to-end. The sweep sub-agent prompt forwards them to `mcp__neuron__train`.
- `rsTensor.initMlp` / `.trainMlp` grew typed option bags.

**Rules upgrade**:
- Seed wave now produces `{2 legacy SGD+tanh variants + 1 modern AdamW+ReLU+cosine}` for classification (MSE for regression; CE for classification). The modern variant wins on every benchmark dataset.

**New benchmark**: digits (UCI optdigits, 3823 samples × 64 features × 10 classes). Validates that the modern loop handles realistic multi-class tabular.

### Baseline uplift (Phase 2 → Phase 3)

| Dataset | v0.8 | v0.9 | Δ |
|---|---|---|---|
| iris | 0.800 | **1.000** | +0.200 |
| wine | 1.000 | 1.000 | — |
| breast-cancer | 0.947 | **0.965** | +0.018 |
| housing (R²) | 0.890 | **0.970** | +0.080 |
| digits | — | **0.990** | new |

### Fixed
- `evaluate_mlp` and `mlp_predict` in rs-tensor previously hard-coded tanh activation. They now read from the per-MLP meta and dispatch correctly — otherwise a ReLU-trained MLP would get tanh-evaluated at predict time.

### Upgrade

```bash
ml-labs update
```

**This release rebuilds the rs-tensor binary** — the new levers require the new Rust code. The `update` command hard-exits if the rebuild fails. Existing calls with just `lr` + `epochs` continue to work unchanged.

---

## v0.8.0 — 2026-04-21

### Added — Phase 2 (training pipeline fundamentals)
- **Implicit run context** — every run now records `{neuron_version, git_sha, rs_tensor_sha, hostname, pid, start_ts, rng_seed}` in a new `run_context` JSON column on `runs`. MLflow-style zero-ceremony reproducibility. Surfaced on `GET /api/runs/:id`.
- **Dataset hash** — `dataset_hash` column stores a SHA-256 over `(sample_id, label, features)` triples for each run's training split. Identical data → identical hash, regardless of insertion order. Guards against accidental data drift.
- **K-fold cross-validation** — new `cv_train` MCP tool (tool #35). Runs k training passes with rotating folds (stratified for classification, random for regression), reports mean ± std of the primary metric. Each fold's run is a regular `runs` row linked to an umbrella parent via new `cv_parent_id` and `cv_fold_id` columns.
- **`stratify` param** on `load_csv` — `"auto"` (default) | `true` | `false`. Auto-stratifies for classification, random-splits for regression. Unchanged behavior when omitted; explicit control when needed.
- **`seed` param** on `cv_train` (like `auto_train` / `train` / `load_csv`) — full deterministic reproducibility.
- **Benchmark harness now tracks dataset_hash** — baseline entries include the hash; re-runs fail fast with a clear "dataset_hash drift" error if training data changes.

### Fixed
- **`val_accuracy` was always null** even when a train/test split existed. `startTrainBackground` (the path used by the dashboard, sweep, auto_train, and now cv_train) did not evaluate on held-out test samples. Every caller that looked at `valAccuracy` (overfit detection, winner selection, diagnose) was silently falling back to training accuracy. `trainBg` now runs a post-training evaluation on test samples and stores the real `val_accuracy`.
- **Baseline numbers dropped** as a result of the fix (iris: 0.967 → 0.800, breast-cancer: 0.969 → 0.947). Old numbers were training-set accuracy; new numbers are honest generalization. Baseline regenerated to v0.8.0.

### Refactors (no behavior change)
- `createRun` now takes a `CreateRunOpts` object (previously positional `ownerPid`). All in-tree callers updated.
- `Run.status` type gains `"cv_parent"`.
- `assignSplits` exported from `load_csv.ts` for testability.

### Tests
- +39 unit tests (hash, run-context, stratify, kfold). Total: **123 tests, < 150 ms**.
- Benchmark regenerated with v0.8.0 baselines; hash assertion validated.

---

## v0.7.0 — 2026-04-21

### Added — Phase 1 (test & benchmark foundation)
- **Seedable RNG** (`neuron/src/util/rng.ts`): mulberry32 with shuffle helper. When `load_csv` receives a `seed` param (or the `NEURON_SEED` env var is set), the stratified train/test split becomes fully reproducible. Fall-through to `Math.random` when unseeded.
- **`seed` param** on `load_csv`, `auto_train`, and `train` tools.
- **`NEURON_PLANNER=rules` env var**: forces the controller to skip the Claude planner and use only the deterministic `refineFromSignals` rules. Used by benchmarks and CI.
- **`NEURON_SWEEP_MODE=sequential` env var**: sweep runs via `startTrainBackground` sequentially, no Claude sub-agents. Combined with `NEURON_PLANNER=rules`, gives fully deterministic `auto_train` output.
- **Unit test suite** under `neuron/test/unit/` (85 tests, 2562 assertions, runs in < 40 ms):
  - `rng.test.ts` — determinism, shuffle invariants, seed resolution
  - `signals.test.ts` — convergence_epoch, still_improving, per_class_variance, severityForMetric
  - `rules.test.ts` — each refinement rule (A/B/C/D/E) + seed wave + fallback + regression branch
  - `patterns.test.ts` — fingerprint buckets, save→lookup round-trip, highest-metric wins
  - `verdict.test.ts` — scoreClassification with/without overfit penalty, scoreRegression, summary rendering
- **Benchmark harness** under `neuron/test/bench/`:
  - Datasets: iris, wine, breast-cancer, housing
  - `bun run bench` — full suite; `bun run bench:fast` — iris + wine only; `bun run bench:bless` — (re)write baseline
  - Deterministic: forces `NEURON_PLANNER=rules` + `NEURON_SWEEP_MODE=sequential` + seed=42
  - Regression guard: fails if accuracy drops > 2% (or R² drops > 0.03) vs committed `test/bench/results/baseline.json`
- **Package scripts**: `test`, `bench`, `bench:fast`, `bench:bless`, `ci` (typecheck + unit tests).
- **`bunfig.toml`** preload for unit tests — each worker gets a unique temp DB.

### Refactors (enable testability; no behavior change)
- `computeConvergenceEpoch`, `computeStillImproving`, `computePerClassVariance` are now exported from `signals.ts`.
- `scoreClassification` and `scoreRegression` moved from `controller.ts` → `verdict.ts`.
- `startTrainBackground` accepts `weightDecay` and `earlyStopPatience` params (plumb-through for deterministic benchmarks that want to exercise every lever).

---

## v0.6.2 — 2026-04-20

### Changed
- **rs-tensor MCP call timeout default raised from 30 min → 1 hour.** For the same reasons as v0.6.1 — Tier 3's `still_improving → 2× epochs` refinement on larger datasets regularly pushes into the 30–60 min range. Override via `RS_TENSOR_TIMEOUT_MS` env var.

---

## v0.6.1 — 2026-04-20

### Fixed
- **rs-tensor MCP call timeout raised from 10 min → 30 min.** Long trainings (large N, high epochs, or the Tier 3 "still_improving → 2× epochs" refinement) were being killed mid-loop by the MCP client's 600 s ceiling. Default is now 1 800 s (30 min), and a new `RS_TENSOR_TIMEOUT_MS` env var lets you override it for runs that need even longer (minimum 60 s). Applies to every rs-tensor call — `tensor_create`, `train_mlp`, `evaluate_mlp`, `tensor_inspect`.

---

## v0.6.0 — 2026-04-20

### Added (auto_train Tier 3 — capability expansion)
- **rs-tensor `train_mlp` gains two new optional args**: `weight_decay` (L2 regularizer, default 0) and `early_stop_patience` (stops training when loss has not improved for N consecutive epochs). The response now also carries `epochs_done` and `stopped_early` so the controller can surface whether the budget was fully used.
- **New hyperparameter levers in neuron**: `train` tool, `TrainHyperparams`, `SweepConfig`, and `RunSignals.config` all thread `weight_decay` and `early_stop_patience` end-to-end. The sweep orchestrator's sub-agent prompt forwards both to `mcp__neuron__train`.
- **Refinement rules use the new levers**:
  - Overfit rule (`overfit_gap > 0.15`) now also proposes a `weight_decay=0.01` variant in addition to the shallower-arch variant — proper regularization, not just capacity reduction.
  - "Still improving" rule now attaches `early_stop_patience ≈ 10% of epochs` to the 2× epoch variant as a safety net.
- **Multi-strategy tournament mode** (opt-in via `auto_train({ tournament: true })`): each wave runs 3 planners in parallel with different priors (`aggressive` / `conservative` / `exploratory`). Their configs are merged, deduplicated, and swept together. Trades cost for robustness on hard tasks. Default is single-planner (unchanged behavior).
- **Richer `auto_wave_*` events**: `auto_wave_started` now includes strategy and elapsed_s; `auto_wave_completed` adds `best_overall_run_id/metric`, `configs_tried`, `max_waves`, `elapsed_s`, `eta_s` (based on avg wave duration × remaining waves), `is_overfit`, and `target_reached`. Enables live progress + ETA in the dashboard without changing the SSE channel.

### Breaking
- **Users must run `ml-labs update`** (or `ml-labs build`) to rebuild the rs-tensor binary — older binaries will reject the new `weight_decay` and `early_stop_patience` parameters. The installer already runs `cargo build --release --bin mcp` via the `update` path.

---

## v0.5.0 — 2026-04-20

### Changed (major internal rewrite — public tool signature unchanged)
- **auto_train Tier 2: Controller + Planner architecture.** The monolithic 40-turn Claude coordinator (`core/auto/coordinator.ts`) is replaced by a deterministic TypeScript state machine (`core/auto/controller.ts`) that owns the budget, wave loop, winner selection, and all DB writes. Claude is now invoked only via a narrow per-wave **planner** (`core/auto/planner.ts`) whose single job is "given these signals, return JSON configs for the next wave."
  - Deterministic outcomes: two `auto_train` invocations on the same task now produce the same wave-2 grid when signals match.
  - Diagnosis, promotion, and publish are pure TS — no more prose-driven Claude reasoning about severity buckets.
  - Training is still parallel (reuses the existing `runSweep()` sub-agent orchestrator).

### Added
- **Signal aggregator** (`core/auto/signals.ts`): typed `SignalBundle` carrying data health, current-wave run signals (overfit_gap, still_improving, convergence_epoch, per_class_variance, severity), and target metric. Single source of truth for what the planner sees.
- **Pure-TS refinement rules** (`core/auto/rules.ts`): `refineFromSignals()` implements the Tier 1 rules (still_improving → 2× epochs, overfit_gap > 0.15 → shallower arch + fewer epochs, early convergence → finer lr, critical underfit → wider hidden, high per-class variance → class_weights=balanced). Used as the deterministic fallback when the planner is unavailable.
- **Claude planner** (`core/auto/planner.ts`): short `query()` call (maxTurns 2) with strict JSON output schema `{configs, rationale, rules_fired}`. On parse failure, falls through to rules.ts. Reads back recent decision_log entries for reflection.
- **Cross-task memory** (`core/auto/patterns.ts`, `auto_patterns` table): tasks are fingerprinted by `(kind, K, D-bucket, N-bucket, imbalance-bucket)`. Prior winning configs warm-start new runs for similar tasks.
- **Structured verdict** (`core/auto/verdict.ts`, new `auto_runs.verdict_json` column): `{status, winner: {run_id, metric_value, is_overfit, confidence, config}, attempted, data_issues, next_steps, summary}`. The one-line `verdict` string is kept for backward compat. `auto_train` return value now includes `verdict_json`.
- **New AutoRun status** `"no_improvement"`: distinct from `"failed"` and `"budget_exceeded"` — coordinator finished cleanly but didn't hit the target.
- **New events**: `auto_wave_started`, `auto_wave_completed` emit per wave for dashboard live updates.
- **class_weights threading through sweep**: `SweepConfig` now includes `class_weights`, and `runOneConfig()` forwards it to the `train` tool call.

### Removed
- `neuron/src/core/auto/coordinator.ts` and `neuron/src/core/auto/prompt.ts` — replaced by controller + planner. The `runCoordinator` export no longer exists; callers should use `runController` from `core/auto/controller.ts`.

---

## v0.4.2 — 2026-04-20

### Added
- **auto_train Tier 1 upgrade** — the coordinator is now signal-driven, regression-aware, overfit-aware, and budget-hard-capped. Same `auto_train` tool signature; richer decisions under the hood.
  - **Expanded tool allowlist** — coordinator now gets `inspect_data`, `get_training_curves`, `compare_runs`, `model_stats` in addition to the prior 11 tools.
  - **Structured refinement grid** — wave 2 is no longer a prose paragraph. Replaced with explicit signal-driven rules: `still_improving` → 2× epochs; `overfit_gap > 0.15` → fewer epochs + shallower arch; early convergence → finer LR; critical underfit → wider hidden layers; high per-class variance → add `class_weights="balanced"` variant. Reproducible across runs.
  - **Regression-aware procedure** — coordinator branches on `task.kind`. For regression, target is R² instead of accuracy, diagnosis uses R² buckets, classification-only tools (`suggest_samples`, class weighting) are skipped.
  - **Imbalance-aware suggest_hyperparams** — `suggest_hyperparams` accepts optional `data_health.imbalance_ratio`; when > 3, the sampling prompt and heuristic fallback flag `class_weights="balanced"`. Coordinator calls `inspect_data` first and threads the ratio in.
  - **Overfit-aware winner selection** — winner is chosen by val_accuracy when available; if `train - val > 0.15`, apply penalty `score = val_acc - 0.5 × (train - val)`. Prevents promoting overfit runs.
  - **Hard budget enforcement** — coordinator is now killed via `AbortSignal` at `budget_s × 1.1` seconds. New `AutoRun.status` value `"budget_exceeded"` recorded on overrun instead of silent overrun.

---

## v0.4.1 — 2026-04-20

### Fixed
- `imbalance_ratio` was computed in `inspect_data` but never included in the API response — now returned as `imbalance_ratio` (float, null for regression).
- `configPath` was hardcoded to `null` in `GET /api/config` even when a config was loaded — now returns the resolved filesystem path.
- `loadConfig()` global cache would serve stale config if the MCP server and HTTP API processes resolved different working directories — cache is now invalidated on cwd mismatch.
- `sweep_progress` events were never emitted during a sweep — each config completion now fires a `sweep_progress` event with `idx`, `total`, `accuracy`, and `status`.

### Added
- `POST /api/tasks/:id/suggest_samples` — HTTP endpoint wrapping the `suggest_samples` MCP tool so the dashboard can call active-learning analysis directly.
- `api.suggestSamples(taskId, opts?)` client helper in `dashboard/src/lib/api.ts`.

---

## v0.4.0 — 2026-04-20

### Added
- **rs-tensor stdio integration** — eliminates the Cloudflare tunnel and HTTP timeout issues. rs-tensor is now vendored as a git submodule (`rs-tensor/`) and built locally via `cargo build --release --bin mcp`. Neuron communicates with it over a long-lived stdio MCP connection (`StdioClientTransport`), avoiding all network overhead. `RS_TENSOR_MCP_URL` still works as an HTTP override for remote setups.
- **`ml-labs build`** command — manually rebuilds the rs-tensor binary after editing Rust source. `ml-labs update` now also runs an incremental cargo rebuild automatically.
- **Cargo prereq check** in `install.sh` — installer fails fast with a helpful message if `cargo` is not installed.
- **Dashboard server status** — sidebar "Servers" section now shows both `neuron` and `rs-tensor` pills. rs-tensor shows three states: `not built` (binary missing), `ready` (binary exists, idle), `online` (actively connected), plus `stdio`/`http` mode label.
- **Dashboard liveness (P0)** — the dashboard now shows live activity during training:
  - `ActivityFeed`: collapses consecutive `run_progress` rows by run ID, raises cap to 15 events, renders all event kinds with icons and colors.
  - `ActiveJobPill` in sidebar shows current stage + spinner during any training activity.
  - `ActiveRunCard` component: stage pill, featurize/eval progress bar, live elapsed ticker, hyperparams. Shown on Overview (LiveStrip) and TaskDetail (inline above runs table).
  - `RunsAll`: live elapsed ticker and pulsing "training…" dot for running runs.
  - `/activity` route: full paginated event log with kind/task/source filters.
- **Richer backend events**:
  - `run_stage` — unthrottled event on each stage transition (featurize → tensors → init → train → eval → weights).
  - `run_progress` — now includes `i`, `n` (sample count progress).
  - `run_completed` — now carries `numClasses`, `epochsDone`, `confusionMatrix` (≤10 classes).
  - `model_registered` — now emitted from both `register_model` tool and `trainBg` auto-promote.
  - `auto_started` / `auto_note` / `auto_completed` — full lifecycle events for `/neuron-auto` coordinator runs.
  - `tool_call` payloads enriched with `lr`, `epochs`, `accuracy_target`, `totalConfigs`, `path` for high-signal tools.

### Fixed
- `suggest_hyperparams` now loads `neuron.config.ts` and hard-pins `headArchitecture` — previously the user's custom architecture was silently ignored in both the sampling prompt and the heuristic fallback.
- Sweep orchestrator `maxTurns` raised from 8 → 20, preventing wave-2 sub-agent failures on tasks with many classes.
- Dashboard restart: port-free wait loop now always runs regardless of whether `lsof` found a PID, preventing a bind race on re-invoke.

---

## v0.3.0 — 2026-04-20

### Added
- **Terminal ↔ Dashboard bridge** — every MCP tool call and run lifecycle event is written to a shared `events` SQLite table, streamed to the browser via SSE (`GET /api/events`). Dashboard shows a live activity feed with click-through links and auto-refreshes React Query caches on `run_completed`/`sweep_completed`.
- **Toast notifications** — `run_completed`, `sweep_completed`, `model_registered` pop a 4s toast in the dashboard bottom-right corner.
- **`GET /api/config`** — exposes the project's `neuron.config.ts` (feature shape, default hyperparams, presence of `featurize`/`headArchitecture`/`decodeImage` functions). Dashboard shows a Config card on the Overview page.
- **Ask Claude channel** — floating "Ask Claude" button in the dashboard POSTs questions to `POST /api/requests`, writes to `data/requests.jsonl`. New `/neuron-ask` slash command reads the file and POST answers back via `POST /api/requests/:id/response`. Answers appear inline in the dashboard.
- **`/neuron-show` slash command** — navigates the browser to a task/run detail page, screenshots it, and describes what's visible (uses globally installed chrome-devtools MCP).
- **`neuron-ui` skill** — teaches Claude the dashboard route map and verification workflow.
- **`CLAUDE.md` template** — `ml-labs init` now writes `CLAUDE.md` to every new project with tool reference, slash command list, and dashboard conventions.
- **`events` DB table** — `id`, `ts`, `source` (mcp/api/tui/user), `kind`, `task_id`, `run_id`, `payload` JSON. Indexed by `ts DESC` and `(task_id, ts DESC)`.

### Fixed
- `NEURON_DB_PATH` and `NEURON_DB` env vars now both accepted in `schema.ts` — prevents MCP server and HTTP API pointing at different databases when launched by `ml-labs dashboard`.
- `bun run build` no longer fails due to `react-devtools-core` missing from ink's optional devtools shim (`--external react-devtools-core` added to build script).
- All e2e test files replaced hardcoded `/Users/yab/…` absolute paths with `import.meta.dir`-relative paths — tests now run from any install location.

---

## v0.2.0 — 2026-04-20

### Added
- **Cross-session predict** — weights restore lazily from SQLite into rs-tensor on first predict after server restart. No retraining needed.
- **`suggest_samples`** (tool #30) — active learning: batch-evaluates all samples in one rs-tensor call, returns per-class accuracy/confidence stats, surfaces uncertain and misclassified rows, emits data-collection recommendations.
- Coordinator prompt updated: if accuracy < target after all waves, coordinator calls `suggest_samples` and includes per-class recommendations in the verdict.
- `rsTensor.restoreMlp()` helper — calls `init_mlp`, then overwrites each weight tensor from the DB. Architecture inferred from weight shapes when not stored explicitly.
- Phase 5 e2e test: `neuron/test/e2e_phase5.ts` — kills and restarts the server between sessions to verify cross-session predict.

---

## v0.1.4 — 2026-04-19

### Added
- **`auto_train`** — spawns a Claude coordinator sub-agent (40 turns, 11-tool allowlist) that runs the full pipeline: preflight → suggest → sweep wave(s) → evaluate → diagnose → promote → optional publish. Returns verdict + decision log.
- **`get_auto_status`** — reads live decision log for an ongoing or completed auto_run, cross-process via SQLite WAL.
- **`log_auto_note`** (internal) — coordinator writes timestamped decision log entries to `auto_runs.decision_log`.
- `run_sweep` gains `wave_size` parameter — stages configs into sequential batches. Existing callers unaffected.
- `auto_runs` table — tracks coordinator invocations with decision_log (JSON array), status, waves_used, winner_run_id, verdict.
- `/neuron-auto <task_id>` slash command.
- Tool count: 28 (27 user-facing + 1 internal).

---

## v0.1.3 — 2026-04-19

### Added
- **`run_sweep`** — parallel hyperparam grid search via Claude Agent SDK sub-agents. `concurrency` controls parallelism; `promote_winner` auto-promotes the best run.
- **`publish_model`** — writes bundle to `~/.neuron/registry/` (weights + metadata + adapter hash).
- **`import_model`** — pulls from registry, creates task + synthetic run with `status='imported'`.
- **`list_registry`** — lists `~/.neuron/registry.db` entries, filterable by kind/tag.
- **`load_model`** — loads registry weights into an existing task without retraining.
- Claude Code skills and slash commands under `.claude/` (8 commands + SKILL.md).
- DB: WAL mode, `runs.run_progress`, `runs.owner_pid`, `runs.source_uri`.
- Tool count: 25.

---

## v0.1.2 — 2026-04-19

### Added
- **Ink TUI** — 5-screen terminal dashboard: Dashboard, Dataset, Train, Runs, Predict.
- **`load_csv`** / **`load_json`** / **`load_images`** — batch data loaders.
- **`get_run_status`** — live training progress, cross-process via DB.
- **`list_tasks`** — tasks with sample counts, accuracy, active run.
- Iris classifier demo verified at 98.7% accuracy.
- Tool count: 20.

---

## v0.1.1 — 2026-04-19

### Added
- 16-tool MCP server, SQLite persistence (tasks/samples/runs/models), adapter pattern (`neuron.config.ts`), rs-tensor integration.
- XOR verified at 100%.
- Tool count: 16.

---

## v0.1.0 — 2026-04-19

### Added
- Initial project scaffolding.
- rs-tensor MCP server wired via `.mcp.json`.
