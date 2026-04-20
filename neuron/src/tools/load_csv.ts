import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { insertSample, sampleCounts } from "../core/db/samples"
import { loadCsv } from "../core/loaders/csv"
import { log } from "../core/logger"
import { existsSync } from "node:fs"

export const name = "load_csv"
export const description = "Batch-ingest a CSV file as samples for a task. Specify which columns are features and which is the label."

export const schema = {
  task_id: z.string().describe("Task ID to load samples into"),
  path: z.string().describe("Absolute or relative path to the CSV file"),
  label_column: z.string().describe("Column name (or 0-based index as string) containing the class label"),
  feature_columns: z.array(z.string()).optional().describe("Column names to use as features. Omit to use all non-label columns."),
  has_header: z.boolean().default(true).describe("Whether the CSV has a header row (default: true)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  if (!existsSync(args.path)) throw new Error(`File not found: ${args.path}`)

  const expectedDim = task.featureShape[0]
  log(`Loading CSV: ${args.path} → task "${args.task_id}" (D=${expectedDim})`)

  const { rows, errors } = loadCsv({
    path: args.path,
    featureColumns: args.feature_columns ?? "all",
    labelColumn: args.label_column,
    hasHeader: args.has_header,
    expectedDim,
  })

  let inserted = 0
  const knownLabels = new Set(task.labels ?? [])

  for (const row of rows) {
    insertSample(args.task_id, row.label, row.features, undefined)
    inserted++
    if (!knownLabels.has(row.label)) {
      knownLabels.add(row.label)
      updateTaskLabels(args.task_id, [...knownLabels].sort())
    }
  }

  const counts = sampleCounts(args.task_id)
  log(`CSV load complete: ${inserted} inserted, ${errors.length} errors`)

  return {
    ok: true,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    per_label: counts,
  }
}
