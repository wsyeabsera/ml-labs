import { describe, test, expect } from "bun:test"
import {
  recordRulesFired,
  recordRulesProducedWinner,
  getRuleStats,
  totalTrialsFor,
} from "../../src/core/auto/rule-stats"

function fp(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

describe("rule-stats", () => {
  test("fresh fingerprint has no stats", () => {
    const f = fp("fresh")
    expect(getRuleStats(f)).toEqual({})
    expect(totalTrialsFor(f)).toBe(0)
  })

  test("recordRulesFired inserts a new row with fired=1, wins=0", () => {
    const f = fp("fired")
    recordRulesFired(["seed", "A"], f)
    const stats = getRuleStats(f)
    expect(stats.seed).toEqual({ fired: 1, wins: 0 })
    expect(stats.A).toEqual({ fired: 1, wins: 0 })
  })

  test("recordRulesFired increments on subsequent calls", () => {
    const f = fp("incr")
    recordRulesFired(["seed"], f)
    recordRulesFired(["seed"], f)
    recordRulesFired(["seed"], f)
    expect(getRuleStats(f).seed).toEqual({ fired: 3, wins: 0 })
  })

  test("recordRulesProducedWinner increments win count independently", () => {
    const f = fp("win")
    recordRulesFired(["seed_modern"], f)
    recordRulesFired(["seed_modern"], f)
    recordRulesProducedWinner(["seed_modern"], f)
    expect(getRuleStats(f).seed_modern).toEqual({ fired: 2, wins: 1 })
  })

  test("totalTrialsFor sums fired counts across rules", () => {
    const f = fp("total")
    recordRulesFired(["A", "B"], f)
    recordRulesFired(["A"], f)
    recordRulesFired(["C"], f)
    expect(totalTrialsFor(f)).toBe(4)  // A:2 + B:1 + C:1
  })

  test("empty rule arrays are no-ops", () => {
    const f = fp("empty")
    recordRulesFired([], f)
    recordRulesProducedWinner([], f)
    expect(getRuleStats(f)).toEqual({})
  })

  test("stats are isolated per fingerprint", () => {
    const a = fp("iso-a")
    const b = fp("iso-b")
    recordRulesFired(["x"], a)
    recordRulesFired(["x"], a)
    recordRulesFired(["x"], b)
    expect(getRuleStats(a).x).toEqual({ fired: 2, wins: 0 })
    expect(getRuleStats(b).x).toEqual({ fired: 1, wins: 0 })
  })
})
