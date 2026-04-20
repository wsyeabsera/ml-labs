import { z } from "zod"
import { listRuns, countRuns } from "../core/db/runs"

export const name = "list_runs"
export const description = "List training runs for a task, newest first."

export const schema = {
  task_id: z.string().describe("Task ID"),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const runs = listRuns(args.task_id, args.limit ?? 10, args.offset ?? 0)
  const total = countRuns(args.task_id)
  return {
    total,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      accuracy: r.accuracy,
      hyperparams: r.hyperparams,
      started_at: r.startedAt,
      finished_at: r.finishedAt,
      duration_s: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
    })),
  }
}
