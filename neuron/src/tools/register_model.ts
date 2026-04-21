import { z } from "zod"
import { getRun } from "../core/db/runs"
import { registerModel, getRegisteredModel } from "../core/db/models"
import { recordEvent } from "../core/db/events"

export const name = "register_model"
export const description = "Promote a completed training run to be the active model for its task."

export const schema = {
  task_id: z.string().describe("Task ID"),
  run_id: z.number().int().describe("Run ID to promote"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)
  if (run.taskId !== args.task_id) throw new Error(`Run ${args.run_id} belongs to task "${run.taskId}", not "${args.task_id}"`)
  if (run.status !== "completed") throw new Error(`Run ${args.run_id} is ${run.status} — only completed runs can be registered`)

  const previous = getRegisteredModel(args.task_id)
  registerModel(args.task_id, args.run_id)

  // Prefer val_accuracy as the "headline" number when a held-out split exists.
  // run.accuracy is *training* accuracy (the metric computed over the training
  // set at finalize time); val_accuracy is the honest generalization number.
  // v1.6.1 bug fix: previously we returned training accuracy as just `accuracy`,
  // which made re-promotions look like they "lost ~15pp" when the caller re-evaluated
  // on held-out data elsewhere (e.g. model_stats).
  const trainAcc = run.accuracy
  const valAcc = run.valAccuracy
  const headline = valAcc ?? trainAcc

  recordEvent({
    source: "mcp",
    kind: "model_registered",
    taskId: args.task_id,
    runId: args.run_id,
    payload: {
      accuracy: headline,
      train_accuracy: trainAcc,
      val_accuracy: valAcc,
      previousRunId: previous?.runId ?? null,
    },
  })

  return {
    ok: true,
    task_id: args.task_id,
    run_id: args.run_id,
    accuracy: headline,
    train_accuracy: trainAcc,
    val_accuracy: valAcc,
    accuracy_source: valAcc != null ? "val_split" : "train_set",
    previous_run_id: previous?.runId ?? null,
  }
}
