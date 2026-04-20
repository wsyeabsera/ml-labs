import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, rmSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const RS_TENSOR_DIR = join(ML_LABS_DIR, "rs-tensor")

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

  // Pull any submodule updates (rs-tensor pin may have moved)
  Bun.spawnSync(["git", "submodule", "update", "--init", "--recursive"], {
    cwd: ML_LABS_DIR,
    stdout: "inherit",
    stderr: "inherit",
  })

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

  // Rebuild rs-tensor binary (incremental after first build)
  if (existsSync(RS_TENSOR_DIR)) {
    const cargoCheck = Bun.spawnSync(["cargo", "--version"], { stderr: "ignore", stdout: "ignore" })
    if (cargoCheck.exitCode === 0) {
      console.log("\nBuilding rs-tensor...")
      const cargoBuild = Bun.spawnSync(["cargo", "build", "--release", "--bin", "mcp"], {
        cwd: RS_TENSOR_DIR,
        stdout: "inherit",
        stderr: "inherit",
      })
      if (cargoBuild.exitCode !== 0) {
        console.warn("Warning: rs-tensor build failed — neuron will fall back to RS_TENSOR_MCP_URL if set.")
      } else {
        console.log("rs-tensor built.")
      }
    } else {
      console.warn("Warning: cargo not found — skipping rs-tensor build. Install Rust: https://rustup.rs")
    }
  }

  // Invalidate dashboard dist so it rebuilds on next `ml-labs dashboard`
  const dashDist = join(ML_LABS_DIR, "dashboard", "dist")
  if (existsSync(dashDist)) {
    rmSync(dashDist, { recursive: true, force: true })
    console.log("Dashboard cache cleared — will rebuild on next launch.")
  }

  console.log("\nML-Labs updated.")
}
