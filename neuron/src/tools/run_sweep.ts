import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { listRuns, getRun } from "../core/db/runs"
import { registerModel } from "../core/db/models"
import { expandGrid } from "../core/sweep/configs"
import { runSweep } from "../core/sweep/orchestrator"

export const name = "run_sweep"
export const description =
  "Run a parallel hyperparameter sweep for a task. Spawns N Claude sub-agents concurrently, each training one config. Returns all run results and auto-promotes the winner."

export const schema = {
  task_id: z.string().describe("Task ID to sweep"),
  configs: z
    .array(z.object({
      lr: z.number().positive().optional(),
      epochs: z.number().int().positive().optional(),
      head_arch: z.array(z.number().int().positive()).optional(),
    }))
    .optional()
    .describe("Explicit list of hyperparameter configs to try"),
  search: z
    .object({
      lr: z.array(z.number().positive()).optional(),
      epochs: z.array(z.number().int().positive()).optional(),
      head_arch: z.array(z.array(z.number().int().positive())).optional(),
    })
    .optional()
    .describe("Grid search spec — cartesian product of all provided axes"),
  concurrency: z.number().int().positive().default(4).describe("Max parallel sub-agents (default: 4)"),
  promote_winner: z.boolean().default(true).describe("Auto-register the best run as active model"),
  wave_size: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("If set, run configs in sequential waves of this size (completes each wave before starting next)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  // Build config list
  const configs = expandGrid(
    args.search ?? {},
    (args.configs ?? []) as Array<{ lr?: number; epochs?: number; head_arch?: number[] }>,
  )
  if (configs.length === 0) throw new Error("Provide at least one config or search spec")
  if (configs.length > 32) throw new Error("Sweep limited to 32 configs — reduce your search space")

  const t0 = Date.now()
  const results = await runSweep(args.task_id, configs, args.concurrency, undefined, args.wave_size)
  const wallClockS = Math.round((Date.now() - t0) / 1000)

  // Find winner (highest accuracy among completed runs)
  let winnerRunId: number | null = null
  let bestAcc = -1
  for (const r of results) {
    if (r.status === "completed" && r.run_id !== null && (r.accuracy ?? -1) > bestAcc) {
      bestAcc = r.accuracy ?? -1
      winnerRunId = r.run_id
    }
  }

  if (args.promote_winner && winnerRunId !== null) {
    const winnerRun = getRun(winnerRunId)
    if (winnerRun?.status === "completed") {
      registerModel(args.task_id, winnerRunId)
    }
  }

  return {
    ok: true,
    task_id: args.task_id,
    total_configs: configs.length,
    completed: results.filter((r) => r.status === "completed").length,
    failed: results.filter((r) => r.status === "failed").length,
    winner_run_id: winnerRunId,
    winner_accuracy: winnerRunId !== null ? bestAcc : null,
    wall_clock_s: wallClockS,
    runs: results.map((r) => ({
      config: r.config,
      run_id: r.run_id,
      accuracy: r.accuracy,
      status: r.status,
      error: r.error,
    })),
  }
}
