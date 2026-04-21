import type { SweepConfig } from "../sweep/configs"
import type { RunSignals, SignalBundle } from "./signals"

/**
 * Structured explanation of a rule that fired. Emitted alongside the
 * legacy `rules_fired: string[]` (which is kept for stats/fingerprint
 * back-compat). Renders as a "why" card on the auto-run timeline UI.
 */
export interface RuleExplanation {
  /** Stable machine id used for rule-effectiveness tracking. */
  name: string
  /** Short human-readable headline. */
  title: string
  /** 1-2 sentence plain-language explanation of why this rule fires. */
  why: string
  /** Concrete numeric facts that triggered this rule on THIS wave. */
  evidence: string[]
}

export interface RefinementPlan {
  configs: SweepConfig[]
  rationale: string
  rules_fired: string[]
  rule_explanations: RuleExplanation[]
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

  // No prior wave → seed wave. Mix of legacy SGD+tanh and modern AdamW+ReLU+CE
  // so the controller has a fair comparison between proven-safe and
  // best-practice-2024+ starting points. Classification gets CE + cosine; regression gets AdamW + MSE.
  if (wave.length === 0) {
    const d = bundle.data.d
    const k = bundle.data.k
    const n = bundle.data.n
    const lr = n < 50 ? 0.05 : n < 200 ? 0.01 : 0.005
    const epochs = n < 50 ? 1000 : n < 200 ? 600 : 400
    const arch = [d, Math.max(d, 32), k]
    const configs: SweepConfig[] = [
      // Legacy SGD+tanh baseline at half, 1×, and 2× the heuristic LR
      { lr: clampLr(lr * 0.5), epochs, head_arch: arch },
      { lr: clampLr(lr),       epochs, head_arch: arch },
    ]
    // Modern variant: AdamW + ReLU + cosine + CE (classification) / MSE (regression).
    // Mini-batch kicks in once N ≥ 50 — below that, full-batch is simpler and faster.
    // Calibration goodies: label_smoothing on CE (classification), SWA on long runs.
    const modernBatch = n >= 50 ? Math.max(8, Math.min(64, Math.floor(n / 8))) : undefined
    const modern: SweepConfig = {
      lr: clampLr(0.01),
      epochs,
      head_arch: arch,
      optimizer: "adamw",
      activation: "relu",
      lr_schedule: "cosine",
      weight_decay: 0.01,
      ...(modernBatch !== undefined ? { batch_size: modernBatch } : {}),
      ...(!isRegression ? { loss: "cross_entropy", label_smoothing: 0.1 } : {}),
      ...(epochs >= 200 ? { swa: true } : {}),
    }
    configs.push(modern)

    const rules_fired = ["seed", "seed_modern"]
    const rule_explanations: RuleExplanation[] = [
      {
        name: "seed",
        title: "Baseline (SGD + tanh)",
        why: "For a fair starting point we pitch two proven-safe SGD+tanh variants at half and 1× the heuristic learning rate. If newer tricks don't help, these tell us.",
        evidence: [
          `dataset size N=${n} → seed lr=${lr}, epochs=${epochs}`,
          `feature dim D=${d}, output dim K=${k}`,
        ],
      },
      {
        name: "seed_modern",
        title: `Modern variant (AdamW + ReLU + cosine + ${isRegression ? "MSE" : "CE"})`,
        why: `AdamW is a stronger default than SGD, ReLU doesn't saturate, cosine LR decay tapers off smoothly, and ${isRegression ? "MSE is the right loss for regression" : "cross-entropy is the right loss for classification"}. Usually wins on 2024-era defaults.${modernBatch ? " Mini-batching (batch_size=" + modernBatch + ") keeps memory bounded on larger datasets." : ""}${epochs >= 200 ? " SWA averages weights near the end for a small stability win." : ""}`,
        evidence: [
          `N=${n}${modernBatch ? `, so batch_size=${modernBatch}` : " (too small to batch → full-batch)"}`,
          `epochs=${epochs}${epochs >= 200 ? " ≥ 200 → SWA enabled" : ""}`,
          ...(!isRegression ? ["label_smoothing=0.1 softens hard one-hot targets (Phase 4)"] : []),
        ],
      },
    ]

    if (!isRegression && bundle.data.imbalance_ratio != null && bundle.data.imbalance_ratio > 3) {
      configs.push({ lr: clampLr(lr), epochs, head_arch: arch, class_weights: "balanced" })
      rules_fired.push("seed_balanced")
      rule_explanations.push({
        name: "seed_balanced",
        title: "Class-weighted variant",
        why: "Your classes are imbalanced enough that a plain loss will happily ignore the minority class. class_weights=\"balanced\" reweights the loss so every class carries equal influence.",
        evidence: [
          `imbalance_ratio = ${bundle.data.imbalance_ratio.toFixed(2)} (> 3 threshold)`,
        ],
      })
    }
    return {
      configs,
      rationale: `seed wave: 2 SGD+tanh variants + 1 AdamW+ReLU${isRegression ? "+MSE" : "+CE"} modern${configs.length > 3 ? " + class_weights=balanced" : ""}`,
      rules_fired,
      rule_explanations,
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
  const explanations: RuleExplanation[] = []

  // Rule A: still improving → 2x epochs + early stopping as safety net
  if (best.still_improving) {
    configs.push({
      lr: baseLr,
      epochs: baseEpochs * 2,
      head_arch: baseArch,
      early_stop_patience: Math.max(20, Math.round(baseEpochs * 0.1)),
    })
    fired.push("A:still_improving→2x epochs + early_stop")
    explanations.push({
      name: "A_still_improving",
      title: "Loss was still falling — give it more epochs",
      why: "The training loss hadn't plateaued by the end of the run, which means the model probably has more to learn. Doubling epochs gives it the headroom; early stopping kicks in if things turn around so we don't waste budget.",
      evidence: [
        `still_improving = true (loss decreasing in the last 20% of training)`,
        `wave epochs = ${baseEpochs} → trying ${baseEpochs * 2} with early_stop_patience=${Math.max(20, Math.round(baseEpochs * 0.1))}`,
      ],
    })
  }

  // Rule B: overfit → fewer epochs + shallower, AND try weight_decay as proper regularizer
  if (best.overfit_gap !== null && best.overfit_gap > 0.15) {
    configs.push({
      lr: baseLr,
      epochs: Math.max(100, Math.round(baseEpochs * 0.7)),
      head_arch: shallowerArch(baseArch, k, d),
    })
    fired.push("B1:overfit→shorter + shallower")
    explanations.push({
      name: "B1_overfit_shorter_shallower",
      title: "Overfitting — shrink the model and train less",
      why: "Training accuracy is much higher than validation accuracy, so the model is memorizing the training set instead of learning general patterns. A smaller architecture with fewer epochs has less capacity to memorize and usually generalizes better.",
      evidence: [
        `overfit_gap = ${best.overfit_gap.toFixed(3)} (> 0.15 threshold)`,
        best.accuracy != null && best.val_accuracy != null
          ? `train acc = ${best.accuracy.toFixed(3)}, val acc = ${best.val_accuracy.toFixed(3)}`
          : `val split missing — gap is estimated`,
        `head_arch ${JSON.stringify(baseArch ?? "default")} → ${JSON.stringify(shallowerArch(baseArch, k, d))}`,
      ],
    })
    // Only add weight_decay variant if not already tried
    if (base.weight_decay === undefined || base.weight_decay === 0) {
      configs.push({
        lr: baseLr,
        epochs: baseEpochs,
        head_arch: baseArch,
        weight_decay: 0.01,
      })
      fired.push("B2:overfit→weight_decay=0.01")
      explanations.push({
        name: "B2_overfit_weight_decay",
        title: "Overfitting — add weight decay",
        why: "Weight decay (aka L2 regularization) gently pushes model weights toward zero during training. It's a cheap way to reduce overfitting without changing the architecture.",
        evidence: [
          `overfit_gap = ${best.overfit_gap.toFixed(3)}`,
          `winner wasn't using weight_decay — trying 0.01 (AdamW default)`,
        ],
      })
    }
  }

  // Rule C: converged too fast → finer LR
  if (best.convergence_epoch !== null && best.epochs_requested !== null &&
      best.convergence_epoch < best.epochs_requested * 0.3) {
    configs.push({ lr: clampLr(baseLr * 0.3), epochs: baseEpochs, head_arch: baseArch })
    fired.push("C:early_converge→finer lr")
    explanations.push({
      name: "C_early_converge_finer_lr",
      title: "Converged very early — try a smaller learning rate",
      why: "The loss curve flattened well before the end of training, which usually means the learning rate was too large and the model jumped straight to a shallow minimum. A smaller LR can find a deeper, more accurate one.",
      evidence: [
        `convergence_epoch = ${best.convergence_epoch} of ${best.epochs_requested} (< 30%)`,
        `lr ${baseLr} → ${clampLr(baseLr * 0.3).toFixed(4)}`,
      ],
    })
  }

  // Rule D: critical severity AND not overfitting → wider arch
  if (best.severity === "critical" && (best.overfit_gap === null || best.overfit_gap <= 0.1)) {
    configs.push({ lr: baseLr, epochs: baseEpochs, head_arch: widerArch(baseArch, k, d) })
    fired.push("D:underfit→wider arch")
    explanations.push({
      name: "D_underfit_wider",
      title: "Underfitting — try a wider network",
      why: "Accuracy is low and the model doesn't seem to be memorizing either, so capacity is probably the bottleneck. Doubling hidden layer width gives the model more parameters to fit the signal.",
      evidence: [
        `severity = "critical" (metric well below target)`,
        `overfit_gap ≤ 0.1 — not memorizing, so underfitting`,
        `head_arch ${JSON.stringify(baseArch ?? "default")} → ${JSON.stringify(widerArch(baseArch, k, d))}`,
      ],
    })
  }

  // Rule E: per-class variance high + class_weights not tried
  if (!isRegression && best.per_class_variance !== null && best.per_class_variance > 0.03 &&
      base.class_weights !== "balanced") {
    configs.push({ lr: baseLr, epochs: baseEpochs, head_arch: baseArch, class_weights: "balanced" })
    fired.push("E:per_class_var→class_weights=balanced")
    explanations.push({
      name: "E_per_class_var_balanced",
      title: "Some classes are weaker than others — rebalance the loss",
      why: "Overall accuracy looks decent but per-class accuracy is uneven, which usually means the loss is dominated by the majority class. class_weights=\"balanced\" reweights the loss so every class gets equal say.",
      evidence: [
        `per_class_variance = ${best.per_class_variance.toFixed(3)} (> 0.03 threshold)`,
        `winner wasn't using class_weights`,
      ],
    })
  }

  // Fallback: no rule fired → ±25% lr
  if (configs.length === 0) {
    configs.push({ lr: clampLr(baseLr * 0.75), epochs: baseEpochs, head_arch: baseArch })
    configs.push({ lr: clampLr(baseLr * 1.25), epochs: baseEpochs, head_arch: baseArch })
    fired.push("fallback:±25% lr")
    explanations.push({
      name: "fallback_lr_sweep",
      title: "No clear issue — nudge learning rate both ways",
      why: "None of the diagnostic rules fired (no overfit, no underfit, loss converged at a reasonable epoch, per-class balanced). Lightly searching around the current LR often finds a small improvement without changing anything more structural.",
      evidence: [
        `lr ${baseLr} → trying ${clampLr(baseLr * 0.75).toFixed(4)} and ${clampLr(baseLr * 1.25).toFixed(4)}`,
      ],
    })
  }

  // Cap at 4 configs per wave
  const capped = configs.slice(0, 4)
  return {
    configs: capped,
    rationale: `refined from wave ${bundle.history.waves_done} winner (${best.metric_name}=${best.metric?.toFixed(3)}): ${fired.join("; ")}`,
    rules_fired: fired,
    rule_explanations: explanations,
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
