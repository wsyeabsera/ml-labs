import { z } from "zod"
import { getSamplesPaginated, sampleCounts } from "../core/db/samples"
import { getTask } from "../core/db/tasks"

export const name = "list_samples"
export const description = "List samples for a task with pagination. Returns feature vectors and metadata."

export const schema = {
  task_id: z.string().describe("Task ID"),
  label: z.string().optional().describe("Filter by label"),
  limit: z.number().int().min(1).max(200).default(50).describe("Max items to return"),
  offset: z.number().int().min(0).default(0).describe("Pagination offset"),
  include_features: z.boolean().default(false).describe("Include feature vectors in response (large)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const { items, total } = getSamplesPaginated({
    taskId: args.task_id,
    label: args.label,
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  })
  const counts = sampleCounts(args.task_id)

  return {
    total,
    counts,
    items: items.map((s) => ({
      id: s.id,
      label: s.label,
      created_at: s.createdAt,
      ...(args.include_features ? { features: s.features } : { feature_dim: s.features.length }),
    })),
  }
}
