/**
 * Feature drift detection via PSI (Population Stability Index) + two-sample
 * Kolmogorov-Smirnov test.
 *
 * Run `driftCheck(taskId)` to compare the task's training distribution against
 * a recent window of served predictions (from the `predictions` table).
 *
 * References:
 *  - PSI: standard industry metric; thresholds 0.1 / 0.25 are Evidently / NannyML defaults.
 *  - KS: Smirnov approximation of the p-value, accurate enough for n, m > 30.
 */

export interface DriftFeatureResult {
  feature_idx: number
  feature_name: string
  psi: number
  ks_statistic: number | null
  ks_p_value: number | null
  ref_n: number
  cur_n: number
  verdict: "stable" | "drifting" | "severe" | "insufficient_data"
}

export interface DriftReport {
  ok: boolean
  task_id: string
  ref_window_size: number
  cur_window_size: number
  features: DriftFeatureResult[]
  verdict_summary: { stable: number; drifting: number; severe: number; insufficient_data: number }
  overall_verdict: "stable" | "drifting" | "severe" | "insufficient_data"
  reason?: string
}

// ── PSI ────────────────────────────────────────────────────────────────────────

/**
 * Population Stability Index. Bins by deciles of the reference distribution
 * (robust to outliers; no bin-edge heuristics needed). Returns NaN when the
 * reference is constant.
 */
export function psi(reference: number[], current: number[], nBins = 10): number {
  if (reference.length === 0 || current.length === 0) return NaN
  // Clamp to at least 2 bins.
  const bins = Math.max(2, nBins)
  const sortedRef = [...reference].sort((a, b) => a - b)
  const edges: number[] = []
  for (let i = 1; i < bins; i++) {
    const idx = Math.floor((i / bins) * sortedRef.length)
    edges.push(sortedRef[Math.min(idx, sortedRef.length - 1)]!)
  }
  // Dedupe edges (constant feature → fewer bins).
  const uniqueEdges = [...new Set(edges)]
  if (uniqueEdges.length === 0) return 0 // all values identical

  // Slightly shift every proportion by ε so we never take log(0).
  const eps = 1e-6
  const nRef = reference.length
  const nCur = current.length

  let total = 0
  for (let i = 0; i <= uniqueEdges.length; i++) {
    const lo = i === 0 ? -Infinity : uniqueEdges[i - 1]!
    const hi = i === uniqueEdges.length ? Infinity : uniqueEdges[i]!
    const inBin = (v: number) => (i === 0 ? v <= hi : i === uniqueEdges.length ? v > lo : v > lo && v <= hi)
    const refP = Math.max(eps, reference.filter(inBin).length / nRef)
    const curP = Math.max(eps, current.filter(inBin).length / nCur)
    total += (refP - curP) * Math.log(refP / curP)
  }
  return total
}

// ── Kolmogorov-Smirnov two-sample test ───────────────────────────────────────

/**
 * Two-sample KS: returns {D, p}. D = max |F_ref(x) - F_cur(x)| over merged sample.
 * p uses the Smirnov series approximation — accurate for n, m > 30.
 * Returns null p when either sample is too small.
 */
export function ks(reference: number[], current: number[]): { D: number; p: number | null } {
  const n = reference.length
  const m = current.length
  if (n < 2 || m < 2) return { D: 0, p: null }

  const sRef = [...reference].sort((a, b) => a - b)
  const sCur = [...current].sort((a, b) => a - b)

  // Merge-style walk: compute CDF diff at every unique point.
  let i = 0
  let j = 0
  let D = 0
  while (i < n && j < m) {
    const a = sRef[i]!
    const b = sCur[j]!
    if (a <= b) i++
    else j++
    const fRef = i / n
    const fCur = j / m
    const d = Math.abs(fRef - fCur)
    if (d > D) D = d
  }
  // Tail: one sample has been exhausted; final CDF = 1.
  // Edge cases already handled by the loop.

  if (n < 30 || m < 30) return { D, p: null }

  // Smirnov p-value: Q_KS(λ), λ = (√(nm/(n+m)) + 0.12 + 0.11 / √(...)) * D
  const nEff = Math.sqrt((n * m) / (n + m))
  const lambda = (nEff + 0.12 + 0.11 / nEff) * D
  let q = 0
  // Q_KS(λ) = 2 Σ_{j=1..∞} (-1)^(j-1) exp(-2 j^2 λ^2). Series converges fast.
  for (let k = 1; k <= 100; k++) {
    const term = 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda)
    q += term
    if (Math.abs(term) < 1e-10) break
  }
  const p = Math.max(0, Math.min(1, q))
  return { D, p }
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export function verdictForFeature(
  psiVal: number,
  ksP: number | null,
  refN: number,
  curN: number,
): DriftFeatureResult["verdict"] {
  if (curN < 30 || refN < 30) return "insufficient_data"
  if (!Number.isFinite(psiVal)) return "insufficient_data"
  if (psiVal >= 0.25) return "severe"
  if (ksP !== null && ksP < 0.01) return "severe"
  if (psiVal >= 0.1) return "drifting"
  return "stable"
}

// ── End-to-end check ─────────────────────────────────────────────────────────

/**
 * Compare reference features vs current features, column by column.
 * `reference` and `current` are N×D and M×D arrays.
 */
export function driftReportFromArrays(
  reference: number[][],
  current: number[][],
  featureNames?: string[],
  taskId = "",
): DriftReport {
  const refN = reference.length
  const curN = current.length
  if (refN === 0 || curN === 0) {
    return {
      ok: false,
      task_id: taskId,
      ref_window_size: refN,
      cur_window_size: curN,
      features: [],
      verdict_summary: { stable: 0, drifting: 0, severe: 0, insufficient_data: 0 },
      overall_verdict: "insufficient_data",
      reason: refN === 0 ? "no reference samples" : "no recent predictions",
    }
  }

  const D = Math.max(reference[0]!.length, current[0]!.length)
  const results: DriftFeatureResult[] = []
  const summary = { stable: 0, drifting: 0, severe: 0, insufficient_data: 0 }

  for (let d = 0; d < D; d++) {
    const refCol = reference.map((r) => r[d] ?? 0)
    const curCol = current.map((r) => r[d] ?? 0)
    const psiVal = psi(refCol, curCol)
    const ksResult = ks(refCol, curCol)
    const verdict = verdictForFeature(psiVal, ksResult.p, refN, curN)
    summary[verdict]++
    results.push({
      feature_idx: d,
      feature_name: featureNames?.[d] ?? `feature_${d}`,
      psi: Number.isFinite(psiVal) ? +psiVal.toFixed(6) : psiVal,
      ks_statistic: +ksResult.D.toFixed(6),
      ks_p_value: ksResult.p != null ? +ksResult.p.toFixed(6) : null,
      ref_n: refN,
      cur_n: curN,
      verdict,
    })
  }

  const overall: DriftReport["overall_verdict"] =
    summary.severe > 0 ? "severe" :
    summary.drifting > D * 0.2 ? "drifting" :   // > 20% of features drifting → overall drifting
    summary.drifting > 0 ? "drifting" :          // any drift with < 20% → still show drifting
    summary.insufficient_data === D ? "insufficient_data" :
    "stable"

  return {
    ok: true,
    task_id: taskId,
    ref_window_size: refN,
    cur_window_size: curN,
    features: results,
    verdict_summary: summary,
    overall_verdict: overall,
  }
}
