import { db } from "./schema"
import { getRun, type Run } from "./runs"

export interface RegisteredModel {
  taskId: string
  runId: number
  promotedAt: number
  run: Run | null
}

interface DbRow { task_id: string; run_id: number; promoted_at: number }

export function registerModel(taskId: string, runId: number) {
  db.prepare(
    `INSERT INTO models (task_id, run_id) VALUES (?, ?)
     ON CONFLICT(task_id) DO UPDATE SET run_id=excluded.run_id, promoted_at=unixepoch()`
  ).run(taskId, runId)
}

export function getRegisteredModel(taskId: string): RegisteredModel | null {
  const row = db.query("SELECT * FROM models WHERE task_id = ?").get(taskId) as DbRow | null
  if (!row) return null
  return { taskId: row.task_id, runId: row.run_id, promotedAt: row.promoted_at, run: getRun(row.run_id) }
}

export function deleteRegisteredModel(taskId: string) {
  db.prepare("DELETE FROM models WHERE task_id = ?").run(taskId)
}
