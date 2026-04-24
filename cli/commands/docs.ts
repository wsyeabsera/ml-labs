import { join } from "node:path"
import { homedir, platform } from "node:os"
import { existsSync, statSync, readdirSync } from "node:fs"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const PORT = 5273

/**
 * Return the maximum mtime (unix ms) of any file under `dir`, walking recursively.
 * Used to decide whether the site dist is stale: if any src file is newer than
 * dist/index.html, we rebuild.
 *
 * Skips node_modules, dist, and dotfiles so the walk is cheap.
 */
function maxMtime(dir: string): number {
  let max = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue
      if (entry.name === "node_modules") continue
      if (entry.name === "dist") continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = maxMtime(p)
        if (sub > max) max = sub
      } else {
        const m = statSync(p).mtimeMs
        if (m > max) max = m
      }
    }
  } catch {
    // ignore — walk is best-effort
  }
  return max
}

function openInBrowser(url: string) {
  const cmd = platform() === "darwin" ? "open"
            : platform() === "win32"  ? "start"
            : "xdg-open"
  try {
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" }).unref()
  } catch {
    // best-effort — the URL is already printed anyway
  }
}

export async function docs() {
  const siteDir = join(ML_LABS_DIR, "site")
  const distDir = join(siteDir, "dist")
  const indexHtml = join(distDir, "index.html")
  const srcDir = join(siteDir, "src")
  const pkgJson = join(siteDir, "package.json")
  const rootConfigs = [
    join(siteDir, "index.html"),
    join(siteDir, "vite.config.ts"),
    join(siteDir, "tailwind.config.js"),
    join(siteDir, "postcss.config.js"),
    join(siteDir, "tsconfig.json"),
  ]

  // Decide whether to rebuild:
  //   1. No dist yet                  → build (first run)
  //   2. Any src / config file newer  → build (update pulled new content)
  //   3. Otherwise                    → skip build, serve existing dist
  let needsBuild = false
  let reason = ""
  if (!existsSync(indexHtml)) {
    needsBuild = true
    reason = "no dist yet"
  } else {
    const distMtime = statSync(indexHtml).mtimeMs
    const srcMax = Math.max(
      maxMtime(srcDir),
      existsSync(pkgJson) ? statSync(pkgJson).mtimeMs : 0,
      ...rootConfigs.filter(existsSync).map((p) => statSync(p).mtimeMs),
    )
    if (srcMax > distMtime) {
      needsBuild = true
      reason = "sources newer than dist"
    }
  }

  if (needsBuild) {
    console.log(`Building docs (${reason})...`)
    // Install is a no-op if node_modules is up to date, so always safe to call.
    const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
      cwd: siteDir, stdout: "inherit", stderr: "inherit",
    })
    if (install.exitCode !== 0) { console.error("bun install failed."); process.exit(1) }

    const build = Bun.spawnSync(["bun", "run", "build"], {
      cwd: siteDir, stdout: "inherit", stderr: "inherit",
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

  const url = `http://localhost:${server.port}`
  console.log(`ML-Labs docs → ${url}`)
  console.log("Opening in your browser. Press Ctrl+C to stop.\n")
  openInBrowser(url)

  // Keep the process alive
  await new Promise(() => {})
}
