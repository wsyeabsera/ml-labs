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
import { listAutoRuns, getAutoRun } from "./core/db/auto"
import { attachShadow, detachShadow, getShadow, getAgreementRate } from "./core/db/shadow"
import { sampleCounts, splitCounts, insertSamplesBatch, deleteAllSamples } from "./core/db/samples"
import { deleteRegisteredModel } from "./core/db/models"
import { countRuns } from "./core/db/runs"
import { getRegisteredModel, registerModel } from "./core/db/models"
import { recordEvent, listEvents } from "./core/db/events"
import { getTaskState, resetTaskState } from "./core/state"
import { startTrainBackground } from "./api/trainBg"
import { startBatchPredictBackground } from "./api/batchPredictBg"
import { getBatch, listBatches } from "./core/db/batch_predict"
import { handler as predictFn, runInference as runInferenceForRun } from "./tools/predict"
import { softmax, argmax, applyNorm } from "./core/metrics"
import { rsTensor, clientStatus } from "./core/mcp_client"
import { loadConfig, loadedConfigPath } from "./adapter/loader"

// Force DB initialization via schema import
import { db } from "./core/db/schema"
import { reapZombies } from "./core/auto/reaper"

// Phase 10.6: reap stranded `running` rows on startup so the dashboard
// doesn't show runs that died with a prior process.
const reaped = reapZombies()
if (reaped.runsReaped > 0 || reaped.autoRunsReaped > 0) {
  console.log(`Reaped stale rows on boot: ${reaped.runsReaped} run(s), ${reaped.autoRunsReaped} auto_run(s)`)
}

const PORT = parseInt(process.env.NEURON_API_PORT ?? "2626")
const DIST = process.env.DASHBOARD_DIST ?? join(import.meta.dir, "../../dashboard/dist")
const VERSION = "1.4.0"
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

// ── Registry serving (Phase 8 / v1.0) ─────────────────────────────────────────

/**
 * Bearer-token gate for the registry endpoints. When NEURON_SERVE_TOKEN is set,
 * requests need `Authorization: Bearer <token>` to proceed. Returns null on
 * success; otherwise a 401 Response to return from the handler.
 */
function serveAuthGate(req: Request): Response | null {
  const expected = process.env.NEURON_SERVE_TOKEN
  if (!expected) return null // unauthenticated by design if no token set
  const header = req.headers.get("authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match || match[1] !== expected) {
    return json({ error: "unauthorized" }, 401)
  }
  return null
}

// Cache of loaded MLPs by uri — avoid re-loading weights from disk every call.
const loadedBundles = new Set<string>()

async function ensureBundleLoaded(uri: string, name: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (loadedBundles.has(uri)) return { ok: true }
  const { readBundle } = await import("./core/registry/bundle")
  const bundle = readBundle(uri)
  if (!bundle) return { ok: false, reason: `bundle not found: ${uri}` }
  const { rsTensor } = await import("./core/mcp_client")
  await rsTensor.restoreMlp(name, bundle.weights, bundle.meta.head_arch)
  loadedBundles.add(uri)
  return { ok: true }
}

async function handleRegistryPredict(name: string, version: string, req: Request): Promise<Response> {
  const guard = serveAuthGate(req)
  if (guard) return guard

  const uri = `neuron://local/${name}@${version}`
  const { readBundle } = await import("./core/registry/bundle")
  const bundle = readBundle(uri)
  if (!bundle) return err(`bundle not found: ${uri}`, 404)

  let body: { features?: number[] } = {}
  try { body = (await req.json()) as typeof body } catch { /* empty ok */ }
  const features = body.features
  if (!Array.isArray(features) || features.length === 0) {
    return err("body requires `features: number[]`")
  }

  const mlpName = `neuron_served_${name}_${version.replaceAll(".", "_")}`
  const loaded = await ensureBundleLoaded(uri, mlpName)
  if (!loaded.ok) return err(loaded.reason, 500)

  const isRegression = bundle.meta.kind === "regression"
  const labels = bundle.meta.labels ?? []
  const K = isRegression ? 1 : labels.length
  const D = bundle.meta.feature_shape[0] ?? features.length

  // Apply normalization from the bundle's run if present.
  const normScale = bundle.weights["__regression_scale__"]?.data
  const { applyNorm } = await import("./core/metrics")
  const normStats = bundle.weights.__norm_stats__ as { data?: number[]; shape?: number[] } | undefined
  const normed = normStats?.data && normStats.shape?.length === 2
    ? applyNorm(features, normStats.data.slice(0, normStats.shape[1]!), normStats.data.slice(normStats.shape[1]!))
    : features

  const t0 = Date.now()
  const inputName = `${mlpName}_input_${t0}`
  await rsTensor.createTensor(inputName, normed, [1, D])
  const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  const raw = evalResult.predictions?.data ?? []

  let output: Record<string, unknown>
  if (isRegression) {
    const rawVal = raw[0] ?? 0
    const value = normScale ? rawVal * (normScale[1] ?? 1) + (normScale[0] ?? 0) : rawVal
    output = { value, raw_output: rawVal }
  } else {
    const logits = raw.slice(0, K)
    const hp = bundle.meta.hyperparams as { calibration_temperature?: number }
    const T = hp?.calibration_temperature
    const scaled = T && T > 0 ? logits.map((v) => v / T) : logits
    const probs = softmax(scaled)
    const idx = argmax(probs)
    const scoreMap: Record<string, number> = {}
    for (let i = 0; i < labels.length; i++) scoreMap[labels[i]!] = +(probs[i] ?? 0).toFixed(4)
    output = {
      label: labels[idx] ?? "unknown",
      confidence: +(probs[idx] ?? 0).toFixed(4),
      scores: scoreMap,
      calibrated: T != null && T > 0,
    }
  }
  const latencyMs = Date.now() - t0

  const { logPrediction } = await import("./core/db/predictions")
  logPrediction({
    taskId: bundle.meta.task_id,
    runId: bundle.meta.run_info?.run_id ?? null,
    modelUri: uri,
    features,
    output,
    latencyMs,
  })

  return json({ ...output, model_uri: uri, latency_ms: latencyMs })
}

async function handleRegistryBatchPredict(name: string, version: string, req: Request): Promise<Response> {
  const guard = serveAuthGate(req)
  if (guard) return guard

  const uri = `neuron://local/${name}@${version}`
  const { readBundle } = await import("./core/registry/bundle")
  const bundle = readBundle(uri)
  if (!bundle) return err(`bundle not found: ${uri}`, 404)

  let body: { features?: number[][] } = {}
  try { body = (await req.json()) as typeof body } catch { /* ok */ }
  const rows = body.features
  if (!Array.isArray(rows) || rows.length === 0) {
    return err("body requires `features: number[][]`")
  }
  if (rows.length > 10000) return err("max 10000 rows per batch")

  const mlpName = `neuron_served_${name}_${version.replaceAll(".", "_")}`
  const loaded = await ensureBundleLoaded(uri, mlpName)
  if (!loaded.ok) return err(loaded.reason, 500)

  const isRegression = bundle.meta.kind === "regression"
  const labels = bundle.meta.labels ?? []
  const K = isRegression ? 1 : labels.length
  const D = bundle.meta.feature_shape[0] ?? rows[0]!.length

  const normScale = bundle.weights["__regression_scale__"]?.data
  const { applyNorm } = await import("./core/metrics")
  const normStats = bundle.weights.__norm_stats__ as { data?: number[]; shape?: number[] } | undefined
  const normalize = normStats?.data && normStats.shape?.length === 2
  const flat = rows.flatMap((f) =>
    normalize
      ? applyNorm(f, normStats!.data!.slice(0, normStats!.shape![1]!), normStats!.data!.slice(normStats!.shape![1]!))
      : f,
  )

  const t0 = Date.now()
  const inputName = `${mlpName}_batch_${t0}`
  await rsTensor.createTensor(inputName, flat, [rows.length, D])
  const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  const raw = evalResult.predictions?.data ?? []

  const hp = bundle.meta.hyperparams as { calibration_temperature?: number }
  const T = hp?.calibration_temperature
  const predictions: unknown[] = []
  for (let i = 0; i < rows.length; i++) {
    if (isRegression) {
      const rawVal = raw[i * K] ?? 0
      const value = normScale ? rawVal * (normScale[1] ?? 1) + (normScale[0] ?? 0) : rawVal
      predictions.push({ row: i + 1, value: +value.toFixed(6), raw_output: rawVal })
    } else {
      const logits = raw.slice(i * K, (i + 1) * K)
      const scaled = T && T > 0 ? logits.map((v) => v / T) : logits
      const probs = softmax(scaled)
      const idx = argmax(probs)
      predictions.push({
        row: i + 1,
        label: labels[idx] ?? "unknown",
        confidence: +(probs[idx] ?? 0).toFixed(4),
      })
    }
  }
  const latencyMs = Date.now() - t0

  const { logPrediction } = await import("./core/db/predictions")
  // Sampled logging — log at most one per batch to keep DB writes bounded.
  logPrediction({
    taskId: bundle.meta.task_id,
    runId: bundle.meta.run_info?.run_id ?? null,
    modelUri: uri,
    features: rows[0]!, // representative sample
    output: { batch_size: rows.length, sample: predictions[0] },
    latencyMs,
  })

  return json({
    model_uri: uri,
    total: rows.length,
    predictions,
    latency_ms: latencyMs,
    calibrated: T != null && T > 0,
  })
}

async function handleRunConfusions(runId: number, url: URL): Promise<Response> {
  const run = getRun(runId)
  if (!run) return err(`Run ${runId} not found`, 404)
  const trueLabel = url.searchParams.get("true")
  const predLabel = url.searchParams.get("pred")
  if (!trueLabel || !predLabel) return err("Query params required: true, pred")

  const task = getTask(run.taskId)
  if (!task) return err(`Task "${run.taskId}" not found`, 404)
  if (task.kind === "regression") {
    return json({ ok: false, reason: "confusion drill-through is classification-only" })
  }

  const labels = task.labels ?? []
  const labelToIdx = new Map(labels.map((l, i) => [l, i]))
  const trueIdx = labelToIdx.get(trueLabel)
  const predIdx = labelToIdx.get(predLabel)
  if (trueIdx === undefined || predIdx === undefined) {
    return err(`Unknown label: ${trueIdx === undefined ? trueLabel : predLabel}`)
  }

  // Pull all samples for this task where the model's prediction matches predLabel
  // AND the true label is trueLabel. We re-predict using the registered model's
  // raw logits so we also report confidence alongside.
  const { getSamplesByTask } = await import("./core/db/samples")
  const samples = getSamplesByTask(run.taskId)
  const candidates = samples.filter((s) => s.label === trueLabel)
  if (candidates.length === 0) return json({ ok: true, samples: [] })

  const K = labels.length
  const D = task.featureShape[0] ?? candidates[0]!.features.length

  const flat = candidates.flatMap((s) =>
    run.normStats
      ? applyNorm(s.features, run.normStats.mean, run.normStats.std)
      : s.features,
  )
  const inputName = `neuron_confusions_${runId}_${Date.now()}`
  await rsTensor.createTensor(inputName, flat, [candidates.length, D])

  const mlpName = `neuron_run_${run.id}_mlp`
  let evalResult: { predictions?: { data: number[]; shape: number[] } }
  try {
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  } catch {
    if (!run.weights) return err("Model not in memory and no stored weights")
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  }

  const raw = evalResult.predictions?.data ?? []
  const T = run.calibrationTemperature
  const result: Array<{ sample_id: number; confidence: number; features: number[]; scores: number[] }> = []
  for (let i = 0; i < candidates.length; i++) {
    const logits = raw.slice(i * K, (i + 1) * K)
    const scaled = T !== null && T !== undefined && T > 0 ? logits.map((v) => v / T) : logits
    const probs = softmax(scaled)
    const pred = argmax(probs)
    if (pred !== predIdx) continue
    result.push({
      sample_id: candidates[i]!.id,
      confidence: +(probs[pred] ?? 0).toFixed(4),
      features: candidates[i]!.features,
      scores: probs.map((p) => +p.toFixed(4)),
    })
  }
  result.sort((a, b) => b.confidence - a.confidence)
  return json({
    ok: true,
    run_id: runId,
    task_id: run.taskId,
    true_label: trueLabel,
    predicted_label: predLabel,
    samples: result,
    labels,
  })
}

function handleRun(id: number): Response {
  const r = getRun(id)
  if (!r) return err(`Run ${id} not found`, 404)
  return json({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    perClassAccuracy: r.perClassAccuracy, confusionMatrix: r.confusionMatrix,
    lossHistory: r.lossHistory,
    valLossHistory: r.valLossHistory,
    mae: r.mae, rmse: r.rmse, r2: r.r2,
    sampleCounts: r.sampleCounts, runProgress: r.runProgress,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
    runContext: r.runContext, datasetHash: r.datasetHash,
    cvFoldId: r.cvFoldId, cvParentId: r.cvParentId,
    calibrationTemperature: r.calibrationTemperature,
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
  const feats = features as number[]
  try {
    const result = await predictFn({ task_id: taskId, features: feats })

    // Phase 8.5 — shadow inference: if a shadow is attached, run it, log the comparison,
    // but return the primary output unchanged to the caller.
    const shadow = getShadow(taskId)
    const primary = getRegisteredModel(taskId)
    if (shadow?.run && primary?.runId != null
        && (shadow.run.status === "completed" || shadow.run.status === "imported")) {
      try {
        const shadowOutput = await runInferenceForRun(shadow.run, task, feats)
        const agree = computeAgreement(result, shadowOutput, task.kind === "regression")
        const { recordShadowComparison } = await import("./core/db/shadow")
        recordShadowComparison({
          taskId,
          primaryRunId: primary.runId,
          shadowRunId: shadow.runId,
          features: feats,
          primaryOutput: result,
          shadowOutput,
          agree,
        })
      } catch {
        // Shadow inference failures are non-fatal — the primary response still ships.
      }
    }

    return json(result)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function computeAgreement(
  primary: { label?: string; value?: number },
  shadow: { label?: string; value?: number },
  isRegression: boolean,
): boolean {
  if (isRegression) {
    if (primary.value == null || shadow.value == null) return false
    const delta = Math.abs(primary.value - shadow.value)
    const scale = Math.max(Math.abs(primary.value), 1)
    return delta / scale < 0.05
  }
  return primary.label != null && primary.label === shadow.label
}

async function handleBatchPredict(taskId: string, req: Request): Promise<Response> {
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

  if (records.length === 0) return err("CSV contained no rows")

  try {
    const { batchId, total, truncated } = startBatchPredictBackground({
      taskId,
      records,
      labelColumn: labelCol,
    })
    return json({ ok: true, batchId, total, truncated })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function handleListBatchPredicts(taskId: string, url: URL): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200)
  const batches = listBatches(taskId, limit)
  return json({ ok: true, batches })
}

function handleGetBatchPredict(id: number): Response {
  const batch = getBatch(id)
  if (!batch) return err(`Batch ${id} not found`, 404)
  return json({ ok: true, batch })
}

// ── Drift check ────────────────────────────────────────────────────────────────

async function handleDrift(taskId: string, url: URL): Promise<Response> {
  const { handler: driftFn } = await import("./tools/drift_check")
  const windowParam = url.searchParams.get("window")
  const window = windowParam ? Math.max(30, Math.min(10000, parseInt(windowParam))) : 1000
  try {
    const result = await driftFn({ task_id: taskId, current_window: window })
    return json(result)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
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

  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder()
      function send(event: string, data: unknown) {
        if (closed) return
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Snapshot = newest 50 events, returned chronologically. `lastId` starts
      // at the max id in the snapshot so the interval loop only emits events
      // strictly newer than what the client just received. This prevents the
      // "every refresh replays every event ever recorded" bug.
      const snapshot = listEvents({ newest: true, limit: 50 })
      let lastId: number
      if (snapshot.length > 0) {
        send("snapshot", snapshot)
        lastId = snapshot[snapshot.length - 1]!.id
      } else {
        // Empty DB — seed cursor at 0 so any future event will surface.
        lastId = 0
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

// ── Drift status + shadow routes ──────────────────────────────────────────────

function handleDriftStatus(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
  const evs = listEvents({ taskId, since: twentyFourHoursAgo, limit: 200 })
    .filter((e) => e.kind === "drift_detected")
  if (evs.length === 0) return json({ ok: true, drift: null })
  const latest = evs[evs.length - 1]!
  const p = latest.payload as { verdict?: string; drifting_features?: number; total_features?: number }
  return json({
    ok: true,
    drift: {
      verdict: p.verdict,
      driftingFeatures: p.drifting_features ?? 0,
      totalFeatures: p.total_features ?? 0,
      ts: latest.ts,
      eventId: latest.id,
    },
  })
}

function handleGetShadow(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const shadow = getShadow(taskId)
  if (!shadow) return json({ ok: true, shadow: null })
  const agreement = getAgreementRate(taskId, 500)
  return json({
    ok: true,
    shadow: {
      runId: shadow.runId,
      addedAt: shadow.addedAt,
      accuracy: shadow.run?.accuracy ?? null,
      valAccuracy: shadow.run?.valAccuracy ?? null,
      status: shadow.run?.status ?? null,
    },
    agreement,
  })
}

async function handleAttachShadow(taskId: string, req: Request): Promise<Response> {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  let body: { run_id?: number } = {}
  try { body = (await req.json()) as { run_id?: number } } catch { return err("Invalid JSON body") }
  if (typeof body.run_id !== "number") return err("run_id (number) required")
  const run = getRun(body.run_id)
  if (!run || run.taskId !== taskId) return err("run_id does not belong to this task", 400)
  if (run.status !== "completed" && run.status !== "imported") {
    return err("shadow must reference a completed or imported run", 400)
  }
  const primary = getRegisteredModel(taskId)
  if (primary && primary.runId === body.run_id) {
    return err("shadow cannot equal the currently-promoted run", 400)
  }
  attachShadow(taskId, body.run_id)
  recordEvent({ source: "api", kind: "shadow_attached", taskId, runId: body.run_id })
  return json({ ok: true, taskId, runId: body.run_id })
}

function handleDetachShadow(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const existing = getShadow(taskId)
  if (!existing) return json({ ok: true, detached: false })
  detachShadow(taskId)
  recordEvent({ source: "api", kind: "shadow_detached", taskId, runId: existing.runId })
  return json({ ok: true, detached: true, runId: existing.runId })
}

function handlePromoteShadow(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const shadow = getShadow(taskId)
  if (!shadow) return err("No shadow attached", 400)
  registerModel(taskId, shadow.runId)
  detachShadow(taskId)
  recordEvent({ source: "api", kind: "shadow_promoted", taskId, runId: shadow.runId,
    payload: { from: "shadow" } })
  recordEvent({ source: "api", kind: "model_registered", taskId, runId: shadow.runId,
    payload: { via: "shadow_promotion" } })
  return json({ ok: true, taskId, runId: shadow.runId })
}

// ── Auto-run routes ───────────────────────────────────────────────────────────

function handleAutoRuns(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 200)
  const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0
  const taskId = url.searchParams.get("task") ?? undefined
  const runs = listAutoRuns(limit, offset, taskId)
  // Summary payload: elide decision_log here to keep the list light.
  const items = runs.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    accuracyTarget: r.accuracy_target,
    budgetS: r.budget_s,
    maxWaves: r.max_waves,
    wavesUsed: r.waves_used,
    winnerRunId: r.winner_run_id,
    finalAccuracy: r.final_accuracy,
    verdict: r.verdict,
    verdictJson: r.verdict_json,
  }))
  return json({ autoRuns: items })
}

function handleAutoRun(id: number): Response {
  const r = getAutoRun(id)
  if (!r) return err(`Auto-run ${id} not found`, 404)
  return json({
    id: r.id,
    taskId: r.task_id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    accuracyTarget: r.accuracy_target,
    budgetS: r.budget_s,
    maxWaves: r.max_waves,
    wavesUsed: r.waves_used,
    winnerRunId: r.winner_run_id,
    finalAccuracy: r.final_accuracy,
    verdict: r.verdict,
    verdictJson: r.verdict_json,
    decisionLog: r.decision_log,
  })
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
    if (taskBatchMatch && req.method === "GET")  return handleListBatchPredicts(decodeURIComponent(taskBatchMatch[1]!), url)

    const batchPredictGetMatch = path.match(/^\/api\/batch_predict\/(\d+)$/)
    if (batchPredictGetMatch && req.method === "GET") return handleGetBatchPredict(parseInt(batchPredictGetMatch[1]!))

    const taskSuggestMatch = path.match(/^\/api\/tasks\/([^/]+)\/suggest_samples$/)
    if (taskSuggestMatch && req.method === "POST") return handleSuggestSamples(decodeURIComponent(taskSuggestMatch[1]!), req)

    const taskDriftMatch = path.match(/^\/api\/tasks\/([^/]+)\/drift$/)
    if (taskDriftMatch && req.method === "GET") return handleDrift(decodeURIComponent(taskDriftMatch[1]!), url)

    const taskDriftStatusMatch = path.match(/^\/api\/tasks\/([^/]+)\/drift-status$/)
    if (taskDriftStatusMatch && req.method === "GET") return handleDriftStatus(decodeURIComponent(taskDriftStatusMatch[1]!))

    const taskShadowMatch = path.match(/^\/api\/tasks\/([^/]+)\/shadow$/)
    if (taskShadowMatch && req.method === "GET")    return handleGetShadow(decodeURIComponent(taskShadowMatch[1]!))
    if (taskShadowMatch && req.method === "POST")   return handleAttachShadow(decodeURIComponent(taskShadowMatch[1]!), req)
    if (taskShadowMatch && req.method === "DELETE") return handleDetachShadow(decodeURIComponent(taskShadowMatch[1]!))

    const taskShadowPromoteMatch = path.match(/^\/api\/tasks\/([^/]+)\/shadow\/promote$/)
    if (taskShadowPromoteMatch && req.method === "POST") return handlePromoteShadow(decodeURIComponent(taskShadowPromoteMatch[1]!))

    const runMatch = path.match(/^\/api\/runs\/(\d+)$/)
    if (runMatch && req.method === "GET")        return handleRun(parseInt(runMatch[1]!))

    if (path === "/api/auto" && req.method === "GET") return handleAutoRuns(url)
    const autoRunMatch = path.match(/^\/api\/auto\/(\d+)$/)
    if (autoRunMatch && req.method === "GET")    return handleAutoRun(parseInt(autoRunMatch[1]!))

    const runEventsMatch = path.match(/^\/api\/runs\/(\d+)\/events$/)
    if (runEventsMatch && req.method === "GET")  return handleRunEvents(parseInt(runEventsMatch[1]!))

    const runConfusionsMatch = path.match(/^\/api\/runs\/(\d+)\/confusions$/)
    if (runConfusionsMatch && req.method === "GET") return handleRunConfusions(parseInt(runConfusionsMatch[1]!), url)

    // Phase 8 — bundle-serving endpoints.
    // name can include letters, digits, dashes, underscores; version is anything after @.
    const registryPredictMatch = path.match(/^\/api\/registry\/([^@/]+)@([^/]+)\/predict$/)
    if (registryPredictMatch && req.method === "POST") {
      return handleRegistryPredict(decodeURIComponent(registryPredictMatch[1]!), decodeURIComponent(registryPredictMatch[2]!), req)
    }
    const registryBatchMatch = path.match(/^\/api\/registry\/([^@/]+)@([^/]+)\/batch_predict$/)
    if (registryBatchMatch && req.method === "POST") {
      return handleRegistryBatchPredict(decodeURIComponent(registryBatchMatch[1]!), decodeURIComponent(registryBatchMatch[2]!), req)
    }

    if (path.startsWith("/api/")) return err("Not found", 404)

    // Serve React app
    return serveStatic(path)
  },
})

console.log(`Neuron API + Dashboard → http://localhost:${PORT}`)
console.log(`DB: ${process.env.NEURON_DB ?? "default"}`)
