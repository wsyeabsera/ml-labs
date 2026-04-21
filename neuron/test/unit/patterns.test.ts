import { describe, test, expect } from "bun:test"
import {
  taskFingerprint,
  sizeBucket,
  imbalanceBucket,
  savePattern,
  lookupBestPattern,
} from "../../src/core/auto/patterns"
import type { DataHealth } from "../../src/core/auto/signals"

function data(overrides: Partial<DataHealth> = {}): DataHealth {
  return {
    n: 150,
    k: 3,
    d: 4,
    imbalance_ratio: 1.0,
    class_distribution: { a: 50, b: 50, c: 50 },
    warnings: [],
    has_val_split: true,
    ...overrides,
  }
}

describe("sizeBucket", () => {
  test.each([
    [10, "xs"],
    [49, "xs"],
    [50, "s"],
    [199, "s"],
    [200, "m"],
    [999, "m"],
    [1000, "l"],
    [100000, "l"],
  ])("n=%d → %s", (n, expected) => {
    expect(sizeBucket(n)).toBe(expected)
  })
})

describe("imbalanceBucket", () => {
  test("null → bal", () => {
    expect(imbalanceBucket(null)).toBe("bal")
  })
  test("ratio < 2 → bal", () => {
    expect(imbalanceBucket(1.5)).toBe("bal")
  })
  test("ratio in [2, 5) → mild", () => {
    expect(imbalanceBucket(3)).toBe("mild")
    expect(imbalanceBucket(4.99)).toBe("mild")
  })
  test("ratio ≥ 5 → severe", () => {
    expect(imbalanceBucket(5)).toBe("severe")
    expect(imbalanceBucket(20)).toBe("severe")
  })
})

describe("taskFingerprint", () => {
  test("deterministic: same DataHealth → same fingerprint", () => {
    const d = data()
    expect(taskFingerprint("classification", d)).toBe(taskFingerprint("classification", d))
  })

  test("different kind → different fingerprint", () => {
    expect(taskFingerprint("classification", data()))
      .not.toBe(taskFingerprint("regression", data()))
  })

  test("different K → different fingerprint", () => {
    expect(taskFingerprint("classification", data({ k: 3 })))
      .not.toBe(taskFingerprint("classification", data({ k: 5 })))
  })

  test("different size bucket → different fingerprint", () => {
    expect(taskFingerprint("classification", data({ n: 100 })))
      .not.toBe(taskFingerprint("classification", data({ n: 5000 })))
  })

  test("different imbalance bucket → different fingerprint", () => {
    expect(taskFingerprint("classification", data({ imbalance_ratio: 1.0 })))
      .not.toBe(taskFingerprint("classification", data({ imbalance_ratio: 10.0 })))
  })

  test("within the same bucket, small changes don't affect fingerprint", () => {
    // Both in size bucket "s" (50–199)
    expect(taskFingerprint("classification", data({ n: 60 })))
      .toBe(taskFingerprint("classification", data({ n: 180 })))
  })

  test("format: kind|kN|dBucket|sizeBucket|imbalanceBucket", () => {
    const fp = taskFingerprint("classification", data({ n: 150, k: 3, d: 4, imbalance_ratio: 1 }))
    expect(fp).toBe("classification|k3|d_xs|s|bal")
  })
})

describe("savePattern + lookupBestPattern", () => {
  const testFp = `test-fingerprint-${Date.now()}`

  test("round-trip: save then lookup returns the saved pattern", () => {
    savePattern({
      task_fingerprint: testFp,
      task_id: "round-trip-task",
      data: data(),
      best_config: { lr: 0.005, epochs: 500 },
      best_metric: 0.92,
      metric_name: "accuracy",
    })

    const p = lookupBestPattern(testFp)
    expect(p).not.toBeNull()
    expect(p!.task_id).toBe("round-trip-task")
    expect(p!.best_metric).toBe(0.92)
    expect(p!.best_config).toEqual({ lr: 0.005, epochs: 500 })
    expect(p!.metric_name).toBe("accuracy")
  })

  test("returns highest-metric pattern when multiple exist for same fingerprint", () => {
    const fp = `test-fingerprint-multi-${Date.now()}`
    savePattern({
      task_fingerprint: fp,
      task_id: "t-low",
      data: data(),
      best_config: { lr: 0.01, epochs: 200 },
      best_metric: 0.7,
      metric_name: "accuracy",
    })
    savePattern({
      task_fingerprint: fp,
      task_id: "t-high",
      data: data(),
      best_config: { lr: 0.003, epochs: 800 },
      best_metric: 0.95,
      metric_name: "accuracy",
    })
    savePattern({
      task_fingerprint: fp,
      task_id: "t-mid",
      data: data(),
      best_config: { lr: 0.005, epochs: 500 },
      best_metric: 0.85,
      metric_name: "accuracy",
    })

    const p = lookupBestPattern(fp)
    expect(p!.task_id).toBe("t-high")
    expect(p!.best_metric).toBe(0.95)
  })

  test("returns null for unknown fingerprint", () => {
    expect(lookupBestPattern("does-not-exist-anywhere")).toBeNull()
  })

  test("dataset_shape is persisted and parsed correctly", () => {
    const fp = `test-ds-shape-${Date.now()}`
    savePattern({
      task_fingerprint: fp,
      task_id: "shape-task",
      data: data({ n: 777, k: 5, d: 42, imbalance_ratio: 3.5 }),
      best_config: { lr: 0.005, epochs: 400 },
      best_metric: 0.88,
      metric_name: "accuracy",
    })
    const p = lookupBestPattern(fp)!
    expect(p.dataset_shape.n).toBe(777)
    expect(p.dataset_shape.k).toBe(5)
    expect(p.dataset_shape.d).toBe(42)
    expect(p.dataset_shape.imbalance_bucket).toBe("mild")
    expect(p.dataset_shape.size_bucket).toBe("m")
  })
})
