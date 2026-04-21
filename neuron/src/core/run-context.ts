import { hostname } from "node:os"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { sha256Hex } from "../util/hash"

export interface RunContext {
  neuron_version: string
  git_sha: string | null
  rs_tensor_sha: string | null
  hostname: string
  pid: number
  start_ts: string          // ISO
  rng_seed: number | null
}

// Cache derived once per process — these don't change during a run's lifetime.
let cachedNeuronVersion: string | null = null
let cachedGitSha: string | null | undefined = undefined
let cachedRsTensorSha: string | null | undefined = undefined

function readNeuronVersion(): string {
  if (cachedNeuronVersion !== null) return cachedNeuronVersion
  try {
    // schema.ts anchors at neuron root 4 levels up — replicate.
    const pkgPath = join(import.meta.dir, "../../package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }
      cachedNeuronVersion = pkg.version ?? "unknown"
      return cachedNeuronVersion
    }
  } catch { /* fall through */ }
  cachedNeuronVersion = "unknown"
  return cachedNeuronVersion
}

function readGitSha(): string | null {
  if (cachedGitSha !== undefined) return cachedGitSha
  try {
    // Run from the neuron project root; if not a git repo, returns null.
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: join(import.meta.dir, "../.."),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    })
    if (r.status === 0) {
      cachedGitSha = r.stdout.toString().trim() || null
    } else {
      cachedGitSha = null
    }
  } catch {
    cachedGitSha = null
  }
  return cachedGitSha
}

function readRsTensorSha(): string | null {
  if (cachedRsTensorSha !== undefined) return cachedRsTensorSha
  try {
    const binPath = process.env.RS_TENSOR_BIN
      ?? join(process.env.HOME ?? "", ".ml-labs", "rs-tensor", "target", "release", "mcp")
    if (!existsSync(binPath)) {
      cachedRsTensorSha = null
      return null
    }
    // Hash the mtime + size — full-binary hashing on every run start is too slow
    // for a 4 MB executable. This is a "version fingerprint" for drift detection,
    // not a cryptographic integrity check.
    const s = statSync(binPath)
    cachedRsTensorSha = sha256Hex(`${binPath}|${s.size}|${s.mtimeMs}`).slice(0, 16)
  } catch {
    cachedRsTensorSha = null
  }
  return cachedRsTensorSha
}

export function buildRunContext(opts: { rng_seed?: number } = {}): RunContext {
  return {
    neuron_version: readNeuronVersion(),
    git_sha: readGitSha(),
    rs_tensor_sha: readRsTensorSha(),
    hostname: hostname(),
    pid: process.pid,
    start_ts: new Date().toISOString(),
    rng_seed: opts.rng_seed ?? null,
  }
}

/** Test-only: reset the module caches so test fixtures can stub env. */
export function __resetRunContextCache(): void {
  cachedNeuronVersion = null
  cachedGitSha = undefined
  cachedRsTensorSha = undefined
}
