import type { SweepConfig } from "../sweep/configs"
import type { RunSignals, SignalBundle } from "./signals"

export interface RefinementPlan {
  configs: SweepConfig[]
  rationale: string
  rules_fired: string[]
}

const clampLr = (lr: number) => Math.max(0.001, Math.min(0.1, lr))

function shallowerArch(arch: number[] | undefined, k: number, d: number): number[] {
  const a = arch ?? [d, Math.max(d, 32), k]
  // head_arch is [D, ...hidden, K]. Drop middle hidden layer if ≥ 2, else halve first hidden.
  if (a.length >= 5) {
    // [D, h1, h2, ..., K]: drop the middle hidden
    const mid = Math.floor((a.length - 1) / 2)
    return [...a.slice(0, mid), ...a.slice(mid + 1)]
  }
  if (a.length >= 3) {
    // [D, h, K]: halve the hidden
    return [a[0]!, Math.max(4, Math.round(a[1]! / 2)), a[a.length - 1]!]
  }
  return a
}

function widerArch(arch: number[] | undefined, k: number, d: number): number[] {
  const a = arch ?? [d, Math.max(d, 32), k]
  // Double each hidden layer.
  if (a.length < 3) return a
  const result = [a[0]!]
  for (let i = 1; i < a.length - 1; i++) result.push(Math.min(512, a[i]! * 2))
  result.push(a[a.length - 1]!)
  return result
}

/**
 * Given a SignalBundle (post-wave), produce the next wave's configs deterministically.
 * Used as the planner fallback and as the bootstrap for wave 1 when there is no prior wave.
 */
export function refineFromSignals(bundle: SignalBundle): RefinementPlan {
  const wave = bundle.current_wave
  const isRegression = bundle.task_kind === "regression"

  // No prior wave → seed from data health defaults
  if (wave.length === 0) {
    const d = bundle.data.d
    const k = bundle.data.k
    const n = bundle.data.n
    const lr = n < 50 ? 0.05 : n < 200 ? 0.01 : 0.005
    const epochs = n < 50 ? 1000 : n < 200 ? 600 : 400
    const arch = [d, Math.max(d, 32), k]
    const configs: SweepConfig[] = [
      { lr: clampLr(lr * 0.5), epochs, head_arch: arch },
      { lr: clampLr(lr),       epochs, head_arch: arch },
      { lr: clampLr(lr * 2),   epochs, head_arch: arch },
    ]
    if (!isRegression && bundle.data.imbalance_ratio != null && bundle.data.imbalance_ratio > 3) {
      configs.push({ lr: clampLr(lr), epochs, head_arch: arch, class_weights: "balanced" })
    }
    return {
      configs,
      rationale: `seed wave: lr × [0.5, 1, 2] around heuristic ${lr} for N=${n}${configs.length > 3 ? ", + class_weights=balanced" : ""}`,
      rules_fired: ["seed"],
    }
  }

  // Pick the best run in the wave
  const sorted = [...wave].sort((a, b) => (b.metric ?? -Infinity) - (a.metric ?? -Infinity))
  const best: RunSignals = sorted[0]!
  const base = best.config
  const baseLr = base.lr ?? 0.005
  const baseEpochs = base.epochs ?? 500
  const baseArch = base.head_arch
  const k = bundle.data.k
  const d = bundle.data.d

  const configs: SweepConfig[] = []
  const fired: string[] = []

  // Rule A: still improving → 2x epochs + early stopping as safety net
  if (best.still_improving) {
    configs.push({
      lr: baseLr,
      epochs: baseEpochs * 2,
      head_arch: baseArch,
      early_stop_patience: Math.max(20, Math.round(baseEpochs * 0.1)),
    })
    fired.push("A:still_improving→2x epochs + early_stop")
  }

  // Rule B: overfit → fewer epochs + shallower, AND try weight_decay as proper regularizer
  if (best.overfit_gap !== null && best.overfit_gap > 0.15) {
    configs.push({
      lr: baseLr,
      epochs: Math.max(100, Math.round(baseEpochs * 0.7)),
      head_arch: shallowerArch(baseArch, k, d),
    })
    fired.push("B1:overfit→shorter + shallower")
    // Only add weight_decay variant if not already tried
    if (base.weight_decay === undefined || base.weight_decay === 0) {
      configs.push({
        lr: baseLr,
        epochs: baseEpochs,
        head_arch: baseArch,
        weight_decay: 0.01,
      })
      fired.push("B2:overfit→weight_decay=0.01")
    }
  }

  // Rule C: converged too fast → finer LR
  if (best.convergence_epoch !== null && best.epochs_requested !== null &&
      best.convergence_epoch < best.epochs_requested * 0.3) {
    configs.push({ lr: clampLr(baseLr * 0.3), epochs: baseEpochs, head_arch: baseArch })
    fired.push("C:early_converge→finer lr")
  }

  // Rule D: critical severity AND not overfitting → wider arch
  if (best.severity === "critical" && (best.overfit_gap === null || best.overfit_gap <= 0.1)) {
    configs.push({ lr: baseLr, epochs: baseEpochs, head_arch: widerArch(baseArch, k, d) })
    fired.push("D:underfit→wider arch")
  }

  // Rule E: per-class variance high + class_weights not tried
  if (!isRegression && best.per_class_variance !== null && best.per_class_variance > 0.03 &&
      base.class_weights !== "balanced") {
    configs.push({ lr: baseLr, epochs: baseEpochs, head_arch: baseArch, class_weights: "balanced" })
    fired.push("E:per_class_var→class_weights=balanced")
  }

  // Fallback: no rule fired → ±25% lr
  if (configs.length === 0) {
    configs.push({ lr: clampLr(baseLr * 0.75), epochs: baseEpochs, head_arch: baseArch })
    configs.push({ lr: clampLr(baseLr * 1.25), epochs: baseEpochs, head_arch: baseArch })
    fired.push("fallback:±25% lr")
  }

  // Cap at 4 configs per wave
  const capped = configs.slice(0, 4)
  return {
    configs: capped,
    rationale: `refined from wave ${bundle.history.waves_done} winner (${best.metric_name}=${best.metric?.toFixed(3)}): ${fired.join("; ")}`,
    rules_fired: fired,
  }
}

/**
 * Stop condition: should we run another wave?
 */
export function shouldContinue(bundle: SignalBundle, max_waves: number): { cont: boolean; reason: string } {
  if (bundle.history.waves_done >= max_waves) return { cont: false, reason: `max waves (${max_waves}) reached` }
  if (bundle.history.budget_used_s >= bundle.history.budget_s) return { cont: false, reason: "budget exhausted" }
  const wave = bundle.current_wave
  if (wave.length === 0) return { cont: true, reason: "no waves run yet" }
  const best = Math.max(...wave.map((r) => r.metric ?? -Infinity))
  if (best >= bundle.target.value) return { cont: false, reason: `target ${bundle.target.metric}=${bundle.target.value} reached` }
  return { cont: true, reason: `best ${bundle.target.metric}=${best.toFixed(3)} < target ${bundle.target.value}` }
}
