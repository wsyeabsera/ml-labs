import { db } from "./schema"

export interface PredictionRow {
  id: number
  taskId: string
  runId: number | null
  modelUri: string | null
  features: number[]
  output: unknown
  ts: number
  latencyMs: number | null
}

export interface LogPredictionArgs {
  taskId: string
  runId?: number | null
  modelUri?: string | null
  features: number[]
  output: unknown
  latencyMs?: number
}

/**
 * Sample rate gate from NEURON_PREDICTION_SAMPLE_RATE env var.
 * Defaults to 1.0 (log every prediction). Set to 0 to disable logging entirely.
 */
function shouldLog(): boolean {
  const rate = parseFloat(process.env.NEURON_PREDICTION_SAMPLE_RATE ?? "1")
  if (!Number.isFinite(rate) || rate <= 0) return false
  if (rate >= 1) return true
  return Math.random() < rate
}

const insertStmt = db.prepare(
  `INSERT INTO predictions (task_id, run_id, model_uri, features, output, latency_ms)
   VALUES (?, ?, ?, ?, ?, ?)`,
)

export function logPrediction(args: LogPredictionArgs): void {
  if (!shouldLog()) return
  try {
    insertStmt.run(
      args.taskId,
      args.runId ?? null,
      args.modelUri ?? null,
      JSON.stringify(args.features),
      JSON.stringify(args.output),
      args.latencyMs ?? null,
    )
  } catch {
    // Best-effort logging; never crash the predict path.
  }
}

interface DbRow {
  id: number
  task_id: string
  run_id: number | null
  model_uri: string | null
  features: string
  output: string
  ts: number
  latency_ms: number | null
}

function rowToPrediction(r: DbRow): PredictionRow {
  return {
    id: r.id,
    taskId: r.task_id,
    runId: r.run_id,
    modelUri: r.model_uri,
    features: JSON.parse(r.features) as number[],
    output: JSON.parse(r.output),
    ts: r.ts,
    latencyMs: r.latency_ms,
  }
}

/**
 * Return the most recent `limit` predictions for a task, newest first.
 * Used by drift detection as the "current window".
 */
export function listRecentPredictions(taskId: string, limit = 1000): PredictionRow[] {
  return (db.query(
    `SELECT * FROM predictions WHERE task_id = ? ORDER BY ts DESC LIMIT ?`,
  ).all(taskId, limit) as DbRow[]).map(rowToPrediction)
}

export function countPredictions(taskId: string): number {
  return (db.query(
    `SELECT COUNT(*) as c FROM predictions WHERE task_id = ?`,
  ).get(taskId) as { c: number }).c
}
