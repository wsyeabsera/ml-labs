import { z } from "zod"
import { getRun } from "../core/db/runs"

export const name = "evaluate"
export const description = "Get full metrics for a completed training run: accuracy, per-class breakdown, confusion matrix."

export const schema = {
  run_id: z.number().int().describe("Run ID to evaluate"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)

  return {
    run_id: args.run_id,
    task_id: run.taskId,
    status: run.status,
    accuracy: run.accuracy,
    per_class_accuracy: run.perClassAccuracy,
    confusion_matrix: run.confusionMatrix,
    loss_history: run.lossHistory,
    sample_counts: run.sampleCounts,
    hyperparams: run.hyperparams,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    duration_s: run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null,
  }
}
