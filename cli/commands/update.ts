import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")

export async function update() {
  if (!existsSync(ML_LABS_DIR)) {
    console.error(`ML-Labs not found at ${ML_LABS_DIR}. Run the installer first.`)
    process.exit(1)
  }

  console.log("Updating ML-Labs...\n")

  // Fetch + hard reset — installation always matches remote exactly
  Bun.spawnSync(["git", "fetch", "origin"], { cwd: ML_LABS_DIR, stdout: "inherit", stderr: "inherit" })
  const reset = Bun.spawnSync(["git", "reset", "--hard", "origin/main"], {
    cwd: ML_LABS_DIR,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (reset.exitCode !== 0) {
    console.error("git reset failed.")
    process.exit(1)
  }

  // Reinstall neuron deps in case packages changed
  console.log("\nReinstalling neuron deps...")
  const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
    cwd: join(ML_LABS_DIR, "neuron"),
    stdout: "inherit",
    stderr: "inherit",
  })
  if (install.exitCode !== 0) {
    console.error("bun install failed.")
    process.exit(1)
  }

  console.log("\nML-Labs updated.")
}
