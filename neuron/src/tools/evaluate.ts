import { z } from "zod"
import { getRun } from "../core/db/runs"

export const name = "evaluate"
export const description = "Get full metrics for a completed training run: accuracy, val_accuracy, per-class breakdown, confusion matrix, regression metrics (MAE/RMSE/R²)."

export const schema = {
  run_id: z.number().int().describe("Run ID to evaluate"),
}

export const outputSchema = {
  run_id: z.number(),
  task_id: z.string(),
  status: z.string(),
  accuracy: z.number().nullable(),
  val_accuracy: z.number().nullable(),
  per_class_accuracy: z.record(z.string(), z.number()).nullable(),
  confusion_matrix: z.array(z.array(z.number())).nullable(),
  loss_history: z.array(z.number()).nullable(),
  mae: z.number().nullable(),
  rmse: z.number().nullable(),
  r2: z.number().nullable(),
  sample_counts: z.record(z.string(), z.number()).nullable(),
  hyperparams: z.record(z.string(), z.unknown()),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  duration_s: z.number().nullable(),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)

  return {
    run_id: args.run_id,
    task_id: run.taskId,
    status: run.status,
    accuracy: run.accuracy,
    val_accuracy: run.valAccuracy,
    per_class_accuracy: run.perClassAccuracy,
    confusion_matrix: run.confusionMatrix,
    loss_history: run.lossHistory,
    mae: run.mae,
    rmse: run.rmse,
    r2: run.r2,
    sample_counts: run.sampleCounts,
    hyperparams: run.hyperparams,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    duration_s: run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null,
  }
}
