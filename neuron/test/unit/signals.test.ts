import { describe, test, expect } from "bun:test"
import {
  computeConvergenceEpoch,
  computeStillImproving,
  computePerClassVariance,
  severityForMetric,
} from "../../src/core/auto/signals"

describe("computeConvergenceEpoch", () => {
  test("returns null for short histories (≤ 10 points)", () => {
    expect(computeConvergenceEpoch([1, 0.9, 0.8, 0.7], 100)).toBeNull()
  })

  test("returns an epoch in [1, totalEpochs] for a converging curve", () => {
    // Monotonically decreasing, improvement slows over time.
    const loss = Array.from({ length: 100 }, (_, i) => 1 / (1 + i * 0.1))
    const ep = computeConvergenceEpoch(loss, 500)
    expect(ep).not.toBeNull()
    expect(ep!).toBeGreaterThanOrEqual(1)
    expect(ep!).toBeLessThanOrEqual(500)
  })

  test("scales to totalEpochs, not history length", () => {
    // Loss history is sampled to 50 points but we trained for 1000 epochs.
    const loss = Array.from({ length: 50 }, (_, i) => 1 / (1 + i * 0.01))
    const ep = computeConvergenceEpoch(loss, 1000)
    expect(ep).not.toBeNull()
    expect(ep!).toBeGreaterThanOrEqual(10)
    expect(ep!).toBeLessThanOrEqual(1000)
  })
})

describe("computeStillImproving", () => {
  test("false for short curves (≤ 20 points)", () => {
    expect(computeStillImproving([1, 0.9, 0.8])).toBe(false)
  })

  test("true when the last 10% is significantly below the prior 10%", () => {
    // First 80% hover around 0.5, last 20% drop to 0.2.
    const flat = Array.from({ length: 80 }, () => 0.5)
    const dropping = Array.from({ length: 20 }, (_, i) => 0.5 - i * 0.015)
    expect(computeStillImproving([...flat, ...dropping])).toBe(true)
  })

  test("false when loss has plateaued", () => {
    // Low-amplitude oscillation around 0.3 — not improving.
    const loss = Array.from({ length: 100 }, (_, i) => 0.3 + Math.sin(i) * 0.001)
    expect(computeStillImproving(loss)).toBe(false)
  })

  test("false when loss is increasing (diverging)", () => {
    const loss = Array.from({ length: 100 }, (_, i) => 0.3 + i * 0.01)
    expect(computeStillImproving(loss)).toBe(false)
  })
})

describe("computePerClassVariance", () => {
  test("returns null for missing input", () => {
    expect(computePerClassVariance(null)).toBeNull()
  })

  test("returns 0 for single-class input", () => {
    expect(computePerClassVariance({ a: 0.9 })).toBe(0)
  })

  test("returns 0 when all classes identical", () => {
    expect(computePerClassVariance({ a: 0.8, b: 0.8, c: 0.8 })).toBe(0)
  })

  test("produces a positive value when classes differ", () => {
    const v = computePerClassVariance({ a: 0.95, b: 0.5, c: 0.3 })
    expect(v).toBeGreaterThan(0)
  })

  test("matches hand-computed variance for known inputs", () => {
    // mean of [0.5, 0.7, 0.9] is 0.7, variance is (0.04 + 0 + 0.04) / 3 ≈ 0.0267
    const v = computePerClassVariance({ a: 0.5, b: 0.7, c: 0.9 })
    expect(v).toBeCloseTo(0.0267, 3)
  })
})

describe("severityForMetric", () => {
  test("classification — critical below 0.5", () => {
    expect(severityForMetric(0.3, false)).toBe("critical")
    expect(severityForMetric(0.49, false)).toBe("critical")
  })

  test("classification — moderate in [0.5, 0.8)", () => {
    expect(severityForMetric(0.5, false)).toBe("moderate")
    expect(severityForMetric(0.79, false)).toBe("moderate")
  })

  test("classification — minor at/above 0.8", () => {
    expect(severityForMetric(0.8, false)).toBe("minor")
    expect(severityForMetric(0.99, false)).toBe("minor")
  })

  test("regression — critical below R² 0.3", () => {
    expect(severityForMetric(0.1, true)).toBe("critical")
    expect(severityForMetric(0.29, true)).toBe("critical")
  })

  test("regression — moderate in [0.3, 0.7)", () => {
    expect(severityForMetric(0.3, true)).toBe("moderate")
    expect(severityForMetric(0.69, true)).toBe("moderate")
  })

  test("regression — minor at/above 0.7", () => {
    expect(severityForMetric(0.7, true)).toBe("minor")
    expect(severityForMetric(0.95, true)).toBe("minor")
  })

  test("null metric is treated as critical", () => {
    expect(severityForMetric(null, false)).toBe("critical")
    expect(severityForMetric(null, true)).toBe("critical")
  })
})
