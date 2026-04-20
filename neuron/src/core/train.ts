import { rsTensor } from "./mcp_client"
import { computeClassificationMetrics, type ClassificationMetrics } from "./metrics"
import { log } from "./logger"
import { throwIfAborted } from "../util/abort"

export interface TrainHyperparams {
  lr: number
  epochs: number
  mlpName?: string
}

export interface TrainProgress {
  stage: "featurize" | "tensors" | "init" | "train" | "eval" | "weights"
  i?: number
  n?: number
  message: string
}

export interface TrainResult {
  metrics: ClassificationMetrics
  lossHistory: number[]
  weights: Record<string, { data: number[]; shape: number[] }>
  sampleCounts: Record<string, number>
  mlpName: string
}

export async function trainHead<S>(opts: {
  samples: S[]
  labels: string[]
  featurize: (s: S) => Promise<number[]>
  headArch: (K: number, D: number) => number[]
  hyperparams: TrainHyperparams
  runId: number
  onProgress?: (p: TrainProgress) => void
  signal?: AbortSignal
}): Promise<TrainResult> {
  const { samples, labels: labelNames, featurize, headArch, hyperparams, runId, onProgress, signal } = opts

  const K = labelNames.length
  const N = samples.length
  const mlpName = hyperparams.mlpName ?? `neuron_run_${runId}_mlp`

  const emit = (p: TrainProgress) => onProgress?.(p)

  // 1. Featurize all samples
  emit({ stage: "featurize", i: 0, n: N, message: `Featurizing 0/${N} samples…` })
  const features: number[][] = []
  const labelIndices: number[] = []

  for (let i = 0; i < N; i++) {
    throwIfAborted(signal)
    const f = await featurize(samples[i]!)
    features.push(f)
    labelIndices.push(labelNames.indexOf((samples[i] as { label?: string }).label ?? ""))
    if ((i + 1) % 10 === 0 || i === N - 1) {
      emit({ stage: "featurize", i: i + 1, n: N, message: `Featurizing ${i + 1}/${N} samples…` })
    }
  }

  throwIfAborted(signal)
  const D = features[0]?.length ?? 1
  const arch = headArch(K, D)

  // 2. Create tensors
  emit({ stage: "tensors", message: `Creating training tensors [${N} × ${D}]…` })
  const inputsName = `neuron_${runId}_inputs`
  const targetsName = `neuron_${runId}_targets`

  const inputs = features.flat()
  const targets: number[] = []
  for (const idx of labelIndices) {
    for (let k = 0; k < K; k++) targets.push(k === idx ? 1.0 : 0.0)
  }

  throwIfAborted(signal)
  await rsTensor.createTensor(inputsName, inputs, [N, D])
  await rsTensor.createTensor(targetsName, targets, [N, K])

  // 3. Init MLP
  emit({ stage: "init", message: `Initializing MLP [${arch.join(" → ")}]…` })
  throwIfAborted(signal)
  const { weight_names } = await rsTensor.initMlp(arch, mlpName)
  log(`MLP initialized: [${arch.join(" → ")}] — ${weight_names.length} weight tensors`)

  // 4. Train
  emit({ stage: "train", message: `Training for ${hyperparams.epochs} epochs (lr=${hyperparams.lr})…` })
  throwIfAborted(signal)
  const trainResult = await rsTensor.trainMlp(mlpName, inputsName, targetsName, hyperparams.lr, hyperparams.epochs)
  const lossHistory = trainResult.loss_history_sampled ?? []
  log(`Training done — final loss: ${lossHistory.at(-1)?.toFixed(4) ?? "?"}`)

  // 5. Evaluate + compute real metrics
  emit({ stage: "eval", message: "Evaluating…" })
  throwIfAborted(signal)
  const evalResult = await rsTensor.evaluateMlp(mlpName, inputsName, targetsName)

  let metrics: ClassificationMetrics = { accuracy: 0, perClassAccuracy: {}, confusionMatrix: [] }
  if (evalResult.predictions && evalResult.predictions.data.length === N * K) {
    metrics = computeClassificationMetrics(evalResult.predictions.data, labelIndices, K, labelNames)
    log(`Accuracy: ${(metrics.accuracy * 100).toFixed(1)}% (top-1 argmax, N=${N})`)
    log(`Per-class: ${labelNames.map((l) => `${l}=${((metrics.perClassAccuracy[l] ?? 0) * 100).toFixed(0)}%`).join(", ")}`)
  }

  // 6. Extract weights
  emit({ stage: "weights", message: "Extracting weights…" })
  throwIfAborted(signal)
  const weights: Record<string, { data: number[]; shape: number[] }> = {}
  for (const name of weight_names) {
    weights[name] = await rsTensor.tensorInspect(name)
  }

  const sampleCounts: Record<string, number> = {}
  for (const name of labelNames) {
    sampleCounts[name] = labelIndices.filter((i) => i === labelNames.indexOf(name)).length
  }

  return { metrics, lossHistory, weights, sampleCounts, mlpName }
}
