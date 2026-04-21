import { describe, test, expect } from "bun:test"
import { refineFromSignals, shouldContinue } from "../../src/core/auto/rules"
import {
  bundleEmpty,
  bundleEmptyImbalanced,
  bundleStillImproving,
  bundleOverfit,
  bundleEarlyConverge,
  bundleCriticalUnderfit,
  bundleHighClassVariance,
  bundleRegression,
} from "./fixtures/bundle-fixtures"

describe("refineFromSignals — seed wave (empty current_wave)", () => {
  test("produces 3 configs: 2 SGD+tanh variants + 1 modern AdamW+ReLU for balanced classification", () => {
    const plan = refineFromSignals(bundleEmpty())
    expect(plan.configs.length).toBe(3)
    expect(plan.rules_fired).toContain("seed")
    expect(plan.rules_fired).toContain("seed_modern")
    for (const c of plan.configs) {
      expect(c.lr).toBeGreaterThanOrEqual(0.001)
      expect(c.lr).toBeLessThanOrEqual(0.1)
      expect(c.epochs).toBeGreaterThan(0)
      expect(c.head_arch?.length).toBeGreaterThanOrEqual(3)
    }
  })

  test("modern variant uses AdamW + ReLU + cosine + CE for classification", () => {
    const plan = refineFromSignals(bundleEmpty())
    const modern = plan.configs.find((c) => c.optimizer === "adamw")
    expect(modern).toBeDefined()
    expect(modern!.activation).toBe("relu")
    expect(modern!.lr_schedule).toBe("cosine")
    expect(modern!.loss).toBe("cross_entropy")
    expect(modern!.weight_decay).toBeGreaterThan(0)
  })

  test("adds class_weights=balanced variant when imbalance > 3", () => {
    const plan = refineFromSignals(bundleEmptyImbalanced())
    expect(plan.configs.length).toBe(4)
    const withWeights = plan.configs.filter((c) => c.class_weights === "balanced")
    expect(withWeights.length).toBe(1)
  })

  test("deterministic: same bundle → same plan", () => {
    const b = bundleEmpty()
    const a = refineFromSignals(b)
    const c = refineFromSignals(b)
    expect(a.configs).toEqual(c.configs)
    expect(a.rules_fired).toEqual(c.rules_fired)
  })
})

describe("refineFromSignals — refinement rules", () => {
  test("Rule A fires when still_improving=true and proposes 2x epochs with early_stop", () => {
    const plan = refineFromSignals(bundleStillImproving())
    expect(plan.rules_fired.some((r) => r.startsWith("A:"))).toBe(true)
    const hasLongerRun = plan.configs.some((c) =>
      c.epochs !== undefined && c.epochs > 500 && c.early_stop_patience !== undefined,
    )
    expect(hasLongerRun).toBe(true)
  })

  test("Rule B fires on overfit_gap > 0.15 — includes shallower arch AND weight_decay variant", () => {
    const plan = refineFromSignals(bundleOverfit())
    // B1 = shallower + shorter
    expect(plan.rules_fired.some((r) => r.startsWith("B1:"))).toBe(true)
    // B2 = weight_decay
    expect(plan.rules_fired.some((r) => r.startsWith("B2:"))).toBe(true)
    const hasWeightDecay = plan.configs.some((c) => (c.weight_decay ?? 0) > 0)
    expect(hasWeightDecay).toBe(true)
  })

  test("Rule C fires when convergence_epoch < 30% of total — proposes lower lr", () => {
    const plan = refineFromSignals(bundleEarlyConverge())
    expect(plan.rules_fired.some((r) => r.startsWith("C:"))).toBe(true)
    // Base lr was 0.05; C should propose lr * 0.3 = 0.015
    const lowerLr = plan.configs.find((c) => (c.lr ?? 1) < 0.02)
    expect(lowerLr).toBeDefined()
  })

  test("Rule D fires on critical severity without overfit — proposes wider arch", () => {
    const plan = refineFromSignals(bundleCriticalUnderfit())
    expect(plan.rules_fired.some((r) => r.startsWith("D:"))).toBe(true)
    // Base arch was [10, 8, 3]; widened should have first hidden layer doubled
    const wider = plan.configs.find((c) => (c.head_arch?.[1] ?? 0) >= 16)
    expect(wider).toBeDefined()
  })

  test("Rule E fires on high per-class variance — proposes class_weights=balanced", () => {
    const plan = refineFromSignals(bundleHighClassVariance())
    expect(plan.rules_fired.some((r) => r.startsWith("E:"))).toBe(true)
    const balanced = plan.configs.find((c) => c.class_weights === "balanced")
    expect(balanced).toBeDefined()
  })

  test("Rule E does NOT fire for regression tasks (class_weights is classification-only)", () => {
    const plan = refineFromSignals(bundleRegression(0.4))
    const hasClassWeights = plan.configs.some((c) => c.class_weights !== undefined)
    expect(hasClassWeights).toBe(false)
    expect(plan.rules_fired.some((r) => r.startsWith("E:"))).toBe(false)
  })

  test("configs are capped at 4 per wave", () => {
    // bundleOverfit triggers B1+B2, might pick up others with wide thresholds.
    const plan = refineFromSignals(bundleOverfit())
    expect(plan.configs.length).toBeLessThanOrEqual(4)
  })

  test("fallback (±25% lr) when no other rule matches", () => {
    // A healthy run: no rule should match, expect fallback.
    const b = {
      ...bundleEmpty(),
      history: { ...bundleEmpty().history, waves_done: 1 },
      current_wave: [
        {
          run_id: 999,
          config: { lr: 0.005, epochs: 500, head_arch: [10, 32, 3] },
          status: "completed" as const,
          metric: 0.88,
          metric_name: "accuracy" as const,
          accuracy: 0.88,
          val_accuracy: 0.88,
          overfit_gap: 0.0,
          still_improving: false,
          convergence_epoch: 300,
          epochs_requested: 500,
          per_class_accuracy: { a: 0.88, b: 0.88, c: 0.88 },
          per_class_variance: 0.0,
          severity: "minor" as const,
          r2: null,
          mae: null,
          rmse: null,
        },
      ],
    }
    const plan = refineFromSignals(b)
    expect(plan.rules_fired).toContain("fallback:±25% lr")
    expect(plan.configs.length).toBe(2)
  })

  test("all proposed lr values stay in [0.001, 0.1]", () => {
    for (const bundle of [
      bundleEmpty(),
      bundleEmptyImbalanced(),
      bundleStillImproving(),
      bundleOverfit(),
      bundleEarlyConverge(),
      bundleCriticalUnderfit(),
      bundleHighClassVariance(),
    ]) {
      const plan = refineFromSignals(bundle)
      for (const c of plan.configs) {
        if (c.lr !== undefined) {
          expect(c.lr).toBeGreaterThanOrEqual(0.001)
          expect(c.lr).toBeLessThanOrEqual(0.1)
        }
      }
    }
  })
})

describe("shouldContinue", () => {
  test("stops when max_waves reached", () => {
    const b = { ...bundleOverfit(), history: { ...bundleOverfit().history, waves_done: 2 } }
    expect(shouldContinue(b, 2).cont).toBe(false)
  })

  test("stops when budget exhausted", () => {
    const b = { ...bundleOverfit() }
    b.history.budget_used_s = b.history.budget_s + 1
    expect(shouldContinue(b, 5).cont).toBe(false)
  })

  test("continues when no waves yet", () => {
    const b = bundleEmpty()
    expect(shouldContinue(b, 3).cont).toBe(true)
  })

  test("stops when target reached", () => {
    const bundle = bundleOverfit()
    bundle.current_wave[0]!.metric = 0.95 // above 0.9 target
    expect(shouldContinue(bundle, 5).cont).toBe(false)
  })

  test("continues when below target and budget available", () => {
    const bundle = bundleStillImproving()
    expect(shouldContinue(bundle, 3).cont).toBe(true)
  })
})
