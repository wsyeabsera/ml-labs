import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import type { BaselineEntry, BaselineFile, BenchResult } from "./types"

const BENCH_DIR = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = resolve(BENCH_DIR, "results")
const BASELINE_PATH = resolve(RESULTS_DIR, "baseline.json")

// Absolute tolerance on metric drop before failing.
// - Classification accuracy: 2% absolute
// - Regression R²: 0.03 absolute
const TOLERANCE = {
  accuracy: 0.02,
  r2: 0.03,
}

export function loadBaseline(): BaselineFile | null {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as BaselineFile
}

export function writeBaseline(results: BenchResult[], neuronVersion: string): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const entries: Record<string, BaselineEntry> = {}
  for (const r of results) {
    if (r.metric_value == null) continue
    entries[r.name] = {
      metric_name: r.metric_name,
      metric_value: r.metric_value,
      waves_used: r.waves_used,
      configs_tried: r.configs_tried,
      wall_clock_s: r.wall_clock_s,
      dataset_hash: r.dataset_hash ?? null,
    }
  }
  const file: BaselineFile = {
    generated_at: new Date().toISOString(),
    neuron_version: neuronVersion,
    entries,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(file, null, 2) + "\n")
}

export interface ComparisonVerdict {
  name: string
  status: "pass" | "regress" | "no_baseline" | "no_result" | "hash_mismatch"
  delta: number | null
  message: string
}

export function compareToBaseline(result: BenchResult, baseline: BaselineFile | null): ComparisonVerdict {
  if (result.metric_value == null) {
    return { name: result.name, status: "no_result", delta: null, message: "bench produced no metric" }
  }
  if (!baseline || !baseline.entries[result.name]) {
    return { name: result.name, status: "no_baseline", delta: null, message: "no committed baseline" }
  }
  const b = baseline.entries[result.name]!
  const delta = result.metric_value - b.metric_value
  const tol = TOLERANCE[result.metric_name]

  // Dataset hash drift means the training set content changed — surfaces
  // accidental data file edits or loader-bug regressions. Hard-fail.
  if (b.dataset_hash != null && result.dataset_hash != null && b.dataset_hash !== result.dataset_hash) {
    return {
      name: result.name,
      status: "hash_mismatch",
      delta,
      message: `dataset_hash drift — ${b.dataset_hash.slice(0, 10)} → ${result.dataset_hash.slice(0, 10)} (training data changed?)`,
    }
  }

  if (delta < -tol) {
    return {
      name: result.name,
      status: "regress",
      delta,
      message: `${result.metric_name} dropped by ${Math.abs(delta).toFixed(3)} (tolerance ${tol})`,
    }
  }
  return {
    name: result.name,
    status: "pass",
    delta,
    message: `${result.metric_name}=${result.metric_value.toFixed(3)} (Δ${delta >= 0 ? "+" : ""}${delta.toFixed(3)})`,
  }
}
