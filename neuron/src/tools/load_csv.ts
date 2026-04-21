import { z } from "zod"
import { getTask, updateTaskLabels, updateTaskFeatureNames } from "../core/db/tasks"
import { insertSamplesBatch, sampleCounts, splitCounts } from "../core/db/samples"
import { loadCsv } from "../core/loaders/csv"
import { recordEvent } from "../core/db/events"
import { log } from "../core/logger"
import { existsSync, statSync } from "node:fs"
import { createRng, resolveSeed } from "../util/rng"
import { estimateTrainingBudget } from "../core/memory_budget"

// Size guards. 500MB default cap keeps a real 130MB load fine while blocking
// catastrophic accidents (a 5GB log file dropped in by mistake). Override with
// max_bytes if you actually need to load huge CSVs.
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024
const WARN_BYTES = 100 * 1024 * 1024
// Rows per SQLite transaction. Keeps memory bounded and amortizes fsync cost.
const INSERT_BATCH_SIZE = 5000

export const name = "load_csv"
export const description =
  "Batch-ingest a CSV file as samples for a task. Streams inserts in batches of 5000 " +
  "(previously per-row — crashed on >100MB files due to SQLite fsync spam). Default 500MB " +
  "file-size guard; pass max_bytes to override."

export const schema = {
  task_id: z.string().describe("Task ID to load samples into"),
  path: z.string().describe("Absolute or relative path to the CSV file"),
  label_column: z.string().describe("Column name containing the class label or regression target"),
  feature_columns: z.array(z.string()).optional().describe("Column names to use as features. Omit to use all non-label columns."),
  has_header: z.boolean().default(true).describe("Whether the CSV has a header row (default: true)"),
  test_size: z.number().min(0).max(0.5).default(0.2).describe("Fraction of data to reserve as test set (default 0.2 = 20% held-out). Pass 0 to put everything in train — but auto_train will then report training accuracy as the winner metric, which is not honest."),
  stratify: z.union([z.literal("auto"), z.boolean()]).default("auto").describe("Whether to preserve class proportions in train/test split. 'auto' (default) enables stratification for classification tasks only; set true/false to override."),
  seed: z.number().int().optional().describe("Seed for the train/test split shuffle. Overrides NEURON_SEED env var. When set, the same seed produces the same split."),
  max_bytes: z.number().int().positive().optional().describe("Override the default 500MB file-size cap. Useful for trusted large datasets; set to the file's size or higher. Raising past 1GB is not recommended on laptops."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  if (!existsSync(args.path)) throw new Error(`File not found: ${args.path}`)

  // Size guard — run this BEFORE readFileSync. A 5GB accidental drop would
  // otherwise just run the process out of memory trying to buffer it.
  const fileSize = statSync(args.path).size
  const maxBytes = args.max_bytes ?? DEFAULT_MAX_BYTES
  if (fileSize > maxBytes) {
    const mb = (fileSize / 1024 / 1024).toFixed(1)
    const capMb = (maxBytes / 1024 / 1024).toFixed(0)
    throw new Error(
      `CSV file is ${mb}MB, above the ${capMb}MB safety cap. ` +
      `Pass max_bytes=${fileSize} to explicitly allow it, or split the CSV.`,
    )
  }
  if (fileSize > WARN_BYTES) {
    log(`Warning: loading large CSV (${(fileSize / 1024 / 1024).toFixed(1)}MB) — this may take a minute.`)
  }

  const expectedDim = task.featureShape[0]
  log(`Loading CSV: ${args.path} → task "${args.task_id}" (D=${expectedDim})`)

  const { rows, errors, featureNames } = loadCsv({
    path: args.path,
    featureColumns: args.feature_columns ?? "all",
    labelColumn: args.label_column,
    hasHeader: args.has_header,
    expectedDim,
  })

  if (rows.length === 0) {
    return { ok: true, inserted: 0, skipped: errors.length, errors: errors.slice(0, 20), per_label: {}, splits: { train: 0, test: 0 } }
  }

  // Save feature names for inspect_data
  if (featureNames && featureNames.length > 0) {
    updateTaskFeatureNames(args.task_id, featureNames)
  }

  // Resolve stratify: "auto" → true for classification, false for regression.
  const stratify = args.stratify === "auto" ? task.kind !== "regression" : args.stratify

  // Assign train/test splits (seeded for reproducibility when seed provided).
  const splits = assignSplits(rows, task.kind, args.test_size, resolveSeed(args.seed), stratify)

  const isRegression = task.kind === "regression"

  // Pre-collect labels so we do ONE updateTaskLabels write at the end instead
  // of one per novel class encountered during inserts (v1.6.3 perf fix).
  const knownLabels = new Set(task.labels ?? [])
  if (!isRegression) {
    for (const row of rows) knownLabels.add(row.label)
    updateTaskLabels(args.task_id, [...knownLabels].sort())
  }

  // Batched inserts. Previously this loop called insertSample per row → N
  // individual SQLite transactions → N fsyncs → 130MB files would stall or
  // crash. Now we insert in chunks of 5000 via insertSamplesBatch (single
  // transaction per chunk). Typical wall-clock drops from minutes to seconds.
  recordEvent({
    source: "mcp", kind: "csv_load_started", taskId: args.task_id,
    payload: { path: args.path, rows: rows.length, size_bytes: fileSize },
  })

  let inserted = 0
  let batch: Parameters<typeof insertSamplesBatch>[0] = []
  const flush = () => {
    if (batch.length === 0) return
    insertSamplesBatch(batch)
    inserted += batch.length
    batch = []
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    batch.push({
      taskId: args.task_id,
      label: row.label,
      features: row.features,
      split: splits[i]!,
    })
    if (batch.length >= INSERT_BATCH_SIZE) {
      flush()
      // Emit progress every batch so dashboard / status polls see forward motion.
      recordEvent({
        source: "mcp", kind: "csv_load_progress", taskId: args.task_id,
        payload: { inserted, total: rows.length },
      })
    }
  }
  flush()

  const counts = sampleCounts(args.task_id)
  const splitSummary = splitCounts(args.task_id)
  log(`CSV load complete: ${inserted} inserted (${splitSummary.train} train / ${splitSummary.test} test), ${errors.length} errors`)

  recordEvent({
    source: "mcp", kind: "csv_load_completed", taskId: args.task_id,
    payload: { inserted, errors: errors.length, train: splitSummary.train, test: splitSummary.test },
  })

  // Phase 11.7: attach training memory budget so Claude can warn the user
  // before they invoke auto_train on an overwhelming dataset.
  const N_train = splitSummary.train
  const D = rows[0]?.features.length ?? task.featureShape[0] ?? 0
  const K = task.kind === "regression" ? 1 : Object.keys(counts).length
  const training_budget = estimateTrainingBudget({
    N: N_train, D, K,
    kind: task.kind === "regression" ? "regression" : "classification",
  })
  if (training_budget.level === "heavy" || training_budget.level === "refuse") {
    log(`Training budget: ${training_budget.headline}`)
  }

  return {
    ok: true,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    per_label: counts,
    splits: splitSummary,
    training_budget,
  }
}

export function assignSplits(
  rows: { label: string; features: number[] }[],
  kind: string,
  testSize?: number,
  seed?: number,
  stratify?: boolean,
): ("train" | "test")[] {
  const result: ("train" | "test")[] = new Array(rows.length).fill("train")
  if (!testSize || testSize <= 0) return result

  const rng = createRng(seed)
  const doStratify = stratify ?? (kind !== "regression")

  if (!doStratify) {
    // Plain random split
    const indices = rng.shuffle([...Array(rows.length).keys()])
    const nTest = Math.round(rows.length * testSize)
    for (let i = 0; i < nTest; i++) result[indices[i]!] = "test"
  } else {
    // Stratified split: preserve class distribution in both splits.
    // Object.keys preserves insertion order in JS, so we sort for determinism.
    const byClass: Record<string, number[]> = {}
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i]!.label
      if (!byClass[label]) byClass[label] = []
      byClass[label]!.push(i)
    }
    const classNames = Object.keys(byClass).sort()
    for (const name of classNames) {
      const shuffled = rng.shuffle([...byClass[name]!])
      const nTest = Math.max(1, Math.round(shuffled.length * testSize))
      for (let i = 0; i < nTest && i < shuffled.length; i++) {
        result[shuffled[i]!] = "test"
      }
    }
  }

  return result
}
