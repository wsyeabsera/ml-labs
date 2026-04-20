# {{PROJECT_NAME}} — ML-Labs project

## Quick reference

- **Dashboard**: http://localhost:5274 · run `ml-labs dashboard` to start
- **Config**: `neuron.config.ts` — edit `defaultHyperparams`, `headArchitecture`, `featurize`
- **Data**: `data/neuron.db` (SQLite WAL) — never edit by hand, use MCP tools

## Conventions

- After `mcp__neuron__train` or `/neuron-auto`, run `/neuron-show <task>` to verify the result rendered in the dashboard.
- If the user says "the dashboard shows X" or "I see Y in the UI", check pending browser questions first: `/neuron-ask`.
- Never edit `data/` directly. All mutations go through `mcp__neuron__*` tools.
- Use `/neuron-status` to see a table of all tasks and their current accuracy before suggesting next steps.

## MCP tools

All `mcp__neuron__*` tools are available. Key ones:

| Tool | When to use |
|---|---|
| `create_task` | First time only — one per project |
| `load_csv` | Ingest training data from a CSV file |
| `inspect_data` | Check dataset health before training |
| `auto_train` | Hands-off training pipeline (preflight → sweep → promote) |
| `train` | Single run with explicit hyperparams |
| `predict` | Single-row inference |
| `suggest_samples` | Active learning — find uncertain rows |

## Slash commands

| Command | Purpose |
|---|---|
| `/neuron-auto <task>` | Full auto-train pipeline |
| `/neuron-train <task>` | Suggest + train + poll |
| `/neuron-status` | Table of all tasks |
| `/neuron-show <task> [run]` | Open dashboard + screenshot |
| `/neuron-ask` | Answer pending browser questions |
| `/neuron-load <task> <file>` | Load CSV/JSON/images |
| `/neuron-sweep <task>` | Hyperparameter sweep |
| `/neuron-diagnose <task>` | Post-run analysis |
