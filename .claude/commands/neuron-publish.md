---
description: Publish a trained Neuron model to the local registry for cross-project reuse
argument-hint: <run_id> <name> [version]
allowed-tools: mcp__neuron__publish_model, mcp__neuron__list_registry
---

Publish run $1 to the local Neuron registry.

Call `mcp__neuron__publish_model` with:
- `run_id=$1`
- `name="$2"`
- `version="$3"` (default: today's date if not provided)

Report the resulting URI (e.g. `neuron://local/$2@$3`), bundle path, and adapter hash.
Remind the user to share the URI with other projects that want to import this model.
