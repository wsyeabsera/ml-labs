# {{PROJECT_NAME}} — ML-Labs project

## Quick reference

- **Dashboard**: http://localhost:5274 · run `ml-labs dashboard` to start
- **Config**: `neuron.config.ts` — edit `defaultHyperparams`, `headArchitecture`, `featurize`, `collect`
- **Data**: `data/neuron.db` (SQLite WAL) — never edit by hand; use MCP tools

## Conventions

- After `mcp__neuron__train` or `/neuron-auto`, run `/neuron-show <task>` to verify in the dashboard.
- If the user says "the dashboard shows X" or "I see Y in the UI", check pending browser questions first: `/neuron-ask`.
- Never edit `data/` directly. All mutations go through `mcp__neuron__*` tools.
- Use `/neuron-status` to see all tasks + current accuracy before suggesting next steps.
- If `auto_train` hangs or the user interrupts, use `mcp__neuron__cancel_auto_train({task_id})` — it aborts the coordinator cleanly and reaps in-flight child runs.

## Signature tools

| Tool | When to reach for it |
|---|---|
| `create_task` | First time only — one per project |
| `load_csv` / `load_json` / `load_images` | Ingest data |
| `auto_train` | The default "make it work" pipeline (preflight → sweep waves → diagnose → calibrate → promote). Decisions are explained in `decision_log` with rule titles + evidence. |
| `get_auto_status` | Poll a running auto_train |
| `cancel_auto_train` | Stop a hung coordinator |
| `train` | Single run with explicit hyperparams (optimizer / lr_schedule / weight_decay / swa / label_smoothing / activation / loss) |
| `cv_train` | K-fold cross-validation with honest ± std |
| `suggest_samples` | Active learning — find the rows the model is most uncertain about |
| `inspect_data` / `data_audit` | Check dataset health before training |
| `calibrate` | Temperature-scale a trained classifier (auto_train does this for you on winners) |
| `drift_check` | PSI + KS drift vs training distribution; emits drift_detected events |
| `predict` / `batch_predict` | Inference. `batch_predict` runs in the background, shows live progress in the dashboard, and logs rows for drift detection. |
| `publish_model` / `import_model` | Cross-project model sharing via `neuron://local/<name>@<version>` |
| `llm_load` / `llm_generate` / `llm_inspect` | Small-LLM inference from a GGUF file (Phase 11A). CPU-only, tokenizer is naive whitespace. |

See `.claude/skills/neuron/SKILL.md` for the full tool inventory (42 tools).

## Slash commands

| Command | Purpose |
|---|---|
| `/neuron-auto <task>` | Full auto-train pipeline |
| `/neuron-train <task>` | Suggest + train + poll |
| `/neuron-status` | Table of all tasks |
| `/neuron-show <task> [run]` | Open dashboard + screenshot |
| `/neuron-ask` | Answer pending browser questions from `data/requests.jsonl` |
| `/neuron-load <task> <file>` | Auto-detect and load CSV / JSON / images |
| `/neuron-sweep <task>` | Hyperparameter sweep |
| `/neuron-diagnose <task>` | Post-run analysis |
| `/neuron-publish <run> <name>` | Publish to registry |
| `/neuron-import [uri]` | Import from registry |

## Dashboard routes worth knowing

- `/` — task grid with per-task drift banners and live-run strip
- `/auto/:id` — auto-run timeline with **"why" cards** explaining every decision (rule explanations, winner reasoning, runners-up)
- `/tasks/:id` — task detail with drift banner, shadow card, batch-predict history, Label button
- `/tasks/:id/label` — active-learning labeling UI with keyboard shortcuts (digits = class, Enter = accept prediction, S = skip, R = refresh)
- `/playground` — GGUF loader + text generation playground
- `/drift` — per-task drift report

## Before heavy training — check the memory budget

`load_csv`, `inspect_data`, and `data_audit` return a `training_budget` object with `level: safe | advisory | heavy | refuse`. If it's `heavy` or `refuse`, stop before calling `auto_train` and tell the user what the estimated peak memory and wall-clock will be. Follow the `advice` array (usually: subset, reduce feature dim, or accept the wait). `auto_train` hard-refuses at `refuse` unless `force: true` — don't bypass that casually; it's calibrated to numbers that have crashed 8GB machines in testing.

## When things go wrong

- **Auto_train won't stop** → `mcp__neuron__cancel_auto_train({task_id: "..."})`
- **DB shows a zombie `running` run after a crash** → `mcp__neuron__cancel_training({run_id, force: true})`, or just restart the MCP server — the startup reaper clears stale rows.
- **Predictions feel off** → `mcp__neuron__drift_check({task_id})`. If ≥20% of features drift, `/neuron-auto` retrain on fresh data.
- **Model is overconfident** → calibration probably didn't run. Re-run `mcp__neuron__calibrate({run_id})` and confirm `predict` returns `calibrated: true`.
- **"Refusing to start auto_train" error** → the dataset is too big for CPU-only MLP. Read the printed options (subset, reduce dimensionality, force) and talk to the user before overriding.
