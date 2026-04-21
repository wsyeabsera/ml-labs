---
name: neuron
description: Use when the user wants to train, evaluate, sweep, label, serve, or reason about small ML models locally — tabular classification/regression on top of an MLP head, plus small-LLM inference from GGUF. Also use for "train a good model", "figure out the hyperparams", or "just make it work" — delegate to mcp__neuron__auto_train. Covers task creation, data loading (CSV/JSON/images), hyperparameter sweeps, cross-validation, calibration, diagnosis, drift detection, active-learning labeling, shadow-model validation, model registry, and LLaMA GGUF inference.
---

# Neuron — Claude-native ML Platform

All operations go through `mcp__neuron__*` tools backed by a local SQLite DB (`data/neuron.db`) and a Rust inference core (rs-tensor). No cloud.

## When to reach for Neuron

- Train a classifier / regressor on CSV / JSON / image data
- Iterate on hyperparams, sweep, cross-validate, calibrate
- Diagnose why a model underperforms (overfitting, class imbalance, underfit)
- Close the loop: suggest uncertain samples → label them → retrain
- Serve a trained model and watch for drift
- Run small-LLM inference (text generation from a GGUF)

## Default workflow

```
1. create_task               → define id, kind, feature_shape
2. load_csv / load_json / load_images → ingest samples
3. auto_train                → the one-shot "make it work" pipeline
   (internally: preflight → seed → sweep waves → diagnose → calibrate → promote)
4. predict / batch_predict   → inference
5. (optional) publish_model  → push to registry for cross-project use
```

For hands-on control, swap step 3 for `suggest_hyperparams` + `train` + `diagnose`.

## Tool inventory (42 tools)

### Task + data

| Tool | Purpose |
|---|---|
| `create_task` | Create task with `{id, kind, feature_shape, sample_shape?}` |
| `reset_task` | Clear samples/runs or delete entirely (`confirm` required) |
| `list_tasks` | All tasks with counts, accuracy, active run |
| `collect` | Add one sample |
| `load_csv` / `load_json` / `load_images` | Batch ingest |
| `list_samples` / `delete_sample` | Sample management |
| `inspect_data` | Class balance + feature stats + scale warnings |

### Auto-train (recommended entry point)

| Tool | Purpose |
|---|---|
| `auto_train` | Full pipeline — `{task_id, accuracy_target?, max_waves?, budget_s?, tournament?, seed?, auto_collect?, max_collect_rounds?, promote?, publish_name?}`. Produces a rich `decision_log` with rule explanations, winner reasoning, and structured verdict. |
| `get_auto_status` | Live decision log poll (`task_id` or `auto_run_id`) |
| `cancel_auto_train` | Abort a running coordinator (`task_id` or `auto_run_id`). Reaps in-flight child runs. |
| `log_auto_note` | Append a note to the current coordinator's decision log (used by sub-agents) |
| `auto_preflight` | Meta-tool: data_audit + suggest_hyperparams + seed config in one call |
| `data_audit` | Meta-tool: inspect_data + preflight_check + class summary |

### Single training

| Tool | Purpose |
|---|---|
| `preflight_check` | Validate readiness before training |
| `suggest_hyperparams` | Recommended lr / epochs / head_arch |
| `train` | Train one run. Supports `optimizer` (sgd/adam/adamw), `lr_schedule` (constant/cosine/linear_warmup), `batch_size`, `weight_decay`, `grad_clip`, `early_stop_patience`, `swa`, `label_smoothing`, `activation` (tanh/relu/gelu/leaky_relu), `loss` (mse/cross_entropy) |
| `cancel_training` | Abort in-flight run. Pass `force: true` to transition a zombie DB row. |
| `run_sweep` | Parallel grid sweep. `wave_size` stages configs into sequential batches. |
| `cv_train` | K-fold cross-validation — `{task_id, k, hyperparams?}`. Stores each fold as its own run with `cv_fold_id` / `cv_parent_id`. |

### Run inspection

| Tool | Purpose |
|---|---|
| `list_runs` | Run history |
| `get_run_status` | Live progress (epochs done, loss history, stage) |
| `evaluate` | Full metrics (confusion matrix, per-class, loss history) |
| `diagnose` | Structured `{primary_cause, evidence, recommendations}` |
| `compare_runs` | Side-by-side for N runs |
| `get_training_curves` | `{convergenceEpoch, still_improving, overfit_gap}` |
| `model_stats` | Parameter count, architecture shape, per-layer sizes |

### Active learning

| Tool | Purpose |
|---|---|
| `suggest_samples` | Hybrid uncertainty + diversity ranking (entropy + k-center coreset). Used by the Labeling UI. |

### Inference

| Tool | Purpose |
|---|---|
| `predict` | Single-sample inference. Returns `{label, confidence, scores, calibrated}` or `{value}`. |
| `batch_predict` | Background CSV batch (up to 5000 rows). Returns `{batchId, total}` immediately; progress streams via events; view in dashboard. Each row is logged to the `predictions` table so drift detection sees batch traffic. |

### Calibration

| Tool | Purpose |
|---|---|
| `calibrate` | Temperature scaling on held-out logits. `auto_train` calls this automatically on promoted classification winners. |

### Production / serving

| Tool | Purpose |
|---|---|
| `register_model` | Promote a run to active model |
| `publish_model` | Push to registry: `neuron://local/<name>@<version>` |
| `import_model` / `load_model` | Pull from registry |
| `list_registry` | All published bundles |
| `export_model` | Portable JSON weights |
| `drift_check` | PSI + KS per-feature drift vs training distribution. Emits `drift_detected` events (dashboard banner auto-appears). |

### LLM inference (Phase 11A)

| Tool | Purpose |
|---|---|
| `llm_load` | `{path}` — load a GGUF into memory (replaces any previous). One model at a time. |
| `llm_generate` | `{prompt? \| token_ids?, max_tokens, temperature}`. Returns `{text, token_ids, elapsed_ms, tokens_per_sec}`. **Tokenizer is naive whitespace** — unknown words silently skipped. For real text, pre-tokenize externally and pass `token_ids`. |
| `llm_inspect` | Config + vocab sample + param count |

**Scope limits for LLM**: CPU-only (5-10 tok/s on 1B), no embedding extraction, no fine-tuning. Use for pipeline testing, not chat apps.

## Signature moves

### `auto_train` is the best starting point

```
auto_train({ task_id: "iris", accuracy_target: 0.95, budget_s: 120 })
```

It runs preflight → seed wave (2 SGD+tanh + 1 AdamW+ReLU+CE modern variant) → refinement waves (rules engine + optional Claude planner + TPE after wave 3) → diagnose on weak waves → calibrate winner → register. Every decision lands in `decision_log` with a plain-language `title` + `why` + numeric `evidence`. Call `get_auto_status` to watch live, or open `/auto/:id` in the dashboard to see why-cards per decision.

Flags worth knowing:
- `tournament: true` — 3 parallel planner strategies (aggressive / conservative / exploratory), merged
- `auto_collect: true` — after training, invokes `neuron.config.ts` `collect()` callback on uncertain samples and loops
- `seed: <N>` — deterministic output (plus `NEURON_PLANNER=rules` for full determinism)

### Closing the active-learning loop

```
auto_train → suggest_samples → /tasks/<id>/label (UI) → POST /api/tasks/<id>/samples → auto_train again
```

The Labeling UI is at `/tasks/<id>/label`. Keyboard shortcuts: digits pick a class, Enter accepts the model's prediction, S skips, R refreshes the queue.

### Shadow-model validation (HTTP-only, not an MCP tool yet)

```
POST /api/tasks/<id>/shadow {run_id}   # attach a run as shadow
GET  /api/tasks/<id>/shadow            # agreement rate over last 500 predicts
POST /api/tasks/<id>/shadow/promote    # atomic registerModel + detach
```

Primary + shadow run sequentially on every `predict`. Primary output is returned; shadow is logged. Useful for validating a new run before promoting.

### Cancellation

- MCP tool call hung? `cancel_auto_train({ task_id })` aborts the coordinator and reaps in-flight child runs.
- Zombie run row stuck at `running` after a crash? `cancel_training({ run_id, force: true })` force-transitions it.
- Startup reaper runs on every server boot — rows older than 30 min in `running` / `pending` get marked `failed`.

## Registry URIs

`neuron://local/<name>@<version>` — e.g. `neuron://local/iris-classifier@2026-04-19`. Adapter hash guards against loading weights trained with a different `neuron.config.ts` `featurize`. `force=true` overrides.

## Slash commands available in this project

- `/neuron-auto <task>` — `auto_train` pipeline
- `/neuron-status` — table of all tasks
- `/neuron-train <task>` — suggest + train + poll
- `/neuron-load <task> <path>` — auto-detect CSV/JSON/image format
- `/neuron-sweep <task>` — grid sweep with default axes
- `/neuron-diagnose <task>` — evaluate + diagnose latest
- `/neuron-publish <run> <name>` — push to registry
- `/neuron-import [uri]` — pull from registry
- `/neuron-show <task> [run]` — navigate browser + screenshot (needs chrome-devtools MCP)
- `/neuron-ask` — read `data/requests.jsonl` and answer pending browser questions

## Dashboard bridge

Runs at `:5274` (dev) or `:2626` (prod). Every MCP tool call + run lifecycle event + drift + auto-cancel surfaces on `GET /api/events` (SSE). Browser "Ask Claude" writes to `data/requests.jsonl` — `/neuron-ask` processes queued questions.

## Hard-earned rules

- **Don't manually cancel training by killing processes.** Use `cancel_auto_train` / `cancel_training` tools; they coordinate DB state and child-run reaping.
- **Don't edit `data/neuron.db` by hand.** Schema changes are auto-migrated on server boot; direct edits risk inconsistency.
- **Imbalance + small datasets**: `auto_train`'s seed wave already tries `class_weights="balanced"` when `imbalance_ratio > 3`. If you're still stuck, `suggest_samples` + labeling loop is usually faster than knob-twisting.
- **Calibration matters for confidence**, not for argmax accuracy. A `calibrated=true` prediction's confidence is trustworthy; without it, neural-network softmax over-confidence is the norm.
- **Drift is a leading indicator, not an alarm.** PSI > 0.25 on ≥20% of features is where retraining becomes defensible; below that, wait for more evidence.
