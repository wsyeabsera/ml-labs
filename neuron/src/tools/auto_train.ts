import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { createAutoRun } from "../core/db/auto"
import { runCoordinator } from "../core/auto/coordinator"
import { recordEvent } from "../core/db/events"

export const name = "auto_train"
export const description =
  "Fully automated ML pipeline: spawns a Claude coordinator sub-agent that runs preflight, " +
  "suggests hyperparams, sweeps in waves, evaluates, and promotes the winner. " +
  "Budget is enforced at wave boundaries (one wave may exceed budget_s). " +
  "Use get_auto_status to follow coordinator progress cross-process."

export const schema = {
  task_id: z.string().describe("Task ID to auto-train"),
  accuracy_target: z
    .number()
    .min(0)
    .max(1)
    .default(0.9)
    .describe("Target accuracy to stop early (default: 0.9)"),
  max_waves: z
    .number()
    .int()
    .positive()
    .default(2)
    .describe("Max sweep waves (default: 2 — coarse then refinement)"),
  budget_s: z
    .number()
    .int()
    .positive()
    .default(180)
    .describe("Soft wall-clock budget in seconds (default: 180). One wave may exceed this."),
  promote: z
    .boolean()
    .default(true)
    .describe("Register winner as active model after training (default: true)"),
  publish_name: z
    .string()
    .optional()
    .describe("If set, publish winner to registry with this name after promotion"),
  publish_version: z
    .string()
    .optional()
    .describe("Registry version string (default: today's date)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found — create it first`)

  const autoRun = createAutoRun(args.task_id, {
    accuracy_target: args.accuracy_target,
    budget_s: args.budget_s,
    max_waves: args.max_waves,
  })

  recordEvent({ source: "mcp", kind: "auto_started", taskId: args.task_id, payload: { autoRunId: autoRun.id, accuracyTarget: args.accuracy_target, budgetS: args.budget_s } })

  const taskKind: "classification" | "regression" = task.kind === "regression" ? "regression" : "classification"

  const result = await runCoordinator({
    task_id: args.task_id,
    task_kind: taskKind,
    auto_run_id: autoRun.id,
    accuracy_target: args.accuracy_target,
    max_waves: args.max_waves,
    budget_s: args.budget_s,
    promote: args.promote,
    publish_name: args.publish_name,
    publish_version: args.publish_version ?? new Date().toISOString().slice(0, 10),
  })

  recordEvent({ source: "mcp", kind: "auto_completed", taskId: args.task_id, payload: { autoRunId: autoRun.id, status: result.status, runId: result.run_id, accuracy: result.accuracy, wallClockS: result.wall_clock_s } })

  return {
    ok: result.status === "completed",
    auto_run_id: autoRun.id,
    status: result.status,
    run_id: result.run_id,
    accuracy: result.accuracy,
    waves_used: result.waves_used,
    verdict: result.verdict,
    published_uri: result.published_uri,
    wall_clock_s: result.wall_clock_s,
  }
}
