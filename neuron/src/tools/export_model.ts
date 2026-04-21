import { z } from "zod"
import { resolve } from "node:path"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"
import { writeBundleDir, hashFile, type BundleMeta } from "../core/registry/bundle"

export const name = "export_model"
export const description =
  "Export the active model. Two output shapes: " +
  "(a) omit bundle_path → return a portable unified JSON inline (weights + metadata + metrics) " +
  "for hand-off via chat / commit. " +
  "(b) pass bundle_path → write the same bundle format publish_model produces to that directory. " +
  "Shape (b) round-trips with import_model({bundle_path: ...}) and with publish_model."

export const schema = {
  task_id: z.string().describe("Task ID to export"),
  bundle_path: z.string().optional().describe(
    "If set, write a bundle directory (meta.json + weights.json + adapter.hash) at this absolute path, matching publish_model's format. The directory will be created if missing. When omitted, returns a unified JSON inline instead.",
  ),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}"`)
  }

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)
  const run = model.run

  if (!run.weights) {
    throw new Error(`Run ${run.id} has no weights — cannot export`)
  }

  // Bundle-path mode — same on-disk layout as publish_model.
  if (args.bundle_path) {
    const outDir = resolve(args.bundle_path)
    const configPath = resolve(process.cwd(), "neuron.config.ts")
    const adapterHash = hashFile(configPath) || null
    const uri = `file://${outDir}`

    const meta: BundleMeta = {
      uri,
      task_id: args.task_id,
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
    }

    const { dir, bytes } = writeBundleDir(outDir, { meta, weights: run.weights })
    return {
      ok: true,
      format: "bundle" as const,
      bundle_path: dir,
      bytes,
      accuracy: run.accuracy,
      val_accuracy: run.valAccuracy,
      adapter_hash: adapterHash,
      run_id: run.id,
      note: "Round-trips with `import_model({bundle_path: '<this dir>'})`.",
    }
  }

  // Inline JSON mode — the old behavior, unchanged for back-compat.
  return {
    format: "unified_json" as const,
    neuron_version: "0.2.0",
    task_id: args.task_id,
    kind: task.kind,
    labels: task.labels ?? [],
    feature_shape: task.featureShape,
    feature_names: task.featureNames ?? [],
    normalize: task.normalize ?? false,
    accuracy: run.accuracy,
    val_accuracy: run.valAccuracy,
    per_class_accuracy: run.perClassAccuracy,
    confusion_matrix: run.confusionMatrix,
    mae: run.mae,
    rmse: run.rmse,
    r2: run.r2,
    norm_stats: run.normStats,
    hyperparams: run.hyperparams,
    weights: run.weights,
    trained_at: run.finishedAt,
  }
}
