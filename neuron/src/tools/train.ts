import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { getSamplesByTask, getSamplesByTaskAndSplit, sampleCounts } from "../core/db/samples"
import { createRun, updateRunStatus, updateRunCheckpoint, finalizeRun, updateDatasetHash } from "../core/db/runs"
import { registerModel } from "../core/db/models"
import { setActiveRun, clearActiveRun, setTaskTrained, setRunProgress, clearRunProgress } from "../core/state"
import { updateRunProgress, clearRunProgressDb } from "../core/db/runs"
import { trainHead, type TrainHyperparams } from "../core/train"
import { loadConfig } from "../adapter/loader"
import { log, clearLog } from "../core/logger"
import { buildRunContext } from "../core/run-context"
import { datasetHash } from "../util/hash"
import { resolveSeed } from "../util/rng"

export const name = "train"
export const description = "Train an MLP head for the task. Supports classification and regression, normalization, class balancing, and train/test split awareness."

export const schema = {
  task_id: z.string().describe("Task ID to train"),
  lr: z.number().positive().optional().describe("Learning rate (default: 0.005)"),
  epochs: z.number().int().positive().optional().describe("Training epochs (default: 500)"),
  head_arch: z.array(z.number().int().positive()).optional().describe("MLP architecture [D, ...hidden, K]. Defaults to [D, max(D,32), K]"),
  run_id: z.number().int().optional().describe("Resume a cancelled run from its checkpoint"),
  auto_register: z.boolean().default(true).describe("Auto-register as active model on completion"),
  class_weights: z.enum(["balanced"]).optional().describe("Oversample minority classes so every class contributes equally to training. Classification only."),
  weight_decay: z.number().nonnegative().optional().describe("L2 weight decay coefficient (default: 0). Typical values: 1e-4 .. 1e-2. Helps combat overfitting."),
  early_stop_patience: z.number().int().positive().optional().describe("Early-stopping patience in epochs. If set, training stops when loss has not improved for this many consecutive epochs."),
  optimizer: z.enum(["sgd", "adam", "adamw"]).optional().describe("Optimizer (default: sgd). Adam/AdamW generally converge faster on harder problems."),
  batch_size: z.number().int().positive().optional().describe("Mini-batch size (default: full batch). Smaller batches add stochastic regularization and scale to larger datasets."),
  lr_schedule: z.enum(["constant", "cosine", "linear_warmup"]).optional().describe("Learning-rate schedule (default: constant)."),
  warmup_epochs: z.number().int().nonnegative().optional().describe("Warmup epochs for lr_schedule=linear_warmup (default: 10)."),
  min_lr: z.number().nonnegative().optional().describe("Minimum learning rate for cosine schedule (default: 0)."),
  grad_clip: z.number().positive().optional().describe("Clip global L2 gradient norm to this value. Useful for high-LR or RNN-like training."),
  loss: z.enum(["mse", "cross_entropy"]).optional().describe("Loss function (default: mse). CrossEntropy is numerically more stable for classification."),
  activation: z.enum(["tanh", "relu", "gelu", "leaky_relu"]).optional().describe("Hidden-layer activation (default: tanh). ReLU/GELU are standard for deeper networks and pair with Kaiming init."),
  init: z.enum(["auto", "xavier", "kaiming"]).optional().describe("Weight init strategy (default: auto — Xavier for tanh, Kaiming for ReLU family)."),
  seed: z.number().int().optional().describe("Reproducibility seed for mini-batch shuffle + run context. Respects NEURON_SEED env var when omitted."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const config = await loadConfig()
  const isRegression = task.kind === "regression"

  // Use only train-split samples for fitting
  const allSamples = getSamplesByTask(args.task_id)
  const hasSplit = allSamples.some((s) => s.split === "test")
  const trainSamples = hasSplit ? getSamplesByTaskAndSplit(args.task_id, "train") : allSamples
  const testSamples = hasSplit ? getSamplesByTaskAndSplit(args.task_id, "test") : []

  if (trainSamples.length === 0) throw new Error("No training samples — use load_csv first")

  const labelNames = isRegression
    ? []
    : [...new Set(trainSamples.map((s) => s.label))].sort()

  if (!isRegression && labelNames.length < 2) throw new Error("Need at least 2 classes to train")

  const K = isRegression ? 1 : labelNames.length
  const D = task.featureShape[0] ?? trainSamples[0]?.features.length ?? 1

  const hyperparams: TrainHyperparams = {
    lr: args.lr ?? config?.defaultHyperparams?.lr ?? 0.005,
    epochs: args.epochs ?? config?.defaultHyperparams?.epochs ?? 500,
    ...(args.weight_decay !== undefined ? { weightDecay: args.weight_decay } : {}),
    ...(args.early_stop_patience !== undefined ? { earlyStopPatience: args.early_stop_patience } : {}),
    ...(args.optimizer !== undefined ? { optimizer: args.optimizer } : {}),
    ...(args.batch_size !== undefined ? { batchSize: args.batch_size } : {}),
    ...(args.lr_schedule !== undefined ? { lrSchedule: args.lr_schedule } : {}),
    ...(args.warmup_epochs !== undefined ? { warmupEpochs: args.warmup_epochs } : {}),
    ...(args.min_lr !== undefined ? { minLr: args.min_lr } : {}),
    ...(args.grad_clip !== undefined ? { gradClip: args.grad_clip } : {}),
    ...(args.loss !== undefined ? { loss: args.loss } : {}),
    ...(args.activation !== undefined ? { activation: args.activation } : {}),
    ...(args.init !== undefined ? { initStrategy: args.init } : {}),
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
  }

  const headArchFn = config?.headArchitecture ?? ((k: number, d: number) => [d, Math.max(d, 32), k])
  const headArch = args.head_arch ?? headArchFn(K, D)

  clearLog()
  if (isRegression) {
    log(`Training "${args.task_id}" (regression): ${trainSamples.length} train samples`)
  } else {
    log(`Training "${args.task_id}": ${trainSamples.length} train samples, ${K} classes: [${labelNames.join(", ")}]`)
  }
  if (testSamples.length > 0) log(`Hold-out test set: ${testSamples.length} samples`)
  log(`Head: [${headArch.join(" → ")}], lr=${hyperparams.lr}, epochs=${hyperparams.epochs}`)

  const seed = resolveSeed(args.seed)
  const runContext = buildRunContext({ rng_seed: seed ?? undefined })
  const run = createRun(
    args.task_id,
    { ...hyperparams, headArch, classWeights: args.class_weights },
    { runContext },
  )
  try {
    updateDatasetHash(
      run.id,
      datasetHash(trainSamples.map((s) => ({ id: s.id, label: s.label, features: s.features }))),
    )
  } catch { /* best-effort */ }
  const ac = new AbortController()
  setActiveRun(args.task_id, run.id, ac)

  try {
    const result = await trainHead({
      samples: trainSamples,
      labels: labelNames,
      featurize: async (s) => {
        if (config?.featurize && !(s as { features?: number[] }).features?.length) {
          return config.featurize((s as { raw?: unknown }).raw)
        }
        return (s as { features: number[] }).features
      },
      headArch: () => headArch,
      hyperparams,
      runId: run.id,
      isRegression,
      normalize: task.normalize,
      classWeights: args.class_weights,
      signal: ac.signal,
      onProgress: (p) => {
        log(p.message)
        setRunProgress(run.id, p, [], 0)
        updateRunProgress(run.id, { stage: p.stage, i: p.i, n: p.n, message: p.message, lossHistory: [], epochsDone: 0 })
        if (p.stage === "featurize" && p.i && p.i % 20 === 0) {
          updateRunCheckpoint(run.id, {
            epochsDone: 0,
            mlpName: `neuron_run_${run.id}_mlp`,
            inputsTensorName: `neuron_${run.id}_inputs`,
            targetsTensorName: `neuron_${run.id}_targets`,
          }, [])
        }
      },
    })

    setRunProgress(run.id, { stage: "eval", message: "Evaluating…" }, result.lossHistory, hyperparams.epochs)

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

    if (!isRegression) updateTaskLabels(args.task_id, labelNames)

    if (args.auto_register !== false) {
      registerModel(args.task_id, run.id)
    }

    setTaskTrained(args.task_id, {
      labels: labelNames,
      metrics: result.metrics,
      lossHistory: result.lossHistory,
      sampleCounts: result.sampleCounts,
      runId: run.id,
    })

    clearRunProgress(run.id)
    clearRunProgressDb(run.id)

    const ret: Record<string, unknown> = {
      ok: true,
      run_id: run.id,
      train_samples: trainSamples.length,
      test_samples: testSamples.length,
      loss_history_tail: result.lossHistory.slice(-5),
    }

    if (isRegression) {
      ret.mae = result.regressionMetrics?.mae
      ret.rmse = result.regressionMetrics?.rmse
      ret.r2 = result.regressionMetrics?.r2
      log(`Run ${run.id} completed — MAE=${result.regressionMetrics?.mae?.toFixed(4)}, R²=${result.regressionMetrics?.r2?.toFixed(4)}`)
    } else {
      ret.accuracy = result.metrics.accuracy
      ret.per_class_accuracy = result.metrics.perClassAccuracy
      ret.labels = labelNames
      if (result.normStats) ret.normalized = true
      log(`Run ${run.id} completed — accuracy ${(result.metrics.accuracy * 100).toFixed(1)}%`)
    }

    return ret
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cancelled = msg.includes("cancelled")
    updateRunStatus(run.id, cancelled ? "cancelled" : "failed")
    clearActiveRun(args.task_id)
    clearRunProgress(run.id)
    clearRunProgressDb(run.id)
    log(`Run ${run.id} ${cancelled ? "cancelled" : "failed"}: ${msg}`)
    throw e
  }
}
