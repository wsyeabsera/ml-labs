/**
 * Neuron HTTP API — serves the ml-labs dashboard on port 2626.
 * Start with: bun src/api.ts
 * Env: NEURON_DB (path to SQLite), DASHBOARD_DIST (path to built React app)
 */
import { join } from "node:path"
import { existsSync, appendFileSync, mkdirSync } from "node:fs"
import { parse as parseCsv } from "csv-parse/sync"
import { listTasks, getTask, createTask, updateTaskFeatureNames, updateTaskLabels, deleteTask } from "./core/db/tasks"
import { listRuns, listAllRuns, getRun } from "./core/db/runs"
import { sampleCounts, splitCounts, insertSamplesBatch, deleteAllSamples } from "./core/db/samples"
import { deleteRegisteredModel } from "./core/db/models"
import { countRuns } from "./core/db/runs"
import { getRegisteredModel, registerModel } from "./core/db/models"
import { recordEvent, listEvents } from "./core/db/events"
import { getTaskState, resetTaskState } from "./core/state"
import { startTrainBackground } from "./api/trainBg"
import { handler as predictFn } from "./tools/predict"
import { softmax, argmax, applyNorm } from "./core/metrics"
import { rsTensor, clientStatus } from "./core/mcp_client"
import { loadConfig, loadedConfigPath } from "./adapter/loader"

// Force DB initialization via schema import
import { db } from "./core/db/schema"

const PORT = parseInt(process.env.NEURON_API_PORT ?? "2626")
const DIST = process.env.DASHBOARD_DIST ?? join(import.meta.dir, "../../dashboard/dist")
const VERSION = "0.13.0"
const DB_DIR = (() => {
  const db = process.env.NEURON_DB
  return db ? join(db, "..") : join(import.meta.dir, "../../data")
})()
const REQUESTS_FILE = join(DB_DIR, "requests.jsonl")

// ── CORS ───────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status)
}

// ── Route handlers ─────────────────────────────────────────────────────────────

function handleHealth(): Response {
  const tasks = listTasks()
  const rs = clientStatus()
  return json({
    ok: true,
    version: VERSION,
    dbPath: process.env.NEURON_DB ?? "default",
    taskCount: tasks.length,
    rsTensor: { ok: rs.ok, mode: rs.mode, connected: rs.connected },
  })
}

function handleTasks(): Response {
  const tasks = listTasks()
  const items = tasks.map((t) => {
    const counts = sampleCounts(t.id)
    const splits = splitCounts(t.id)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const runs = listRuns(t.id, 1)
    const lastRun = runs[0] ?? null
    const model = getRegisteredModel(t.id)
    return {
      id: t.id,
      kind: t.kind,
      featureShape: t.featureShape,
      featureNames: t.featureNames,
      labels: t.labels,
      normalize: t.normalize,
      sampleCount: total,
      trainCount: splits.train,
      testCount: splits.test,
      runCount: countRuns(t.id),
      activeRunId: model?.run?.id ?? null,
      lastRunStatus: lastRun?.status ?? null,
      accuracy: model?.run?.accuracy ?? null,
      createdAt: t.createdAt,
    }
  })
  return json({ tasks: items })
}

function handleTask(id: string): Response {
  const t = getTask(id)
  if (!t) return err(`Task "${id}" not found`, 404)
  const counts = sampleCounts(id)
  const splits = splitCounts(id)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const model = getRegisteredModel(id)
  return json({
    id: t.id, kind: t.kind, featureShape: t.featureShape,
    featureNames: t.featureNames, labels: t.labels, normalize: t.normalize,
    sampleCount: total, trainCount: splits.train, testCount: splits.test,
    runCount: countRuns(id), activeRunId: model?.run?.id ?? null,
    lastRunStatus: (listRuns(id, 1)[0]?.status) ?? null,
    accuracy: model?.run?.accuracy ?? null, createdAt: t.createdAt,
  })
}

function handleRuns(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const runs = listRuns(taskId, 50).map((r) => ({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    perClassAccuracy: r.perClassAccuracy, confusionMatrix: r.confusionMatrix,
    lossHistory: r.lossHistory, mae: r.mae, rmse: r.rmse, r2: r.r2,
    sampleCounts: r.sampleCounts,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
  }))
  return json({ runs })
}

function handleAllRuns(): Response {
  const runs = listAllRuns(100).map((r) => ({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    mae: r.mae, rmse: r.rmse, r2: r.r2,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
  }))
  return json({ runs })
}

function handleRun(id: number): Response {
  const r = getRun(id)
  if (!r) return err(`Run ${id} not found`, 404)
  return json({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    perClassAccuracy: r.perClassAccuracy, confusionMatrix: r.confusionMatrix,
    lossHistory: r.lossHistory, mae: r.mae, rmse: r.rmse, r2: r.r2,
    sampleCounts: r.sampleCounts, runProgress: r.runProgress,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
    runContext: r.runContext, datasetHash: r.datasetHash,
    cvFoldId: r.cvFoldId, cvParentId: r.cvParentId,
  })
}

async function handleInspect(taskId: string): Promise<Response> {
  // Re-use the inspect_data tool handler logic inline (avoids circular dep)
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)

  const { getSamplesByTask } = await import("./core/db/samples")
  const samples = getSamplesByTask(taskId)
  if (samples.length === 0) return json({ ok: true, total: 0, message: "No samples loaded yet." })

  const D = samples[0]!.features.length
  const N = samples.length
  const featureNames = task.featureNames ?? Array.from({ length: D }, (_, i) => `feature_${i}`)
  const splits = splitCounts(taskId)
  const counts = sampleCounts(taskId)

  const mins = new Array<number>(D).fill(Infinity)
  const maxs = new Array<number>(D).fill(-Infinity)
  const sums = new Array<number>(D).fill(0)
  const sumSqs = new Array<number>(D).fill(0)
  for (const s of samples) {
    for (let d = 0; d < D; d++) {
      const v = s.features[d] ?? 0
      if (v < mins[d]!) mins[d] = v
      if (v > maxs[d]!) maxs[d] = v
      sums[d]! += v
      sumSqs[d]! += v * v
    }
  }
  const featureStats = featureNames.map((name, d) => {
    const mean = sums[d]! / N
    const std = Math.sqrt(Math.max(0, sumSqs[d]! / N - mean * mean))
    return { name, mean: +mean.toFixed(4), std: +std.toFixed(4), min: +(mins[d]!).toFixed(4), max: +(maxs[d]!).toFixed(4), constant: (maxs[d]! - mins[d]!) < 1e-9 }
  })

  const warnings: string[] = []
  const constantFeatures = featureStats.filter((f) => f.constant).map((f) => f.name)
  if (constantFeatures.length > 0) warnings.push(`Constant features: ${constantFeatures.join(", ")}`)
  const ranges = featureStats.map((f) => f.max - f.min).filter((r) => r > 0)
  if (ranges.length > 1 && Math.max(...ranges) / Math.min(...ranges) > 100) {
    warnings.push(`Feature scales differ by >100x — consider normalize=true`)
  }
  if (task.kind !== "regression") {
    const vals = Object.values(counts)
    if (vals.length > 0) {
      const ratio = Math.max(...vals) / Math.min(...vals)
      if (ratio > 3) warnings.push(`Class imbalance ${ratio.toFixed(1)}x — consider class_weights="balanced"`)
    }
  }

  let imbalanceRatio: number | null = null
  if (task.kind !== "regression") {
    const vals = Object.values(counts)
    if (vals.length > 1) imbalanceRatio = +(Math.max(...vals) / Math.min(...vals)).toFixed(2)
  }

  return json({
    ok: true, task_id: taskId, kind: task.kind, total: N, splits,
    features: { count: D, names: featureNames, stats: featureStats },
    class_distribution: task.kind !== "regression" ? counts : null,
    imbalance_ratio: imbalanceRatio,
    normalize_enabled: task.normalize,
    warnings,
  })
}

async function handleStartTrain(taskId: string, req: Request): Promise<Response> {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)

  const state = getTaskState(taskId)
  if (state.activeRunId != null) return err("Training already in progress", 409)

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* empty body ok */ }

  try {
    const { runId } = await startTrainBackground({
      taskId,
      lr: typeof body.lr === "number" ? body.lr : undefined,
      epochs: typeof body.epochs === "number" ? body.epochs : undefined,
      headArch: Array.isArray(body.head_arch) ? (body.head_arch as number[]) : undefined,
      classWeights: body.class_weights === "balanced" ? "balanced" : undefined,
    })
    recordEvent({ source: "api", kind: "run_started", taskId, runId, payload: { lr: body.lr, epochs: body.epochs } })
    return json({ ok: true, runId })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function handleCancelTrain(taskId: string): Response {
  const state = getTaskState(taskId)
  if (!state.activeRunId || !state.abortController) return err("No active training run", 404)
  state.abortController.abort(new Error("cancelled"))
  recordEvent({ source: "api", kind: "run_cancelled", taskId, runId: state.activeRunId })
  return json({ ok: true, runId: state.activeRunId })
}

// ── Reset / delete task ────────────────────────────────────────────────────────

function handleResetTask(taskId: string, req: Request): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)

  const mode = new URL(req.url).searchParams.get("mode") ?? "reset"
  if (mode !== "reset" && mode !== "delete") return err(`mode must be "reset" or "delete"`)

  // Abort any active training first
  const state = getTaskState(taskId)
  if (state.abortController) state.abortController.abort(new Error("task reset"))

  // Cancel any running sweep
  const sweep = activeSweeps.get(taskId)
  if (sweep?.status === "running") { sweep.ac.abort(); activeSweeps.delete(taskId) }

  deleteAllSamples(taskId)
  deleteRegisteredModel(taskId)
  db.prepare("DELETE FROM runs WHERE task_id = ?").run(taskId)
  db.prepare("UPDATE tasks SET labels = NULL, feature_names = NULL WHERE id = ?").run(taskId)
  resetTaskState(taskId)

  if (mode === "delete") {
    deleteTask(taskId)
    recordEvent({ source: "api", kind: "task_deleted", taskId, payload: {} })
    return json({ ok: true, deleted: true, taskId })
  }

  recordEvent({ source: "api", kind: "task_reset", taskId, payload: {} })
  return json({ ok: true, deleted: false, taskId })
}

// ── Dataset upload ─────────────────────────────────────────────────────────────

function splitStratified(rows: { label: string }[], kind: string, testSize: number): ("train" | "test")[] {
  const result: ("train" | "test")[] = new Array(rows.length).fill("train")
  if (testSize <= 0) return result
  const sh = <T>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j]!, a[i]!] } return a }
  if (kind === "regression") {
    const idx = sh([...Array(rows.length).keys()])
    for (let i = 0; i < Math.round(rows.length * testSize); i++) result[idx[i]!] = "test"
  } else {
    const byClass: Record<string, number[]> = {}
    rows.forEach((r, i) => { (byClass[r.label] ??= []).push(i) })
    for (const idxs of Object.values(byClass)) {
      const s = sh([...idxs])
      for (let i = 0; i < Math.max(1, Math.round(s.length * testSize)) && i < s.length; i++) result[s[i]!] = "test"
    }
  }
  return result
}

async function handleUpload(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const taskId = url.searchParams.get("task_id")?.trim()
  const kind = (url.searchParams.get("kind") ?? "classification") as "classification" | "regression"
  const labelCol = url.searchParams.get("label_column")
  const normalize = url.searchParams.get("normalize") !== "false"
  const testSize = Math.min(0.5, Math.max(0, parseFloat(url.searchParams.get("test_size") ?? "0.2")))
  const featureColsParam = url.searchParams.get("feature_columns")
  const replace = url.searchParams.get("replace") === "true"

  if (!taskId) return err("task_id is required")
  if (!labelCol) return err("label_column is required")
  if (kind !== "classification" && kind !== "regression") return err("kind must be classification or regression")

  let csvText = ""
  try { csvText = await req.text() } catch { return err("Failed to read body") }
  if (!csvText.trim()) return err("Empty CSV body")

  let records: Record<string, string>[]
  try {
    records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true, cast: false }) as Record<string, string>[]
  } catch (e) {
    return err(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (records.length === 0) return err("CSV contains no data rows")

  const allCols = Object.keys(records[0]!)
  if (!allCols.includes(labelCol)) return err(`Label column "${labelCol}" not found. Headers: ${allCols.join(", ")}`)

  const featureCols = featureColsParam
    ? featureColsParam.split(",").map((c) => c.trim()).filter(Boolean)
    : allCols.filter((c) => c !== labelCol)
  if (featureCols.length === 0) return err("No feature columns")

  const D = featureCols.length
  const rows: { label: string; features: number[] }[] = []
  const parseErrors: string[] = []

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!
    const label = row[labelCol]?.trim()
    if (!label) { parseErrors.push(`Row ${i + 2}: empty label`); continue }
    const features: number[] = []
    let bad = false
    for (const col of featureCols) {
      const v = parseFloat(row[col] ?? "")
      if (isNaN(v)) { parseErrors.push(`Row ${i + 2}: "${row[col]}" in "${col}" is not a number`); bad = true; break }
      features.push(v)
    }
    if (!bad) rows.push({ label, features })
  }
  if (rows.length === 0) return err(`No valid rows. Sample errors: ${parseErrors.slice(0, 3).join("; ")}`)

  const labelSet = kind === "classification" ? [...new Set(rows.map((r) => r.label))].sort() : null

  if (replace) deleteAllSamples(taskId)

  createTask({ id: taskId, kind, labels: labelSet, featureShape: [D], sampleShape: [D], normalize, featureNames: featureCols })
  updateTaskFeatureNames(taskId, featureCols)
  if (labelSet) updateTaskLabels(taskId, labelSet)

  const splits = splitStratified(rows, kind, testSize)
  insertSamplesBatch(rows.map((r, i) => ({ taskId, label: r.label, features: r.features, split: splits[i] })))

  const splitSummary = splitCounts(taskId)
  const counts = sampleCounts(taskId)
  const warnings: string[] = []
  if (parseErrors.length > 0) warnings.push(`${parseErrors.length} rows skipped due to parse errors`)
  if (labelSet && labelSet.length < 2) warnings.push("Only 1 class found — need at least 2 to train")

  recordEvent({ source: "api", kind: "upload", taskId, payload: { total: rows.length, features: D, labels: labelSet?.length ?? 0 } })
  return json({
    ok: true, taskId, total: rows.length,
    trainCount: splitSummary.train, testCount: splitSummary.test,
    featureNames: featureCols, labels: labelSet, labelCounts: counts,
    warnings, skipped: parseErrors.length,
  })
}

// ── Hyperparameter sweep ───────────────────────────────────────────────────────

interface SweepEntry { lr?: number; epochs?: number }

interface SweepResult {
  config: SweepEntry
  runId: number | null
  accuracy: number | null
  valAccuracy: number | null
  status: "pending" | "running" | "done" | "failed"
  error?: string
}

interface ActiveSweep {
  taskId: string
  results: SweepResult[]
  status: "running" | "completed" | "cancelled"
  currentIdx: number
  ac: AbortController
  bestRunId: number | null
  bestAccuracy: number | null
  promoteWinner: boolean
}

const activeSweeps = new Map<string, ActiveSweep>()

async function handleStartSweep(taskId: string, req: Request): Promise<Response> {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const existing = activeSweeps.get(taskId)
  if (existing?.status === "running") return err("Sweep already running", 409)
  if (getTaskState(taskId).activeRunId != null) return err("Training already in progress", 409)

  let body: { search?: { lr?: number[]; epochs?: number[] }; configs?: SweepEntry[]; promote_winner?: boolean } = {}
  try { body = (await req.json()) as typeof body } catch { /* ok */ }

  // Expand grid
  const configs: SweepEntry[] = []
  const lrs = body.search?.lr ?? []
  const epochsList = body.search?.epochs ?? []
  if (lrs.length > 0 || epochsList.length > 0) {
    for (const lr of (lrs.length ? lrs : [undefined as unknown as number])) {
      for (const epochs of (epochsList.length ? epochsList : [undefined as unknown as number])) {
        const c: SweepEntry = {}
        if (lr != null) c.lr = lr
        if (epochs != null) c.epochs = epochs
        configs.push(c)
      }
    }
  }
  if (body.configs) configs.push(...body.configs)
  if (configs.length === 0) return err("Provide search or configs")
  if (configs.length > 20) return err("Sweep limited to 20 configs")

  const ac = new AbortController()
  const sweep: ActiveSweep = {
    taskId, status: "running", currentIdx: 0, ac,
    bestRunId: null, bestAccuracy: null,
    promoteWinner: body.promote_winner ?? true,
    results: configs.map((c) => ({ config: c, runId: null, accuracy: null, valAccuracy: null, status: "pending" })),
  }
  activeSweeps.set(taskId, sweep)
  recordEvent({ source: "api", kind: "sweep_started", taskId, payload: { total: configs.length, promoteWinner: body.promote_winner ?? true } })

  ;(async () => {
    for (let i = 0; i < configs.length; i++) {
      if (ac.signal.aborted) break
      sweep.currentIdx = i
      sweep.results[i]!.status = "running"
      try {
        const { runId } = await startTrainBackground({ taskId, lr: configs[i]!.lr, epochs: configs[i]!.epochs })
        sweep.results[i]!.runId = runId
        // Wait for completion
        while (!ac.signal.aborted) {
          await new Promise<void>((r) => setTimeout(r, 600))
          const run = getRun(runId)
          if (!run || (run.status !== "running" && run.status !== "pending")) {
            sweep.results[i]!.accuracy = run?.accuracy ?? null
            sweep.results[i]!.valAccuracy = run?.valAccuracy ?? null
            sweep.results[i]!.status = run?.status === "completed" ? "done" : "failed"
            if (run?.status !== "completed") sweep.results[i]!.error = `run status: ${run?.status}`
            recordEvent({
              source: "api", kind: "sweep_progress", taskId, runId: sweep.results[i]!.runId ?? undefined,
              payload: { idx: i, total: configs.length, accuracy: run?.accuracy ?? null, status: sweep.results[i]!.status },
            })
            break
          }
        }
      } catch (e) {
        sweep.results[i]!.status = "failed"
        sweep.results[i]!.error = e instanceof Error ? e.message : String(e)
      }
    }
    if (!ac.signal.aborted) {
      sweep.status = "completed"
      let best = -1
      for (const r of sweep.results) {
        if (r.status === "done" && (r.accuracy ?? -1) > best) {
          best = r.accuracy!; sweep.bestAccuracy = r.accuracy; sweep.bestRunId = r.runId
        }
      }
      if (sweep.promoteWinner && sweep.bestRunId != null) {
        const winRun = getRun(sweep.bestRunId)
        if (winRun?.status === "completed") registerModel(taskId, sweep.bestRunId)
      }
      recordEvent({ source: "api", kind: "sweep_completed", taskId, runId: sweep.bestRunId ?? undefined, payload: { bestAccuracy: sweep.bestAccuracy, bestRunId: sweep.bestRunId } })
    } else {
      sweep.status = "cancelled"
      recordEvent({ source: "api", kind: "sweep_cancelled", taskId })
    }
  })()

  return json({ ok: true, total: configs.length })
}

function handleGetSweep(taskId: string): Response {
  const s = activeSweeps.get(taskId)
  if (!s) return json({ active: false })
  return json({
    active: true, taskId: s.taskId, status: s.status,
    currentIdx: s.currentIdx, total: s.results.length,
    results: s.results, bestRunId: s.bestRunId, bestAccuracy: s.bestAccuracy,
    promoteWinner: s.promoteWinner,
  })
}

function handleCancelSweep(taskId: string): Response {
  const s = activeSweeps.get(taskId)
  if (!s || s.status !== "running") return err("No active sweep", 404)
  s.ac.abort()
  return json({ ok: true })
}

// ── Predict ────────────────────────────────────────────────────────────────────

async function handlePredict(taskId: string, req: Request): Promise<Response> {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { return err("Invalid JSON body") }
  const features = body.features
  if (!Array.isArray(features) || features.some((v) => typeof v !== "number"))
    return err("features must be an array of numbers")
  try {
    const result = await predictFn({ task_id: taskId, features: features as number[] })
    return json(result)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

async function handleBatchPredict(taskId: string, req: Request): Promise<Response> {
  const model = getRegisteredModel(taskId)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported"))
    return err(`No trained model for task "${taskId}". Train first.`)
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)

  const url = new URL(req.url)
  const labelCol = url.searchParams.get("label_column") ?? undefined

  let csvText = ""
  try { csvText = await req.text() } catch { return err("Failed to read body") }
  if (!csvText.trim()) return err("Empty CSV body")

  let records: Record<string, string>[]
  try {
    records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true, cast: false }) as Record<string, string>[]
  } catch (e) {
    return err(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (records.length === 0) return json({ ok: true, total: 0, processed: 0, predictions: [], errors: [] })

  const isRegression = task.kind === "regression"
  const run = model.run
  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  const K = isRegression ? 1 : labels.length
  const mlpName = `neuron_run_${run.id}_mlp`
  const firstRow = records[0]!
  const allCols = Object.keys(firstRow)
  const featureCols = labelCol ? allCols.filter((c) => c !== labelCol) : allCols

  // Ensure model is in memory
  try {
    const probe = featureCols.map((c) => parseFloat(firstRow[c] ?? "0") || 0)
    await rsTensor.createTensor("neuron_batch_probe_api", probe, [1, probe.length])
    await rsTensor.evaluateMlp(mlpName, "neuron_batch_probe_api")
  } catch {
    if (!run.weights) return err("Model weights not found. Retrain.")
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
  }

  const MAX_ROWS = 200
  const rowsToProcess = records.slice(0, MAX_ROWS)
  const errors: string[] = records.length > MAX_ROWS ? [`Truncated to first ${MAX_ROWS} rows`] : []
  const predictions: unknown[] = []
  let correct = 0

  for (let i = 0; i < rowsToProcess.length; i++) {
    const rowData = rowsToProcess[i]!
    let features = featureCols.map((c) => { const v = parseFloat(rowData[c] ?? ""); return isNaN(v) ? 0 : v })
    if (run.normStats) features = applyNorm(features, run.normStats.mean, run.normStats.std)
    const inputName = `neuron_batch_api_${i % 50}`
    await rsTensor.createTensor(inputName, features, [1, features.length])
    const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)

    if (isRegression) {
      const scale = run.weights?.["__regression_scale__"]?.data
      const rawOutput = evalResult.predictions?.data?.[0] ?? 0
      const value = rawOutput * (scale?.[1] ?? 1) + (scale?.[0] ?? 0)
      const entry: Record<string, unknown> = { row: i + 1, value: +value.toFixed(6) }
      if (labelCol && rowData[labelCol]) {
        const truth = parseFloat(rowData[labelCol] ?? "0")
        entry.truth = truth; entry.error = +(value - truth).toFixed(6)
      }
      predictions.push(entry)
    } else {
      const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
      const probs = softmax(rawScores)
      const predIdx = argmax(probs)
      const label = labels[predIdx] ?? "unknown"
      const confidence = +(probs[predIdx] ?? 0).toFixed(4)
      const scored = labels.map((l, idx) => ({ label: l, prob: +(probs[idx] ?? 0).toFixed(4) }))
        .sort((a, b) => b.prob - a.prob).slice(0, 3)
      const entry: Record<string, unknown> = { row: i + 1, label, confidence, scores: scored }
      if (labelCol && rowData[labelCol]) {
        const truth = rowData[labelCol]!
        entry.truth = truth; entry.correct = label === truth
        if (label === truth) correct++
      }
      predictions.push(entry)
    }
  }

  const result: Record<string, unknown> = {
    ok: true, total: records.length, processed: rowsToProcess.length, errors, predictions,
  }
  if (labelCol && !isRegression && rowsToProcess.length > 0) {
    result.accuracy = +(correct / rowsToProcess.length).toFixed(4)
    result.correct = correct
  }
  return json(result)
}

// ── Suggest samples ────────────────────────────────────────────────────────────

async function handleSuggestSamples(taskId: string, req: Request): Promise<Response> {
  const { handler: suggestFn } = await import("./tools/suggest_samples")
  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* empty body ok */ }
  try {
    const result = await suggestFn({
      task_id: taskId,
      n_suggestions: typeof body.n_suggestions === "number" ? body.n_suggestions : 5,
      confidence_threshold: typeof body.confidence_threshold === "number" ? body.confidence_threshold : 0.7,
    })
    return json(result)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

// ── Config inspector ───────────────────────────────────────────────────────────

async function handleConfig(): Promise<Response> {
  const config = await loadConfig()
  const configPath = loadedConfigPath()
  if (!config) {
    return json({
      ok: true,
      taskId: null,
      configPath: null,
      featureShape: null,
      sampleShape: null,
      hasFeaturize: false,
      hasDecodeImage: false,
      hasHeadArchitecture: false,
      defaultHyperparams: { lr: 0.005, epochs: 500 },
    })
  }
  return json({
    ok: true,
    taskId: config.taskId ?? null,
    configPath,
    featureShape: config.featureShape ?? null,
    sampleShape: config.sampleShape ?? null,
    hasFeaturize: typeof config.featurize === "function",
    hasDecodeImage: typeof config.decodeImage === "function",
    hasHeadArchitecture: typeof config.headArchitecture === "function",
    defaultHyperparams: {
      lr: config.defaultHyperparams?.lr ?? 0.005,
      epochs: config.defaultHyperparams?.epochs ?? 500,
    },
  })
}

// ── Global event bus SSE ───────────────────────────────────────────────────────

function handleEventsStream(): Response {
  let closed = false
  let lastId = -1

  // Seed cursor from latest event
  const seed = listEvents({ limit: 1 })
  if (seed.length > 0) lastId = seed[seed.length - 1]!.id - 1

  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder()
      function send(event: string, data: unknown) {
        if (closed) return
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Send last 50 events as initial snapshot
      const snapshot = listEvents({ limit: 50 })
      if (snapshot.length > 0) {
        send("snapshot", snapshot)
        lastId = snapshot[snapshot.length - 1]!.id
      }

      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return }
        const news = listEvents({ sinceId: lastId, limit: 200 })
        for (const ev of news) {
          send(ev.kind, ev)
          lastId = ev.id
        }
      }, 300)
    },
    cancel() { closed = true },
  })

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}

function handleEventsRest(req: Request): Response {
  const url = new URL(req.url)
  const sinceId = url.searchParams.has("since_id") ? parseInt(url.searchParams.get("since_id")!) : undefined
  const taskId = url.searchParams.get("task") ?? undefined
  const limit = url.searchParams.has("limit") ? parseInt(url.searchParams.get("limit")!) : 100
  const events = listEvents({ sinceId, taskId, limit })
  return json({ events })
}

// ── Ask Claude channel ─────────────────────────────────────────────────────────

async function handlePostRequest(req: Request): Promise<Response> {
  let body: { prompt?: string; context?: { route?: string; taskId?: string; runId?: number } } = {}
  try { body = (await req.json()) as typeof body } catch { return err("Invalid JSON body") }
  if (!body.prompt?.trim()) return err("prompt is required")

  const taskId = body.context?.taskId
  const runId = body.context?.runId

  const id = recordEvent({
    source: "user",
    kind: "request",
    taskId,
    runId,
    payload: { prompt: body.prompt, context: body.context ?? {} },
  })

  // Append to jsonl file for terminal Claude to read
  try {
    mkdirSync(DB_DIR, { recursive: true })
    appendFileSync(REQUESTS_FILE, JSON.stringify({ id, ts: Date.now(), prompt: body.prompt, context: body.context ?? {}, answered: false }) + "\n")
  } catch { /* non-fatal */ }

  return json({ ok: true, id })
}

async function handlePostResponse(requestId: number, req: Request): Promise<Response> {
  let body: { answer?: string } = {}
  try { body = (await req.json()) as typeof body } catch { return err("Invalid JSON body") }
  if (!body.answer?.trim()) return err("answer is required")

  recordEvent({
    source: "mcp",
    kind: "response",
    payload: { requestId, answer: body.answer },
  })

  return json({ ok: true })
}

// ── SSE: live run progress ─────────────────────────────────────────────────────

function handleRunEvents(runId: number): Response {
  let closed = false

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder()
      function send(event: string, data: unknown) {
        if (closed) return
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Initial state
      const run = getRun(runId)
      if (!run) {
        send("error", { message: `Run ${runId} not found` })
        ctrl.close()
        return
      }

      send("init", {
        id: run.id, status: run.status,
        hyperparams: run.hyperparams,
        progress: run.runProgress,
      })

      if (run.status !== "running" && run.status !== "pending") {
        send("complete", {
          status: run.status, accuracy: run.accuracy,
          lossHistory: run.lossHistory, perClassAccuracy: run.perClassAccuracy,
          confusionMatrix: run.confusionMatrix, mae: run.mae, rmse: run.rmse, r2: run.r2,
        })
        ctrl.close()
        return
      }

      // Poll until done
      let lastProgress = JSON.stringify(run.runProgress)
      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return }
        const r = getRun(runId)
        if (!r) { clearInterval(interval); ctrl.close(); return }

        const prog = JSON.stringify(r.runProgress)
        if (prog !== lastProgress) {
          lastProgress = prog
          send("progress", r.runProgress)
        }

        if (r.status !== "running" && r.status !== "pending") {
          clearInterval(interval)
          send("complete", {
            status: r.status, accuracy: r.accuracy,
            lossHistory: r.lossHistory, perClassAccuracy: r.perClassAccuracy,
            confusionMatrix: r.confusionMatrix, mae: r.mae, rmse: r.rmse, r2: r.r2,
          })
          if (!closed) ctrl.close()
        }
      }, 500)
    },
    cancel() { closed = true },
  })

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}

// ── Static file server ─────────────────────────────────────────────────────────

async function serveStatic(pathname: string): Promise<Response> {
  if (!existsSync(DIST)) {
    return new Response("Dashboard not built. Run: bun run build (in dashboard/)", { status: 503 })
  }
  const clean = pathname === "/" ? "/index.html" : pathname
  const file = Bun.file(join(DIST, clean))
  if (await file.exists()) return new Response(file)
  // SPA fallback
  return new Response(Bun.file(join(DIST, "index.html")))
}

// ── Router ─────────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS })
    }

    // API routes
    if (path === "/api/health")                 return handleHealth()
    if (path === "/api/config" && req.method === "GET") return handleConfig()
    if (path === "/api/events" && req.method === "GET") {
      const url2 = new URL(req.url)
      if (url2.searchParams.has("stream") || req.headers.get("accept")?.includes("text/event-stream")) {
        return handleEventsStream()
      }
      return handleEventsRest(req)
    }
    if (path === "/api/requests" && req.method === "POST") return handlePostRequest(req)
    const requestsResponseMatch = path.match(/^\/api\/requests\/(\d+)\/response$/)
    if (requestsResponseMatch && req.method === "POST") return handlePostResponse(parseInt(requestsResponseMatch[1]!), req)
    if (path === "/api/runs" && req.method === "GET") return handleAllRuns()
    if (path === "/api/tasks" && req.method === "GET") return handleTasks()

    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch && req.method === "GET")       return handleTask(decodeURIComponent(taskMatch[1]!))
    if (taskMatch && req.method === "DELETE")    return handleResetTask(decodeURIComponent(taskMatch[1]!), req)

    const taskRunsMatch = path.match(/^\/api\/tasks\/([^/]+)\/runs$/)
    if (taskRunsMatch && req.method === "GET")   return handleRuns(decodeURIComponent(taskRunsMatch[1]!))

    const taskInspectMatch = path.match(/^\/api\/tasks\/([^/]+)\/inspect$/)
    if (taskInspectMatch && req.method === "GET") return handleInspect(decodeURIComponent(taskInspectMatch[1]!))

    const taskTrainMatch = path.match(/^\/api\/tasks\/([^/]+)\/train$/)
    if (taskTrainMatch && req.method === "POST")  return handleStartTrain(decodeURIComponent(taskTrainMatch[1]!), req)
    if (taskTrainMatch && req.method === "DELETE") return handleCancelTrain(decodeURIComponent(taskTrainMatch[1]!))

    if (path === "/api/upload" && req.method === "POST") return handleUpload(req)

    const taskSweepMatch = path.match(/^\/api\/tasks\/([^/]+)\/sweep$/)
    if (taskSweepMatch && req.method === "POST")   return handleStartSweep(decodeURIComponent(taskSweepMatch[1]!), req)
    if (taskSweepMatch && req.method === "GET")    return handleGetSweep(decodeURIComponent(taskSweepMatch[1]!))
    if (taskSweepMatch && req.method === "DELETE") return handleCancelSweep(decodeURIComponent(taskSweepMatch[1]!))

    const taskPredictMatch = path.match(/^\/api\/tasks\/([^/]+)\/predict$/)
    if (taskPredictMatch && req.method === "POST") return handlePredict(decodeURIComponent(taskPredictMatch[1]!), req)

    const taskBatchMatch = path.match(/^\/api\/tasks\/([^/]+)\/batch_predict$/)
    if (taskBatchMatch && req.method === "POST") return handleBatchPredict(decodeURIComponent(taskBatchMatch[1]!), req)

    const taskSuggestMatch = path.match(/^\/api\/tasks\/([^/]+)\/suggest_samples$/)
    if (taskSuggestMatch && req.method === "POST") return handleSuggestSamples(decodeURIComponent(taskSuggestMatch[1]!), req)

    const runMatch = path.match(/^\/api\/runs\/(\d+)$/)
    if (runMatch && req.method === "GET")        return handleRun(parseInt(runMatch[1]!))

    const runEventsMatch = path.match(/^\/api\/runs\/(\d+)\/events$/)
    if (runEventsMatch && req.method === "GET")  return handleRunEvents(parseInt(runEventsMatch[1]!))

    if (path.startsWith("/api/")) return err("Not found", 404)

    // Serve React app
    return serveStatic(path)
  },
})

console.log(`Neuron API + Dashboard → http://localhost:${PORT}`)
console.log(`DB: ${process.env.NEURON_DB ?? "default"}`)
