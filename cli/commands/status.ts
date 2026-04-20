import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { rsTensorUrl } from "../lib/config"

const ML_LABS_DIR = join(homedir(), ".ml-labs")

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

  // ── rs-tensor health ─────────────────────────────────────────────────────────
  const rsUrl = rsTensorUrl()
  const isRemote = !rsUrl.includes("localhost") && !rsUrl.includes("127.0.0.1")
  process.stdout.write(`\nrs-tensor:  `)
  try {
    const res = await fetch(rsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      signal: AbortSignal.timeout(2500),
    })
    if (res.ok || res.status === 405) {
      console.log(`reachable  (${rsUrl})`)
    } else {
      console.log(`HTTP ${res.status}  (${rsUrl})`)
    }
  } catch {
    if (isRemote) {
      console.log(`unreachable  (${rsUrl})`)
      console.log(`             make sure the home server is up and rs-tensor is running`)
    } else {
      console.log(`not running  (${rsUrl})`)
      console.log(`             start with: cargo run --release  (in rs-tensor repo)`)
    }
  }
  console.log(`  configure: ml-labs config set rs-tensor-url <url>`)

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
