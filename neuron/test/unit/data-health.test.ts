/**
 * computeDataHealth requires the DB, so lives separate from the pure-helper
 * signals tests. Uses the same per-worker temp DB set up by setup.ts.
 */
import { describe, test, expect } from "bun:test"
import { createTask } from "../../src/core/db/tasks"
import { insertSamplesBatch } from "../../src/core/db/samples"
import { computeDataHealth } from "../../src/core/auto/signals"

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

describe("computeDataHealth", () => {
  test("classification: reports K = number of distinct labels", () => {
    const id = makeId("cls-basic")
    createTask({
      id, kind: "classification",
      labels: null, featureShape: [4], sampleShape: [4], normalize: false, featureNames: null,
    })
    insertSamplesBatch([
      { taskId: id, label: "a", features: [1, 2, 3, 4] },
      { taskId: id, label: "b", features: [5, 6, 7, 8] },
      { taskId: id, label: "a", features: [2, 3, 4, 5] },
      { taskId: id, label: "c", features: [9, 8, 7, 6] },
    ])
    const h = computeDataHealth(id)
    expect(h.n).toBe(4)
    expect(h.k).toBe(3)
    expect(h.d).toBe(4)
    expect(h.class_distribution).toEqual({ a: 2, b: 1, c: 1 })
  })

  test("regression: K is forced to 1 regardless of unique target values", () => {
    // This is the bug caught by the Phase 1 benchmark: housing.csv has ~70
    // unique prices. Previously K was computed as 70, causing auto_train to
    // build a [D, 32, 70] head for a single-output regression task — wildly
    // oversized, slow, and wrong.
    const id = makeId("reg-bug")
    createTask({
      id, kind: "regression",
      labels: null, featureShape: [3], sampleShape: [3], normalize: false, featureNames: null,
    })
    insertSamplesBatch(
      Array.from({ length: 50 }, (_, i) => ({
        taskId: id,
        label: String(100000 + i * 1000), // 50 unique target values
        features: [i, i + 1, i + 2],
      })),
    )
    const h = computeDataHealth(id)
    expect(h.k).toBe(1)
    expect(h.class_distribution).toBeNull()
    expect(h.imbalance_ratio).toBeNull() // imbalance is classification-only
  })

  test("reports imbalance ratio > 3 as a warning for classification", () => {
    const id = makeId("cls-imb")
    createTask({
      id, kind: "classification",
      labels: null, featureShape: [2], sampleShape: [2], normalize: false, featureNames: null,
    })
    insertSamplesBatch([
      ...Array.from({ length: 100 }, (_, i) => ({ taskId: id, label: "majority", features: [i, i * 2] })),
      ...Array.from({ length: 10 },  (_, i) => ({ taskId: id, label: "minority", features: [i, i * 3] })),
    ])
    const h = computeDataHealth(id)
    expect(h.imbalance_ratio).toBe(10)
    expect(h.warnings.some((w) => w.includes("imbalance"))).toBe(true)
  })

  test("no imbalance warning for regression even when labels are heavily duplicated", () => {
    const id = makeId("reg-imb")
    createTask({
      id, kind: "regression",
      labels: null, featureShape: [1], sampleShape: [1], normalize: false, featureNames: null,
    })
    insertSamplesBatch([
      ...Array.from({ length: 100 }, (_, i) => ({ taskId: id, label: "1.5", features: [i] })),
      ...Array.from({ length: 5 },   (_, i) => ({ taskId: id, label: "2.0", features: [i] })),
    ])
    const h = computeDataHealth(id)
    expect(h.imbalance_ratio).toBeNull()
    expect(h.warnings.some((w) => w.includes("imbalance"))).toBe(false)
  })

  test("flags low sample count", () => {
    const id = makeId("low-n")
    createTask({
      id, kind: "classification",
      labels: null, featureShape: [2], sampleShape: [2], normalize: false, featureNames: null,
    })
    insertSamplesBatch([
      { taskId: id, label: "a", features: [1, 2] },
      { taskId: id, label: "b", features: [3, 4] },
    ])
    const h = computeDataHealth(id)
    expect(h.warnings.some((w) => w.includes("low sample count"))).toBe(true)
  })
})
