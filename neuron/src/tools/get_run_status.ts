import { z } from "zod"
import { getRun } from "../core/db/runs"
import { getRunProgress } from "../core/state"

export const name = "get_run_status"
export const description = "Get live training progress for a run. Polls in-memory state during training; falls back to DB for completed runs or cross-process runs (sweeps)."

export const schema = {
  run_id: z.number().int().describe("Run ID to query"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)

  // In-memory progress: available when the run is in this process
  const memProgress = getRunProgress(args.run_id)
  if (memProgress) {
    return {
      run_id: args.run_id,
      status: "running",
      stage: memProgress.stage,
      i: memProgress.i ?? null,
      n: memProgress.n ?? null,
      message: memProgress.message,
      loss_history: memProgress.lossHistory,
      epochs_done: memProgress.epochsDone,
    }
  }

  // DB progress: written by sub-agent processes during sweeps
  if (run.status === "running" && run.runProgress) {
    const p = run.runProgress
    return {
      run_id: args.run_id,
      status: "running",
      stage: p.stage,
      i: p.i ?? null,
      n: p.n ?? null,
      message: p.message,
      loss_history: p.lossHistory,
      epochs_done: p.epochsDone,
    }
  }

  return {
    run_id: args.run_id,
    status: run.status,
    stage: run.status === "completed" ? "weights" : null,
    i: null,
    n: null,
    message: run.status === "completed" ? "Training complete" : `Run is ${run.status}`,
    loss_history: run.lossHistory ?? [],
    epochs_done: (run.hyperparams?.epochs as number | undefined) ?? 0,
  }
}
