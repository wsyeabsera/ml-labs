export interface ClassificationMetrics {
  accuracy: number
  perClassAccuracy: Record<string, number>
  confusionMatrix: number[][]
}

export interface RegressionMetrics {
  mae: number
  rmse: number
  r2: number
}

export function argmax(row: number[]): number {
  let best = 0
  for (let i = 1; i < row.length; i++) if ((row[i] ?? -Infinity) > (row[best] ?? -Infinity)) best = i
  return best
}

export function computeClassificationMetrics(
  predsFlat: number[],
  labelIndices: number[],
  K: number,
  labelNames: string[],
): ClassificationMetrics {
  const N = labelIndices.length
  const confusionMatrix: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0))
  const perClassTotal = new Array<number>(K).fill(0)
  const perClassCorrect = new Array<number>(K).fill(0)
  let totalCorrect = 0

  for (let i = 0; i < N; i++) {
    const row = predsFlat.slice(i * K, (i + 1) * K)
    const predIdx = argmax(row)
    const trueIdx = labelIndices[i]!
    confusionMatrix[trueIdx]![predIdx] = (confusionMatrix[trueIdx]![predIdx] ?? 0) + 1
    perClassTotal[trueIdx] = (perClassTotal[trueIdx] ?? 0) + 1
    if (predIdx === trueIdx) {
      perClassCorrect[trueIdx] = (perClassCorrect[trueIdx] ?? 0) + 1
      totalCorrect++
    }
  }

  const perClassAccuracy: Record<string, number> = {}
  for (let k = 0; k < K; k++) {
    const total = perClassTotal[k] ?? 0
    perClassAccuracy[labelNames[k]!] = total > 0 ? (perClassCorrect[k] ?? 0) / total : 0
  }

  return {
    accuracy: N > 0 ? totalCorrect / N : 0,
    perClassAccuracy,
    confusionMatrix,
  }
}

export function computeRegressionMetrics(
  predictions: number[],
  targets: number[],
): RegressionMetrics {
  const N = predictions.length
  if (N === 0) return { mae: 0, rmse: 0, r2: 0 }

  let sumAE = 0, sumSE = 0
  for (let i = 0; i < N; i++) {
    const diff = (predictions[i] ?? 0) - (targets[i] ?? 0)
    sumAE += Math.abs(diff)
    sumSE += diff * diff
  }

  const mean = targets.reduce((a, b) => a + b, 0) / N
  const ssTot = targets.reduce((s, t) => s + (t - mean) ** 2, 0)
  const r2 = ssTot > 0 ? 1 - sumSE / ssTot : 0

  return {
    mae: sumAE / N,
    rmse: Math.sqrt(sumSE / N),
    r2,
  }
}

export function softmax(values: number[]): number[] {
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

export function computeNormStats(featureMatrix: number[][]): { mean: number[]; std: number[] } {
  const N = featureMatrix.length
  const D = featureMatrix[0]?.length ?? 0
  const mean = new Array<number>(D).fill(0)
  const std = new Array<number>(D).fill(1)
  if (N === 0 || D === 0) return { mean, std }

  for (const row of featureMatrix) for (let d = 0; d < D; d++) mean[d]! += (row[d] ?? 0) / N
  for (const row of featureMatrix) for (let d = 0; d < D; d++) std[d]! += ((row[d] ?? 0) - mean[d]!) ** 2
  for (let d = 0; d < D; d++) std[d] = Math.sqrt((std[d]! / N)) || 1  // fallback 1 avoids div-by-zero

  return { mean, std }
}

export function applyNorm(features: number[], mean: number[], std: number[]): number[] {
  return features.map((v, i) => (v - (mean[i] ?? 0)) / (std[i] ?? 1))
}
