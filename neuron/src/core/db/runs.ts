import { db } from "./schema"
import { safeParse } from "../../util/json"
import type { NormStats } from "./tasks"

export interface Run {
  id: number
  taskId: string
  hyperparams: Record<string, unknown>
  accuracy: number | null
  perClassAccuracy: Record<string, number> | null
  confusionMatrix: number[][] | null
  lossHistory: number[] | null
  valAccuracy: number | null
  valLossHistory: number[] | null
  normStats: NormStats | null
  mae: number | null
  rmse: number | null
  r2: number | null
  sampleCounts: Record<string, number> | null
  weights: Record<string, { data: number[]; shape: number[] }> | null
  checkpoint: Checkpoint | null
  runProgress: RunProgressBlob | null
  ownerPid: number | null
  sourceUri: string | null
  status: "pending" | "running" | "completed" | "cancelled" | "failed" | "imported"
  startedAt: number | null
  finishedAt: number | null
}

export interface RunProgressBlob {
  stage: string
  i?: number
  n?: number
  message: string
  lossHistory: number[]
  epochsDone: number
}

export interface Checkpoint {
  epochsDone: number
  mlpName: string
  inputsTensorName: string
  targetsTensorName: string
}

interface DbRow {
  id: number; task_id: string; hyperparams: string; accuracy: number | null
  per_class_accuracy: string | null; confusion_matrix: string | null
  loss_history: string | null; val_accuracy: number | null; val_loss_history: string | null
  norm_stats: string | null; mae: number | null; rmse: number | null; r2: number | null
  sample_counts: string | null; weights: string | null
  checkpoint: string | null; run_progress: string | null; owner_pid: number | null
  source_uri: string | null; status: string; started_at: number | null; finished_at: number | null
}

function rowToRun(r: DbRow): Run {
  return {
    id: r.id, taskId: r.task_id,
    hyperparams: safeParse(r.hyperparams, {}),
    accuracy: r.accuracy,
    perClassAccuracy: safeParse(r.per_class_accuracy, null),
    confusionMatrix: safeParse(r.confusion_matrix, null),
    lossHistory: safeParse(r.loss_history, null),
    valAccuracy: r.val_accuracy,
    valLossHistory: safeParse(r.val_loss_history, null),
    normStats: safeParse(r.norm_stats, null),
    mae: r.mae,
    rmse: r.rmse,
    r2: r.r2,
    sampleCounts: safeParse(r.sample_counts, null),
    weights: safeParse(r.weights, null),
    checkpoint: safeParse(r.checkpoint, null),
    runProgress: safeParse(r.run_progress, null),
    ownerPid: r.owner_pid,
    sourceUri: r.source_uri,
    status: r.status as Run["status"],
    startedAt: r.started_at, finishedAt: r.finished_at,
  }
}

export function createRun(taskId: string, hyperparams: Record<string, unknown>, ownerPid = process.pid): Run {
  const result = db.prepare(
    "INSERT INTO runs (task_id, hyperparams, status, started_at, owner_pid) VALUES (?, ?, 'running', unixepoch(), ?)"
  ).run(taskId, JSON.stringify(hyperparams), ownerPid)
  return getRun(result.lastInsertRowid as number)!
}

export function createImportedRun(taskId: string, sourceUri: string, weights: Record<string, { data: number[]; shape: number[] }>, accuracy: number | null): Run {
  const result = db.prepare(
    `INSERT INTO runs (task_id, hyperparams, status, started_at, finished_at, source_uri, weights, accuracy)
     VALUES (?, '{}', 'imported', unixepoch(), unixepoch(), ?, ?, ?)`
  ).run(taskId, sourceUri, JSON.stringify(weights), accuracy)
  return getRun(result.lastInsertRowid as number)!
}

export function updateRunProgress(id: number, blob: RunProgressBlob) {
  db.prepare("UPDATE runs SET run_progress = ? WHERE id = ?").run(JSON.stringify(blob), id)
}

export function clearRunProgressDb(id: number) {
  db.prepare("UPDATE runs SET run_progress = NULL WHERE id = ?").run(id)
}

export function getRun(id: number): Run | null {
  const row = db.query("SELECT * FROM runs WHERE id = ?").get(id) as DbRow | null
  return row ? rowToRun(row) : null
}

export function listRuns(taskId: string, limit = 20, offset = 0): Run[] {
  return (db.query("SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(taskId, limit, offset) as DbRow[]).map(rowToRun)
}

export function updateRunStatus(id: number, status: Run["status"]) {
  db.prepare("UPDATE runs SET status = ?, finished_at = unixepoch() WHERE id = ?").run(status, id)
}

export function updateRunCheckpoint(id: number, checkpoint: Checkpoint, lossHistory: number[]) {
  db.prepare("UPDATE runs SET checkpoint = ?, loss_history = ? WHERE id = ?")
    .run(JSON.stringify(checkpoint), JSON.stringify(lossHistory), id)
}

export function finalizeRun(id: number, params: {
  accuracy: number
  perClassAccuracy: Record<string, number>
  confusionMatrix: number[][]
  lossHistory: number[]
  sampleCounts: Record<string, number>
  weights: Record<string, { data: number[]; shape: number[] }>
  valAccuracy?: number
  valLossHistory?: number[]
  normStats?: NormStats
  mae?: number
  rmse?: number
  r2?: number
}) {
  db.prepare(`UPDATE runs SET accuracy=?, per_class_accuracy=?, confusion_matrix=?,
    loss_history=?, sample_counts=?, weights=?, status='completed', finished_at=unixepoch(),
    checkpoint=NULL, val_accuracy=?, val_loss_history=?, norm_stats=?, mae=?, rmse=?, r2=?
    WHERE id=?`).run(
    params.accuracy, JSON.stringify(params.perClassAccuracy), JSON.stringify(params.confusionMatrix),
    JSON.stringify(params.lossHistory), JSON.stringify(params.sampleCounts),
    JSON.stringify(params.weights),
    params.valAccuracy ?? null,
    params.valLossHistory ? JSON.stringify(params.valLossHistory) : null,
    params.normStats ? JSON.stringify(params.normStats) : null,
    params.mae ?? null, params.rmse ?? null, params.r2 ?? null,
    id,
  )
}

export function countRuns(taskId: string): number {
  return (db.query("SELECT COUNT(*) as c FROM runs WHERE task_id = ?").get(taskId) as { c: number }).c
}
