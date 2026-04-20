import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getRun } from "../core/db/runs"
import { getTask } from "../core/db/tasks"
import { hashFile } from "../core/registry/bundle"
import { writeBundle } from "../core/registry/bundle"
import { upsertEntry } from "../core/db/registry"
import { bundleDir, uriToSlug } from "../core/registry/paths"
import { loadConfig } from "../adapter/loader"
import { resolve } from "node:path"

export const name = "publish_model"
export const description =
  "Publish a trained model to the local registry at ~/.neuron/registry/, making it importable by any project."

export const schema = {
  run_id: z.number().int().describe("Completed run ID to publish"),
  name: z.string().min(1).describe("Registry name, e.g. 'iris-classifier'"),
  version: z.string().optional().describe("Version tag (default: today's date YYYY-MM-DD)"),
  description: z.string().optional().describe("Human-readable description"),
  tags: z.array(z.string()).optional().describe("Searchable tags"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)
  if (run.status !== "completed") throw new Error(`Run ${args.run_id} is ${run.status} — only completed runs can be published`)
  if (!run.weights) throw new Error(`Run ${args.run_id} has no weights — cannot publish`)

  const task = getTask(run.taskId)
  if (!task) throw new Error(`Task "${run.taskId}" not found`)

  const version = args.version ?? new Date().toISOString().slice(0, 10)
  const uri = `neuron://local/${args.name}@${version}`

  // Compute adapter hash for safety-checking imports
  const configPath = resolve(process.cwd(), "neuron.config.ts")
  const adapterHash = hashFile(configPath) || null

  const { bytes } = writeBundle(uri, {
    meta: {
      uri,
      task_id: task.id,
      kind: task.kind,
      labels: task.labels ?? [],
      feature_shape: task.featureShape,
      sample_shape: task.sampleShape,
      head_arch: (run.hyperparams?.headArch as number[] | undefined) ?? [],
      accuracy: run.accuracy,
      hyperparams: run.hyperparams,
      adapter_hash: adapterHash,
      neuron_version: "0.2.0",
      run_info: { run_id: run.id, finished_at: run.finishedAt },
    },
    weights: run.weights,
  })

  upsertEntry({
    uri,
    name: args.name,
    version,
    description: args.description ?? "",
    tags: args.tags ?? [],
    taskKind: task.kind,
    featureShape: task.featureShape,
    sampleShape: task.sampleShape,
    accuracy: run.accuracy,
    adapterHash,
    bundlePath: bundleDir(uriToSlug(uri)),
    createdAt: Math.floor(Date.now() / 1000),
  })

  return {
    ok: true,
    uri,
    name: args.name,
    version,
    accuracy: run.accuracy,
    adapter_hash: adapterHash,
    bundle_path: bundleDir(uriToSlug(uri)),
    bytes,
  }
}
