export interface ClassificationMetrics {
  accuracy: number
  perClassAccuracy: Record<string, number>
  confusionMatrix: number[][]
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

export function softmax(values: number[]): number[] {
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}
