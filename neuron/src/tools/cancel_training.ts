import { z } from "zod"
import { getTaskState } from "../core/state"
import { getRun } from "../core/db/runs"
import { listTasks } from "../core/db/tasks"

export const name = "cancel_training"
export const description = "Cancel a running training job."

export const schema = {
  task_id: z.string().optional().describe("Task ID (finds active run automatically)"),
  run_id: z.number().int().optional().describe("Specific run ID to cancel"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (args.task_id) {
    const s = getTaskState(args.task_id)
    if (!s.abortController || !s.activeRunId) {
      return { ok: false, message: "No active training run for this task" }
    }
    s.abortController.abort()
    return { ok: true, cancelled_run_id: s.activeRunId }
  }

  if (args.run_id) {
    const run = getRun(args.run_id)
    if (!run) throw new Error(`Run ${args.run_id} not found`)
    const s = getTaskState(run.taskId)
    if (s.activeRunId !== args.run_id || !s.abortController) {
      return { ok: false, message: "Run is not currently active" }
    }
    s.abortController.abort()
    return { ok: true, cancelled_run_id: args.run_id }
  }

  throw new Error("Provide task_id or run_id")
}
