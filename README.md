# ML-Labs

A Claude-native ML platform that runs entirely on your machine.
Train classifiers, sweep hyperparameters, share models across projects — all from one chat.

```
rs-tensor (Rust math)  →  Neuron MCP server (TypeScript)  →  Claude Code (you)
```

## What's in the box

| Package | Description |
|---|---|
| `neuron/` | MCP server — 30 tools for training, sweeps, auto-train, registry, active learning |
| `neuron/src/tui/` | Ink terminal dashboard — live training status, dataset browser |
| `site/` | React docs site — architecture, training flow, tool reference |
| `docs/mcp-reference/` | rs-tensor MCP markdown reference |

## Quick start

**1. Wire Neuron into your project**

```json
// .mcp.json
{
  "mcpServers": {
    "neuron": {
      "command": "bun",
      "args": ["run", "/path/to/ml-agent/neuron/src/server.ts"]
    }
  }
}
```

**2. Install deps**

```bash
bun --cwd neuron install
```

**3. Train your first model**

In Claude Code:
```
> Use Neuron to train a classifier on ./iris.csv
```

Or with the slash command:
```
/neuron-auto iris
```

**4. Open the docs**

```bash
bun run docs        # dev server → http://localhost:5273
bun run docs:build  # static build → site/dist/
```

**5. Open the TUI**

```bash
bun run tui         # Ink terminal dashboard
```

## Available root scripts

| Script | What it does |
|---|---|
| `bun run docs` | Dev server for the docs site on :5273 |
| `bun run docs:build` | Production build → `site/dist/` |
| `bun run docs:preview` | Serve the production build locally |
| `bun run mcp:dev` | Run the Neuron MCP server in hot-reload mode |
| `bun run mcp:build` | Compile Neuron to `neuron/dist/` |
| `bun run tui` | Launch the Ink terminal dashboard |

## Slash commands (Claude Code)

| Command | Description |
|---|---|
| `/neuron-auto <task_id>` | Full auto-train pipeline — preflight → sweep → diagnose → promote |
| `/neuron-train <task_id>` | Single run with suggested hyperparams |
| `/neuron-sweep <task_id>` | Grid sweep with default axes |
| `/neuron-status` | List all tasks |
| `/neuron-diagnose <task_id>` | Evaluate + diagnose latest run |
| `/neuron-publish <run_id> <name>` | Publish to local registry |
| `/neuron-import [uri]` | Import from local registry |
| `/neuron-load <task_id> <path>` | Load data from CSV/JSON/images |

## Stack

- **Runtime:** [Bun](https://bun.sh) — TypeScript, SQLite, process management
- **Math:** rs-tensor — Rust MLP/CNN, autograd, inference via MCP
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io) — stdio + HTTP transports
- **AI:** [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) — coordinator sub-agents, parallel sweeps
- **UI:** [Ink](https://github.com/vadimdemedes/ink) (TUI) + React + Vite (docs site)
- **Persistence:** SQLite with WAL mode — tasks, samples, runs, models, auto_run logs

## License

MIT — see [LICENSE](./LICENSE).
