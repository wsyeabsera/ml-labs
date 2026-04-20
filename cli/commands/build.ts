import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const RS_TENSOR_DIR = join(ML_LABS_DIR, "rs-tensor")

export async function build() {
  if (!existsSync(RS_TENSOR_DIR)) {
    console.error(`rs-tensor not found at ${RS_TENSOR_DIR}.`)
    console.error(`Run \`ml-labs update\` to fetch the submodule.`)
    process.exit(1)
  }

  const cargoCheck = Bun.spawnSync(["cargo", "--version"], { stderr: "ignore", stdout: "ignore" })
  if (cargoCheck.exitCode !== 0) {
    console.error("cargo not found. Install Rust: https://rustup.rs")
    process.exit(1)
  }

  console.log("Building rs-tensor (cargo --release)…")
  const result = Bun.spawnSync(["cargo", "build", "--release", "--bin", "mcp"], {
    cwd: RS_TENSOR_DIR,
    stdout: "inherit",
    stderr: "inherit",
  })

  if (result.exitCode !== 0) {
    console.error("Build failed.")
    process.exit(1)
  }

  const bin = join(RS_TENSOR_DIR, "target", "release", "mcp")
  console.log(`\nBuilt: ${bin}`)
}
