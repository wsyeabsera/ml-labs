import { db } from "./schema"
import { safeParse } from "../../util/json"

export type BatchPredictStatus = "running" | "completed" | "failed"

export interface BatchPredictRun {
  id: number
  taskId: string
  runId: number
  total: number
  processed: number
  correct: number | null
  accuracy: number | null
  status: BatchPredictStatus
  startedAt: number
  finishedAt: number | null
  latencyMsAvg: number | null
  errors: string[]
  hasLabels: boolean
  labelColumn: string | null
}

interface Row {
  id: number
  task_id: string
  run_id: number
  total: number
  processed: number
  correct: number | null
  accuracy: number | null
  status: string
  started_at: number
  finished_at: number | null
  latency_ms_avg: number | null
  errors: string
  has_labels: number
  label_column: string | null
}

function rowTo(r: Row): BatchPredictRun {
  return {
    id: r.id,
    taskId: r.task_id,
    runId: r.run_id,
    total: r.total,
    processed: r.processed,
    correct: r.correct,
    accuracy: r.accuracy,
    status: r.status as BatchPredictStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    latencyMsAvg: r.latency_ms_avg,
    errors: safeParse<string[]>(r.errors, []),
    hasLabels: r.has_labels === 1,
    labelColumn: r.label_column,
  }
}

export function createBatch(params: {
  taskId: string
  runId: number
  total: number
  hasLabels: boolean
  labelColumn?: string | null
  errors?: string[]
}): BatchPredictRun {
  const result = db.prepare(
    `INSERT INTO batch_predict_runs (task_id, run_id, total, has_labels, label_column, errors)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    params.taskId,
    params.runId,
    params.total,
    params.hasLabels ? 1 : 0,
    params.labelColumn ?? null,
    JSON.stringify(params.errors ?? []),
  )
  return getBatch(result.lastInsertRowid as number)!
}

export function updateBatchProgress(
  id: number,
  processed: number,
  correct: number | null,
  latencyMsAvg: number,
): void {
  const accuracy = correct != null && processed > 0 ? correct / processed : null
  db.prepare(
    `UPDATE batch_predict_runs
       SET processed = ?, correct = ?, accuracy = ?, latency_ms_avg = ?
     WHERE id = ?`,
  ).run(processed, correct, accuracy, latencyMsAvg, id)
}

export function finalizeBatch(
  id: number,
  params: {
    status: BatchPredictStatus
    processed: number
    correct: number | null
    latencyMsAvg: number | null
    errors?: string[]
  },
): void {
  const accuracy = params.correct != null && params.processed > 0 ? params.correct / params.processed : null
  const sets: string[] = [
    "status = ?", "processed = ?", "correct = ?", "accuracy = ?",
    "latency_ms_avg = ?", "finished_at = unixepoch()",
  ]
  const vals: (string | number | null)[] = [
    params.status, params.processed, params.correct, accuracy, params.latencyMsAvg,
  ]
  if (params.errors) {
    sets.push("errors = ?")
    vals.push(JSON.stringify(params.errors))
  }
  vals.push(id)
  db.exec(`UPDATE batch_predict_runs SET ${sets.join(", ")} WHERE id = ?`, vals)
}

export function getBatch(id: number): BatchPredictRun | null {
  const row = db.query(`SELECT * FROM batch_predict_runs WHERE id = ?`).get(id) as Row | null
  return row ? rowTo(row) : null
}

export function listBatches(taskId: string, limit = 50): BatchPredictRun[] {
  const rows = db.query(
    `SELECT * FROM batch_predict_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`,
  ).all(taskId, limit) as Row[]
  return rows.map(rowTo)
}
