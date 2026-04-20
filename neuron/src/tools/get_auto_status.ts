import { z } from "zod"
import { getAutoRun, getLatestAutoRunForTask } from "../core/db/auto"

export const name = "get_auto_status"
export const description =
  "Get the status and live decision log for an auto_train invocation. Poll during training to follow coordinator progress cross-process."

export const schema = {
  auto_run_id: z
    .number()
    .int()
    .optional()
    .describe("Specific auto_run_id to query (returned by auto_train)"),
  task_id: z
    .string()
    .optional()
    .describe("Task ID — returns the most recent auto_run for this task"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (!args.auto_run_id && !args.task_id) {
    throw new Error("Provide auto_run_id or task_id")
  }

  const autoRun = args.auto_run_id
    ? getAutoRun(args.auto_run_id)
    : getLatestAutoRunForTask(args.task_id!)

  if (!autoRun) {
    throw new Error(
      args.auto_run_id
        ? `auto_run ${args.auto_run_id} not found`
        : `No auto_runs found for task "${args.task_id}"`,
    )
  }

  return {
    ok: true,
    auto_run_id: autoRun.id,
    task_id: autoRun.task_id,
    status: autoRun.status,
    started_at: autoRun.started_at,
    finished_at: autoRun.finished_at,
    accuracy_target: autoRun.accuracy_target,
    budget_s: autoRun.budget_s,
    max_waves: autoRun.max_waves,
    waves_used: autoRun.waves_used,
    winner_run_id: autoRun.winner_run_id,
    final_accuracy: autoRun.final_accuracy,
    verdict: autoRun.verdict,
    decision_log: autoRun.decision_log,
  }
}
