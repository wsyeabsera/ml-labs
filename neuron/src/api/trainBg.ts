import { getTask, updateTaskLabels } from "../core/db/tasks"
import { getSamplesByTask, getSamplesByTaskAndSplit } from "../core/db/samples"
import {
  createRun, updateRunStatus, finalizeRun,
  updateRunProgress, clearRunProgressDb,
} from "../core/db/runs"
import { registerModel, getRegisteredModel } from "../core/db/models"
import { recordEvent } from "../core/db/events"
import {
  setActiveRun, clearActiveRun, setTaskTrained, clearRunProgress,
} from "../core/state"
import { trainHead } from "../core/train"
import { loadConfig } from "../adapter/loader"

export interface StartTrainArgs {
  taskId: string
  lr?: number
  epochs?: number
  headArch?: number[]
  classWeights?: "balanced"
}

export async function startTrainBackground(args: StartTrainArgs): Promise<{ runId: number }> {
  const task = getTask(args.taskId)
  if (!task) throw new Error(`Task "${args.taskId}" not found`)

  const config = await loadConfig()

  const allSamples = getSamplesByTask(args.taskId)
  const hasSplit = allSamples.some((s) => s.split === "test")
  const trainSamples = hasSplit ? getSamplesByTaskAndSplit(args.taskId, "train") : allSamples

  if (trainSamples.length === 0) throw new Error("No training samples — load data with load_csv first")

  const isRegression = task.kind === "regression"
  const labelNames = isRegression
    ? []
    : [...new Set(trainSamples.map((s) => s.label))].sort()
  if (!isRegression && labelNames.length < 2)
    throw new Error("Need at least 2 distinct classes to train")

  const K = isRegression ? 1 : labelNames.length
  const D = task.featureShape[0] ?? trainSamples[0]?.features.length ?? 1

  const lr = args.lr ?? config?.defaultHyperparams?.lr ?? 0.005
  const epochs = args.epochs ?? config?.defaultHyperparams?.epochs ?? 500
  const headArchFn = config?.headArchitecture ?? ((k: number, d: number) => [d, Math.max(d, 32), k])
  const headArch = args.headArch ?? headArchFn(K, D)

  const run = createRun(args.taskId, { lr, epochs, headArch, classWeights: args.classWeights })
  const ac = new AbortController()
  setActiveRun(args.taskId, run.id, ac)

  recordEvent({ source: "mcp", kind: "run_started", taskId: args.taskId, runId: run.id, payload: { lr, epochs, headArch } })

  // Fire-and-forget training loop
  let lastProgressTs = 0
  let lastStage: string | null = null
  ;(async () => {
    try {
      const result = await trainHead({
        samples: trainSamples,
        labels: labelNames,
        featurize: async (s) => (s as { features: number[] }).features,
        headArch: () => headArch,
        hyperparams: { lr, epochs },
        runId: run.id,
        isRegression,
        normalize: task.normalize,
        classWeights: args.classWeights,
        signal: ac.signal,
        onProgress: (p) => {
          updateRunProgress(run.id, {
            stage: p.stage, i: p.i, n: p.n,
            message: p.message, lossHistory: [], epochsDone: 0,
          })
          // Stage transition — unthrottled heartbeat
          if (p.stage !== lastStage) {
            lastStage = p.stage
            recordEvent({ source: "mcp", kind: "run_stage", taskId: args.taskId, runId: run.id, payload: { stage: p.stage, message: p.message } })
          }
          // Progress with i/n — throttled to 1/sec
          const now = Date.now()
          if (now - lastProgressTs > 1000) {
            lastProgressTs = now
            recordEvent({ source: "mcp", kind: "run_progress", taskId: args.taskId, runId: run.id, payload: { stage: p.stage, i: p.i, n: p.n, message: p.message } })
          }
        },
      })

      finalizeRun(run.id, {
        accuracy: result.metrics.accuracy,
        perClassAccuracy: result.metrics.perClassAccuracy,
        confusionMatrix: result.metrics.confusionMatrix,
        lossHistory: result.lossHistory,
        sampleCounts: result.sampleCounts,
        weights: result.weights,
        normStats: result.normStats,
        mae: result.regressionMetrics?.mae,
        rmse: result.regressionMetrics?.rmse,
        r2: result.regressionMetrics?.r2,
      })

      if (!isRegression) updateTaskLabels(args.taskId, labelNames)
      const prevModel = getRegisteredModel(args.taskId)
      registerModel(args.taskId, run.id)
      recordEvent({ source: "mcp", kind: "model_registered", taskId: args.taskId, runId: run.id, payload: { accuracy: result.metrics.accuracy, previousRunId: prevModel?.runId ?? null } })
      const numClasses = isRegression ? 0 : K
      recordEvent({ source: "mcp", kind: "run_completed", taskId: args.taskId, runId: run.id, payload: {
        accuracy: result.metrics.accuracy,
        mae: result.regressionMetrics?.mae,
        numClasses,
        epochsDone: epochs,
        confusionMatrix: numClasses > 0 && numClasses <= 10 ? result.metrics.confusionMatrix : undefined,
      } })
      setTaskTrained(args.taskId, {
        labels: labelNames,
        metrics: result.metrics,
        lossHistory: result.lossHistory,
        sampleCounts: result.sampleCounts,
        runId: run.id,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const failKind = msg.includes("cancelled") ? "cancelled" : "failed"
      updateRunStatus(run.id, failKind)
      recordEvent({ source: "mcp", kind: `run_${failKind}`, taskId: args.taskId, runId: run.id, payload: { error: msg } })
      clearActiveRun(args.taskId)
    } finally {
      clearRunProgress(run.id)
      clearRunProgressDb(run.id)
    }
  })()

  return { runId: run.id }
}
