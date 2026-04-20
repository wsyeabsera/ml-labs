import { getTask } from "../db/tasks"
import { getRun, type Run } from "../db/runs"
import { sampleCounts, getSamplesByTaskAndSplit } from "../db/samples"

export interface DataHealth {
  n: number
  k: number
  d: number
  imbalance_ratio: number | null
  class_distribution: Record<string, number> | null
  warnings: string[]
  has_val_split: boolean
}

export interface RunSignals {
  run_id: number
  config: { lr?: number; epochs?: number; head_arch?: number[]; class_weights?: "balanced" }
  status: Run["status"]
  metric: number | null
  metric_name: "accuracy" | "r2"
  accuracy: number | null
  val_accuracy: number | null
  overfit_gap: number | null
  still_improving: boolean
  convergence_epoch: number | null
  epochs_requested: number | null
  per_class_accuracy: Record<string, number> | null
  per_class_variance: number | null
  severity: "critical" | "moderate" | "minor"
  r2: number | null
  mae: number | null
  rmse: number | null
}

export interface SignalBundle {
  task_id: string
  task_kind: "classification" | "regression"
  target: { metric: "accuracy" | "r2"; value: number }
  data: DataHealth
  history: {
    prior_best_metric: number | null
    prior_best_config: RunSignals["config"] | null
    waves_done: number
    budget_used_s: number
    budget_s: number
  }
  current_wave: RunSignals[]
}

export function computeDataHealth(task_id: string): DataHealth {
  const task = getTask(task_id)
  if (!task) throw new Error(`Task "${task_id}" not found`)
  const counts = sampleCounts(task_id)
  const n = Object.values(counts).reduce((a, b) => a + b, 0)
  const k = Object.keys(counts).length
  const d = task.featureShape[0] ?? 1

  let imbalance_ratio: number | null = null
  const warnings: string[] = []
  const vals = Object.values(counts)
  if (task.kind !== "regression" && vals.length > 1) {
    const min = Math.min(...vals)
    if (min > 0) imbalance_ratio = +(Math.max(...vals) / min).toFixed(2)
    if (imbalance_ratio !== null && imbalance_ratio > 3) {
      warnings.push(`class imbalance ratio ${imbalance_ratio}x`)
    }
  }
  if (n < 30) warnings.push(`low sample count (${n})`)
  if (task.kind !== "regression" && k < 2) warnings.push(`need at least 2 classes`)

  const has_val_split = getSamplesByTaskAndSplit(task_id, "test").length > 0

  return {
    n, k, d,
    imbalance_ratio,
    class_distribution: task.kind === "regression" ? null : counts,
    warnings,
    has_val_split,
  }
}

export function severityForMetric(metric: number | null, isRegression: boolean): "critical" | "moderate" | "minor" {
  if (metric == null) return "critical"
  if (isRegression) {
    if (metric < 0.3) return "critical"
    if (metric < 0.7) return "moderate"
    return "minor"
  }
  if (metric < 0.5) return "critical"
  if (metric < 0.8) return "moderate"
  return "minor"
}

function computeConvergenceEpoch(loss: number[], epochsRequested: number | null): number | null {
  const N = loss.length
  if (N <= 10) return null
  for (let i = N - 1; i > 0; i--) {
    const prev = loss[i - 1] ?? 0
    const cur = loss[i] ?? 0
    const improvement = (prev - cur) / (prev || 1)
    if (improvement > 0.001) {
      const total = epochsRequested ?? N
      return Math.round((i / N) * total)
    }
  }
  return null
}

function computeStillImproving(loss: number[]): boolean {
  const N = loss.length
  if (N <= 20) return false
  const tail = loss.slice(-Math.ceil(N * 0.1))
  const prior = loss.slice(-Math.ceil(N * 0.2), -Math.ceil(N * 0.1))
  const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length
  const priorMean = prior.reduce((a, b) => a + b, 0) / prior.length
  return priorMean - tailMean > 0.001 * priorMean
}

function computePerClassVariance(pc: Record<string, number> | null): number | null {
  if (!pc) return null
  const vals = Object.values(pc)
  if (vals.length < 2) return 0
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
  return +variance.toFixed(4)
}

export function collectRunSignals(run_id: number, isRegression: boolean): RunSignals | null {
  const run = getRun(run_id)
  if (!run) return null

  const loss = run.lossHistory ?? []
  const epochsRequested = (run.hyperparams as { epochs?: number }).epochs ?? null
  const config = {
    lr: (run.hyperparams as { lr?: number }).lr,
    epochs: (run.hyperparams as { epochs?: number }).epochs,
    head_arch: (run.hyperparams as { headArch?: number[] }).headArch,
    class_weights: (run.hyperparams as { classWeights?: "balanced" }).classWeights,
  }

  const metric = isRegression ? run.r2 : (run.valAccuracy ?? run.accuracy)
  const overfit_gap = run.accuracy !== null && run.valAccuracy !== null
    ? +(run.accuracy - run.valAccuracy).toFixed(4)
    : null

  return {
    run_id,
    config,
    status: run.status,
    metric,
    metric_name: isRegression ? "r2" : "accuracy",
    accuracy: run.accuracy,
    val_accuracy: run.valAccuracy,
    overfit_gap,
    still_improving: computeStillImproving(loss),
    convergence_epoch: computeConvergenceEpoch(loss, epochsRequested),
    epochs_requested: epochsRequested,
    per_class_accuracy: run.perClassAccuracy,
    per_class_variance: computePerClassVariance(run.perClassAccuracy),
    severity: severityForMetric(metric, isRegression),
    r2: run.r2,
    mae: run.mae,
    rmse: run.rmse,
  }
}

export function collectSignals(opts: {
  task_id: string
  task_kind: "classification" | "regression"
  target_value: number
  current_wave_run_ids: number[]
  waves_done: number
  budget_s: number
  budget_used_s: number
  prior_best_metric?: number | null
  prior_best_config?: RunSignals["config"] | null
}): SignalBundle {
  const data = computeDataHealth(opts.task_id)
  const isRegression = opts.task_kind === "regression"
  const current_wave: RunSignals[] = []
  for (const id of opts.current_wave_run_ids) {
    const s = collectRunSignals(id, isRegression)
    if (s) current_wave.push(s)
  }
  return {
    task_id: opts.task_id,
    task_kind: opts.task_kind,
    target: { metric: isRegression ? "r2" : "accuracy", value: opts.target_value },
    data,
    history: {
      prior_best_metric: opts.prior_best_metric ?? null,
      prior_best_config: opts.prior_best_config ?? null,
      waves_done: opts.waves_done,
      budget_used_s: opts.budget_used_s,
      budget_s: opts.budget_s,
    },
    current_wave,
  }
}
