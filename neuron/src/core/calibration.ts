/**
 * Post-hoc confidence calibration via temperature scaling (Guo et al., 2017).
 *
 * Given a set of held-out logits + labels, find T > 0 minimizing NLL:
 *     NLL(T) = -mean( log(softmax(logits / T)[y_i]) )
 *
 * T < 1 sharpens confidence; T > 1 tempers it (overconfident models need T > 1).
 * We use a log-space grid search (1-parameter, robust, deterministic).
 */

/** Stable log-softmax for a single logit row. */
function logSoftmax(row: number[]): number[] {
  let max = -Infinity
  for (const v of row) if (v > max) max = v
  let sumExp = 0
  for (const v of row) sumExp += Math.exp(v - max)
  const logSum = Math.log(sumExp) + max
  return row.map((v) => v - logSum)
}

/** NLL on held-out (logits / T, int label). */
export function nllAt(logits: number[][], labels: number[], T: number): number {
  if (T <= 0) return Infinity
  let total = 0
  for (let i = 0; i < logits.length; i++) {
    const scaled = logits[i]!.map((v) => v / T)
    const lse = logSoftmax(scaled)
    total -= lse[labels[i]!]!
  }
  return total / logits.length
}

/** Expected Calibration Error. Uses n_bins equal-width confidence bins. */
export function ece(
  probs: number[][],
  labels: number[],
  nBins = 15,
): number {
  const bins = Array.from({ length: nBins }, () => ({ conf: 0, acc: 0, n: 0 }))
  for (let i = 0; i < probs.length; i++) {
    const row = probs[i]!
    let best = 0
    let bestIdx = 0
    for (let k = 0; k < row.length; k++) {
      if (row[k]! > best) { best = row[k]!; bestIdx = k }
    }
    const binIdx = Math.min(nBins - 1, Math.floor(best * nBins))
    const bin = bins[binIdx]!
    bin.conf += best
    bin.acc += bestIdx === labels[i] ? 1 : 0
    bin.n += 1
  }
  let totalN = 0
  let ece = 0
  for (const b of bins) totalN += b.n
  if (totalN === 0) return 0
  for (const b of bins) {
    if (b.n === 0) continue
    const avgConf = b.conf / b.n
    const avgAcc = b.acc / b.n
    ece += (b.n / totalN) * Math.abs(avgConf - avgAcc)
  }
  return ece
}

/** Fit temperature T via log-space grid search. Returns the T minimizing NLL. */
export function fitTemperature(
  logits: number[][],
  labels: number[],
  opts?: { logRange?: [number, number]; nPoints?: number },
): { T: number; nll_before: number; nll_after: number; ece_before: number; ece_after: number } {
  const [logMin, logMax] = opts?.logRange ?? [-1.5, 1.5] // T in [~0.22, ~31.6]
  const nPoints = opts?.nPoints ?? 120

  let bestT = 1.0
  let bestNll = nllAt(logits, labels, 1.0)
  const nllBefore = bestNll

  for (let i = 0; i < nPoints; i++) {
    const logT = logMin + (logMax - logMin) * (i / (nPoints - 1))
    const T = Math.exp(logT)
    const nll = nllAt(logits, labels, T)
    if (nll < bestNll) {
      bestNll = nll
      bestT = T
    }
  }

  // ECE uses softmax probabilities — compute before + after for reporting.
  const toProbs = (T: number) => logits.map((row) => {
    const scaled = row.map((v) => v / T)
    let max = -Infinity
    for (const v of scaled) if (v > max) max = v
    const exps = scaled.map((v) => Math.exp(v - max))
    const sum = exps.reduce((a, b) => a + b, 0)
    return exps.map((e) => e / sum)
  })

  return {
    T: bestT,
    nll_before: nllBefore,
    nll_after: bestNll,
    ece_before: ece(toProbs(1.0), labels),
    ece_after: ece(toProbs(bestT), labels),
  }
}
