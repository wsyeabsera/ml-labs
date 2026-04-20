import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const PORT = 5273

export async function docs() {
  const distDir = join(ML_LABS_DIR, "site", "dist")

  // Lazy build if dist doesn't exist yet
  if (!existsSync(join(distDir, "index.html"))) {
    console.log("Building docs (first run)...")
    const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
      cwd: join(ML_LABS_DIR, "site"),
      stdout: "inherit",
      stderr: "inherit",
    })
    if (install.exitCode !== 0) { console.error("bun install failed."); process.exit(1) }

    const build = Bun.spawnSync(["bun", "run", "build"], {
      cwd: join(ML_LABS_DIR, "site"),
      stdout: "inherit",
      stderr: "inherit",
    })
    if (build.exitCode !== 0) { console.error("build failed."); process.exit(1) }
    console.log("")
  }

  // Kill anything already on PORT so we always land on the same URL
  const pids = Bun.spawnSync(["lsof", "-ti", `TCP:${PORT}`, "-sTCP:LISTEN"], { stderr: "ignore" })
  const pidList = new TextDecoder().decode(pids.stdout).trim()
  if (pidList) {
    for (const pid of pidList.split("\n")) {
      Bun.spawnSync(["kill", "-9", pid.trim()], { stderr: "ignore" })
    }
    // brief pause for the OS to release the socket
    await Bun.sleep(300)
  }

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname
      const file = Bun.file(join(distDir, pathname))
      if (await file.exists()) return new Response(file)
      return new Response(Bun.file(join(distDir, "index.html")))
    },
  })

  console.log(`ML-Labs docs → http://localhost:${server.port}`)
  console.log("Press Ctrl+C to stop.\n")

  // Keep the process alive
  await new Promise(() => {})
}
