/**
 * Training memory budget estimator (Phase 11.7).
 *
 * Static, CPU-only MLP workload estimator. Pure TS, no I/O. Used by load_csv /
 * inspect_data / data_audit to attach a `training_budget` object to responses,
 * and by auto_train's preflight to refuse workloads that will crash the host.
 *
 * Numbers calibrated from v1.7.1 smoke tests (60k × 784 Fashion-MNIST → ~1.25GB
 * RSS peak on Bun/Node). Not exact — a guardrail, not a profiler.
 */

export type BudgetLevel = "safe" | "advisory" | "heavy" | "refuse"

export interface TrainingBudget {
  N: number
  D: number
  K: number
  inputCells: number
  peak_mb: number
  wall_clock_estimate_s: [number, number]
  level: BudgetLevel
  headline: string
  advice: string[]
}

export interface BudgetInput {
  N: number
  D: number
  K: number
  kind: "classification" | "regression"
}

/**
 * Estimate peak JS heap for training this workload. Model:
 *
 *   peak ≈ (JS input array) + (JS target array) + (tensor JSON send buffer)
 *   JS input array ≈ N*D * 20 bytes  (boxed doubles in a V8/Bun number[])
 *   JS target array ≈ N*K * 20 bytes
 *   JSON send buffer ≈ N*D * 12 bytes (stringified decimal floats)
 *
 * Tensor memory on the rs-tensor side is smaller (Float32 at 4 bytes/cell) and
 * lives in a separate process — we count it separately but weight it less.
 */
export function estimateTrainingBudget(args: BudgetInput): TrainingBudget {
  const { N, D, K, kind } = args
  const inputCells = N * D
  const targetCells = kind === "classification" ? N * K : N

  const jsInputBytes = inputCells * 20
  const jsTargetBytes = targetCells * 20
  const jsonSendBytes = inputCells * 12
  const rsTensorBytes = inputCells * 4  // Float32 copy held in rs-tensor

  const totalBytes = jsInputBytes + jsTargetBytes + jsonSendBytes + rsTensorBytes
  const peak_mb = Math.round(totalBytes / 1024 / 1024)

  // Rough wall-clock bands. Based on:
  //   - small datasets (Pima-sized): full training in < 5s
  //   - 10k × ~100: 20-60s
  //   - 60k × 784 (Fashion-MNIST): 3-10 min per wave
  // Not config-aware (doesn't know batch_size / epochs) — a coarse upper bound.
  const inputCellsM = inputCells / 1_000_000
  let lowS: number
  let highS: number
  if (inputCellsM < 0.1) { lowS = 1; highS = 5 }
  else if (inputCellsM < 1) { lowS = 5; highS = 30 }
  else if (inputCellsM < 5) { lowS = 15; highS = 60 }
  else if (inputCellsM < 20) { lowS = 60; highS = 240 }  // 1-4 min
  else if (inputCellsM < 60) { lowS = 180; highS = 900 } // 3-15 min
  else if (inputCellsM < 150) { lowS = 600; highS = 1800 } // 10-30 min
  else { lowS = 1200; highS = 3600 }                    // 20 min - 1 hr

  let level: BudgetLevel
  if (inputCellsM < 5) level = "safe"
  else if (inputCellsM < 20) level = "advisory"
  else if (inputCellsM < 60) level = "heavy"
  else level = "refuse"

  const headline = buildHeadline(level, inputCells, peak_mb, lowS, highS)
  const advice = buildAdvice(level, N, D, K)

  return {
    N, D, K,
    inputCells,
    peak_mb,
    wall_clock_estimate_s: [lowS, highS],
    level,
    headline,
    advice,
  }
}

function buildHeadline(
  level: BudgetLevel,
  inputCells: number,
  peakMb: number,
  lowS: number,
  highS: number,
): string {
  const cells = inputCells.toLocaleString()
  const wallClock = highS < 60
    ? `~${lowS}-${highS}s`
    : highS < 3600
      ? `~${Math.round(lowS / 60)}-${Math.round(highS / 60)}min`
      : `~${Math.round(lowS / 3600)}-${Math.round(highS / 3600)}hr`
  switch (level) {
    case "safe":
      return `Small workload (${cells} input cells, ~${peakMb}MB peak, ${wallClock} per wave)`
    case "advisory":
      return `Moderate workload (${cells} input cells, ~${peakMb}MB peak, ${wallClock} per wave)`
    case "heavy":
      return `Heavy workload (${cells} input cells, ~${peakMb}MB peak, ${wallClock} per wave) — CPU-only MLP will be slow`
    case "refuse":
      return `Very heavy workload (${cells} input cells, ~${peakMb}MB peak, ${wallClock} per wave) — likely to crash on <16GB machines`
  }
}

function buildAdvice(level: BudgetLevel, _N: number, D: number, _K: number): string[] {
  if (level === "safe") return []
  const advice: string[] = []
  advice.push("For iteration speed, subset the dataset: e.g. keep the first 10-20k rows in a new task and load_csv again.")
  if (D > 128) {
    advice.push(`Feature dimension D=${D} is high. Consider a featurize() callback in neuron.config.ts that downsamples (e.g. 28x28 image → 14x14 flattened → D=196 instead of 784, ~4× faster end-to-end).`)
  }
  if (level === "heavy" || level === "refuse") {
    advice.push("Expect minutes per wave on CPU. Run overnight or during a break. Cancel with cancel_auto_train if it gets stuck.")
  }
  if (level === "refuse") {
    advice.push("To override, pass force: true to auto_train. But know that this workload has crashed 8GB machines in testing.")
    advice.push("If you really need this scale, consider splitting into two phases: train on 20% for hyperparam search, then one final run on the full set.")
  }
  return advice
}
