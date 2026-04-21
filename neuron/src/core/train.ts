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
  swa?: boolean
  swaStartEpoch?: number
  labelSmoothing?: number
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

  // Phase-stage 1+2+3 combined into a single pass that avoids materializing
  // an [N][D] array of arrays. On 60k × 784 (Fashion-MNIST) the old path held
  // ~1.2GB of nested JS arrays plus another ~1.2GB normalized copy plus a flat
  // 47M-number inputs array. Peak ~3GB → hard crash on 8GB laptops. This pass
  // builds ONE flat inputs array (~380MB for that size) and normalizes in place.

  const balancedMode = !isRegression && classWeights === "balanced"

  // Featurize the first sample to learn D. Small cost vs the refactor payoff.
  emit({ stage: "featurize", i: 0, n: N_orig, message: `Featurizing 0/${N_orig} samples…` })
  const firstFeat = N_orig > 0 ? await featurize(samples[0]!) : []
  const D = firstFeat.length || 1

  // Balanced mode still needs the full [N][D] matrix to resample per class, so
  // it follows the old path. For Fashion-MNIST and other balanced datasets this
  // never triggers and we stay on the memory-efficient path.
  if (balancedMode) {
    const rawFeatures: number[][] = new Array(N_orig)
    rawFeatures[0] = firstFeat
    const rawLabelIndices: number[] = new Array(N_orig)
    rawLabelIndices[0] = labelNames.indexOf((samples[0] as { label?: string }).label ?? "")
    for (let i = 1; i < N_orig; i++) {
      throwIfAborted(signal)
      rawFeatures[i] = await featurize(samples[i]!)
      rawLabelIndices[i] = labelNames.indexOf((samples[i] as { label?: string }).label ?? "")
      if ((i + 1) % 10 === 0 || i === N_orig - 1) {
        emit({ stage: "featurize", i: i + 1, n: N_orig, message: `Featurizing ${i + 1}/${N_orig} samples…` })
      }
    }
    throwIfAborted(signal)

    let normStatsLocal: NormStats | undefined
    let features = rawFeatures
    if (normalize && rawFeatures.length > 0) {
      normStatsLocal = computeNormStats(rawFeatures)
      features = rawFeatures.map((f) => applyNorm(f, normStatsLocal!.mean, normStatsLocal!.std))
      log(`Normalization: computed mean/std over ${rawFeatures.length} training samples`)
    }

    const countPerClass: Record<number, number> = {}
    for (const idx of rawLabelIndices) countPerClass[idx] = (countPerClass[idx] ?? 0) + 1
    const maxCount = Math.max(...Object.values(countPerClass))
    const balanced: { feat: number[]; idx: number }[] = []
    for (let k = 0; k < labelNames.length; k++) {
      const classSamples = rawLabelIndices
        .map((idx, i) => (idx === k ? { feat: features[i]!, idx: k } : null))
        .filter(Boolean) as { feat: number[]; idx: number }[]
      if (classSamples.length === 0) continue
      let pos = 0
      while (balanced.filter((s) => s.idx === k).length < maxCount) {
        balanced.push(classSamples[pos % classSamples.length]!)
        pos++
      }
    }
    for (let i = balanced.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [balanced[i], balanced[j]] = [balanced[j]!, balanced[i]!]
    }
    log(`Class weights balanced: oversampled to ${maxCount} per class, total ${balanced.length} samples`)

    // Delegate to the streaming path using the balanced sequence
    return await trainFromFlat({
      N: balanced.length, D, K: isRegression ? 1 : labelNames.length,
      inputsFlat: balanced.flatMap((s) => s.feat),
      labelIndices: balanced.map((s) => s.idx),
      labelValues: [],
      normStats: normStatsLocal,
      labelNames, isRegression, hyperparams, headArch, runId, mlpName,
      emit, signal,
    })
  }

  // ── Streaming / single-pass path (the new default) ──

  const N = N_orig
  const K = isRegression ? 1 : labelNames.length

  // Pre-allocate the flat inputs array ONCE. For 60k × 784 that's 47M numbers
  // ≈ 380MB. No shadow copies.
  const inputsFlat = new Array<number>(N * D)
  const rawLabelIndices: number[] = new Array<number>(N)
  const rawLabelValues: number[] = isRegression ? new Array<number>(N) : []

  // Stats accumulators for online normalization (no second pass needed).
  const sum: number[] = normalize ? new Array<number>(D).fill(0) : []
  const sumSq: number[] = normalize ? new Array<number>(D).fill(0) : []

  // Fill row 0 from firstFeat (already featurized)
  for (let d = 0; d < D; d++) {
    const v = firstFeat[d] ?? 0
    inputsFlat[d] = v
    if (normalize) { sum[d]! += v; sumSq[d]! += v * v }
  }
  {
    const label0 = (samples[0] as { label?: string }).label ?? ""
    if (isRegression) {
      rawLabelValues[0] = parseFloat(label0) || 0
      rawLabelIndices[0] = 0
    } else {
      rawLabelIndices[0] = labelNames.indexOf(label0)
    }
  }

  // Stream the rest — one sample at a time, immediately write into the flat
  // array, drop the intermediate feature array so GC can reclaim.
  for (let i = 1; i < N; i++) {
    throwIfAborted(signal)
    const f = await featurize(samples[i]!)
    const base = i * D
    for (let d = 0; d < D; d++) {
      const v = f[d] ?? 0
      inputsFlat[base + d] = v
      if (normalize) { sum[d]! += v; sumSq[d]! += v * v }
    }
    const label = (samples[i] as { label?: string }).label ?? ""
    if (isRegression) {
      rawLabelValues[i] = parseFloat(label) || 0
      rawLabelIndices[i] = 0
    } else {
      rawLabelIndices[i] = labelNames.indexOf(label)
    }
    if ((i + 1) % 100 === 0 || i === N - 1) {
      emit({ stage: "featurize", i: i + 1, n: N, message: `Featurizing ${i + 1}/${N} samples…` })
    }
  }
  throwIfAborted(signal)

  // Compute normalization stats and apply in-place.
  let normStats: NormStats | undefined
  if (normalize && N > 0) {
    const mean = sum.map((s) => s / N)
    const std = sumSq.map((sq, d) => Math.sqrt(sq / N - mean[d]! ** 2) || 1)
    normStats = { mean, std }
    for (let i = 0; i < N; i++) {
      const base = i * D
      for (let d = 0; d < D; d++) {
        inputsFlat[base + d] = (inputsFlat[base + d]! - mean[d]!) / std[d]!
      }
    }
    log(`Normalization: computed mean/std over ${N} training samples`)
  }

  return await trainFromFlat({
    N, D, K,
    inputsFlat,
    labelIndices: rawLabelIndices,
    labelValues: rawLabelValues,
    normStats,
    labelNames, isRegression, hyperparams, headArch, runId, mlpName,
    emit, signal,
  })
}

// Extracted training body. Takes a pre-flattened input array instead of
// [N][D] — shared by the balanced path and the streaming default path.
interface TrainFromFlatArgs {
  N: number
  D: number
  K: number
  inputsFlat: number[]
  labelIndices: number[]
  labelValues: number[]
  normStats: NormStats | undefined
  labelNames: string[]
  isRegression: boolean
  hyperparams: TrainHyperparams
  headArch: (K: number, D: number) => number[]
  runId: number
  mlpName: string
  emit: (p: TrainProgress) => void
  signal?: AbortSignal
}

async function trainFromFlat(args: TrainFromFlatArgs): Promise<TrainResult> {
  const { N, D, K, inputsFlat, labelIndices, labelValues, normStats, labelNames, isRegression, hyperparams, headArch, runId, mlpName, emit, signal } = args

  // Regression: min-max normalize target values to [0,1] for stable training
  let targetMin = 0, targetRange = 1
  if (isRegression && labelValues.length > 0) {
    targetMin = Math.min(...labelValues)
    const targetMax = Math.max(...labelValues)
    targetRange = (targetMax - targetMin) || 1
    log(`Regression targets: min=${targetMin.toFixed(3)}, max=${targetMax.toFixed(3)}`)
  }

  const arch = headArch(K, D)

  // 4. Create tensors
  emit({ stage: "tensors", message: `Creating training tensors [${N} × ${D}]…` })
  const inputsName = `neuron_${runId}_inputs`
  const targetsName = `neuron_${runId}_targets`

  // inputsFlat is already a pre-flattened N*D array from the caller.
  const inputs = inputsFlat
  const targets: number[] = []

  if (isRegression) {
    for (const v of labelValues) targets.push((v - targetMin) / targetRange)
  } else {
    for (const idx of labelIndices) {
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
      ...(hyperparams.swa !== undefined ? { swa: hyperparams.swa } : {}),
      ...(hyperparams.swaStartEpoch !== undefined ? { swa_start_epoch: hyperparams.swaStartEpoch } : {}),
      ...(hyperparams.labelSmoothing !== undefined ? { label_smoothing: hyperparams.labelSmoothing } : {}),
      // Stream per-epoch progress from rs-tensor through to the caller's
      // onProgress (already throttled + routed to events by trainBg).
      onProgress: (p) => emit({ stage: "train", i: p.progress, n: p.total, message: p.message ?? "" }),
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
    regressionMetrics = computeRegressionMetrics(denormPreds, labelValues)
    // Express as "accuracy" = 1 - normalized_rmse for sweeps/coordinator compatibility
    const normalizedRmse = regressionMetrics.rmse / (targetRange || 1)
    metrics = {
      accuracy: Math.max(0, 1 - normalizedRmse),
      perClassAccuracy: {},
      confusionMatrix: [],
    }
    log(`Regression: MAE=${regressionMetrics.mae.toFixed(4)}, RMSE=${regressionMetrics.rmse.toFixed(4)}, R²=${regressionMetrics.r2.toFixed(4)}`)
  } else if (evalResult.predictions && evalResult.predictions.data.length === N * K) {
    metrics = computeClassificationMetrics(evalResult.predictions.data, labelIndices, K, labelNames)
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
      const targetIdx = labelNames.indexOf(name)
      sampleCounts[name] = labelIndices.filter((idx: number) => idx === targetIdx).length
    }
  } else {
    sampleCounts["__total__"] = N
  }

  return { metrics, regressionMetrics, lossHistory, weights, sampleCounts, normStats, mlpName }
}
