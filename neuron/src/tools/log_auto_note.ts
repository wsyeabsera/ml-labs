import { z } from "zod"
import { appendAutoLog, getAutoRun } from "../core/db/auto"
import { recordEvent } from "../core/db/events"

export const name = "log_auto_note"
export const description =
  "Internal coordinator tool — append a decision-log entry to an auto_run. Not for direct user use."

export const schema = {
  auto_run_id: z.number().int().describe("auto_runs.id to append to"),
  stage: z.string().describe("Pipeline stage label (e.g. preflight, sweep_wave_1, promote)"),
  note: z.string().describe("Human-readable note"),
  payload: z.unknown().optional().describe("Optional structured data to attach"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const autoRun = getAutoRun(args.auto_run_id)
  if (!autoRun) throw new Error(`auto_run ${args.auto_run_id} not found`)

  const entry = {
    ts: new Date().toISOString(),
    stage: args.stage,
    note: args.note,
    ...(args.payload !== undefined ? { payload: args.payload } : {}),
  }

  appendAutoLog(args.auto_run_id, entry)
  recordEvent({ source: "mcp", kind: "auto_note", taskId: autoRun.task_id, payload: { autoRunId: args.auto_run_id, stage: args.stage, note: args.note } })
  return { ok: true, ts: entry.ts, auto_run_id: args.auto_run_id }
}
