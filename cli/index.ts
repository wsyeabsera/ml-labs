#!/usr/bin/env bun
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { init } from "./commands/init"
import { update } from "./commands/update"
import { docs } from "./commands/docs"
import { status } from "./commands/status"
import { tui } from "./commands/tui"
import { config } from "./commands/config"
import { health } from "./commands/health"
import { dashboard } from "./commands/dashboard"

function getVersion(): string {
  const rootPkg = join(homedir(), ".ml-labs", "package.json")
  if (existsSync(rootPkg)) {
    try { return JSON.parse(readFileSync(rootPkg, "utf-8")).version ?? "0.2.1" } catch {}
  }
  try {
    const own = join(import.meta.dir, "package.json")
    if (existsSync(own)) return JSON.parse(readFileSync(own, "utf-8")).version ?? "0.2.1"
  } catch {}
  return "0.2.1"
}

const help = `
ml-labs v${getVersion()} — Claude-native ML platform

USAGE
  ml-labs <command> [options]

COMMANDS
  init [project-name]   Scaffold a new ML-Labs project (default: current dir)
  tui                   Launch the terminal dashboard (Ink TUI)
  update                Pull latest ML-Labs and rebuild
  docs                  Serve the ML-Labs docs site (http://localhost:5273)
  status                Show install info, rs-tensor health, and project state
  dashboard             Launch the web dashboard (http://localhost:2626)
  health                Run sanity checks on both MCP servers
  config <sub>          Get/set global config (e.g. rs-tensor-url)

OPTIONS
  -v, --version         Print version and exit
  -h, --help            Print this help and exit

EXAMPLES
  ml-labs init my-classifier
  ml-labs init .                Wire ML-Labs into the current directory
  ml-labs tui                   Open the Neuron terminal dashboard
  ml-labs config set rs-tensor-url http://homeserver:3000/mcp
  ml-labs health                Run full MCP health check
  ml-labs status
  ml-labs update
  ml-labs docs

FEATURES (34 MCP tools)
  · Train/test split     load_csv test_size=0.2 → stratified split stored in DB
  · Z-score norm         create_task normalize=true → applied at train + predict
  · Regression           kind="regression" → MAE / RMSE / R² metrics
  · Class weights        train class_weights="balanced" → oversampling
  · Observability        inspect_data · get_training_curves · model_stats
  · Batch inference      batch_predict over a CSV file
  · Active learning      suggest_samples → uncertain / misclassified rows
  · Parallel sweeps      run_sweep → N sub-agents, wall clock ≈ one run
  · Auto-train           /neuron-auto → coordinator sub-agent, full pipeline
  · Cross-session        weights restore lazily from SQLite into rs-tensor

DOCS
  ml-labs docs          Serves the full reference at http://localhost:5273
`

const [, , command, ...args] = process.argv

if (command === "--version" || command === "-v") {
  console.log(getVersion())
  process.exit(0)
}

if (command === "--help" || command === "-h" || !command) {
  console.log(help)
  process.exit(0)
}

switch (command) {
  case "init":
    await init(args[0] ?? ".")
    break
  case "tui":
    await tui()
    break
  case "update":
    await update()
    break
  case "docs":
    await docs()
    break
  case "status":
    await status()
    break
  case "dashboard":
    await dashboard()
    break
  case "health":
    await health()
    break
  case "config":
    config(args)
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.log(help)
    process.exit(1)
}
