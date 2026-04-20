import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const RS_TENSOR_BIN = join(ML_LABS_DIR, "rs-tensor", "target", "release", "mcp")

export async function status() {
  // ── Install ──────────────────────────────────────────────────────────────────
  if (!existsSync(ML_LABS_DIR)) {
    console.log("ML-Labs: not installed")
    console.log(`  Run: curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash`)
    process.exit(1)
  }

  let version = "unknown"
  const rootPkg = join(ML_LABS_DIR, "package.json")
  if (existsSync(rootPkg)) {
    try { version = JSON.parse(readFileSync(rootPkg, "utf-8")).version ?? "unknown" } catch {}
  }

  let commit = "unknown"
  const gitResult = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: ML_LABS_DIR, stderr: "ignore",
  })
  if (gitResult.exitCode === 0) commit = new TextDecoder().decode(gitResult.stdout).trim()

  const distBuilt = existsSync(join(ML_LABS_DIR, "site", "dist", "index.html"))

  console.log(`\nML-Labs v${version}  (${commit})`)
  console.log(`  install: ${ML_LABS_DIR}`)
  console.log(`  docs:    ${distBuilt ? "built" : "not built — run: ml-labs docs"}`)

  // ── rs-tensor binary ─────────────────────────────────────────────────────────
  const explicitUrl = process.env.RS_TENSOR_MCP_URL
  process.stdout.write(`\nrs-tensor:  `)
  if (explicitUrl) {
    console.log(`remote  (RS_TENSOR_MCP_URL=${explicitUrl})`)
  } else if (existsSync(RS_TENSOR_BIN)) {
    console.log(`built  (${RS_TENSOR_BIN})`)
  } else {
    console.log(`not built — run: ml-labs update`)
    console.log(`             (or set RS_TENSOR_MCP_URL to use a remote server)`)
  }

  // ── current project ──────────────────────────────────────────────────────────
  const mcpPath = resolve(process.cwd(), ".mcp.json")
  const dbPath = resolve(process.cwd(), "data", "neuron.db")
  const configPath = resolve(process.cwd(), "neuron.config.ts")

  console.log(`\ncurrent dir: ${process.cwd()}`)
  if (existsSync(mcpPath)) {
    console.log(`  .mcp.json:        found`)
    console.log(`  neuron.config.ts: ${existsSync(configPath) ? "found" : "missing — run: ml-labs init ."}`)
    console.log(`  neuron.db:        ${existsSync(dbPath) ? "found" : "none yet (created on first use)"}`)
  } else {
    console.log(`  not an ML-Labs project  — run: ml-labs init .`)
  }

  console.log(`
tools:  34 MCP tools across 7 categories
        Task · Data · Training · Auto · Inspection · Model · Inference

quick start:
  ml-labs init my-project
  ml-labs tui                   launch the terminal dashboard
  # open in Claude Code, then:
  /neuron-load iris examples/iris.csv
  /neuron-auto iris
`)
}
