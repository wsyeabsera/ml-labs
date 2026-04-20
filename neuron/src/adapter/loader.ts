import { resolve } from "node:path"
import type { NeuronConfig } from "./types"

let cached: NeuronConfig | null = null

export async function loadConfig(): Promise<NeuronConfig | null> {
  if (cached) return cached
  const candidates = [
    resolve(process.cwd(), "neuron.config.ts"),
    resolve(process.cwd(), "neuron.config.js"),
  ]
  for (const path of candidates) {
    try {
      const mod = await import(path) as { default?: NeuronConfig }
      if (mod.default) { cached = mod.default; return cached }
    } catch { /* not found */ }
  }
  return null
}
