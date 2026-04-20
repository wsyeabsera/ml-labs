import { z } from "zod"
import { readBundle, hashFile } from "../core/registry/bundle"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { createImportedRun } from "../core/db/runs"
import { registerModel } from "../core/db/models"
import { setTaskTrained } from "../core/state"
import { resolve } from "node:path"

export const name = "load_model"
export const description =
  "Load weights from a registry model into an existing task without retraining. The task must already exist with a matching feature shape."

export const schema = {
  task_id: z.string().describe("Existing task ID to load the model into"),
  uri: z.string().describe("Registry URI, e.g. 'neuron://local/iris-classifier@2026-04-19'"),
  force: z.boolean().default(false).describe("Skip adapter-hash mismatch check"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found — use import_model to create it`)

  const bundle = readBundle(args.uri)
  if (!bundle) throw new Error(`Bundle not found for URI "${args.uri}". Use list_registry to see available models.`)

  // Adapter hash safety check
  if (!args.force && bundle.meta.adapter_hash) {
    const localConfigPath = resolve(process.cwd(), "neuron.config.ts")
    const localHash = hashFile(localConfigPath)
    if (localHash && localHash !== bundle.meta.adapter_hash) {
      throw new Error(
        `Adapter hash mismatch — the bundle was trained with a different neuron.config.ts.\n` +
        `  bundle hash:  ${bundle.meta.adapter_hash}\n` +
        `  local hash:   ${localHash}\n` +
        `Pass force=true to load anyway.`
      )
    }
  }

  // Shape check
  const bundleD = bundle.meta.feature_shape[0]
  const taskD = task.featureShape[0]
  if (bundleD !== undefined && taskD !== undefined && bundleD !== taskD) {
    throw new Error(
      `Feature shape mismatch: bundle expects [${bundle.meta.feature_shape}], task has [${task.featureShape}]. Use force=true to skip.`
    )
  }

  const run = createImportedRun(args.task_id, args.uri, bundle.weights, bundle.meta.accuracy)
  registerModel(args.task_id, run.id)

  if (bundle.meta.labels.length > 0) {
    updateTaskLabels(args.task_id, bundle.meta.labels)
    setTaskTrained(args.task_id, {
      labels: bundle.meta.labels,
      metrics: { accuracy: bundle.meta.accuracy ?? 0, perClassAccuracy: {}, confusionMatrix: [] },
      lossHistory: [],
      sampleCounts: {},
      runId: run.id,
    })
  }

  return {
    ok: true,
    task_id: args.task_id,
    uri: args.uri,
    run_id: run.id,
    accuracy: bundle.meta.accuracy,
    labels: bundle.meta.labels,
  }
}
