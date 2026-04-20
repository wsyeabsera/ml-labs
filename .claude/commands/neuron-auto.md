---
description: Auto-train a model for <task_id> — preflight, sweep, diagnose, promote
argument-hint: <task_id> [accuracy_target] [budget_s]
allowed-tools: mcp__neuron__auto_train, mcp__neuron__get_auto_status
---

Call mcp__neuron__auto_train with task_id="$1", accuracy_target=${2:-0.9}, budget_s=${3:-180}.

While it runs (auto_train blocks until the coordinator finishes), show the user what's happening.
When it returns, report: status, final accuracy, waves_used, verdict, and the decision_log summary.

If auto_train returns status="data_issue", explain the preflight failure from verdict and suggest fixes.
If status="failed", surface the error and suggest running /neuron-status to inspect the task.
