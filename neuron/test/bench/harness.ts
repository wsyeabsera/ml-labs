import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readFileSync } from "node:fs"

// The harness forces deterministic mode BEFORE any module imports DB state.
// Child setup must already have set NEURON_DB_PATH via bunfig preload (or CLI).
process.env.NEURON_PLANNER = "rules"
process.env.NEURON_SWEEP_MODE = "sequential"

import { createTask } from "../../src/core/db/tasks"
import { handler as loadCsvHandler } from "../../src/tools/load_csv"
import { handler as autoTrainHandler } from "../../src/tools/auto_train"
import type { BenchConfig, BenchResult } from "./types"

const BENCH_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(BENCH_DIR, "data")

function countColumns(csvPath: string): number {
  const firstLine = readFileSync(csvPath, "utf-8").split("\n")[0]!
  return firstLine.split(",").length
}

export async function runBench(config: BenchConfig, seed = 42): Promise<BenchResult> {
  const csvPath = join(DATA_DIR, config.csv)
  if (!existsSync(csvPath)) throw new Error(`Dataset not found: ${csvPath}`)

  // Unique task id per run so benches don't collide across invocations.
  const taskId = `bench_${config.name}_${Date.now()}`
  const totalCols = countColumns(csvPath)
  const featureDim = totalCols - 1  // one label column

  createTask({
    id: taskId,
    kind: config.kind,
    labels: null,
    featureShape: [featureDim],
    sampleShape: [featureDim],
    normalize: true,
    featureNames: null,
  })

  await loadCsvHandler({
    task_id: taskId,
    path: csvPath,
    label_column: config.label_column,
    has_header: true,
    test_size: config.test_size,
    seed,
  })

  const t0 = Date.now()
  const result = await autoTrainHandler({
    task_id: taskId,
    accuracy_target: config.accuracy_target,
    max_waves: config.max_waves,
    budget_s: config.budget_s,
    promote: true,
    tournament: false,
    seed,
  }) as {
    status: string
    accuracy: number | null
    waves_used: number
    verdict_json?: {
      winner: { metric_value: number | null; metric_name: "accuracy" | "r2"; is_overfit: boolean }
      attempted: { configs_tried: number; wall_clock_s: number }
    }
  }

  const wall_clock_s = Math.round((Date.now() - t0) / 1000)
  const vj = result.verdict_json
  const metric_value = vj?.winner.metric_value ?? result.accuracy
  const metric_name = vj?.winner.metric_name ?? (config.kind === "regression" ? "r2" : "accuracy")

  return {
    name: config.name,
    kind: config.kind,
    metric_name,
    metric_value,
    waves_used: result.waves_used,
    configs_tried: vj?.attempted.configs_tried ?? 0,
    wall_clock_s,
    status: result.status,
    is_overfit: vj?.winner.is_overfit ?? false,
    seed,
  }
}

/**
 * Reproducibility check — same bench, same seed, twice. Asserts identical
 * verdict. Called from the run.ts CLI when --verify-repro is passed.
 */
export async function verifyReproducibility(config: BenchConfig, seed = 42): Promise<boolean> {
  const a = await runBench(config, seed)
  const b = await runBench(config, seed)
  return (
    a.metric_value === b.metric_value &&
    a.waves_used === b.waves_used &&
    a.configs_tried === b.configs_tried
  )
}
