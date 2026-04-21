import { describe, test, expect } from "bun:test"
import { createRng, resolveSeed } from "../../src/util/rng"

describe("createRng", () => {
  test("is deterministic with the same seed", () => {
    const a = createRng(42)
    const b = createRng(42)
    const aSeq = [a.next(), a.next(), a.next(), a.next(), a.next()]
    const bSeq = [b.next(), b.next(), b.next(), b.next(), b.next()]
    expect(aSeq).toEqual(bSeq)
  })

  test("produces different output with different seeds", () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  test("shuffle produces identical permutation for same seed", () => {
    const arr1 = createRng(7).shuffle([1, 2, 3, 4, 5, 6, 7, 8])
    const arr2 = createRng(7).shuffle([1, 2, 3, 4, 5, 6, 7, 8])
    expect(arr1).toEqual(arr2)
  })

  test("shuffle permutations differ across seeds", () => {
    const arr1 = createRng(1).shuffle([1, 2, 3, 4, 5, 6, 7, 8])
    const arr2 = createRng(2).shuffle([1, 2, 3, 4, 5, 6, 7, 8])
    expect(arr1).not.toEqual(arr2)
  })

  test("shuffle preserves multiset (no values lost/duplicated)", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const shuffled = createRng(3).shuffle([...src])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(src)
  })

  test("next returns values in [0, 1)", () => {
    const r = createRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test("int respects maxExclusive bound", () => {
    const r = createRng(5)
    for (let i = 0; i < 200; i++) {
      const v = r.int(10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
    }
  })

  test("without seed falls back to Math.random (nondeterministic)", () => {
    const a = createRng()
    const b = createRng()
    // Can't assert inequality (astronomical collision chance), but we can at least
    // verify no crash and values are valid.
    expect(a.next()).toBeGreaterThanOrEqual(0)
    expect(b.next()).toBeLessThan(1)
  })
})

describe("resolveSeed", () => {
  test("explicit seed takes priority", () => {
    process.env.NEURON_SEED = "99"
    expect(resolveSeed(42)).toBe(42)
    delete process.env.NEURON_SEED
  })

  test("falls back to NEURON_SEED env var", () => {
    process.env.NEURON_SEED = "17"
    expect(resolveSeed()).toBe(17)
    delete process.env.NEURON_SEED
  })

  test("returns undefined when neither is set", () => {
    delete process.env.NEURON_SEED
    expect(resolveSeed()).toBeUndefined()
  })

  test("invalid NEURON_SEED yields undefined", () => {
    process.env.NEURON_SEED = "not a number"
    expect(resolveSeed()).toBeUndefined()
    delete process.env.NEURON_SEED
  })
})
