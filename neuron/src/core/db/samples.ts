import { db } from "./schema"

export interface SampleRow {
  id: number
  taskId: string
  label: string
  features: number[]
  raw?: unknown
  createdAt: number
}

interface DbRow {
  id: number
  task_id: string
  label: string
  features: string
  raw: string | null
  created_at: number
}

function toSampleRow(r: DbRow): SampleRow {
  return {
    id: r.id,
    taskId: r.task_id,
    label: r.label,
    features: JSON.parse(r.features) as number[],
    raw: r.raw ? JSON.parse(r.raw) : undefined,
    createdAt: r.created_at,
  }
}

export function insertSample(taskId: string, label: string, features: number[], raw?: unknown): number {
  const result = db.prepare(
    "INSERT INTO samples (task_id, label, features, raw) VALUES (?, ?, ?, ?)"
  ).run(taskId, label, JSON.stringify(features), raw !== undefined ? JSON.stringify(raw) : null)
  return result.lastInsertRowid as number
}

export function insertSamplesBatch(items: { taskId: string; label: string; features: number[]; raw?: unknown }[]) {
  const stmt = db.prepare("INSERT INTO samples (task_id, label, features, raw) VALUES (?, ?, ?, ?)")
  const tx = db.transaction(() => {
    for (const s of items) stmt.run(s.taskId, s.label, JSON.stringify(s.features), s.raw !== undefined ? JSON.stringify(s.raw) : null)
  })
  tx()
}

export function getSamplesByTask(taskId: string): SampleRow[] {
  return (db.query("SELECT * FROM samples WHERE task_id = ? ORDER BY id").all(taskId) as DbRow[]).map(toSampleRow)
}

export function getSamplesPaginated(opts: { taskId: string; label?: string; limit: number; offset: number }) {
  const where = opts.label ? "task_id = ? AND label = ?" : "task_id = ?"
  const params = opts.label ? [opts.taskId, opts.label] : [opts.taskId]
  const total = (db.query(`SELECT COUNT(*) as c FROM samples WHERE ${where}`).get(...params) as { c: number }).c
  const rows = db
    .query(`SELECT * FROM samples WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as DbRow[]
  return { items: rows.map(toSampleRow), total }
}

export function sampleCounts(taskId: string): Record<string, number> {
  const rows = db.query("SELECT label, COUNT(*) as c FROM samples WHERE task_id = ? GROUP BY label").all(taskId) as { label: string; c: number }[]
  return Object.fromEntries(rows.map((r) => [r.label, r.c]))
}

export function deleteSampleById(id: number): boolean {
  return (db.prepare("DELETE FROM samples WHERE id = ?").run(id)).changes > 0
}

export function deleteSamplesByLabel(taskId: string, label: string): number {
  return (db.prepare("DELETE FROM samples WHERE task_id = ? AND label = ?").run(taskId, label)).changes
}

export function deleteAllSamples(taskId: string) {
  db.prepare("DELETE FROM samples WHERE task_id = ?").run(taskId)
}
