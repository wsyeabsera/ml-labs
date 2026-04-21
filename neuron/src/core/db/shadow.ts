import { db } from "./schema"
import { getRun, type Run } from "./runs"

export interface ShadowModel {
  taskId: string
  runId: number
  addedAt: number
  run: Run | null
}

interface ShadowRow { task_id: string; run_id: number; added_at: number }

export function attachShadow(taskId: string, runId: number): void {
  db.prepare(
    `INSERT INTO shadow_models (task_id, run_id) VALUES (?, ?)
     ON CONFLICT(task_id) DO UPDATE SET run_id=excluded.run_id, added_at=unixepoch()`,
  ).run(taskId, runId)
}

export function detachShadow(taskId: string): void {
  db.prepare(`DELETE FROM shadow_models WHERE task_id = ?`).run(taskId)
}

export function getShadow(taskId: string): ShadowModel | null {
  const row = db.query(`SELECT * FROM shadow_models WHERE task_id = ?`).get(taskId) as ShadowRow | null
  if (!row) return null
  return { taskId: row.task_id, runId: row.run_id, addedAt: row.added_at, run: getRun(row.run_id) }
}

export function recordShadowComparison(params: {
  taskId: string
  primaryRunId: number
  shadowRunId: number
  features: number[]
  primaryOutput: unknown
  shadowOutput: unknown
  agree: boolean
}): void {
  db.prepare(
    `INSERT INTO shadow_comparisons
      (task_id, primary_run_id, shadow_run_id, features, primary_output, shadow_output, agree)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.taskId,
    params.primaryRunId,
    params.shadowRunId,
    JSON.stringify(params.features),
    JSON.stringify(params.primaryOutput),
    JSON.stringify(params.shadowOutput),
    params.agree ? 1 : 0,
  )
}

export interface AgreementStats {
  total: number
  agreed: number
  rate: number
}

export function getAgreementRate(taskId: string, window = 500): AgreementStats {
  const row = db.query(
    `SELECT COUNT(*) as total, SUM(agree) as agreed FROM (
       SELECT agree FROM shadow_comparisons
        WHERE task_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).get(taskId, window) as { total: number; agreed: number | null } | null
  const total = row?.total ?? 0
  const agreed = row?.agreed ?? 0
  return { total, agreed, rate: total > 0 ? agreed / total : 0 }
}

export interface ShadowComparisonRow {
  id: number
  ts: number
  agree: boolean
  primaryOutput: unknown
  shadowOutput: unknown
}

export function listRecentComparisons(taskId: string, limit = 50): ShadowComparisonRow[] {
  const rows = db.query(
    `SELECT id, ts, agree, primary_output, shadow_output
       FROM shadow_comparisons WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
  ).all(taskId, limit) as {
    id: number; ts: number; agree: number; primary_output: string; shadow_output: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    agree: r.agree === 1,
    primaryOutput: safeParse(r.primary_output),
    shadowOutput: safeParse(r.shadow_output),
  }))
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
