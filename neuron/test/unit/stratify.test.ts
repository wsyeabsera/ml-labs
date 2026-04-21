import { describe, test, expect } from "bun:test"
import { assignSplits } from "../../src/tools/load_csv"

function rowsWithLabels(labels: string[]): { label: string; features: number[] }[] {
  return labels.map((label, i) => ({ label, features: [i] }))
}

describe("assignSplits", () => {
  test("testSize=0 means every sample is train", () => {
    const rows = rowsWithLabels(["a", "b", "c", "a"])
    const splits = assignSplits(rows, "classification", 0, 42)
    expect(splits).toEqual(["train", "train", "train", "train"])
  })

  test("stratified classification preserves per-class ratio within ±1", () => {
    // 80 "a" + 20 "b", test_size=0.2 → 16 "a" test, 4 "b" test
    const rows = rowsWithLabels([
      ...Array(80).fill("a"),
      ...Array(20).fill("b"),
    ])
    const splits = assignSplits(rows, "classification", 0.2, 42, true)
    const aTestCount = splits.filter((s, i) => s === "test" && rows[i]!.label === "a").length
    const bTestCount = splits.filter((s, i) => s === "test" && rows[i]!.label === "b").length
    expect(Math.abs(aTestCount - 16)).toBeLessThanOrEqual(1)
    expect(Math.abs(bTestCount - 4)).toBeLessThanOrEqual(1)
  })

  test("stratify=false with classification does random split (both classes may be missing from test)", () => {
    // With seed=42 on 100 samples (1% "b"), a random 20% split on "b" could miss it.
    const rows = rowsWithLabels([...Array(99).fill("a"), "b"])
    const splits = assignSplits(rows, "classification", 0.2, 42, false)
    const testCount = splits.filter((s) => s === "test").length
    expect(Math.abs(testCount - 20)).toBeLessThanOrEqual(2)
  })

  test("stratify=true with classification guarantees every class has at least 1 in test", () => {
    const rows = rowsWithLabels([...Array(99).fill("a"), "b"])
    const splits = assignSplits(rows, "classification", 0.2, 42, true)
    const bIsInTest = splits.some((s, i) => s === "test" && rows[i]!.label === "b")
    expect(bIsInTest).toBe(true)
  })

  test("regression uses random split regardless of stratify hint", () => {
    // For regression, labels are unique target values — stratification makes no sense.
    const rows = Array.from({ length: 50 }, (_, i) => ({ label: String(i * 1.1), features: [i] }))
    const splits = assignSplits(rows, "regression", 0.2, 42)
    const testCount = splits.filter((s) => s === "test").length
    expect(testCount).toBe(10)
  })

  test("same seed produces identical split", () => {
    const rows = rowsWithLabels([...Array(50).fill("a"), ...Array(50).fill("b")])
    const a = assignSplits(rows, "classification", 0.2, 123, true)
    const b = assignSplits(rows, "classification", 0.2, 123, true)
    expect(a).toEqual(b)
  })

  test("different seeds produce different splits", () => {
    const rows = rowsWithLabels([...Array(50).fill("a"), ...Array(50).fill("b")])
    const a = assignSplits(rows, "classification", 0.2, 1, true)
    const b = assignSplits(rows, "classification", 0.2, 2, true)
    expect(a).not.toEqual(b)
  })
})
