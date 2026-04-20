import { join } from "node:path"
import { homedir } from "node:os"

const ML_LABS_DIR = join(homedir(), ".ml-labs")

export async function docs() {
  console.log("Starting ML-Labs docs at http://localhost:5273 ...\n")
  const proc = Bun.spawn(["bun", "run", "dev"], {
    cwd: join(ML_LABS_DIR, "site"),
    stdout: "inherit",
    stderr: "inherit",
  })
  await proc.exited
}
