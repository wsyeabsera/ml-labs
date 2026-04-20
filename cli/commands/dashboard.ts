import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const PORT = 2626

function detectNeuronDb(): string {
  const mcpPath = resolve(process.cwd(), ".mcp.json")
  if (existsSync(mcpPath)) {
    try {
      const db: unknown = JSON.parse(readFileSync(mcpPath, "utf-8"))?.mcpServers?.neuron?.env?.NEURON_DB
      if (typeof db === "string" && db) return db
    } catch {}
  }
  return join(ML_LABS_DIR, "data", "neuron.db")
}

async function buildIfNeeded(): Promise<boolean> {
  const dist = join(ML_LABS_DIR, "dashboard", "dist", "index.html")
  if (existsSync(dist)) return true

  console.log("Building dashboard (first run)…")
  const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
    cwd: join(ML_LABS_DIR, "dashboard"),
    stdout: "inherit",
    stderr: "inherit",
  })
  if (install.exitCode !== 0) { console.error("bun install failed"); return false }

  const build = Bun.spawnSync(["bun", "run", "build"], {
    cwd: join(ML_LABS_DIR, "dashboard"),
    stdout: "inherit",
    stderr: "inherit",
  })
  if (build.exitCode !== 0) { console.error("build failed"); return false }
  console.log("")
  return true
}

export async function dashboard() {
  if (!existsSync(ML_LABS_DIR)) {
    console.error("ML-Labs not installed. Run the installer first.")
    process.exit(1)
  }

  const neuronDb = detectNeuronDb()
  const dashDist = join(ML_LABS_DIR, "dashboard", "dist")

  if (!(await buildIfNeeded())) process.exit(1)

  // Always kill anything on PORT so a new invocation from a different project
  // directory always starts fresh with the correct NEURON_DB.
  const pids = Bun.spawnSync(["lsof", "-ti", `TCP:${PORT}`, "-sTCP:LISTEN"], { stderr: "ignore" })
  const pidList = new TextDecoder().decode(pids.stdout).trim()
  if (pidList) {
    console.log("Restarting dashboard server with current project DB…")
    for (const pid of pidList.split("\n")) {
      Bun.spawnSync(["kill", "-9", pid.trim()], { stderr: "ignore" })
    }
    // Wait until the port is actually free (up to 3s)
    for (let i = 0; i < 30; i++) {
      await Bun.sleep(100)
      const check = Bun.spawnSync(["lsof", "-ti", `TCP:${PORT}`, "-sTCP:LISTEN"], { stderr: "ignore" })
      if (!new TextDecoder().decode(check.stdout).trim()) break
    }
  }

  const serverTs = join(ML_LABS_DIR, "neuron", "src", "api.ts")
  const proc = Bun.spawn(["bun", "run", serverTs], {
    cwd: join(ML_LABS_DIR, "neuron"),
    env: {
      ...process.env,
      NEURON_DB: neuronDb,
      DASHBOARD_DIST: dashDist,
      NEURON_API_PORT: String(PORT),
    } as Record<string, string>,
    stdout: "pipe",
    stderr: "inherit",
  })

  // Wait for server to be ready
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const dec = new TextDecoder()
  let ready = false
  while (!ready) {
    const { done, value } = await reader.read()
    if (done) break
    const line = dec.decode(value)
    process.stdout.write(line)
    if (line.includes("http://localhost")) ready = true
  }

  // Open browser
  Bun.spawnSync(["open", `http://localhost:${PORT}`], { stderr: "ignore" })
  console.log(`\nProject DB: ${neuronDb}`)
  console.log("Press Ctrl+C to stop.\n")

  // Keep alive — pipe remaining stdout
  ;(async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      process.stdout.write(dec.decode(value))
    }
  })()

  await proc.exited
}
