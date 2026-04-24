import { getTask, updateTaskLabels } from "../core/db/tasks"
import { getSamplesByTask, getSamplesByTaskAndSplit, countSamplesByTaskAndSplit } from "../core/db/samples"
import {
  createRun, updateRunStatus, finalizeRun,
  updateRunProgress, clearRunProgressDb,
} from "../core/db/runs"
import { registerModel, getRegisteredModel } from "../core/db/models"
import { recordEvent } from "../core/db/events"
import {
  setActiveRun, clearActiveRun, setTaskTrained, clearRunProgress,
} from "../core/state"
import { trainHead, evalValAccuracy } from "../core/train"
import { loadConfig } from "../adapter/loader"
import { buildRunContext } from "../core/run-context"
import { datasetHash } from "../util/hash"
import { resolveSeed } from "../util/rng"
import { updateDatasetHash } from "../core/db/runs"

export interface StartTrainArgs {
  taskId: string
  lr?: number
  epochs?: number
  headArch?: number[]
  classWeights?: "balanced"
  weightDecay?: number
  earlyStopPatience?: number
  seed?: number
  cvFoldId?: number
  cvParentId?: number
  optimizer?: "sgd" | "adam" | "adamw"
  batchSize?: number
  lrSchedule?: "constant" | "cosine" | "linear_warmup"
  warmupEpochs?: number
  minLr?: number
  gradClip?: number
  loss?: "mse" | "cross_entropy"
  activation?: "tanh" | "relu" | "gelu" | "leaky_relu"
  initStrategy?: "auto" | "xavier" | "kaiming"
  swa?: boolean
  swaStartEpoch?: number
  labelSmoothing?: number
  /**
   * Auto-register the resulting run as the task's active model on completion.
   * Defaults to true for backward compat with dashboard-launched trainings.
   * cv_train sets this false so per-fold runs don't clobber the real winner.
   */
  autoRegister?: boolean
}

export async function startTrainBackground(args: StartTrainArgs): Promise<{ runId: number }> {
  const task = getTask(args.taskId)
  if (!task) throw new Error(`Task "${args.taskId}" not found`)

  const config = await loadConfig()

  // v1.7.1: avoid materializing every sample twice. Cheap count queries first;
  // only fetch the rows we actually hand to the trainer.
  const testCount = countSamplesByTaskAndSplit(args.taskId, "test")
  const hasSplit = testCount > 0
  const trainSamples = hasSplit
    ? getSamplesByTaskAndSplit(args.taskId, "train")
    : getSamplesByTask(args.taskId)
  // testSamples is only needed for the post-training val eval. Defer reading it
  // until then so it doesn't inflate peak memory during the training call.

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

  const seed = resolveSeed(args.seed)
  const runContext = buildRunContext({ rng_seed: seed ?? undefined })

  const run = createRun(
    args.taskId,
    {
      lr, epochs, headArch,
      classWeights: args.classWeights,
      ...(args.weightDecay !== undefined ? { weightDecay: args.weightDecay } : {}),
      ...(args.earlyStopPatience !== undefined ? { earlyStopPatience: args.earlyStopPatience } : {}),
    },
    {
      runContext,
      cvFoldId: args.cvFoldId ?? null,
      cvParentId: args.cvParentId ?? null,
    },
  )

  // Dataset hash is computed once per run based on what the trainer actually sees.
  try {
    updateDatasetHash(
      run.id,
      datasetHash(trainSamples.map((s) => ({ id: s.id, label: s.label, features: s.features }))),
    )
  } catch { /* best-effort; don't fail training on hash errors */ }
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
        hyperparams: {
          lr, epochs,
          ...(args.weightDecay !== undefined ? { weightDecay: args.weightDecay } : {}),
          ...(args.earlyStopPatience !== undefined ? { earlyStopPatience: args.earlyStopPatience } : {}),
          ...(args.optimizer !== undefined ? { optimizer: args.optimizer } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
          ...(args.lrSchedule !== undefined ? { lrSchedule: args.lrSchedule } : {}),
          ...(args.warmupEpochs !== undefined ? { warmupEpochs: args.warmupEpochs } : {}),
          ...(args.minLr !== undefined ? { minLr: args.minLr } : {}),
          ...(args.gradClip !== undefined ? { gradClip: args.gradClip } : {}),
          ...(args.loss !== undefined ? { loss: args.loss } : {}),
          ...(args.activation !== undefined ? { activation: args.activation } : {}),
          ...(args.initStrategy !== undefined ? { initStrategy: args.initStrategy } : {}),
          ...(seed !== undefined ? { seed } : {}),
          ...(args.swa !== undefined ? { swa: args.swa } : {}),
          ...(args.swaStartEpoch !== undefined ? { swaStartEpoch: args.swaStartEpoch } : {}),
          ...(args.labelSmoothing !== undefined ? { labelSmoothing: args.labelSmoothing } : {}),
        },
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

      // Held-out val eval populates val_accuracy so downstream tools (cv_train,
      // winner selection, overfit detection) have a real generalization signal.
      // Shared helper also covers tools/train.ts (sub-agent sweep path).
      const valAccuracy = await evalValAccuracy({
        taskId: args.taskId,
        runId: run.id,
        D, K,
        labelNames,
        ...(result.normStats ? { normStats: result.normStats } : {}),
        isRegression,
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
        ...(valAccuracy !== undefined ? { valAccuracy } : {}),
      })

      if (!isRegression) updateTaskLabels(args.taskId, labelNames)
      const autoRegister = args.autoRegister !== false
      const prevModel = autoRegister ? getRegisteredModel(args.taskId) : null
      if (autoRegister) {
        registerModel(args.taskId, run.id)
        recordEvent({ source: "mcp", kind: "model_registered", taskId: args.taskId, runId: run.id, payload: { accuracy: result.metrics.accuracy, previousRunId: prevModel?.runId ?? null } })
      }
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
