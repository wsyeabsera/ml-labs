import { describe, test, expect } from "bun:test"
import { shouldDiagnose, runDiagnoser } from "../../src/core/auto/diagnoser"
import {
  runHealthy,
  runOverfit,
  runCriticalUnderfit,
  bundleOverfit,
  bundleCriticalUnderfit,
} from "./fixtures/bundle-fixtures"

describe("shouldDiagnose", () => {
  test("healthy run — no diagnosis needed", () => {
    expect(shouldDiagnose(runHealthy())).toBe(false)
  })

  test("overfit gap > 0.2 triggers diagnosis", () => {
    expect(shouldDiagnose(runOverfit())).toBe(true) // gap=0.23
  })

  test("critical severity triggers diagnosis", () => {
    expect(shouldDiagnose(runCriticalUnderfit())).toBe(true)
  })

  test("null input is a no-op", () => {
    expect(shouldDiagnose(null)).toBe(false)
  })
})

describe("runDiagnoser (rules-only fallback path)", () => {
  // Forcing NEURON_PLANNER=rules forces the rules fallback (no Claude call).
  test("overfit bundle → primary_cause = overfitting", async () => {
    process.env.NEURON_PLANNER = "rules"
    try {
      const d = await runDiagnoser({
        bundle: bundleOverfit(),
        bestRun: runOverfit(),
        reflection: [],
      })
      expect(d.primary_cause).toBe("overfitting")
      expect(d.source).toBe("rules")
      expect(d.confidence).toBe("low")
      expect(d.evidence.length).toBeGreaterThan(0)
      expect(d.recommendations.length).toBeGreaterThan(0)
    } finally {
      delete process.env.NEURON_PLANNER
    }
  })

  test("critical underfit → primary_cause = underfitting", async () => {
    process.env.NEURON_PLANNER = "rules"
    try {
      const d = await runDiagnoser({
        bundle: bundleCriticalUnderfit(),
        bestRun: runCriticalUnderfit(),
        reflection: [],
      })
      expect(d.primary_cause).toBe("underfitting")
      expect(d.recommendations.some((r) => r.includes("wider") || r.includes("epoch"))).toBe(true)
    } finally {
      delete process.env.NEURON_PLANNER
    }
  })

  test("output has required fields", async () => {
    process.env.NEURON_PLANNER = "rules"
    try {
      const d = await runDiagnoser({
        bundle: bundleOverfit(),
        bestRun: runOverfit(),
        reflection: [],
      })
      expect(typeof d.primary_cause).toBe("string")
      expect(Array.isArray(d.evidence)).toBe(true)
      expect(Array.isArray(d.recommendations)).toBe(true)
      expect(["high", "low"]).toContain(d.confidence)
      expect(["claude", "rules"]).toContain(d.source)
    } finally {
      delete process.env.NEURON_PLANNER
    }
  })
})
