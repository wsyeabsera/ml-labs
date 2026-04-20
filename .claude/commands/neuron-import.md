---
description: Import a model from the Neuron registry into the current project
argument-hint: [uri]
allowed-tools: mcp__neuron__list_registry, mcp__neuron__import_model, mcp__neuron__list_tasks
---

Import a model from the local Neuron registry.

If no URI is provided ($ARGUMENTS is empty):
1. Call `mcp__neuron__list_registry` to show available models.
2. Ask the user which URI they want to import.

Once a URI is identified, call `mcp__neuron__import_model` with:
- `uri="$ARGUMENTS"` (or the user-chosen URI)
- `task_id` omitted (auto-creates a task from the bundle's shape)

If the import fails due to an adapter-hash mismatch, explain the risk and ask whether to retry with `force=true`.

Report the created/updated task_id, run_id, and accuracy.
