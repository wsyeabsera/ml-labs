import { describe, test, expect } from "bun:test"
import { sha256Hex, datasetHash } from "../../src/util/hash"

describe("sha256Hex", () => {
  test("hex output is 64 chars", () => {
    const h = sha256Hex("anything")
    expect(h).toHaveLength(64)
    expect(/^[0-9a-f]+$/.test(h)).toBe(true)
  })

  test("known vector matches OpenSSL", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("different inputs produce different hashes", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"))
  })
})

describe("datasetHash", () => {
  const samples = [
    { id: 3, label: "a", features: [1.0, 2.0] },
    { id: 1, label: "b", features: [3.0, 4.0] },
    { id: 2, label: "a", features: [5.0, 6.0] },
  ]

  test("order-invariant — same samples in different orders hash identically", () => {
    const h1 = datasetHash(samples)
    const h2 = datasetHash([samples[2]!, samples[0]!, samples[1]!])
    expect(h1).toBe(h2)
  })

  test("changing a feature changes the hash", () => {
    const original = datasetHash(samples)
    const mutated = datasetHash([
      samples[0]!,
      samples[1]!,
      { ...samples[2]!, features: [5.0, 6.01] }, // tiny perturbation
    ])
    expect(original).not.toBe(mutated)
  })

  test("changing a label changes the hash", () => {
    const original = datasetHash(samples)
    const mutated = datasetHash([
      { ...samples[0]!, label: "c" },
      samples[1]!,
      samples[2]!,
    ])
    expect(original).not.toBe(mutated)
  })

  test("changing an id changes the hash (id is part of the canonical string)", () => {
    const original = datasetHash(samples)
    const mutated = datasetHash([
      { ...samples[0]!, id: 999 },
      samples[1]!,
      samples[2]!,
    ])
    expect(original).not.toBe(mutated)
  })

  test("empty dataset is a valid hash (of nothing) — stable", () => {
    const h = datasetHash([])
    expect(h).toHaveLength(64)
    expect(datasetHash([])).toBe(h)
  })
})
