import { z } from "zod"
import { listTasks } from "../core/db/tasks"
import { sampleCounts } from "../core/db/samples"
import { countRuns } from "../core/db/runs"
import { getTaskState } from "../core/state"

export const name = "list_tasks"
export const description = "List all registered tasks with sample counts, last-run accuracy, and training status."

export const schema = {}

export async function handler(_args: z.infer<z.ZodObject<typeof schema>>) {
  const tasks = listTasks()
  const items = tasks.map((t) => {
    const counts = sampleCounts(t.id)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const state = getTaskState(t.id)
    return {
      id: t.id,
      kind: t.kind,
      labels: t.labels ?? [],
      feature_shape: t.featureShape,
      normalize: t.normalize,
      feature_names: t.featureNames,
      sample_count: total,
      counts_by_label: counts,
      trained: state.trained,
      accuracy: state.accuracy,
      active_run_id: state.activeRunId,
      created_at: t.createdAt,
    }
  })
  return { ok: true, count: items.length, tasks: items }
}
