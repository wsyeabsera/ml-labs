#!/usr/bin/env bun
// End-to-end Phase 1 verification for Neuron MCP

import { spawn } from "bun"
import { resolve } from "node:path"

const server = spawn({
  cmd: ["bun", "run", resolve(import.meta.dir, "../src/server.ts")],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  cwd: resolve(import.meta.dir, "../.."),
})

let id = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
let buf = ""

// Read stdout line by line
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
          // Server-initiated request (e.g. sampling/createMessage) — respond with "not supported"
          const errReply = JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32601, message: "Method not found" },
          }) + "\n"
          server.stdin.write(errReply)
        } else if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id)!
          pending.delete(msg.id)
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else resolve(msg.result)
        }
      } catch { /* notification or parse error, ignore */ }
    }
  }
})()

async function send(method: string, params: unknown): Promise<unknown> {
  const reqId = ++id
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject })
    const msg = JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params }) + "\n"
    server.stdin.write(msg)
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

async function main() {
  // Initialize
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e-test", version: "1.0" },
  })
  console.log("Initialized neuron MCP\n")

  // 1. Reset xor-demo if exists
  try {
    await call("reset_task", { task_id: "xor-demo", confirm: true, delete_task: true })
    console.log("Reset existing xor-demo")
  } catch { /* may not exist */ }

  // 2. Create task
  ok("create_task", await call("create_task", {
    id: "xor-demo",
    kind: "classification",
    labels: ["0", "1"],
    feature_shape: [2],
    sample_shape: [2],
  }))

  // 3. Collect XOR samples (9 copies of each pattern = 36 samples)
  const xorData = [
    { features: [0, 0], label: "0" },
    { features: [0, 1], label: "1" },
    { features: [1, 0], label: "1" },
    { features: [1, 1], label: "0" },
  ]
  let collected = 0
  for (const pattern of xorData) {
    for (let i = 0; i < 9; i++) {
      await call("collect", { task_id: "xor-demo", ...pattern })
      collected++
    }
  }
  console.log(`\n✓ collect — ${collected} samples added`)

  // 4. List samples
  ok("list_samples", await call("list_samples", { task_id: "xor-demo" }))

  // 5. Preflight check (heuristic fallback expected)
  ok("preflight_check", await call("preflight_check", { task_id: "xor-demo" }))

  // 6. Suggest hyperparams (heuristic fallback expected)
  ok("suggest_hyperparams", await call("suggest_hyperparams", { task_id: "xor-demo" }))

  // 7. Train
  console.log("\nTraining (this takes ~5s)...")
  const trainResult = ok("train", await call("train", {
    task_id: "xor-demo",
    lr: 0.05,
    epochs: 1000,
    head_arch: [2, 16, 2],
  })) as { run_id?: number; accuracy?: number }

  const runId = trainResult?.run_id
  if (!runId) throw new Error("No run_id in train result")

  // 8. Evaluate
  ok("evaluate", await call("evaluate", { run_id: runId }))

  // 9. Predict all 4 XOR inputs
  for (const [a, b] of [[0,0],[0,1],[1,0],[1,1]]) {
    ok(`predict [${a},${b}]`, await call("predict", {
      task_id: "xor-demo",
      features: [a, b],
    }))
  }

  // 10. Diagnose
  ok("diagnose", await call("diagnose", { run_id: runId }))

  // 11. List runs
  ok("list_runs", await call("list_runs", { task_id: "xor-demo" }))

  // 12. Export model
  ok("export_model", await call("export_model", { task_id: "xor-demo" }))

  console.log("\n\nPhase 1 verification complete.")
  server.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error("FAIL:", e)
  server.kill()
  process.exit(1)
})
