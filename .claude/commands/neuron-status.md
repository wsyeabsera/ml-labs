---
description: Show all Neuron tasks with sample counts, training status, and accuracy
allowed-tools: mcp__neuron__list_tasks, mcp__neuron__list_runs
---

Show the current state of all Neuron tasks.

1. Call `mcp__neuron__list_tasks` (no arguments).
2. For any task with `active_run_id` set, call `mcp__neuron__get_run_status` to show live training progress.
3. Present results as a formatted table: Task ID | Kind | Samples | Trained | Accuracy | Active Run.
