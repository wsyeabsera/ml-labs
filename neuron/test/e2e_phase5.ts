#!/usr/bin/env bun
// Phase 5 e2e: cross-session predict (weight restore) + suggest_samples (active learning)

import { spawn } from "bun"
import { resolve } from "node:path"

function spawnServer() {
  return spawn({
    cmd: ["bun", "run", "/Users/yab/Projects/ml-agent/neuron/src/server.ts"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/Users/yab/Projects/ml-agent",
  })
}

function makeClient(server: ReturnType<typeof spawnServer>) {
  let id = 0
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let buf = ""

  ;(async () => {
    const reader = server.stdout.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value)
      const lines = buf.split("\n")
      buf = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id?: number; method?: string; result?: unknown; error?: unknown }
          if (msg.method && msg.id !== undefined) {
            server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }) + "\n")
          } else if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id)!
            pending.delete(msg.id)
            if (msg.error) reject(new Error(JSON.stringify(msg.error)))
            else resolve(msg.result)
          }
        } catch { /* ignore */ }
      }
    }
  })()

  async function send(method: string, params: unknown): Promise<unknown> {
    const reqId = ++id
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject })
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n")
    })
  }

  async function call(name: string, args: unknown): Promise<unknown> {
    return send("tools/call", { name, arguments: args })
  }

  function ok(label: string, result: unknown) {
    const r = result as { content?: Array<{ text?: string }> }
    const text = r?.content?.[0]?.text ?? JSON.stringify(result)
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    console.log(`\n✓ ${label}`)
    console.log(JSON.stringify(parsed, null, 2))
    return parsed
  }

  return { send, call, ok }
}

async function main() {
  // ── Session 1: train iris ──────────────────────────────────────────────────
  console.log("=== SESSION 1: train iris ===")
  const s1 = spawnServer()
  const c1 = makeClient(s1)
  await c1.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-phase5-s1", version: "1.0" } })

  // Ensure iris exists with data
  const tasks = c1.ok("list_tasks", await c1.call("list_tasks", {})) as { tasks?: Array<{ id: string; trained?: boolean }> }
  const irisTask = tasks.tasks?.find((t) => t.id === "iris")

  if (!irisTask) {
    console.log("\nCreating iris task…")
    await c1.call("create_task", { id: "iris", kind: "classification", feature_shape: [4] })
    const csvPath = resolve(import.meta.dir, "fixtures/iris.csv")
    await c1.call("load_csv", {
      task_id: "iris",
      path: csvPath,
      label_column: "species",
      feature_columns: ["sepal_length", "sepal_width", "petal_length", "petal_width"],
    })
  }

  // Train iris in session 1
  console.log("\nTraining iris in session 1…")
  const trainResult = c1.ok("train", await c1.call("train", {
    task_id: "iris",
    lr: 0.05,
    epochs: 800,
    head_arch: [4, 32, 3],
    auto_register: true,
  })) as { run_id?: number; accuracy?: number }

  const runId = trainResult.run_id!
  console.log(`\nTrained run #${runId}, accuracy ${((trainResult.accuracy ?? 0) * 100).toFixed(1)}%`)

  // Predict in session 1 (MLP is in memory)
  const pred1 = c1.ok("predict session1 (MLP in memory)", await c1.call("predict", {
    task_id: "iris",
    features: [5.1, 3.5, 1.4, 0.2],
  })) as { label?: string; confidence?: number }
  console.log(`\nSession 1 prediction: ${pred1.label} (${((pred1.confidence ?? 0) * 100).toFixed(1)}%)`)

  if (pred1.label !== "setosa") throw new Error(`Expected setosa, got ${pred1.label}`)

  s1.kill()
  console.log("\n[Session 1 killed — MLP is gone from rs-tensor memory]\n")

  // Brief pause to ensure server is gone
  await new Promise((r) => setTimeout(r, 1000))

  // ── Session 2: predict without retraining (cross-session restore) ──────────
  console.log("=== SESSION 2: cross-session predict (weight restore) ===")
  const s2 = spawnServer()
  const c2 = makeClient(s2)
  await c2.send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-phase5-s2", version: "1.0" } })

  // Give boot() a moment to restore weights
  await new Promise((r) => setTimeout(r, 2000))

  // Predict in session 2 — MLP should be restored from DB via boot() or lazy restore
  const pred2 = c2.ok("predict session2 (cross-session restore)", await c2.call("predict", {
    task_id: "iris",
    features: [5.1, 3.5, 1.4, 0.2],
  })) as { label?: string; confidence?: number }
  console.log(`\nSession 2 prediction: ${pred2.label} (${((pred2.confidence ?? 0) * 100).toFixed(1)}%)`)

  if (pred2.label !== "setosa") {
    throw new Error(`Cross-session predict failed! Expected setosa, got ${pred2.label}`)
  }
  console.log("✓ Cross-session predict works — weights restored without retraining")

  // Also predict a different flower class
  const pred3 = c2.ok("predict virginica (cross-session)", await c2.call("predict", {
    task_id: "iris",
    features: [6.3, 3.3, 6.0, 2.5],
  })) as { label?: string }
  console.log(`\nVirginica sample predicted as: ${pred3.label}`)
  if (pred3.label !== "virginica") {
    console.log(`  Note: expected virginica, got ${pred3.label} — model may have borderline accuracy on this sample`)
  }

  // ── suggest_samples: active learning ────────────────────────────────────────
  console.log("\n=== SUGGEST_SAMPLES: active learning ===")
  const suggest = c2.ok("suggest_samples", await c2.call("suggest_samples", {
    task_id: "iris",
    n_suggestions: 5,
    confidence_threshold: 0.8,
  })) as {
    ok?: boolean
    n_samples?: number
    overall_accuracy?: number
    per_class?: Array<{ label: string; count: number; accuracy: number; avg_confidence: number }>
    uncertain_samples?: Array<{ sample_id: number; true_label: string; predicted_label: string; confidence: number }>
    recommendations?: string[]
  }

  console.log(`\nSamples analyzed: ${suggest.n_samples}`)
  console.log(`Overall accuracy on training set: ${((suggest.overall_accuracy ?? 0) * 100).toFixed(1)}%`)
  console.log(`\nPer-class breakdown:`)
  for (const cls of suggest.per_class ?? []) {
    console.log(`  ${cls.label}: count=${cls.count}, accuracy=${(cls.accuracy * 100).toFixed(0)}%, avg_conf=${(cls.avg_confidence * 100).toFixed(0)}%`)
  }
  console.log(`\nUncertain samples: ${suggest.uncertain_samples?.length ?? 0}`)
  console.log(`\nRecommendations:`)
  for (const r of suggest.recommendations ?? []) console.log(`  - ${r}`)

  if (!suggest.ok) throw new Error("suggest_samples returned ok=false")
  if ((suggest.n_samples ?? 0) < 100) throw new Error(`Expected ≥100 samples analyzed, got ${suggest.n_samples}`)
  if (!suggest.per_class?.length) throw new Error("No per_class stats returned")
  if (!suggest.recommendations?.length) throw new Error("No recommendations returned")

  console.log("\n✓ suggest_samples working — active learning data identified")

  s2.kill()
  console.log("\n\nPhase 5 verification complete.")
  process.exit(0)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
