---
name: neuron-ui
description: Drive, verify, and operate the ML-Labs dashboard in Chrome via mcp__chrome-devtools__* tools. Use when the user says "show me X in the dashboard", "verify the UI rendered", "screenshot the run", "open the playground", "open the labeling UI", or after any training/predict/auto-train to confirm the result landed.
---

# Neuron-UI Skill

Navigate, verify, and operate the ML-Labs dashboard via `mcp__chrome-devtools__*`.

## Chrome-DevTools MCP — one-instance limit

Only one chrome-devtools MCP process can hold the CDP connection at a time. If tools fail with a connection error or return no pages, another Claude session (or a stale background process) is likely holding it.

```bash
pkill -f "mcp-server-puppeteer|chrome-devtools|@modelcontextprotocol/server-chrome" 2>/dev/null; sleep 0.5
```

Then retry. If other Claude sessions are open, they should close or restart those first.

## Dashboard URLs

- Dev (Vite):  `http://localhost:5274`
- Prod (API):  `http://localhost:2626`

Use `:5274` if the dev server is running, `:2626` otherwise.

## Route map

| Route | Purpose |
|---|---|
| `/` | Overview — task grid, drift banners per task, live-run strip |
| `/tasks/:id` | Task detail — drift banner, shadow card, batch-predict history, samples, runs, inspect |
| `/tasks/:id/runs/:runId` | Run detail — loss curve + val overlay, confusion drill-through, per-class bars, grouped training config, run context (SHAs / seed / dataset hash) |
| `/tasks/:id/compare` | N-run compare (up to 6) — loss overlays, metrics table, winner star |
| `/tasks/:id/label` | **Labeling UI (Phase 11A)** — one uncertain sample at a time, digit shortcuts, retrain banner at ≥10 labels |
| `/runs` | All runs across tasks — compare checkboxes (≥2 → floating Compare button) |
| `/train` | Train panel — launch + live ActiveRunCard (loss sparkline + ETA) |
| `/predict` | Predict — single form + Batch (live progress card) |
| `/sweep` | Hyperparameter sweep — leaderboard, launch/cancel |
| `/upload` | Dataset upload wizard |
| `/drift` | Drift report — per-task PSI/KS cards |
| `/activity` | Full activity feed, filterable by kind |
| `/auto` | All auto-runs list |
| `/auto/:id` | Auto-run detail — **decision_log timeline with expandable "why" cards**, verdict_json breakdown (data_issues, next_steps, winner reasoning with runners-up) |
| `/playground` | **LLM Playground (Phase 11A)** — load a GGUF, inspect config, generate with max_tokens + temperature sliders |

## Verification workflow

After `mcp__neuron__train` or `auto_train` completes:

1. `mcp__chrome-devtools__navigate_page` → `http://localhost:5274/tasks/<task_id>/runs/<run_id>`
2. `mcp__chrome-devtools__take_screenshot` → inspect visually
3. Report: accuracy badge, loss curve, confusion matrix, training config card, run context card

For an `auto_train` result, prefer `/auto/<auto_run_id>` — the timeline tells the whole story of why the pipeline picked what it did.

## Targeted verification snippets

- **Drift banner rendered?** Navigate to `/` and check for the warning/danger styled card above the task grid.
- **Shadow comparing?** Navigate to `/tasks/<id>` — the Shadow card shows primary acc, shadow acc, agreement %.
- **Batch running?** Navigate to `/predict`, select task, look for the BatchPredictLiveCard with a progress bar and tok/s-style throughput.
- **Labeling queue has candidates?** Navigate to `/tasks/<id>/label`. If "No uncertain samples" appears, the model is too confident — surface more data or retrain.
- **LLM generation worked?** Navigate to `/playground`, confirm the Model card shows "● loaded" and the Generate card displays tok/s + elapsed after a generate.
- **Why did auto_train pick X?** Navigate to `/auto/<auto_run_id>`. `winner_selection` auto-expands; click "why" on any entry to see rule explanations + evidence.

## Useful one-liner operations

- **Current activity feed**: `evaluate_script` → `Array.from(document.querySelectorAll('.activity-feed [data-kind]')).slice(-5).map(e => e.textContent)`
- **Is a batch running?**: `evaluate_script` checks for elements with class `border-[var(--accent-border)]` under `/predict`.
- **Banner visible?**: `take_snapshot` and look for "Drift detected" or "Severe drift".

## Trigger phrases

> "show me the run", "open the task in the dashboard", "verify the UI", "screenshot the result", "check the dashboard", "navigate to …", "open the playground", "let me label some samples", "show me why auto_train picked that"
