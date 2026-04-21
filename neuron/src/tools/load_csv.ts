import { z } from "zod"
import { getTask, updateTaskLabels, updateTaskFeatureNames } from "../core/db/tasks"
import { insertSample, sampleCounts, splitCounts } from "../core/db/samples"
import { loadCsv } from "../core/loaders/csv"
import { log } from "../core/logger"
import { existsSync } from "node:fs"
import { createRng, resolveSeed } from "../util/rng"

export const name = "load_csv"
export const description = "Batch-ingest a CSV file as samples for a task. Supports stratified train/test split."

export const schema = {
  task_id: z.string().describe("Task ID to load samples into"),
  path: z.string().describe("Absolute or relative path to the CSV file"),
  label_column: z.string().describe("Column name containing the class label or regression target"),
  feature_columns: z.array(z.string()).optional().describe("Column names to use as features. Omit to use all non-label columns."),
  has_header: z.boolean().default(true).describe("Whether the CSV has a header row (default: true)"),
  test_size: z.number().min(0).max(0.5).optional().describe("Fraction of data to reserve as test set (e.g. 0.2 for 20%). Omit to use all data for training."),
  stratify: z.union([z.literal("auto"), z.boolean()]).default("auto").describe("Whether to preserve class proportions in train/test split. 'auto' (default) enables stratification for classification tasks only; set true/false to override."),
  seed: z.number().int().optional().describe("Seed for the train/test split shuffle. Overrides NEURON_SEED env var. When set, the same seed produces the same split."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  if (!existsSync(args.path)) throw new Error(`File not found: ${args.path}`)

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

  let inserted = 0
  const knownLabels = new Set(task.labels ?? [])
  const isRegression = task.kind === "regression"

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const split = splits[i]!
    insertSample(args.task_id, row.label, row.features, undefined, split)
    inserted++
    if (!isRegression && !knownLabels.has(row.label)) {
      knownLabels.add(row.label)
      updateTaskLabels(args.task_id, [...knownLabels].sort())
    }
  }

  const counts = sampleCounts(args.task_id)
  const splitSummary = splitCounts(args.task_id)
  log(`CSV load complete: ${inserted} inserted (${splitSummary.train} train / ${splitSummary.test} test), ${errors.length} errors`)

  return {
    ok: true,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    per_label: counts,
    splits: splitSummary,
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
