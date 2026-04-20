import { z } from "zod"
import { getTask, deleteTask } from "../core/db/tasks"
import { deleteAllSamples } from "../core/db/samples"
import { deleteRegisteredModel } from "../core/db/models"
import { resetTaskState } from "../core/state"
import { db } from "../core/db/schema"

export const name = "reset_task"
export const description = "Wipe all samples, runs, and model data for a task. DESTRUCTIVE — requires confirm=true."

export const schema = {
  task_id: z.string().describe("Task ID to reset"),
  confirm: z.boolean().describe("Must be true to proceed"),
  delete_task: z.boolean().default(false).describe("Also delete the task definition (not just its data)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (!args.confirm) throw new Error("Set confirm=true to reset the task. This is irreversible.")

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  deleteAllSamples(args.task_id)
  deleteRegisteredModel(args.task_id)
  db.prepare("DELETE FROM runs WHERE task_id = ?").run(args.task_id)
  resetTaskState(args.task_id)

  if (args.delete_task) {
    deleteTask(args.task_id)
    return { ok: true, deleted: true, task_id: args.task_id }
  }

  return { ok: true, deleted: false, task_id: args.task_id, message: "Task data cleared. Task definition kept." }
}
