/**
 * Background batch-prediction worker (Phase 10.5).
 *
 * Mirrors trainBg.ts: POST returns a batchId immediately; this module owns the
 * actual row iteration, progress events, and completion state. Each predicted
 * row is also logged to the `predictions` table so drift detection and the
 * prediction log see batch traffic the same way single-shot predicts are seen.
 */
import { getTask } from "../core/db/tasks"
import { getRegisteredModel } from "../core/db/models"
import {
  createBatch, updateBatchProgress, finalizeBatch, type BatchPredictRun,
} from "../core/db/batch_predict"
import { logPrediction } from "../core/db/predictions"
import { recordEvent } from "../core/db/events"
import { rsTensor } from "../core/mcp_client"
import { applyNorm, softmax, argmax } from "../core/metrics"

const MAX_ROWS = 5000
const PROGRESS_EVERY = 50

export interface StartBatchPredictArgs {
  taskId: string
  records: Record<string, string>[]
  labelColumn?: string
}

export interface StartBatchPredictResult {
  batchId: number
  total: number
  truncated: boolean
}

export function startBatchPredictBackground(
  args: StartBatchPredictArgs,
): StartBatchPredictResult {
  const task = getTask(args.taskId)
  if (!task) throw new Error(`Task "${args.taskId}" not found`)
  const model = getRegisteredModel(args.taskId)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.taskId}". Train first.`)
  }

  const truncated = args.records.length > MAX_ROWS
  const rows = args.records.slice(0, MAX_ROWS)
  const errors: string[] = truncated ? [`Truncated to first ${MAX_ROWS} rows`] : []

  if (rows.length === 0) throw new Error("Empty CSV — no rows to process")

  const labelCol = args.labelColumn
  const hasLabels = !!labelCol && !!rows[0]![labelCol]

  const batch = createBatch({
    taskId: args.taskId,
    runId: model.run.id,
    total: rows.length,
    hasLabels,
    labelColumn: labelCol ?? null,
    errors,
  })

  recordEvent({
    source: "api",
    kind: "batch_predict_started",
    taskId: args.taskId,
    payload: { batchId: batch.id, total: rows.length, hasLabels },
  })

  // Fire-and-forget worker. Errors are captured, logged, and the batch row
  // is marked failed — they don't bubble into the HTTP request lifecycle.
  void runBatch(batch, args.taskId, model.run, rows, labelCol, errors).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    finalizeBatch(batch.id, {
      status: "failed",
      processed: 0,
      correct: hasLabels ? 0 : null,
      latencyMsAvg: null,
      errors: [...errors, `worker crashed: ${msg}`],
    })
    recordEvent({
      source: "api",
      kind: "batch_predict_failed",
      taskId: args.taskId,
      payload: { batchId: batch.id, error: msg },
    })
  })

  return { batchId: batch.id, total: rows.length, truncated }
}

async function runBatch(
  batch: BatchPredictRun,
  taskId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: any,
  rows: Record<string, string>[],
  labelCol: string | undefined,
  errors: string[],
): Promise<void> {
  const task = getTask(taskId)!
  const isRegression = task.kind === "regression"
  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  const K = isRegression ? 1 : labels.length
  const mlpName = `neuron_run_${run.id}_mlp`
  const firstRow = rows[0]!
  const allCols = Object.keys(firstRow)
  const featureCols = labelCol ? allCols.filter((c) => c !== labelCol) : allCols

  // Ensure model is loaded in rs-tensor.
  try {
    const probe = featureCols.map((c) => parseFloat(firstRow[c] ?? "0") || 0)
    await rsTensor.createTensor("neuron_batch_probe_api", probe, [1, probe.length])
    await rsTensor.evaluateMlp(mlpName, "neuron_batch_probe_api")
  } catch {
    if (!run.weights) {
      finalizeBatch(batch.id, {
        status: "failed",
        processed: 0,
        correct: batch.hasLabels ? 0 : null,
        latencyMsAvg: null,
        errors: [...errors, "model weights not in memory and none stored — retrain"],
      })
      recordEvent({
        source: "api",
        kind: "batch_predict_failed",
        taskId,
        payload: { batchId: batch.id, error: "model weights missing" },
      })
      return
    }
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
  }

  let correct = 0
  let totalLatency = 0

  for (let i = 0; i < rows.length; i++) {
    const rowData = rows[i]!
    let features = featureCols.map((c) => {
      const v = parseFloat(rowData[c] ?? "")
      return isNaN(v) ? 0 : v
    })
    const rawFeatures = [...features]
    if (run.normStats) features = applyNorm(features, run.normStats.mean, run.normStats.std)

    const t0 = Date.now()
    const inputName = `neuron_batch_api_${i % 50}`
    try {
      await rsTensor.createTensor(inputName, features, [1, features.length])
      const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
      const latencyMs = Date.now() - t0
      totalLatency += latencyMs

      let output: Record<string, unknown>
      if (isRegression) {
        const scale = run.weights?.["__regression_scale__"]?.data
        const rawOutput = evalResult.predictions?.data?.[0] ?? 0
        const value = rawOutput * (scale?.[1] ?? 1) + (scale?.[0] ?? 0)
        output = { value: +value.toFixed(6) }
        if (labelCol && rowData[labelCol]) {
          const truth = parseFloat(rowData[labelCol] ?? "0")
          output.truth = truth
          output.error = +(value - truth).toFixed(6)
        }
      } else {
        const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
        const T = run.calibrationTemperature ?? null
        const scaled = T !== null && T > 0 ? rawScores.map((v: number) => v / T) : rawScores
        const probs = softmax(scaled)
        const idx = argmax(probs)
        const label = labels[idx] ?? "unknown"
        output = {
          label,
          confidence: +(probs[idx] ?? 0).toFixed(4),
          calibrated: T !== null,
        }
        if (labelCol && rowData[labelCol]) {
          const truth = rowData[labelCol]!
          output.truth = truth
          output.correct = label === truth
          if (label === truth) correct++
        }
      }

      logPrediction({
        taskId,
        runId: run.id,
        modelUri: `neuron://local/run/${run.id}#batch/${batch.id}`,
        features: rawFeatures,
        output,
        latencyMs,
      })
    } catch (e) {
      errors.push(`row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
      // Continue — one bad row shouldn't kill the whole batch.
    }

    const processed = i + 1
    if (processed % PROGRESS_EVERY === 0 || processed === rows.length) {
      const avgLatency = totalLatency / processed
      const correctToLog = batch.hasLabels ? correct : null
      updateBatchProgress(batch.id, processed, correctToLog, avgLatency)
      recordEvent({
        source: "api",
        kind: "batch_predict_progress",
        taskId,
        payload: {
          batchId: batch.id,
          processed,
          total: rows.length,
          accuracy: batch.hasLabels && processed > 0 ? correct / processed : null,
          latencyMsAvg: +avgLatency.toFixed(2),
          throughputRowsPerS: +(1000 / Math.max(avgLatency, 1)).toFixed(1),
        },
      })
    }
  }

  const avgLatency = rows.length > 0 ? totalLatency / rows.length : 0
  finalizeBatch(batch.id, {
    status: "completed",
    processed: rows.length,
    correct: batch.hasLabels ? correct : null,
    latencyMsAvg: +avgLatency.toFixed(2),
    errors,
  })
  recordEvent({
    source: "api",
    kind: "batch_predict_completed",
    taskId,
    payload: {
      batchId: batch.id,
      processed: rows.length,
      total: rows.length,
      accuracy: batch.hasLabels && rows.length > 0 ? correct / rows.length : null,
      latencyMsAvg: +avgLatency.toFixed(2),
      errors: errors.length,
    },
  })
}
