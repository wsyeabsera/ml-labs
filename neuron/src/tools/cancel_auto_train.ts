import { z } from "zod"
import { abortByAutoRun, abortByTask, getController } from "../core/auto/registry"
import { getAutoRun, getLatestAutoRunForTask, updateAutoRun, appendAutoLog } from "../core/db/auto"
import { forceCancelRun } from "../core/db/runs"
import { recordEvent } from "../core/db/events"

export const name = "cancel_auto_train"
export const description =
  "Cancel a running auto_train coordinator. Provide task_id or auto_run_id. " +
  "Aborts the in-process coordinator (stops spawning new sub-agents, halts planner/tournament), " +
  "marks the auto_run and any in-flight child runs as cancelled."

export const schema = {
  task_id: z.string().optional().describe("Task ID — cancels the latest running auto_run for this task."),
  auto_run_id: z.number().int().optional().describe("Specific auto_run ID to cancel."),
}

export const outputSchema = {
  ok: z.boolean(),
  auto_run_id: z.number().int().nullable(),
  was_active: z.boolean().describe("True if an in-process coordinator was found and aborted."),
  child_runs_cancelled: z.array(z.number().int()).describe("Run IDs force-transitioned from running → cancelled."),
  message: z.string(),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (args.auto_run_id == null && !args.task_id) {
    throw new Error("Provide task_id or auto_run_id")
  }

  // Resolve target auto_run_id.
  let autoRunId: number | null = null
  if (args.auto_run_id != null) {
    const row = getAutoRun(args.auto_run_id)
    if (!row) return {
      ok: false, auto_run_id: args.auto_run_id, was_active: false,
      child_runs_cancelled: [], message: `Auto-run ${args.auto_run_id} not found`,
    }
    autoRunId = row.id
  } else if (args.task_id) {
    const latest = getLatestAutoRunForTask(args.task_id)
    if (!latest) return {
      ok: false, auto_run_id: null, was_active: false,
      child_runs_cancelled: [], message: `No auto_run found for task "${args.task_id}"`,
    }
    autoRunId = latest.id
  }

  if (autoRunId == null) {
    return { ok: false, auto_run_id: null, was_active: false, child_runs_cancelled: [], message: "Could not resolve auto_run_id" }
  }

  // If a coordinator is live in this process, trigger its abort and collect its
  // child run ids so we can also reap them here (belt-and-suspenders — the
  // controller's finally-block also reaps them, but if the coordinator is
  // stuck we want to transition the rows regardless).
  const live = args.auto_run_id != null
    ? abortByAutoRun(args.auto_run_id)
    : (args.task_id ? abortByTask(args.task_id) : null)
  const entry = getController(autoRunId) // may be null if we just aborted + raced deregister
  const childIds = live ? [...live.childRunIds] : entry ? [...entry.childRunIds] : []

  // Force-cancel any in-flight child runs.
  const cancelledChildren: number[] = []
  for (const childId of childIds) {
    if (forceCancelRun(childId, "cancelled")) cancelledChildren.push(childId)
  }

  // Write the auto_run row to cancelled if it's still running. If the controller
  // was live it'll also write its own cancelled verdict in its finally block,
  // but that may be a few hundred ms out — do it here too so the caller sees an
  // immediate state change.
  const current = getAutoRun(autoRunId)
  if (current && current.status === "running") {
    updateAutoRun(autoRunId, {
      status: "cancelled",
      finished_at: new Date().toISOString(),
      verdict: "cancelled by operator",
    })
    appendAutoLog(autoRunId, {
      ts: new Date().toISOString(),
      stage: "cancelled",
      note: live
        ? `cancel requested — coordinator aborted, ${cancelledChildren.length} child run(s) reaped`
        : `cancel requested — no active coordinator in this process (zombie row)${cancelledChildren.length ? `, ${cancelledChildren.length} child run(s) reaped` : ""}`,
      payload: { via: "cancel_auto_train", reaped: cancelledChildren },
    })
    recordEvent({
      source: "mcp",
      kind: "auto_cancelled",
      taskId: current.task_id,
      payload: { auto_run_id: autoRunId, reaped: cancelledChildren.length },
    })
  }

  return {
    ok: true,
    auto_run_id: autoRunId,
    was_active: live != null,
    child_runs_cancelled: cancelledChildren,
    message: live
      ? `Aborted coordinator for auto_run ${autoRunId}${cancelledChildren.length ? `; reaped ${cancelledChildren.length} child run(s)` : ""}`
      : `Auto_run ${autoRunId} had no active coordinator — marked cancelled${cancelledChildren.length ? `, ${cancelledChildren.length} child run(s) reaped` : ""}`,
  }
}
