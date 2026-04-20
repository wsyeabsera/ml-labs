---
name: neuron
description: Use when the user wants to train, evaluate, sweep, or reuse a small ML classifier on tabular or image data locally. Also use when the user says "train a good model", "figure out the hyperparams", or "just make it work" — delegate to mcp__neuron__auto_train. Covers task creation, data loading (CSV/JSON/images), hyperparameter sweeps, run evaluation, automated pipelines, and cross-project model sharing via registry.
---

# Neuron — Local ML Platform

Neuron is a Claude-native MCP server for training and serving small ML classifiers. All operations go through `mcp__neuron__*` tools against a local SQLite DB (`data/neuron.db`). No web stack, no cloud — models live on disk.

## When to reach for Neuron

- User wants to train a classifier on CSV/JSON/image data
- User wants to iterate on hyperparameters or run a sweep
- User wants to share a trained model with another project
- User wants to evaluate or diagnose a previous run

## Workflow at a glance

```
1. create_task          → define task id, kind=classification, feature_shape
2. load_csv / load_json / load_images → batch-ingest samples
3. preflight_check      → validate readiness (min samples, class balance)
4. train OR run_sweep   → single run or parallel grid search
5. evaluate + diagnose  → full metrics + recommendations
6. predict              → single-sample inference
7. publish_model        → push to ~/.neuron/registry/ for cross-project use
```

## All tools (30 total)

### Task management
- `create_task` `{id, kind, feature_shape, sample_shape?}` — create or reset a task
- `reset_task` `{task_id, confirm, delete_task?}` — clear samples/runs or delete entirely
- `list_tasks` — list all tasks with sample counts, accuracy, active run

### Data ingestion
- `collect` `{task_id, label, features?, raw?}` — add one sample
- `load_csv` `{task_id, path, label_column, feature_columns?}` — batch CSV import
- `load_json` `{task_id, path}` — batch JSON array import (`[{features,label}]`)
- `load_images` `{task_id, dir}` — walk `dir/{label}/*.{jpg,png}`, decode, collect
- `list_samples` `{task_id, limit?, offset?}` — paginated sample list with counts
- `delete_sample` `{sample_id}` — remove one sample

### Automated pipeline
- `auto_train` `{task_id, accuracy_target?, max_waves?, budget_s?, promote?, publish_name?}` — full pipeline: coordinator sub-agent runs preflight → suggest → sweep waves → evaluate → suggest_samples (if needed) → promote. Returns verdict + decision log.
- `get_auto_status` `{auto_run_id? | task_id?}` — live decision log for an ongoing auto_train
- `suggest_samples` `{task_id, n_suggestions?, confidence_threshold?}` — active learning: batch-evaluates all samples, surfaces uncertain/misclassified examples, returns per-class accuracy stats and data collection recommendations

### Training
- `preflight_check` `{task_id}` — validate before training
- `suggest_hyperparams` `{task_id}` — recommended lr, epochs, head_arch
- `train` `{task_id, lr?, epochs?, head_arch?, run_id?, auto_register?}` — train one run
- `cancel_training` `{task_id}` — abort in-flight run
- `run_sweep` `{task_id, configs? | search?, concurrency?, promote_winner?, wave_size?}` — parallel grid sweep; wave_size stages configs into sequential batches

### Run inspection
- `list_runs` `{task_id, limit?, offset?}` — run history
- `get_run_status` `{run_id}` — live progress during training
- `evaluate` `{run_id}` — full metrics (confusion matrix, per-class accuracy, loss history)
- `diagnose` `{run_id}` — structured diagnostic + recommendations
- `compare_runs` `{run_ids}` — side-by-side accuracy/hyperparams comparison

### Model management
- `register_model` `{task_id, run_id}` — promote run to active model
- `export_model` `{task_id}` — export weights as portable JSON
- `publish_model` `{run_id, name, version?}` — push to local registry
- `import_model` `{uri, task_id?}` — pull from registry, create task + weights
- `load_model` `{task_id, uri, force?}` — load registry weights into existing task
- `list_registry` `{kind?, tag?}` — list models in ~/.neuron/registry/

### Inference
- `predict` `{task_id, features}` — single-sample prediction with confidence scores

## Auto-train example (recommended for new workflows)

```
auto_train({
  task_id: "iris",
  accuracy_target: 0.95,
  max_waves: 2,
  budget_s: 120,
})
```
The coordinator sub-agent handles everything: preflight → suggest → 2–3 configs wave 1 → evaluate → refine → promote. Monitor live with `get_auto_status({task_id: "iris"})`.

## Sweep example

```
run_sweep({
  task_id: "iris",
  search: { lr: [0.01, 0.05, 0.1], epochs: [500, 1000] },
  concurrency: 3,
  promote_winner: true
})
```
Returns 6 parallel runs, auto-promotes winner. Wall clock ≈ time of single run.

## Registry URIs

Format: `neuron://local/<name>@<version>` (e.g. `neuron://local/iris-classifier@2026-04-19`)

Adapter hash guards against loading a model trained with a different `neuron.config.ts` `featurize`. Use `force=true` to override.

## Slash commands (available in this project)

- `/neuron-status` — show all tasks
- `/neuron-train <task_id>` — train with suggested hyperparams
- `/neuron-sweep <task_id>` — grid sweep with default axes
- `/neuron-load <task_id> <path>` — auto-detect and load data
- `/neuron-diagnose <task_id>` — evaluate + diagnose latest run
- `/neuron-publish <run_id> <name>` — publish to registry
- `/neuron-import [uri]` — import from registry
- `/neuron-auto <task_id>` — run full auto_train pipeline with coordinator sub-agent
