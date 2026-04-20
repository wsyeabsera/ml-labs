# {{PROJECT_NAME}}

Powered by [ML-Labs](https://github.com/wsyeabsera/ml-labs) — a Claude-native ML platform.

## Quick start

**1. Open in Claude Code** — Neuron tools load automatically from `.mcp.json`.

**2. Load your data**
```
/neuron-load <task_id> ./data/my-data.csv
```

**3. Train**
```
/neuron-auto <task_id>
```
The coordinator sweeps hyperparameters, diagnoses the result, and promotes the winner. 
Takes 30–120 seconds depending on data size.

**4. Predict**
```typescript
await mcp__neuron__predict({ task_id: "<task_id>", features: [...] })
```

## Useful commands

| Command | What it does |
|---|---|
| `/neuron-auto <task_id>` | Full auto-train: preflight → sweep → diagnose → promote |
| `/neuron-status` | Show all tasks, sample counts, accuracy |
| `/neuron-diagnose <task_id>` | Evaluate + diagnose the latest run |
| `/neuron-sweep <task_id>` | Manual grid sweep |
| `/neuron-publish <run_id> <name>` | Publish model to local registry |

## Project layout

```
{{PROJECT_NAME}}/
├── .mcp.json           ← Neuron wired to ~/.ml-labs
├── .claude/            ← Skills + slash commands (auto-loaded by Claude Code)
├── neuron.config.ts    ← Featurize + task config — edit this for your data
├── data/               ← SQLite DB lives here (gitignored)
│   └── your-data.csv
└── README.md
```

## Updating ML-Labs

```bash
ml-labs update
```

Pulls the latest Neuron tools, skills, and docs from GitHub and rebuilds the CLI.
