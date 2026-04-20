---
description: Evaluate and diagnose the latest run for a Neuron task
argument-hint: <task_id>
allowed-tools: mcp__neuron__list_runs, mcp__neuron__evaluate, mcp__neuron__diagnose
---

Diagnose the latest completed run for task "$1".

1. Call `mcp__neuron__list_runs` with `task_id="$1"`, `limit=1`.
2. If a completed run exists, call `mcp__neuron__evaluate` with `run_id=<id>` to get full metrics.
3. Call `mcp__neuron__diagnose` with `run_id=<id>` for a structured diagnostic.
4. Present: overall accuracy, per-class breakdown, confusion matrix summary, and the diagnostic recommendations.
5. Suggest next steps (more data for weak classes, different architecture, etc.).
