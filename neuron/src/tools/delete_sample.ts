import { z } from "zod"
import { deleteSampleById, deleteSamplesByLabel, sampleCounts } from "../core/db/samples"

export const name = "delete_sample"
export const description = "Delete a sample by ID, or all samples for a label (bulk). Bulk delete requires confirm=true."

export const schema = {
  task_id: z.string().describe("Task ID"),
  id: z.number().int().optional().describe("Sample ID to delete (single)"),
  label: z.string().optional().describe("Delete all samples with this label (bulk)"),
  confirm: z.boolean().default(false).describe("Required for bulk label deletion"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (args.id !== undefined) {
    const deleted = deleteSampleById(args.id)
    return { ok: deleted, deleted: deleted ? 1 : 0 }
  }
  if (args.label) {
    if (!args.confirm) throw new Error("Set confirm=true to bulk-delete all samples for a label")
    const deleted = deleteSamplesByLabel(args.task_id, args.label)
    const counts = sampleCounts(args.task_id)
    return { ok: true, deleted, counts }
  }
  throw new Error("Provide either id or label")
}
