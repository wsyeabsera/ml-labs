import { describe, test, expect } from "bun:test"
import {
  scoreClassification,
  scoreRegression,
  verdictSummaryOneLiner,
  type StructuredVerdict,
} from "../../src/core/auto/verdict"
import {
  runHealthy,
  runOverfit,
  runCriticalUnderfit,
} from "./fixtures/bundle-fixtures"

describe("scoreClassification", () => {
  test("prefers val_accuracy when both train and val present and gap is small", () => {
    const r = runHealthy()
    expect(scoreClassification(r)).toBe(r.val_accuracy!)
  })

  test("applies overfit penalty when train-val gap > 0.15", () => {
    const r = runOverfit() // train=0.98, val=0.75 → gap=0.23
    const expected = r.val_accuracy! - 0.5 * (r.accuracy! - r.val_accuracy!)
    expect(scoreClassification(r)).toBeCloseTo(expected, 6)
    // Penalty should make the score strictly less than val_accuracy alone.
    expect(scoreClassification(r)).toBeLessThan(r.val_accuracy!)
  })

  test("does NOT apply penalty when gap is below 0.15 threshold", () => {
    const r = runHealthy()
    r.accuracy = 0.88
    r.val_accuracy = 0.75 // gap = 0.13 — no penalty
    expect(scoreClassification(r)).toBe(0.75)
  })

  test("falls back to accuracy when val_accuracy is null", () => {
    const r = runHealthy()
    r.val_accuracy = null
    expect(scoreClassification(r)).toBe(r.accuracy!)
  })

  test("returns -Infinity when both are null", () => {
    const r = runHealthy()
    r.accuracy = null
    r.val_accuracy = null
    expect(scoreClassification(r)).toBe(-Infinity)
  })

  test("healthy run scores > overfit run (overfit penalty is effective)", () => {
    expect(scoreClassification(runHealthy())).toBeGreaterThan(scoreClassification(runOverfit()))
  })

  test("healthy run scores > critical-underfit run", () => {
    expect(scoreClassification(runHealthy())).toBeGreaterThan(scoreClassification(runCriticalUnderfit()))
  })
})

describe("scoreRegression", () => {
  test("returns R² when present", () => {
    const r = runHealthy()
    r.r2 = 0.82
    expect(scoreRegression(r)).toBe(0.82)
  })

  test("returns -Infinity when r2 is null", () => {
    const r = runHealthy()
    r.r2 = null
    expect(scoreRegression(r)).toBe(-Infinity)
  })
})

describe("verdictSummaryOneLiner", () => {
  function verdict(overrides: Partial<StructuredVerdict> = {}): StructuredVerdict {
    return {
      status: "completed",
      winner: {
        run_id: 42,
        metric_value: 0.935,
        metric_name: "accuracy",
        is_overfit: false,
        confidence: "high",
        config: { lr: 0.005, epochs: 500 },
      },
      attempted: { configs_tried: 6, waves_used: 2, wall_clock_s: 45 },
      data_issues: [],
      next_steps: [],
      summary: "target reached",
      ...overrides,
    }
  }

  test("completed: mentions metric, value, run id, configs, waves", () => {
    const s = verdictSummaryOneLiner(verdict())
    expect(s).toContain("accuracy=0.935")
    expect(s).toContain("run 42")
    expect(s).toContain("6 configs")
    expect(s).toContain("2 waves")
  })

  test("completed + is_overfit flags penalty in the summary", () => {
    const s = verdictSummaryOneLiner(verdict({
      winner: { ...verdict().winner, is_overfit: true },
    }))
    expect(s).toContain("overfit penalty applied")
  })

  test("data_issue echoes summary text", () => {
    const s = verdictSummaryOneLiner(verdict({
      status: "data_issue",
      summary: "too few samples",
      winner: { ...verdict().winner, run_id: null, metric_value: null },
    }))
    expect(s).toContain("too few")
  })

  test("budget_exceeded mentions time/config context", () => {
    const s = verdictSummaryOneLiner(verdict({ status: "budget_exceeded" }))
    expect(s).toContain("budget exceeded")
    expect(s).toContain("2 waves")
  })

  test("no_improvement includes next_steps[0]", () => {
    const s = verdictSummaryOneLiner(verdict({
      status: "no_improvement",
      next_steps: ["collect more data"],
    }))
    expect(s).toContain("no improvement")
    expect(s).toContain("collect more data")
  })
})
