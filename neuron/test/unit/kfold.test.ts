import { describe, test, expect } from "bun:test"
import { kfoldAssign, kfoldSplits } from "../../src/core/kfold"

describe("kfoldAssign (plain k-fold)", () => {
  test("every sample gets a fold in [0, k-1]", () => {
    const labels = Array.from({ length: 100 }, (_, i) => String(i % 3))
    const folds = kfoldAssign(labels, { k: 5, seed: 42 })
    expect(folds.length).toBe(100)
    for (const f of folds) {
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(5)
    }
  })

  test("fold sizes are balanced (±1 when not evenly divisible)", () => {
    const labels = Array.from({ length: 103 }, () => "x")
    const folds = kfoldAssign(labels, { k: 5, seed: 42 })
    const sizes = [0, 0, 0, 0, 0]
    for (const f of folds) sizes[f]!++
    for (const s of sizes) {
      expect(s).toBeGreaterThanOrEqual(20)
      expect(s).toBeLessThanOrEqual(21)
    }
  })

  test("same seed produces same assignment", () => {
    const labels = Array.from({ length: 50 }, (_, i) => String(i % 2))
    const a = kfoldAssign(labels, { k: 5, seed: 7 })
    const b = kfoldAssign(labels, { k: 5, seed: 7 })
    expect(a).toEqual(b)
  })

  test("different seeds produce different assignments", () => {
    const labels = Array.from({ length: 50 }, (_, i) => String(i % 2))
    const a = kfoldAssign(labels, { k: 5, seed: 1 })
    const b = kfoldAssign(labels, { k: 5, seed: 2 })
    expect(a).not.toEqual(b)
  })

  test("rejects k < 2", () => {
    expect(() => kfoldAssign(["a", "b"], { k: 1 })).toThrow()
  })

  test("rejects k > N", () => {
    expect(() => kfoldAssign(["a", "b"], { k: 5 })).toThrow()
  })
})

describe("kfoldAssign (stratified)", () => {
  test("preserves class proportions within each fold (±1)", () => {
    // 80% class a, 20% class b
    const labels = [
      ...Array(80).fill("a"),
      ...Array(20).fill("b"),
    ]
    const folds = kfoldAssign(labels, { k: 5, seed: 42, stratify: true })
    for (let f = 0; f < 5; f++) {
      const aCount = labels.filter((l, i) => folds[i] === f && l === "a").length
      const bCount = labels.filter((l, i) => folds[i] === f && l === "b").length
      // 80/5=16 a, 20/5=4 b — allow ±1
      expect(Math.abs(aCount - 16)).toBeLessThanOrEqual(1)
      expect(Math.abs(bCount - 4)).toBeLessThanOrEqual(1)
    }
  })

  test("every class appears in every fold (when per-class count ≥ k)", () => {
    const labels = [
      ...Array(15).fill("a"),
      ...Array(15).fill("b"),
      ...Array(15).fill("c"),
    ]
    const folds = kfoldAssign(labels, { k: 3, seed: 42, stratify: true })
    for (let f = 0; f < 3; f++) {
      const classesInFold = new Set(labels.filter((_, i) => folds[i] === f))
      expect(classesInFold.size).toBe(3)
    }
  })
})

describe("kfoldSplits", () => {
  test("test folds are disjoint and cover all samples exactly once", () => {
    const sampleIds = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const labels = sampleIds.map((_, i) => String(i % 2))
    const splits = kfoldSplits(sampleIds, labels, { k: 5, seed: 42 })
    expect(splits.length).toBe(5)
    const allTest = splits.flatMap((s) => s.testIds).sort((a, b) => a - b)
    expect(allTest).toEqual([...sampleIds].sort((a, b) => a - b))
  })

  test("trainIds + testIds cover the full sample set in each fold", () => {
    const sampleIds = Array.from({ length: 25 }, (_, i) => i + 1)
    const labels = sampleIds.map((_, i) => String(i % 3))
    const splits = kfoldSplits(sampleIds, labels, { k: 5, seed: 42 })
    for (const s of splits) {
      expect(s.trainIds.length + s.testIds.length).toBe(sampleIds.length)
      const combined = new Set([...s.trainIds, ...s.testIds])
      expect(combined.size).toBe(sampleIds.length)
    }
  })

  test("no sample appears in both train and test of the same fold", () => {
    const sampleIds = Array.from({ length: 20 }, (_, i) => i + 1)
    const labels = sampleIds.map((_, i) => String(i % 2))
    const splits = kfoldSplits(sampleIds, labels, { k: 4, seed: 42 })
    for (const s of splits) {
      const trainSet = new Set(s.trainIds)
      for (const t of s.testIds) {
        expect(trainSet.has(t)).toBe(false)
      }
    }
  })
})
