import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"

export const name = "export_model"
export const description = "Export the active model as a portable JSON artifact (weights, config, labels, metrics)."

export const schema = {
  task_id: z.string().describe("Task ID to export"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}"`)
  }

  const task = getTask(args.task_id)
  const run = model.run

  return {
    neuron_version: "0.1.0",
    task_id: args.task_id,
    kind: task?.kind ?? "classification",
    labels: task?.labels ?? [],
    feature_shape: task?.featureShape ?? [],
    accuracy: run.accuracy,
    per_class_accuracy: run.perClassAccuracy,
    confusion_matrix: run.confusionMatrix,
    hyperparams: run.hyperparams,
    weights: run.weights,
    trained_at: run.finishedAt,
  }
}
