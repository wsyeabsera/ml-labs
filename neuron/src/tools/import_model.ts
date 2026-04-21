import { z } from "zod"
import { readBundle, readBundleDir, hashFile, type Bundle } from "../core/registry/bundle"
import { getTask, createTask } from "../core/db/tasks"
import { createImportedRun } from "../core/db/runs"
import { registerModel } from "../core/db/models"
import { setTaskTrained } from "../core/state"
import { resolve } from "node:path"

export const name = "import_model"
export const description =
  "Import a model into the current project. Accepts either a registry URI (for models published via publish_model) " +
  "or a filesystem bundle_path (for bundles written by export_model({bundle_path})). Creates a task (or uses an " +
  "existing one) and loads the weights without retraining."

export const schema = {
  uri: z.string().optional().describe("Registry URI, e.g. 'neuron://local/iris-classifier@2026-04-19'. Mutually exclusive with bundle_path."),
  bundle_path: z.string().optional().describe("Absolute path to a bundle directory (meta.json + weights.json + adapter.hash), as written by export_model({bundle_path}). Mutually exclusive with uri."),
  task_id: z.string().optional().describe("Target task ID (created if absent, using bundle's shape)"),
  force: z.boolean().default(false).describe("Skip adapter-hash mismatch check"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (!args.uri && !args.bundle_path) {
    throw new Error("Provide either uri (registry) or bundle_path (filesystem)")
  }
  if (args.uri && args.bundle_path) {
    throw new Error("Provide uri OR bundle_path, not both")
  }

  let bundle: Bundle | null
  let sourceLabel: string
  if (args.uri) {
    bundle = readBundle(args.uri)
    sourceLabel = args.uri
    if (!bundle) throw new Error(`Bundle not found for URI "${args.uri}". Use list_registry to see available models.`)
  } else {
    const dir = resolve(args.bundle_path!)
    bundle = readBundleDir(dir)
    sourceLabel = `file://${dir}`
    if (!bundle) throw new Error(`No bundle found at "${dir}" (expected meta.json + weights.json).`)
  }

  // Adapter hash safety check
  if (!args.force && bundle.meta.adapter_hash) {
    const localConfigPath = resolve(process.cwd(), "neuron.config.ts")
    const localHash = hashFile(localConfigPath)
    if (localHash && localHash !== bundle.meta.adapter_hash) {
      throw new Error(
        `Adapter hash mismatch — the bundle was trained with a different neuron.config.ts.\n` +
        `  bundle hash:  ${bundle.meta.adapter_hash}\n` +
        `  local hash:   ${localHash}\n` +
        `Pass force=true to import anyway (model may produce wrong results).`
      )
    }
  }

  const targetId = args.task_id ?? bundle.meta.task_id

  // Ensure task exists with matching shape
  let task = getTask(targetId)
  if (!task) {
    task = createTask({
      id: targetId,
      kind: bundle.meta.kind,
      labels: bundle.meta.labels,
      featureShape: bundle.meta.feature_shape,
      sampleShape: bundle.meta.sample_shape,
      normalize: false,
      featureNames: null,
    })
  }

  // Create a synthetic run row to hold the imported weights
  const run = createImportedRun(targetId, sourceLabel, bundle.weights, bundle.meta.accuracy)

  // Register it as the active model
  registerModel(targetId, run.id)

  // Update in-memory state so the TUI and predict tool see it immediately
  if (bundle.meta.labels.length > 0) {
    setTaskTrained(targetId, {
      labels: bundle.meta.labels,
      metrics: {
        accuracy: bundle.meta.accuracy ?? 0,
        perClassAccuracy: {},
        confusionMatrix: [],
      },
      lossHistory: [],
      sampleCounts: {},
      runId: run.id,
    })
  }

  return {
    ok: true,
    source: sourceLabel,
    task_id: targetId,
    run_id: run.id,
    accuracy: bundle.meta.accuracy,
    labels: bundle.meta.labels,
    feature_shape: bundle.meta.feature_shape,
    adapter_hash_matched: !bundle.meta.adapter_hash || args.force ? null : true,
  }
}
