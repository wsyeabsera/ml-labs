import { describe, test, expect } from "bun:test"
import { suggestTpe, suggestTpeBatch, type TpeObservation, type TpeParamSpec } from "../../src/core/auto/tpe"

const SPACE: TpeParamSpec = {
  lr: { kind: "log_uniform", min: 0.001, max: 0.1 },
  epochs: { kind: "int_uniform", min: 100, max: 2000 },
  optimizer: { kind: "categorical", choices: ["sgd", "adam", "adamw"] as const },
}

describe("suggestTpe — cold start", () => {
  test("empty history returns uniform sample within bounds", () => {
    const r = suggestTpe(SPACE, [], { seed: 42 })
    const lr = r.lr as number
    expect(lr).toBeGreaterThanOrEqual(0.001)
    expect(lr).toBeLessThanOrEqual(0.1)
    const epochs = r.epochs as number
    expect(Number.isInteger(epochs)).toBe(true)
    expect(epochs).toBeGreaterThanOrEqual(100)
    expect(epochs).toBeLessThanOrEqual(2000)
    expect(["sgd", "adam", "adamw"]).toContain(r.optimizer)
  })

  test("< 3 observations also falls back to uniform", () => {
    const r = suggestTpe(SPACE, [
      { config: { lr: 0.01, epochs: 500, optimizer: "adam" }, score: 0.95 },
    ], { seed: 42 })
    const lr = r.lr as number
    expect(lr).toBeGreaterThanOrEqual(0.001)
    expect(lr).toBeLessThanOrEqual(0.1)
  })
})

describe("suggestTpe — determinism", () => {
  test("same seed + same history → same suggestion", () => {
    const hist: TpeObservation[] = [
      { config: { lr: 0.01, epochs: 500, optimizer: "adam" }, score: 0.9 },
      { config: { lr: 0.005, epochs: 800, optimizer: "adamw" }, score: 0.95 },
      { config: { lr: 0.05, epochs: 200, optimizer: "sgd" }, score: 0.5 },
      { config: { lr: 0.001, epochs: 1500, optimizer: "adamw" }, score: 0.85 },
    ]
    const a = suggestTpe(SPACE, hist, { seed: 7 })
    const b = suggestTpe(SPACE, hist, { seed: 7 })
    expect(a).toEqual(b)
  })

  test("different seed → different suggestion", () => {
    const hist: TpeObservation[] = [
      { config: { lr: 0.01, epochs: 500, optimizer: "adam" }, score: 0.9 },
      { config: { lr: 0.005, epochs: 800, optimizer: "adamw" }, score: 0.95 },
      { config: { lr: 0.05, epochs: 200, optimizer: "sgd" }, score: 0.5 },
      { config: { lr: 0.001, epochs: 1500, optimizer: "adamw" }, score: 0.85 },
    ]
    const a = suggestTpe(SPACE, hist, { seed: 1 })
    const b = suggestTpe(SPACE, hist, { seed: 2 })
    expect(a).not.toEqual(b)
  })
})

describe("suggestTpe — learns from history", () => {
  test("good observations cluster around lr=0.01 → TPE suggestions cluster near 0.01", () => {
    // Build a history where low-lr configs are the winners.
    const hist: TpeObservation[] = []
    for (let i = 0; i < 30; i++) {
      const lr = 0.005 + i * 0.001  // 0.005..0.034
      const score = lr < 0.015 ? 0.95 - Math.abs(lr - 0.01) * 20 : 0.5 - lr * 2
      hist.push({ config: { lr, epochs: 500, optimizer: "adam" }, score })
    }

    const lrs: number[] = []
    for (let i = 0; i < 20; i++) {
      const r = suggestTpe(SPACE, hist, { seed: i + 100 })
      lrs.push(r.lr as number)
    }
    // Mean of suggestions should be much closer to 0.01 than to the middle of the range.
    const mean = lrs.reduce((a, b) => a + b, 0) / lrs.length
    expect(mean).toBeLessThan(0.03)
    expect(mean).toBeGreaterThan(0.003)
  })

  test("categorical: if 'adamw' dominates winners, suggestions skew adamw", () => {
    const hist: TpeObservation[] = []
    for (let i = 0; i < 20; i++) {
      hist.push({ config: { lr: 0.01, epochs: 500, optimizer: "adamw" }, score: 0.9 + i * 0.002 })
    }
    for (let i = 0; i < 20; i++) {
      hist.push({ config: { lr: 0.01, epochs: 500, optimizer: "sgd" }, score: 0.3 + i * 0.002 })
    }
    const opts: string[] = []
    for (let i = 0; i < 30; i++) {
      opts.push(suggestTpe(SPACE, hist, { seed: i + 1 }).optimizer as string)
    }
    const adamwCount = opts.filter((o) => o === "adamw").length
    // With 70% keep + 30% explore from the good set (all adamw), adamw should dominate.
    expect(adamwCount).toBeGreaterThan(opts.length * 0.5)
  })
})

describe("suggestTpeBatch", () => {
  test("returns N configs, each with required keys", () => {
    const batch = suggestTpeBatch(SPACE, [], 5, { seed: 42 })
    expect(batch.length).toBe(5)
    for (const cfg of batch) {
      expect(cfg.lr).toBeDefined()
      expect(cfg.epochs).toBeDefined()
      expect(cfg.optimizer).toBeDefined()
    }
  })

  test("batch seeded deterministically", () => {
    const a = suggestTpeBatch(SPACE, [], 3, { seed: 42 })
    const b = suggestTpeBatch(SPACE, [], 3, { seed: 42 })
    expect(a).toEqual(b)
  })
})
