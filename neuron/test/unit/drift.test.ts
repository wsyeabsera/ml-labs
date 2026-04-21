import { describe, test, expect } from "bun:test"
import { psi, ks, driftReportFromArrays, verdictForFeature } from "../../src/core/drift"

function gaussian(n: number, mean: number, std: number, seed: number): number[] {
  // Deterministic Gaussian via a simple LCG + Box-Muller.
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(1e-10, next())
    const u2 = next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    out.push(mean + z * std)
  }
  return out
}

describe("psi", () => {
  test("~0 on identical distributions", () => {
    const a = gaussian(1000, 0, 1, 42)
    const b = gaussian(1000, 0, 1, 43)
    // Different seeds but same distribution should be ~ 0 (< 0.05)
    expect(Math.abs(psi(a, b))).toBeLessThan(0.1)
  })

  test("large on mean-shifted distribution", () => {
    const a = gaussian(1000, 0, 1, 42)
    const b = gaussian(1000, 2, 1, 43)  // 2σ shift
    expect(psi(a, b)).toBeGreaterThan(0.5)
  })

  test("handles constant feature", () => {
    const a = Array(100).fill(0.5)
    const b = Array(100).fill(0.5)
    // No variance → no PSI; should return 0 or a small finite value.
    expect(psi(a, b)).toBe(0)
  })

  test("empty input returns NaN", () => {
    expect(psi([], [1, 2, 3])).toBeNaN()
    expect(psi([1, 2, 3], [])).toBeNaN()
  })
})

describe("ks", () => {
  test("identical distributions → low D, high p", () => {
    const a = gaussian(500, 0, 1, 7)
    const b = gaussian(500, 0, 1, 8)
    const r = ks(a, b)
    expect(r.D).toBeLessThan(0.2)
    expect(r.p).not.toBeNull()
    expect(r.p!).toBeGreaterThan(0.01)
  })

  test("shifted distributions → high D, p ≈ 0", () => {
    const a = gaussian(500, 0, 1, 1)
    const b = gaussian(500, 2, 1, 2)
    const r = ks(a, b)
    expect(r.D).toBeGreaterThan(0.5)
    expect(r.p).not.toBeNull()
    expect(r.p!).toBeLessThan(0.01)
  })

  test("too-small samples return null p", () => {
    const r = ks([1, 2, 3], [4, 5, 6])
    expect(r.p).toBeNull()
  })
})

describe("verdictForFeature", () => {
  test("stable when PSI < 0.1 and KS p > 0.01", () => {
    expect(verdictForFeature(0.05, 0.5, 100, 100)).toBe("stable")
  })
  test("drifting on 0.1 ≤ PSI < 0.25", () => {
    expect(verdictForFeature(0.15, 0.5, 100, 100)).toBe("drifting")
  })
  test("severe on PSI ≥ 0.25", () => {
    expect(verdictForFeature(0.3, 0.5, 100, 100)).toBe("severe")
  })
  test("severe when KS p < 0.01 even if PSI is small", () => {
    expect(verdictForFeature(0.05, 0.001, 100, 100)).toBe("severe")
  })
  test("insufficient_data when sample sizes too small", () => {
    expect(verdictForFeature(0.5, 0.001, 10, 100)).toBe("insufficient_data")
  })
})

describe("driftReportFromArrays", () => {
  test("reports overall stable on identical distributions", () => {
    const ref = Array.from({ length: 200 }, (_, i) => [Math.sin(i * 0.1), Math.cos(i * 0.1)])
    const cur = Array.from({ length: 200 }, (_, i) => [Math.sin(i * 0.1 + 0.01), Math.cos(i * 0.1 + 0.01)])
    const rep = driftReportFromArrays(ref, cur, ["a", "b"], "test")
    expect(rep.ok).toBe(true)
    expect(rep.features.length).toBe(2)
    expect(["stable", "drifting"]).toContain(rep.overall_verdict)
  })

  test("reports severe on a feature shifted > 2σ", () => {
    const ref = Array.from({ length: 200 }, (_, i) => [gaussian(1, 0, 1, i + 100)[0]!, 0])
    const cur = Array.from({ length: 200 }, (_, i) => [gaussian(1, 3, 1, i + 200)[0]!, 0])
    const rep = driftReportFromArrays(ref, cur, ["shifted", "const"], "test")
    expect(rep.features[0]!.verdict).toBe("severe")
    expect(rep.overall_verdict).toBe("severe")
  })

  test("empty reference → insufficient_data", () => {
    const rep = driftReportFromArrays([], [[1, 2, 3]], undefined, "test")
    expect(rep.ok).toBe(false)
    expect(rep.overall_verdict).toBe("insufficient_data")
  })
})
