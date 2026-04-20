import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ML_LABS_DIR = join(homedir(), ".ml-labs")

function detectNeuronDb(): string {
  // Prefer the current project's DB if we're inside an ML-Labs project
  const mcpPath = resolve(process.cwd(), ".mcp.json")
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"))
      const db: unknown = mcp?.mcpServers?.neuron?.env?.NEURON_DB
      if (typeof db === "string" && db) return db
    } catch {}
  }
  // Fallback: global dev DB
  return join(ML_LABS_DIR, "data", "neuron.db")
}

export async function tui() {
  if (!existsSync(ML_LABS_DIR)) {
    console.error("ML-Labs not installed. Run the installer first.")
    process.exit(1)
  }

  const neuronDir = join(ML_LABS_DIR, "neuron")
  const neuronDb = detectNeuronDb()

  console.log(`Launching Neuron TUI`)
  console.log(`  project db: ${neuronDb}\n`)

  const proc = Bun.spawn(["bun", "run", "src/tui/index.tsx"], {
    cwd: neuronDir,
    env: { ...process.env, NEURON_DB: neuronDb },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  const code = await proc.exited
  process.exit(code)
}
