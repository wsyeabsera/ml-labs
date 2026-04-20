import { db } from "./schema"

export interface AutoLogEntry {
  ts: string
  stage: string
  note: string
  payload?: unknown
}

export interface AutoRun {
  id: number
  task_id: string
  status: "running" | "completed" | "failed" | "data_issue"
  started_at: string
  finished_at: string | null
  accuracy_target: number | null
  budget_s: number | null
  max_waves: number | null
  waves_used: number
  winner_run_id: number | null
  final_accuracy: number | null
  decision_log: AutoLogEntry[]
  verdict: string | null
  coordinator_pid: number | null
}

type RawAutoRun = Omit<AutoRun, "decision_log"> & { decision_log: string }

function parse(row: RawAutoRun): AutoRun {
  return { ...row, decision_log: JSON.parse(row.decision_log ?? "[]") }
}

export function createAutoRun(
  task_id: string,
  opts: {
    accuracy_target?: number
    budget_s?: number
    max_waves?: number
  },
): AutoRun {
  const now = new Date().toISOString()
  const row = db
    .query(
      `INSERT INTO auto_runs (task_id, status, started_at, accuracy_target, budget_s, max_waves, coordinator_pid)
       VALUES (?, 'running', ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      task_id,
      now,
      opts.accuracy_target ?? null,
      opts.budget_s ?? null,
      opts.max_waves ?? null,
      process.pid,
    ) as RawAutoRun
  return parse(row)
}

export function updateAutoRun(
  id: number,
  fields: Partial<{
    status: AutoRun["status"]
    finished_at: string
    waves_used: number
    winner_run_id: number
    final_accuracy: number
    verdict: string
  }>,
): void {
  const sets: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: any[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`)
    vals.push(v)
  }
  if (!sets.length) return
  vals.push(id)
  db.exec(`UPDATE auto_runs SET ${sets.join(", ")} WHERE id = ?`, vals)
}

export function appendAutoLog(id: number, entry: AutoLogEntry): void {
  const row = db.query(`SELECT decision_log FROM auto_runs WHERE id = ?`).get(id) as
    | { decision_log: string }
    | null
  if (!row) return
  const log: AutoLogEntry[] = JSON.parse(row.decision_log ?? "[]")
  log.push(entry)
  db.exec(`UPDATE auto_runs SET decision_log = ? WHERE id = ?`, [JSON.stringify(log), id])
}

export function getAutoRun(id: number): AutoRun | null {
  const row = db
    .query(`SELECT * FROM auto_runs WHERE id = ?`)
    .get(id) as RawAutoRun | null
  return row ? parse(row) : null
}

export function getLatestAutoRunForTask(task_id: string): AutoRun | null {
  const row = db
    .query(`SELECT * FROM auto_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(task_id) as RawAutoRun | null
  return row ? parse(row) : null
}
