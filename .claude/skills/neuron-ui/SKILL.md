---
name: neuron-ui
description: Drive and verify the ML-Labs dashboard in Chrome via chrome-devtools MCP tools
---

# Neuron UI Skill

Use `mcp__chrome-devtools__*` tools to navigate, verify, and operate the ML-Labs dashboard.

## Dashboard URLs

- Dev server (Vite):  `http://localhost:5274`
- Prod (API-served):  `http://localhost:2626`

Use `:5274` if the dev server is running, `:2626` otherwise.

## Route map

| Route | Purpose |
|---|---|
| `/` | Overview — task grid + config card |
| `/tasks/:id` | Task detail — samples, runs, inspect |
| `/tasks/:id/runs/:runId` | Run detail — metrics, confusion matrix, loss curve |
| `/tasks/:id/compare` | Side-by-side run comparison |
| `/runs` | All runs across tasks |
| `/train` | Train panel — launch training + live progress |
| `/predict` | Predict — single or batch CSV |
| `/sweep` | Hyperparameter sweep |
| `/upload` | Dataset upload wizard |

## Verification workflow

After `mcp__neuron__train` completes, verify the result in the browser:

1. `mcp__chrome-devtools__navigate_page` → `http://localhost:5274/tasks/<task_id>/runs/<run_id>`
2. `mcp__chrome-devtools__take_screenshot` → inspect visually
3. Report: accuracy badge visible, loss curve rendered, confusion matrix present

## Useful operations

- **Open a task**: navigate to `/tasks/<task_id>`
- **Check run status**: navigate to `/tasks/<task_id>/runs/<run_id>`, screenshot
- **Trigger upload in browser**: navigate to `/upload`, use `fill` / `click` to interact
- **Read activity feed**: `evaluate_script` → `document.querySelector('.activity-feed')?.innerText`

## Trigger phrases

> "show me the run", "open the task in the dashboard", "verify the UI rendered",
> "screenshot the results", "navigate to the run page", "check the dashboard"
