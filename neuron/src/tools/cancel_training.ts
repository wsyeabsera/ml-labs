import { z } from "zod"
import { getTaskState } from "../core/state"
import { getRun, forceCancelRun } from "../core/db/runs"

export const name = "cancel_training"
export const description =
  "Cancel a running training job. Aborts the in-process worker if one is " +
  "tracking the run. Use `force: true` to mark a DB-running row cancelled " +
  "when no in-process worker is tracking it (zombie cleanup)."

export const schema = {
  task_id: z.string().optional().describe("Task ID (finds active run automatically)"),
  run_id: z.number().int().optional().describe("Specific run ID to cancel"),
  force: z.boolean().default(false).describe(
    "Force-transition a DB-running run to cancelled even when no in-process worker is tracking it. Useful for zombies left behind by crashes or out-of-band kills.",
  ),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (args.task_id) {
    const s = getTaskState(args.task_id)
    if (s.abortController && s.activeRunId) {
      s.abortController.abort()
      return { ok: true, cancelled_run_id: s.activeRunId, forced: false }
    }
    return { ok: false, message: "No active training run for this task" }
  }

  if (args.run_id) {
    const run = getRun(args.run_id)
    if (!run) throw new Error(`Run ${args.run_id} not found`)
    const s = getTaskState(run.taskId)
    if (s.activeRunId === args.run_id && s.abortController) {
      s.abortController.abort()
      return { ok: true, cancelled_run_id: args.run_id, forced: false }
    }
    // Zombie path: DB says running but no in-process worker is tracking it.
    if (args.force && (run.status === "running" || run.status === "pending")) {
      const ok = forceCancelRun(args.run_id, "cancelled")
      return {
        ok,
        cancelled_run_id: args.run_id,
        forced: true,
        message: ok
          ? `Force-cancelled run ${args.run_id} (no in-process worker was tracking it).`
          : `Run ${args.run_id} is already in a terminal state.`,
      }
    }
    return {
      ok: false,
      message: run.status !== "running" && run.status !== "pending"
        ? `Run ${args.run_id} is already ${run.status}`
        : "Run is not currently active (no in-process worker). Pass `force: true` to transition the DB row anyway.",
    }
  }

  throw new Error("Provide task_id or run_id")
}
