import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { insertSample, sampleCounts } from "../core/db/samples"
import { loadConfig } from "../adapter/loader"
import { log } from "../core/logger"
import { readFileSync, existsSync } from "node:fs"

export const name = "load_json"
export const description = "Batch-ingest a JSON array as samples. Each element must have {label, features?:number[], raw?} fields."

export const schema = {
  task_id: z.string().describe("Task ID to load samples into"),
  path: z.string().describe("Path to a JSON file containing an array of {label, features?, raw?} objects"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  if (!existsSync(args.path)) throw new Error(`File not found: ${args.path}`)

  let records: unknown[]
  try {
    records = JSON.parse(readFileSync(args.path, "utf-8")) as unknown[]
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!Array.isArray(records)) throw new Error("JSON file must contain an array at the top level")

  const config = await loadConfig()
  const errors: string[] = []
  let inserted = 0
  const knownLabels = new Set(task.labels ?? [])

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] as Record<string, unknown>
    if (!rec || typeof rec !== "object") { errors.push(`Index ${i}: not an object`); continue }

    const label = typeof rec.label === "string" ? rec.label.trim() : null
    if (!label) { errors.push(`Index ${i}: missing or non-string "label" field`); continue }

    let features: number[] | null = null

    if (Array.isArray(rec.features)) {
      features = rec.features as number[]
    } else if (rec.raw !== undefined) {
      if (!config?.featurize) {
        errors.push(`Index ${i}: has "raw" but no featurize in neuron.config.ts`)
        continue
      }
      try {
        features = await config.featurize(rec.raw)
      } catch (e) {
        errors.push(`Index ${i}: featurize failed — ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
    } else {
      errors.push(`Index ${i}: must have "features" or "raw" field`)
      continue
    }

    insertSample(args.task_id, label, features, rec.raw)
    inserted++
    if (!knownLabels.has(label)) {
      knownLabels.add(label)
      updateTaskLabels(args.task_id, [...knownLabels].sort())
    }
  }

  const counts = sampleCounts(args.task_id)
  log(`JSON load complete: ${inserted} inserted, ${errors.length} errors`)

  return {
    ok: true,
    inserted,
    skipped: errors.length,
    errors: errors.slice(0, 20),
    per_label: counts,
  }
}
