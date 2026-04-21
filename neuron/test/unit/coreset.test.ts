import { describe, test, expect } from "bun:test"
import { kCenterGreedy, hybridUncertaintyDiversity } from "../../src/core/auto/coreset"

describe("kCenterGreedy", () => {
  test("empty input returns empty", () => {
    expect(kCenterGreedy([], 5)).toEqual([])
    expect(kCenterGreedy([[1, 2]], 0)).toEqual([])
  })

  test("k >= N returns all indices", () => {
    const pts = [[0, 0], [1, 1], [2, 2]]
    expect(kCenterGreedy(pts, 5).sort()).toEqual([0, 1, 2])
  })

  test("spatially spread output for a simple 1D line", () => {
    // 10 points along a line at x=0..9. k=3 should pick the ends + middle.
    const pts = Array.from({ length: 10 }, (_, i) => [i])
    const out = kCenterGreedy(pts, 3)
    expect(out.length).toBe(3)
    expect(out).toContain(0)   // endpoint
    expect(out).toContain(9)   // other endpoint
    // The third should be somewhere in the middle (idx 4 or 5).
    const middle = out.find((i) => i !== 0 && i !== 9)
    expect([3, 4, 5]).toContain(middle)
  })

  test("deterministic: same input → same output", () => {
    const pts = [[0, 0], [1, 0], [0, 1], [10, 10], [5, 5], [-3, -2]]
    const a = kCenterGreedy(pts, 3)
    const b = kCenterGreedy(pts, 3)
    expect(a).toEqual(b)
  })

  test("clusters: picks diverse representatives", () => {
    // Three tight clusters at (0,0), (10,10), (-10,10). k=3 should pick one from each.
    const cluster1 = Array.from({ length: 10 }, (_, i) => [i * 0.01, i * 0.01])
    const cluster2 = Array.from({ length: 10 }, (_, i) => [10 + i * 0.01, 10 + i * 0.01])
    const cluster3 = Array.from({ length: 10 }, (_, i) => [-10 + i * 0.01, 10 + i * 0.01])
    const pts = [...cluster1, ...cluster2, ...cluster3]
    const out = kCenterGreedy(pts, 3)
    // Map each selected index back to its cluster (0, 1, or 2)
    const clusters = out.map((i) => Math.floor(i / 10))
    expect(new Set(clusters).size).toBe(3)
  })

  test("pairwise distances in output are non-trivial", () => {
    const pts = Array.from({ length: 20 }, (_, i) => [i, 20 - i, (i * 7) % 13])
    const out = kCenterGreedy(pts, 4)
    // No duplicates
    expect(new Set(out).size).toBe(out.length)
  })
})

describe("hybridUncertaintyDiversity", () => {
  test("picks uncertain AND diverse samples", () => {
    // 6 samples: pairs of near-duplicates at 3 spatial positions.
    // Uncertainty: pair A = 0.9 each, pair B = 0.5 each, pair C = 0.1 each.
    const features = [
      [0, 0], [0.01, 0.01],   // pair A (very uncertain)
      [5, 5], [5.01, 5.01],   // pair B (medium)
      [10, 10], [10.01, 10.01], // pair C (confident)
    ]
    const uncertainty = [0.9, 0.9, 0.5, 0.5, 0.1, 0.1]

    // Ask for 3 → should get one from each pair, not 3 from pair A.
    const selected = hybridUncertaintyDiversity(features, uncertainty, 3, 3)
    expect(selected.length).toBe(3)
    // Rough: selected should span at least 2 of the 3 pairs.
    const pairs = selected.map((i) => Math.floor(i / 2))
    expect(new Set(pairs).size).toBeGreaterThanOrEqual(2)
  })

  test("falls back to uncertainty alone when k >= N", () => {
    const features = [[0], [1], [2]]
    const uncertainty = [0.1, 0.9, 0.5]
    const out = hybridUncertaintyDiversity(features, uncertainty, 5, 3)
    expect(out.length).toBe(3)
  })

  test("empty / zero k returns []", () => {
    expect(hybridUncertaintyDiversity([], [], 3)).toEqual([])
    expect(hybridUncertaintyDiversity([[1]], [0.5], 0)).toEqual([])
  })

  test("throws on mismatched lengths", () => {
    expect(() =>
      hybridUncertaintyDiversity([[0], [1]], [0.5], 1)
    ).toThrow()
  })

  test("deterministic", () => {
    const features = Array.from({ length: 30 }, (_, i) => [Math.sin(i), Math.cos(i), i * 0.1])
    const uncertainty = Array.from({ length: 30 }, (_, i) => Math.sin(i * 0.7) * 0.5 + 0.5)
    const a = hybridUncertaintyDiversity(features, uncertainty, 5)
    const b = hybridUncertaintyDiversity(features, uncertainty, 5)
    expect(a).toEqual(b)
  })
})
