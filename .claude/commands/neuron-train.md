---
description: Train a Neuron model for a task with auto-suggested hyperparams
argument-hint: <task_id> [lr] [epochs]
allowed-tools: mcp__neuron__suggest_hyperparams, mcp__neuron__train, mcp__neuron__get_run_status, mcp__neuron__list_runs
---

Train a Neuron model for task "$1".

1. Call `mcp__neuron__suggest_hyperparams` with `task_id="$1"` to get recommended lr, epochs, and head_arch. Override with the user-supplied values if provided: lr=$2 epochs=$3.
2. Call `mcp__neuron__train` with `task_id="$1"` and the chosen hyperparams.
3. Poll `mcp__neuron__get_run_status` every 2 seconds until `status` is no longer `"running"`.
4. Report final accuracy and whether the model was auto-registered.
