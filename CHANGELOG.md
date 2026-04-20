# Changelog

All notable changes to ML-Labs are documented here.

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
