import { db } from "./schema"

export interface Task {
  id: string
  kind: string
  labels: string[] | null
  featureShape: number[]
  sampleShape: number[]
  createdAt: number
}

interface TaskRow {
  id: string
  kind: string
  labels: string | null
  feature_shape: string
  sample_shape: string
  created_at: number
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    kind: r.kind,
    labels: r.labels ? JSON.parse(r.labels) as string[] : null,
    featureShape: JSON.parse(r.feature_shape) as number[],
    sampleShape: JSON.parse(r.sample_shape) as number[],
    createdAt: r.created_at,
  }
}

export function createTask(params: Omit<Task, "createdAt">): Task {
  db.prepare(
    `INSERT INTO tasks (id, kind, labels, feature_shape, sample_shape) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, labels=excluded.labels,
       feature_shape=excluded.feature_shape, sample_shape=excluded.sample_shape`
  ).run(
    params.id,
    params.kind,
    params.labels ? JSON.stringify(params.labels) : null,
    JSON.stringify(params.featureShape),
    JSON.stringify(params.sampleShape),
  )
  return getTask(params.id)!
}

export function getTask(id: string): Task | null {
  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null
  return row ? rowToTask(row) : null
}

export function listTasks(): Task[] {
  return (db.query("SELECT * FROM tasks ORDER BY created_at DESC").all() as TaskRow[]).map(rowToTask)
}

export function deleteTask(id: string) {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id)
}

export function updateTaskLabels(id: string, labels: string[]) {
  db.prepare("UPDATE tasks SET labels = ? WHERE id = ?").run(JSON.stringify(labels), id)
}
