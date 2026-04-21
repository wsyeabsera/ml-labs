import { rsTensor } from "./mcp_client"
import {
  computeClassificationMetrics, computeRegressionMetrics,
  computeNormStats, applyNorm,
  type ClassificationMetrics, type RegressionMetrics,
} from "./metrics"
import { log } from "./logger"
import { throwIfAborted } from "../util/abort"
import type { NormStats } from "./db/tasks"

export interface TrainHyperparams {
  lr: number
  epochs: number
  mlpName?: string
  weightDecay?: number
  earlyStopPatience?: number
  optimizer?: "sgd" | "adam" | "adamw"
  batchSize?: number
  lrSchedule?: "constant" | "cosine" | "linear_warmup"
  warmupEpochs?: number
  minLr?: number
  gradClip?: number
  loss?: "mse" | "cross_entropy"
  activation?: "tanh" | "relu" | "gelu" | "leaky_relu"
  initStrategy?: "auto" | "xavier" | "kaiming"
  seed?: number
}

export interface TrainProgress {
  stage: "featurize" | "tensors" | "init" | "train" | "eval" | "weights"
  i?: number
  n?: number
  message: string
}

export interface TrainResult {
  metrics: ClassificationMetrics
  regressionMetrics?: RegressionMetrics
  lossHistory: number[]
  weights: Record<string, { data: number[]; shape: number[] }>
  sampleCounts: Record<string, number>
  normStats?: NormStats
  mlpName: string
}

export async function trainHead<S>(opts: {
  samples: S[]
  labels: string[]
  featurize: (s: S) => Promise<number[]>
  headArch: (K: number, D: number) => number[]
  hyperparams: TrainHyperparams
  runId: number
  isRegression?: boolean
  normalize?: boolean
  classWeights?: "balanced"
  onProgress?: (p: TrainProgress) => void
  signal?: AbortSignal
}): Promise<TrainResult> {
  const {
    samples, labels: labelNames, featurize, headArch, hyperparams, runId,
    isRegression = false, normalize = false, classWeights,
    onProgress, signal,
  } = opts

  const N_orig = samples.length
  const mlpName = hyperparams.mlpName ?? `neuron_run_${runId}_mlp`
  const emit = (p: TrainProgress) => onProgress?.(p)

  // 1. Featurize all samples
  emit({ stage: "featurize", i: 0, n: N_orig, message: `Featurizing 0/${N_orig} samples…` })
  const rawFeatures: number[][] = []
  const rawLabelIndices: number[] = []
  const rawLabelValues: number[] = []  // for regression

  for (let i = 0; i < N_orig; i++) {
    throwIfAborted(signal)
    const f = await featurize(samples[i]!)
    rawFeatures.push(f)
    const label = (samples[i] as { label?: string }).label ?? ""
    if (isRegression) {
      rawLabelValues.push(parseFloat(label) || 0)
      rawLabelIndices.push(0)
    } else {
      rawLabelIndices.push(labelNames.indexOf(label))
    }
    if ((i + 1) % 10 === 0 || i === N_orig - 1) {
      emit({ stage: "featurize", i: i + 1, n: N_orig, message: `Featurizing ${i + 1}/${N_orig} samples…` })
    }
  }

  throwIfAborted(signal)

  // 2. Compute and apply normalization stats from this training set
  let normStats: NormStats | undefined
  let features = rawFeatures
  if (normalize && rawFeatures.length > 0) {
    normStats = computeNormStats(rawFeatures)
    features = rawFeatures.map((f) => applyNorm(f, normStats!.mean, normStats!.std))
    log(`Normalization: computed mean/std over ${rawFeatures.length} training samples`)
  }

  // 3. Apply class weights via oversampling (classification only)
  let trainingFeatures = features
  let trainingLabelIndices = rawLabelIndices
  if (!isRegression && classWeights === "balanced") {
    const countPerClass: Record<number, number> = {}
    for (const idx of rawLabelIndices) countPerClass[idx] = (countPerClass[idx] ?? 0) + 1
    const maxCount = Math.max(...Object.values(countPerClass))
    const balanced: { feat: number[]; idx: number }[] = []
    for (let k = 0; k < labelNames.length; k++) {
      const classSamples = rawLabelIndices
        .map((idx, i) => (idx === k ? { feat: features[i]!, idx: k } : null))
        .filter(Boolean) as { feat: number[]; idx: number }[]
      if (classSamples.length === 0) continue
      // Fill up to maxCount by cycling through class samples
      let pos = 0
      while (balanced.filter((s) => s.idx === k).length < maxCount) {
        balanced.push(classSamples[pos % classSamples.length]!)
        pos++
      }
    }
    // Shuffle balanced set
    for (let i = balanced.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [balanced[i], balanced[j]] = [balanced[j]!, balanced[i]!]
    }
    trainingFeatures = balanced.map((s) => s.feat)
    trainingLabelIndices = balanced.map((s) => s.idx)
    log(`Class weights balanced: oversampled to ${maxCount} per class, total ${balanced.length} samples`)
  }

  const N = trainingFeatures.length
  const D = trainingFeatures[0]?.length ?? 1
  const K = isRegression ? 1 : labelNames.length

  // Regression: min-max normalize target values to [0,1] for stable training
  let targetMin = 0, targetRange = 1
  if (isRegression && rawLabelValues.length > 0) {
    targetMin = Math.min(...rawLabelValues)
    const targetMax = Math.max(...rawLabelValues)
    targetRange = (targetMax - targetMin) || 1
    log(`Regression targets: min=${targetMin.toFixed(3)}, max=${targetMax.toFixed(3)}`)
  }

  const arch = headArch(K, D)

  // 4. Create tensors
  emit({ stage: "tensors", message: `Creating training tensors [${N} × ${D}]…` })
  const inputsName = `neuron_${runId}_inputs`
  const targetsName = `neuron_${runId}_targets`

  const inputs = trainingFeatures.flat()
  const targets: number[] = []

  if (isRegression) {
    for (const v of rawLabelValues) targets.push((v - targetMin) / targetRange)
  } else {
    for (const idx of trainingLabelIndices) {
      for (let k = 0; k < K; k++) targets.push(k === idx ? 1.0 : 0.0)
    }
  }

  throwIfAborted(signal)
  await rsTensor.createTensor(inputsName, inputs, [N, D])
  await rsTensor.createTensor(targetsName, targets, isRegression ? [N, 1] : [N, K])

  // 5. Init MLP
  emit({ stage: "init", message: `Initializing MLP [${arch.join(" → ")}]…` })
  throwIfAborted(signal)
  const { weight_names } = await rsTensor.initMlp(arch, mlpName, {
    ...(hyperparams.activation !== undefined ? { activation: hyperparams.activation } : {}),
    ...(hyperparams.initStrategy !== undefined ? { init: hyperparams.initStrategy } : {}),
  })
  log(`MLP initialized: [${arch.join(" → ")}] — ${weight_names.length} weight tensors`)

  // 6. Train
  emit({ stage: "train", message: `Training for ${hyperparams.epochs} epochs (lr=${hyperparams.lr})…` })
  throwIfAborted(signal)
  const trainResult = await rsTensor.trainMlp(
    mlpName, inputsName, targetsName, hyperparams.lr, hyperparams.epochs,
    {
      ...(hyperparams.weightDecay !== undefined ? { weight_decay: hyperparams.weightDecay } : {}),
      ...(hyperparams.earlyStopPatience !== undefined ? { early_stop_patience: hyperparams.earlyStopPatience } : {}),
      ...(hyperparams.optimizer !== undefined ? { optimizer: hyperparams.optimizer } : {}),
      ...(hyperparams.batchSize !== undefined ? { batch_size: hyperparams.batchSize } : {}),
      ...(hyperparams.lrSchedule !== undefined ? { lr_schedule: hyperparams.lrSchedule } : {}),
      ...(hyperparams.warmupEpochs !== undefined ? { warmup_epochs: hyperparams.warmupEpochs } : {}),
      ...(hyperparams.minLr !== undefined ? { min_lr: hyperparams.minLr } : {}),
      ...(hyperparams.gradClip !== undefined ? { grad_clip: hyperparams.gradClip } : {}),
      ...(hyperparams.loss !== undefined ? { loss: hyperparams.loss } : {}),
      ...(hyperparams.seed !== undefined ? { rng_seed: hyperparams.seed } : {}),
    },
  )
  const lossHistory = trainResult.loss_history_sampled ?? []
  const epochsDone = trainResult.epochs_done ?? hyperparams.epochs
  log(`Training done — final loss: ${lossHistory.at(-1)?.toFixed(4) ?? "?"}${trainResult.stopped_early ? ` (early-stopped at epoch ${epochsDone})` : ""}`)

  // 7. Evaluate
  emit({ stage: "eval", message: "Evaluating…" })
  throwIfAborted(signal)
  const evalResult = await rsTensor.evaluateMlp(mlpName, inputsName, targetsName)

  let metrics: ClassificationMetrics = { accuracy: 0, perClassAccuracy: {}, confusionMatrix: [] }
  let regressionMetrics: RegressionMetrics | undefined

  if (isRegression) {
    const rawPreds = evalResult.predictions?.data?.slice(0, N) ?? []
    const denormPreds = rawPreds.map((v) => v * targetRange + targetMin)
    regressionMetrics = computeRegressionMetrics(denormPreds, rawLabelValues)
    // Express as "accuracy" = 1 - normalized_rmse for sweeps/coordinator compatibility
    const normalizedRmse = regressionMetrics.rmse / (targetRange || 1)
    metrics = {
      accuracy: Math.max(0, 1 - normalizedRmse),
      perClassAccuracy: {},
      confusionMatrix: [],
    }
    log(`Regression: MAE=${regressionMetrics.mae.toFixed(4)}, RMSE=${regressionMetrics.rmse.toFixed(4)}, R²=${regressionMetrics.r2.toFixed(4)}`)
  } else if (evalResult.predictions && evalResult.predictions.data.length === N * K) {
    metrics = computeClassificationMetrics(evalResult.predictions.data, trainingLabelIndices, K, labelNames)
    log(`Accuracy: ${(metrics.accuracy * 100).toFixed(1)}% (top-1 argmax, N=${N})`)
    log(`Per-class: ${labelNames.map((l) => `${l}=${((metrics.perClassAccuracy[l] ?? 0) * 100).toFixed(0)}%`).join(", ")}`)
  }

  // 8. Extract weights
  emit({ stage: "weights", message: "Extracting weights…" })
  throwIfAborted(signal)
  const weights: Record<string, { data: number[]; shape: number[] }> = {}
  for (const name of weight_names) {
    weights[name] = await rsTensor.tensorInspect(name)
  }

  // Embed regression scale in weights metadata for inference
  if (isRegression) {
    weights["__regression_scale__"] = { data: [targetMin, targetRange], shape: [2] }
  }

  const sampleCounts: Record<string, number> = {}
  if (!isRegression) {
    for (const name of labelNames) {
      sampleCounts[name] = rawLabelIndices.filter((i) => i === labelNames.indexOf(name)).length
    }
  } else {
    sampleCounts["__total__"] = N_orig
  }

  return { metrics, regressionMetrics, lossHistory, weights, sampleCounts, normStats, mlpName }
}
