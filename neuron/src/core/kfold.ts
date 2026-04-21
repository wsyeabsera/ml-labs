import { createRng } from "../util/rng"

export interface KFoldOptions {
  k: number
  seed?: number
  stratify?: boolean              // classification-only; ignored for regression
}

/**
 * Assign each sample to one of K folds. Returns an array of fold indices
 * (0..k-1), one per sample, in the same order as the input.
 *
 * For stratified k-fold, each fold preserves the per-class proportion up to
 * ±1 sample, which is the same guarantee sklearn's StratifiedKFold provides.
 *
 * Deterministic: same seed + same label sequence → same fold assignment.
 */
export function kfoldAssign(
  labels: string[],
  opts: KFoldOptions,
): number[] {
  const { k, seed, stratify = false } = opts
  if (k < 2) throw new Error(`k must be ≥ 2, got ${k}`)
  if (k > labels.length) throw new Error(`k (${k}) must be ≤ number of samples (${labels.length})`)

  const rng = createRng(seed)
  const folds: number[] = new Array(labels.length).fill(-1)

  if (!stratify) {
    // Plain k-fold: shuffle indices, split into k contiguous chunks.
    const indices = rng.shuffle([...Array(labels.length).keys()])
    const foldSize = Math.floor(labels.length / k)
    const remainder = labels.length % k
    let cursor = 0
    for (let f = 0; f < k; f++) {
      const size = foldSize + (f < remainder ? 1 : 0)
      for (let i = 0; i < size; i++) folds[indices[cursor + i]!] = f
      cursor += size
    }
    return folds
  }

  // Stratified k-fold: per class, shuffle and distribute round-robin across folds.
  const byClass: Record<string, number[]> = {}
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    if (!byClass[label]) byClass[label] = []
    byClass[label]!.push(i)
  }
  // Deterministic class iteration order.
  const classNames = Object.keys(byClass).sort()
  for (const name of classNames) {
    const shuffled = rng.shuffle([...byClass[name]!])
    for (let i = 0; i < shuffled.length; i++) {
      folds[shuffled[i]!] = i % k
    }
  }
  return folds
}

export interface FoldSummary {
  fold: number
  trainIds: number[]
  testIds: number[]
}

/**
 * Materializes the fold plan into per-fold {trainIds, testIds}.
 * Useful for drivers that want to iterate K training passes.
 */
export function kfoldSplits(
  sampleIds: number[],
  labels: string[],
  opts: KFoldOptions,
): FoldSummary[] {
  const assignment = kfoldAssign(labels, opts)
  const summaries: FoldSummary[] = []
  for (let f = 0; f < opts.k; f++) {
    const trainIds: number[] = []
    const testIds: number[] = []
    for (let i = 0; i < sampleIds.length; i++) {
      if (assignment[i] === f) testIds.push(sampleIds[i]!)
      else trainIds.push(sampleIds[i]!)
    }
    summaries.push({ fold: f, trainIds, testIds })
  }
  return summaries
}
