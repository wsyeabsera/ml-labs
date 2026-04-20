---
description: Load a dataset into a Neuron task from a file or directory
argument-hint: <task_id> <path>
allowed-tools: mcp__neuron__load_csv, mcp__neuron__load_json, mcp__neuron__load_images, mcp__neuron__list_samples
---

Load data into task "$1" from path "$2".

Auto-detect format from the path:
- If `$2` ends in `.csv` → call `mcp__neuron__load_csv` with `task_id="$1"`, `path="$2"`. Ask the user for `label_column` and `feature_columns` if not obvious from the file.
- If `$2` ends in `.json` → call `mcp__neuron__load_json` with `task_id="$1"`, `path="$2"`.
- If `$2` is a directory → call `mcp__neuron__load_images` with `task_id="$1"`, `dir="$2"`.

After loading, call `mcp__neuron__list_samples` and report insert count, skipped count, and per-label distribution.
