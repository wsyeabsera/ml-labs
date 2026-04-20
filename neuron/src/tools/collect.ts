import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { insertSample, sampleCounts } from "../core/db/samples"
import { loadConfig } from "../adapter/loader"

export const name = "collect"
export const description = "Add a labeled sample to the task dataset. Provide pre-computed features OR raw input (if a neuron.config.ts featurize function is available)."

export const schema = {
  task_id: z.string().describe("Task ID to add sample to"),
  label: z.string().min(1).describe("Class label"),
  features: z.array(z.number()).optional().describe("Pre-computed feature vector"),
  raw: z.unknown().optional().describe("Raw input (patches, pixels, etc.) — server will featurize if config provides a featurize function"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found. Call create_task first.`)

  let features = args.features
  if (!features) {
    if (!args.raw) throw new Error("Provide either features or raw input")
    const config = await loadConfig()
    if (!config?.featurize) throw new Error("No featurize function in neuron.config.ts — provide pre-computed features")
    features = await config.featurize(args.raw)
  }

  const id = insertSample(args.task_id, args.label, features, args.raw)

  // Auto-register label on task if new
  const allLabels = new Set(task.labels ?? [])
  if (!allLabels.has(args.label)) {
    allLabels.add(args.label)
    updateTaskLabels(args.task_id, [...allLabels].sort())
  }

  const counts = sampleCounts(args.task_id)
  return { ok: true, id, label: args.label, feature_dim: features.length, counts }
}
