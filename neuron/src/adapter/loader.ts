import { resolve } from "node:path"
import type { NeuronConfig } from "./types"

let cached: NeuronConfig | null = null
let cachedPath: string | null = null

export function loadedConfigPath(): string | null {
  return cachedPath
}

export async function loadConfig(): Promise<NeuronConfig | null> {
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, "neuron.config.ts"),
    resolve(cwd, "neuron.config.js"),
  ]
  // Invalidate if cwd has changed (MCP server vs HTTP API may start from different dirs)
  if (cached && cachedPath && !candidates.includes(cachedPath)) {
    cached = null
    cachedPath = null
  }
  if (cached) return cached
  for (const path of candidates) {
    try {
      const mod = await import(path) as { default?: NeuronConfig }
      if (mod.default) {
        cached = mod.default
        cachedPath = path
        return cached
      }
    } catch { /* not found */ }
  }
  return null
}
