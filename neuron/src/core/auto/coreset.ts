/**
 * k-center coreset selection (greedy max-min Euclidean distance).
 *
 * Given a set of points and a number k, returns indices of k points that
 * maximize spatial diversity. Used by active learning to avoid redundant
 * sampling when uncertainty alone would pick many near-duplicates.
 *
 * Algorithm:
 *   1. Pick an initial seed (farthest from origin, deterministic).
 *   2. Repeatedly add the point whose minimum distance to the already-chosen
 *      set is maximal.
 *
 * O(N × k × D). Fine for N up to a few thousand samples per call.
 */

function sqDist(a: number[], b: number[]): number {
  let s = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = a[i]! - b[i]!
    s += d * d
  }
  return s
}

/**
 * Returns k indices (into `points`) forming a max-min-distance coreset.
 * If k >= N, returns all indices. Returns at most `points.length` indices.
 */
export function kCenterGreedy(points: number[][], k: number): number[] {
  const n = points.length
  if (n === 0 || k <= 0) return []
  if (k >= n) return points.map((_, i) => i)

  // Seed: the point with the largest L2 norm from the origin.
  // Deterministic and works reasonably across feature scales.
  let seed = 0
  let seedNorm = -Infinity
  for (let i = 0; i < n; i++) {
    const normSq = sqDist(points[i]!, new Array(points[i]!.length).fill(0))
    if (normSq > seedNorm) { seedNorm = normSq; seed = i }
  }

  const selected: number[] = [seed]
  // minDist[i] = distance from point i to the nearest already-selected point.
  const minDist: number[] = new Array(n).fill(Infinity)
  for (let i = 0; i < n; i++) {
    minDist[i] = sqDist(points[i]!, points[seed]!)
  }
  minDist[seed] = 0

  while (selected.length < k) {
    // Pick the point with the maximum distance-to-nearest-selected.
    let bestIdx = -1
    let bestDist = -Infinity
    for (let i = 0; i < n; i++) {
      if (minDist[i]! > bestDist) { bestDist = minDist[i]!; bestIdx = i }
    }
    if (bestIdx === -1 || bestDist === 0) break  // duplicate points only
    selected.push(bestIdx)
    // Update min distances.
    for (let i = 0; i < n; i++) {
      const d = sqDist(points[i]!, points[bestIdx]!)
      if (d < minDist[i]!) minDist[i] = d
    }
  }
  return selected
}

/**
 * Hybrid uncertainty + diversity ranking:
 *   1. Rank by uncertainty (caller-supplied scores, higher = more uncertain).
 *   2. Take the top `uncertainMultiplier * k` candidates.
 *   3. Run k-center coreset on their feature vectors.
 *   4. Return the coreset indices (pointing back into the original array).
 */
export function hybridUncertaintyDiversity(
  features: number[][],
  uncertainty: number[],
  k: number,
  uncertainMultiplier = 3,
): number[] {
  const n = features.length
  if (n !== uncertainty.length) throw new Error(`features length ${n} != uncertainty length ${uncertainty.length}`)
  if (n === 0 || k <= 0) return []
  if (k >= n) return features.map((_, i) => i)

  // Top candidates by uncertainty (stable sort by descending score).
  const indexed = uncertainty.map((u, i) => ({ i, u }))
  indexed.sort((a, b) => b.u - a.u)
  const candCount = Math.min(n, Math.max(k, Math.floor(k * uncertainMultiplier)))
  const candidateIdx = indexed.slice(0, candCount).map((x) => x.i)
  const candidateFeatures = candidateIdx.map((i) => features[i]!)

  const diverseLocal = kCenterGreedy(candidateFeatures, k)
  return diverseLocal.map((local) => candidateIdx[local]!)
}
