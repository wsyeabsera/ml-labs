import { z } from "zod"
import { getRun } from "../core/db/runs"
import { registerModel, getRegisteredModel } from "../core/db/models"

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

  return {
    ok: true,
    task_id: args.task_id,
    run_id: args.run_id,
    accuracy: run.accuracy,
    previous_run_id: previous?.runId ?? null,
  }
}
