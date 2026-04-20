---
description: Run a parallel hyperparameter sweep for a Neuron task
argument-hint: <task_id> [concurrency]
allowed-tools: mcp__neuron__run_sweep, mcp__neuron__list_runs, mcp__neuron__list_tasks
---

Run a hyperparameter sweep for task "$1".

Call `mcp__neuron__run_sweep` with:
- `task_id="$1"`
- `search={"lr":[0.001,0.01,0.05],"epochs":[500,1000]}`
- `concurrency=$2` (default 3 if not provided)
- `promote_winner=true`

Report the results table (config → accuracy), the winner run_id, and overall wall-clock time.
