import { describe, test, expect } from "bun:test"
import { fitTemperature, ece, nllAt } from "../../src/core/calibration"

describe("nllAt", () => {
  test("perfect predictions yield ~0 NLL at T=1", () => {
    // logits where the correct class wildly dominates
    const logits = [
      [10, 0, 0], [0, 10, 0], [0, 0, 10],
    ]
    const labels = [0, 1, 2]
    expect(nllAt(logits, labels, 1.0)).toBeLessThan(0.01)
  })

  test("uniform logits give NLL = log(K)", () => {
    const logits = [[0, 0, 0], [0, 0, 0]]
    const labels = [0, 1]
    expect(nllAt(logits, labels, 1.0)).toBeCloseTo(Math.log(3), 3)
  })

  test("T <= 0 returns Infinity (guard)", () => {
    expect(nllAt([[1, 2]], [0], 0)).toBe(Infinity)
    expect(nllAt([[1, 2]], [0], -1)).toBe(Infinity)
  })
})

describe("ece (expected calibration error)", () => {
  test("well-calibrated input → low ECE", () => {
    // Probabilities that match accuracy: 70% predicted with 70% confidence, etc.
    const probs = Array.from({ length: 100 }, (_, i) => {
      if (i < 70) return [0.7, 0.3]
      return [0.3, 0.7]
    })
    // 70% of first group classified correctly as 0, 70% of second correctly as 1
    const labels = [
      ...Array.from({ length: 49 }, () => 0),
      ...Array.from({ length: 21 }, () => 1),
      ...Array.from({ length: 9 }, () => 0),
      ...Array.from({ length: 21 }, () => 1),
    ]
    const e = ece(probs, labels, 10)
    expect(e).toBeLessThan(0.25)
  })

  test("empty input → 0", () => {
    expect(ece([], [])).toBe(0)
  })
})

describe("fitTemperature", () => {
  test("overconfident input yields T > 1 (tempers)", () => {
    // Model is overconfident: assigns probability ~0.99 but is actually only 80% accurate.
    const logits: number[][] = []
    const labels: number[] = []
    for (let i = 0; i < 100; i++) {
      const correct = i < 80
      // overconfident raw logits
      logits.push(correct ? [6, 0, 0] : [6, 0, 0])
      labels.push(correct ? 0 : 1)
    }
    const r = fitTemperature(logits, labels)
    expect(r.T).toBeGreaterThan(1)
    expect(r.ece_after).toBeLessThanOrEqual(r.ece_before)
  })

  test("already-calibrated input yields T close to 1", () => {
    // Correct predictions with moderate confidence.
    const logits: number[][] = []
    const labels: number[] = []
    for (let i = 0; i < 100; i++) {
      const cls = i % 3
      const l = [0, 0, 0]
      l[cls] = 2.0 // moderate confidence
      logits.push(l)
      labels.push(cls)
    }
    const r = fitTemperature(logits, labels)
    // Should be roughly ≤ 1 since predictions are already near-perfect
    expect(r.T).toBeGreaterThan(0.2)
    expect(r.T).toBeLessThan(2)
  })

  test("fit reduces or maintains NLL", () => {
    const logits = [
      [4, 0, 0], [4, 0, 0], [0, 4, 0], [0, 0, 4], [4, 0, 0], [0, 4, 0],
    ]
    const labels = [0, 1, 1, 2, 1, 1]
    const r = fitTemperature(logits, labels)
    expect(r.nll_after).toBeLessThanOrEqual(r.nll_before + 1e-6)
  })

  test("output T is always positive", () => {
    const logits = [[1, 2], [2, 1]]
    const labels = [1, 0]
    const r = fitTemperature(logits, labels)
    expect(r.T).toBeGreaterThan(0)
  })
})
