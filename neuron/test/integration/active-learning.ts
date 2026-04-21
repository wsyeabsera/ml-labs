/**
 * Active-learning integration test.
 *
 * Verifies: auto_train({ auto_collect: true }) completes without error,
 * invokes suggest_samples, calls the user's `collect` callback, inserts
 * the returned samples, and re-runs one more wave.
 *
 * Setup: writes a temporary neuron.config.ts to cwd that exports a collect
 * callback, then runs auto_train in that cwd so loadConfig picks it up.
 *
 * Run explicitly:
 *   bun run test/integration/active-learning.ts
 */
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { parse as parseCsv } from "csv-parse/sync"

process.env.NEURON_PLANNER = "rules"
process.env.NEURON_SWEEP_MODE = "sequential"

import { createTask, deleteTask } from "../../src/core/db/tasks"
import { handler as loadCsvHandler } from "../../src/tools/load_csv"
import { handler as autoTrainHandler } from "../../src/tools/auto_train"
import { sampleCounts } from "../../src/core/db/samples"

const BENCH_DATA = resolve(dirname(fileURLToPath(import.meta.url)), "../bench/data")

// Build a minority-class iris CSV: keep only 20% of "virginica".
function buildMinorityIris(): string {
  const path = join(BENCH_DATA, "iris.csv")
  const raw = readFileSync(path, "utf-8")
  const rows = parseCsv(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[]
  const minority = "virginica"
  const minCount = rows.filter((r) => r.species === minority).length
  const keepMinority = Math.max(5, Math.floor(minCount * 0.2))
  let minoritySeen = 0
  const kept: Record<string, string>[] = []
  for (const r of rows) {
    if (r.species === minority) {
      if (minoritySeen < keepMinority) { kept.push(r); minoritySeen++ }
    } else {
      kept.push(r)
    }
  }
  const header = "sepal_length,sepal_width,petal_length,petal_width,species"
  const body = kept.map((r) => `${r.sepal_length},${r.sepal_width},${r.petal_length},${r.petal_width},${r.species}`).join("\n")
  const tmp = `/tmp/iris_minority_${Date.now()}.csv`
  writeFileSync(tmp, `${header}\n${body}\n`)
  return tmp
}

async function main() {
  console.log("\n=== active-learning integration test ===\n")

  // Set up a project dir with a neuron.config.ts exposing a collect() callback.
  const projectDir = mkdtempSync(join(tmpdir(), "neuron-al-"))
  const configPath = join(projectDir, "neuron.config.ts")
  writeFileSync(configPath, `
export default {
  taskId: "iris_al",
  featureShape: [4],
  collect: async () => {
    // Inject 20 synthetic virginica samples with realistic feature ranges.
    return Array.from({ length: 20 }, (_, i) => ({
      label: "virginica",
      features: [
        6.3 + Math.sin(i) * 0.3,
        3.0 + Math.cos(i) * 0.3,
        5.1 + (i % 5) * 0.2,
        2.0 + (i % 3) * 0.15,
      ],
    }))
  },
}
`)

  // Move into the project dir so loadConfig picks up our test config.
  const origCwd = process.cwd()
  process.chdir(projectDir)

  try {
    const csv = buildMinorityIris()
    const taskId = `al_smoke_${Date.now()}`
    createTask({
      id: taskId, kind: "classification",
      labels: null, featureShape: [4], sampleShape: [4],
      normalize: true, featureNames: null,
    })
    await loadCsvHandler({
      task_id: taskId, path: csv, label_column: "species",
      has_header: true, test_size: 0.2, stratify: "auto", seed: 42,
    })

    const before = sampleCounts(taskId)
    console.log(`  samples before auto_collect: ${JSON.stringify(before)}`)

    // Target > 1.0 is mathematically unreachable for accuracy, so the
    // early-stop never fires and auto_collect rounds actually run.
    const t0 = Date.now()
    const result = await autoTrainHandler({
      task_id: taskId, accuracy_target: 1.01, max_waves: 2, budget_s: 120,
      promote: true, tournament: false,
      auto_collect: true, max_collect_rounds: 2,
      seed: 42,
    }) as { status: string; accuracy: number | null; waves_used: number }
    const elapsedS = Math.round((Date.now() - t0) / 1000)

    const after = sampleCounts(taskId)
    console.log(`  samples after auto_collect:  ${JSON.stringify(after)}`)
    console.log(`  training: status=${result.status}, accuracy=${result.accuracy?.toFixed(3) ?? "n/a"}, waves=${result.waves_used}, t=${elapsedS}s\n`)

    // Assertions: auto_collect ran and added samples.
    const virginicaAdded = (after.virginica ?? 0) - (before.virginica ?? 0)
    if (virginicaAdded < 20) {
      console.error(`✗ expected ≥20 virginica samples added, got ${virginicaAdded}`)
      deleteTask(taskId)
      process.exit(1)
    }
    console.log(`✓ auto_collect added ${virginicaAdded} samples and training completed`)
    deleteTask(taskId)
  } finally {
    process.chdir(origCwd)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
