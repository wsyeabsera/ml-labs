import type { SignalBundle, RunSignals, DataHealth } from "../../../src/core/auto/signals"

const defaultData: DataHealth = {
  n: 300,
  k: 3,
  d: 10,
  imbalance_ratio: 1.0,
  class_distribution: { a: 100, b: 100, c: 100 },
  warnings: [],
  has_val_split: true,
}

const defaultHistory = {
  prior_best_metric: null,
  prior_best_config: null,
  waves_done: 1,
  budget_used_s: 10,
  budget_s: 180,
}

function base(): SignalBundle {
  return {
    task_id: "test-task",
    task_kind: "classification",
    target: { metric: "accuracy", value: 0.9 },
    data: { ...defaultData },
    history: { ...defaultHistory },
    current_wave: [],
  }
}

/** Run with healthy signals — converged, no overfit, target-achieving. */
export function runHealthy(run_id = 1): RunSignals {
  return {
    run_id,
    config: { lr: 0.005, epochs: 500, head_arch: [10, 32, 3] },
    status: "completed",
    metric: 0.92,
    metric_name: "accuracy",
    accuracy: 0.93,
    val_accuracy: 0.92,
    overfit_gap: 0.01,
    still_improving: false,
    convergence_epoch: 320,
    epochs_requested: 500,
    per_class_accuracy: { a: 0.93, b: 0.92, c: 0.92 },
    per_class_variance: 0.0001,
    severity: "minor",
    r2: null,
    mae: null,
    rmse: null,
  }
}

/** Run that is still improving — loss hasn't plateaued. */
export function runStillImproving(run_id = 2): RunSignals {
  return {
    run_id,
    config: { lr: 0.005, epochs: 300, head_arch: [10, 32, 3] },
    status: "completed",
    metric: 0.72,
    metric_name: "accuracy",
    accuracy: 0.72,
    val_accuracy: 0.72,
    overfit_gap: 0.0,
    still_improving: true,
    convergence_epoch: null,
    epochs_requested: 300,
    per_class_accuracy: { a: 0.75, b: 0.7, c: 0.71 },
    per_class_variance: 0.0004,
    severity: "moderate",
    r2: null,
    mae: null,
    rmse: null,
  }
}

/** Run showing clear overfitting — train >> val. */
export function runOverfit(run_id = 3): RunSignals {
  return {
    run_id,
    config: { lr: 0.01, epochs: 800, head_arch: [10, 128, 64, 3] },
    status: "completed",
    metric: 0.75,
    metric_name: "accuracy",
    accuracy: 0.98,
    val_accuracy: 0.75,
    overfit_gap: 0.23,
    still_improving: false,
    convergence_epoch: 200,
    epochs_requested: 800,
    per_class_accuracy: { a: 0.78, b: 0.75, c: 0.72 },
    per_class_variance: 0.0009,
    severity: "moderate",
    r2: null,
    mae: null,
    rmse: null,
  }
}

/** Run that converged very fast — likely LR too high OR easy problem. */
export function runEarlyConverge(run_id = 4): RunSignals {
  return {
    run_id,
    config: { lr: 0.05, epochs: 500, head_arch: [10, 32, 3] },
    status: "completed",
    metric: 0.85,
    metric_name: "accuracy",
    accuracy: 0.85,
    val_accuracy: 0.85,
    overfit_gap: 0.0,
    still_improving: false,
    convergence_epoch: 50,
    epochs_requested: 500,
    per_class_accuracy: { a: 0.86, b: 0.85, c: 0.84 },
    per_class_variance: 0.0001,
    severity: "minor",
    r2: null,
    mae: null,
    rmse: null,
  }
}

/** Run with critical underfit — low accuracy, no overfit. */
export function runCriticalUnderfit(run_id = 5): RunSignals {
  return {
    run_id,
    config: { lr: 0.001, epochs: 100, head_arch: [10, 8, 3] },
    status: "completed",
    metric: 0.35,
    metric_name: "accuracy",
    accuracy: 0.36,
    val_accuracy: 0.35,
    overfit_gap: 0.01,
    still_improving: false,
    convergence_epoch: 80,
    epochs_requested: 100,
    per_class_accuracy: { a: 0.4, b: 0.35, c: 0.3 },
    per_class_variance: 0.0025,
    severity: "critical",
    r2: null,
    mae: null,
    rmse: null,
  }
}

/** Run with high per-class variance — some classes much weaker than others. */
export function runHighClassVariance(run_id = 6): RunSignals {
  return {
    run_id,
    config: { lr: 0.005, epochs: 500, head_arch: [10, 32, 3] },
    status: "completed",
    metric: 0.7,
    metric_name: "accuracy",
    accuracy: 0.7,
    val_accuracy: 0.7,
    overfit_gap: 0.0,
    still_improving: false,
    convergence_epoch: 300,
    epochs_requested: 500,
    per_class_accuracy: { a: 0.95, b: 0.5, c: 0.3 },
    per_class_variance: 0.073, // > 0.03 threshold
    severity: "moderate",
    r2: null,
    mae: null,
    rmse: null,
  }
}

// ── Bundle builders ────────────────────────────────────────────────────────────

/** Empty bundle — before any wave has run. Triggers the "seed" path in rules. */
export function bundleEmpty(): SignalBundle {
  return { ...base(), history: { ...defaultHistory, waves_done: 0 } }
}

/** Empty bundle with severe imbalance — should add class_weights variant in seed. */
export function bundleEmptyImbalanced(): SignalBundle {
  return {
    ...base(),
    history: { ...defaultHistory, waves_done: 0 },
    data: {
      ...defaultData,
      imbalance_ratio: 5.0,
      class_distribution: { a: 250, b: 40, c: 10 },
      warnings: ["class imbalance ratio 5x"],
    },
  }
}

export function bundleStillImproving(): SignalBundle {
  return { ...base(), current_wave: [runStillImproving()] }
}

export function bundleOverfit(): SignalBundle {
  return { ...base(), current_wave: [runOverfit()] }
}

export function bundleEarlyConverge(): SignalBundle {
  return { ...base(), current_wave: [runEarlyConverge()] }
}

export function bundleCriticalUnderfit(): SignalBundle {
  return { ...base(), current_wave: [runCriticalUnderfit()] }
}

export function bundleHighClassVariance(): SignalBundle {
  return { ...base(), current_wave: [runHighClassVariance()] }
}

export function bundleRegression(metric = 0.65): SignalBundle {
  const r: RunSignals = {
    run_id: 100,
    config: { lr: 0.005, epochs: 500 },
    status: "completed",
    metric,
    metric_name: "r2",
    accuracy: null,
    val_accuracy: null,
    overfit_gap: null,
    still_improving: false,
    convergence_epoch: 250,
    epochs_requested: 500,
    per_class_accuracy: null,
    per_class_variance: null,
    severity: metric < 0.3 ? "critical" : metric < 0.7 ? "moderate" : "minor",
    r2: metric,
    mae: 0.5,
    rmse: 0.7,
  }
  return {
    ...base(),
    task_kind: "regression",
    target: { metric: "r2", value: 0.85 },
    current_wave: [r],
  }
}

/** Bundle with a prior winner loaded — for warm-start tests. */
export function bundleWithPrior(priorMetric = 0.88): SignalBundle {
  return {
    ...base(),
    history: {
      ...defaultHistory,
      waves_done: 0,
      prior_best_metric: priorMetric,
      prior_best_config: { lr: 0.003, epochs: 600, head_arch: [10, 32, 3] },
    },
  }
}
