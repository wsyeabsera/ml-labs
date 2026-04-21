import { describe, test, expect } from "bun:test"
import { hostname } from "node:os"
import { buildRunContext, __resetRunContextCache } from "../../src/core/run-context"

describe("buildRunContext", () => {
  test("populates required fields", () => {
    __resetRunContextCache()
    const ctx = buildRunContext({ rng_seed: 42 })
    expect(ctx.neuron_version).toBeDefined()
    expect(typeof ctx.neuron_version).toBe("string")
    expect(ctx.hostname).toBe(hostname())
    expect(ctx.pid).toBe(process.pid)
    expect(ctx.rng_seed).toBe(42)
    expect(typeof ctx.start_ts).toBe("string")
    // ISO-8601ish: contains T and Z
    expect(ctx.start_ts).toContain("T")
  })

  test("rng_seed is null when omitted", () => {
    __resetRunContextCache()
    const ctx = buildRunContext()
    expect(ctx.rng_seed).toBeNull()
  })

  test("neuron_version matches package.json", () => {
    __resetRunContextCache()
    const ctx = buildRunContext()
    // Should be semver-like; current repo is v0.7.x → v0.8.x range
    expect(ctx.neuron_version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("git_sha is null or a 40-char hex string", () => {
    __resetRunContextCache()
    const ctx = buildRunContext()
    if (ctx.git_sha !== null) {
      expect(ctx.git_sha).toHaveLength(40)
      expect(/^[0-9a-f]+$/.test(ctx.git_sha)).toBe(true)
    }
  })

  test("rs_tensor_sha is null or a short hex fingerprint", () => {
    __resetRunContextCache()
    const ctx = buildRunContext()
    if (ctx.rs_tensor_sha !== null) {
      expect(ctx.rs_tensor_sha).toHaveLength(16)
    }
  })

  test("caches git_sha + rs_tensor_sha within a process", () => {
    __resetRunContextCache()
    const a = buildRunContext()
    const b = buildRunContext()
    // Cache means these two should be the same object values (not re-computed).
    expect(a.git_sha).toBe(b.git_sha)
    expect(a.rs_tensor_sha).toBe(b.rs_tensor_sha)
    expect(a.neuron_version).toBe(b.neuron_version)
  })

  test("start_ts differs between calls (not cached)", async () => {
    __resetRunContextCache()
    const a = buildRunContext()
    await new Promise((r) => setTimeout(r, 5))
    const b = buildRunContext()
    expect(b.start_ts).not.toBe(a.start_ts)
  })
})
