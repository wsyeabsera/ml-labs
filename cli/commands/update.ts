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

  // Rebuild rs-tensor binary (incremental after first build).
  // v0.6.0+ adds new train_mlp parameters (weight_decay, early_stop_patience) that
  // older binaries reject — so the rebuild is load-bearing.
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
        console.error("rs-tensor build failed — aborting update to avoid a half-applied upgrade.")
        console.error("Fix the Rust build (see output above) and re-run `ml-labs update`.")
        process.exit(1)
      }
      console.log("rs-tensor built.")
    } else {
      console.warn("Warning: cargo not found — skipping rs-tensor rebuild.")
      console.warn("v0.6.0 added new train_mlp args; without a rebuilt binary, auto_train may fail.")
      console.warn("Install Rust via https://rustup.rs, or set RS_TENSOR_MCP_URL to point at a v0.6.0+ remote.")
    }
  }

  // Invalidate build caches so the next `ml-labs dashboard` / `ml-labs docs`
  // rebuilds from the freshly-pulled sources. `ml-labs docs` also has an mtime
  // check as a second line of defense, but clearing here is unambiguous.
  const dashDist = join(ML_LABS_DIR, "dashboard", "dist")
  if (existsSync(dashDist)) {
    rmSync(dashDist, { recursive: true, force: true })
    console.log("Dashboard cache cleared — will rebuild on next launch.")
  }
  const siteDist = join(ML_LABS_DIR, "site", "dist")
  if (existsSync(siteDist)) {
    rmSync(siteDist, { recursive: true, force: true })
    console.log("Docs cache cleared — will rebuild on next `ml-labs docs`.")
  }

  console.log("\nML-Labs updated.")
}
