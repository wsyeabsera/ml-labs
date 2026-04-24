#!/usr/bin/env bun
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { init } from "./commands/init"
import { update } from "./commands/update"
import { build } from "./commands/build"
import { docs } from "./commands/docs"
import { status } from "./commands/status"
import { tui } from "./commands/tui"
import { config } from "./commands/config"
import { health } from "./commands/health"
import { dashboard } from "./commands/dashboard"
import { reset } from "./commands/reset"

function getVersion(): string {
  const rootPkg = join(homedir(), ".ml-labs", "package.json")
  if (existsSync(rootPkg)) {
    try { return JSON.parse(readFileSync(rootPkg, "utf-8")).version ?? "0.3.0" } catch {}
  }
  try {
    const own = join(import.meta.dir, "package.json")
    if (existsSync(own)) return JSON.parse(readFileSync(own, "utf-8")).version ?? "0.3.0"
  } catch {}
  return "0.3.0"
}

const help = `
ml-labs v${getVersion()} — Claude-native ML platform

USAGE
  ml-labs <command> [options]

COMMANDS
  init [project-name]   Scaffold a new ML-Labs project (default: current dir)
  tui                   Launch the terminal dashboard (Ink TUI)
  update                Pull latest ML-Labs and rebuild (including rs-tensor)
  build                 Rebuild the rs-tensor binary (cargo --release)
  docs                  Serve the ML-Labs docs site (http://localhost:5273)
  status                Show install info, rs-tensor binary state, and project state
  dashboard             Launch the web dashboard (http://localhost:2626)
  reset <task_id>       Clear data for a task (--delete to remove task entirely)
  health                Run sanity checks on both MCP servers
  config <sub>          Get/set global config

OPTIONS
  -v, --version         Print version and exit
  -h, --help            Print this help and exit

EXAMPLES
  ml-labs init my-classifier
  ml-labs init .                Wire ML-Labs into the current directory
  ml-labs reset iris            Clear samples/runs/weights for task "iris"
  ml-labs reset iris --delete   Remove the iris task entirely
  ml-labs tui                   Open the Neuron terminal dashboard
  ml-labs build                 Rebuild rs-tensor binary after editing Rust source
  ml-labs health                Run full MCP health check
  ml-labs status
  ml-labs update
  ml-labs docs

FEATURES (43 MCP tools)
  · Auto-train           auto_train → full pipeline (preflight → waves → promote)
  · Adaptive sweeps      run_sweep → sub-agents when safe, sequential when not
  · Memory guardrail     safe/advisory/heavy/refuse bands + dry_run preview
  · Validation           cv_train · calibrate (ECE) · drift_check (PSI + KS)
  · Active learning      suggest_samples + auto_collect loop
  · LLM playground       llm_load / llm_generate / llm_inspect (GGUF)
  · Registry             publish_model / import_model across projects
  · Three UIs            Claude Code (MCP) · dashboard (:2626) · TUI

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
  case "build":
    await build()
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
  case "reset":
    await reset(args[0], args.slice(1))
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
