#!/usr/bin/env bun
// Phase 2 end-to-end verification: data loaders + get_run_status + list_tasks

import { spawn } from "bun"
import { resolve } from "node:path"
import { writeFileSync } from "node:fs"

const server = spawn({
  cmd: ["bun", "run", "/Users/yab/Projects/ml-agent/neuron/src/server.ts"],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  cwd: "/Users/yab/Projects/ml-agent",
})

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
          const errReply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }) + "\n"
          server.stdin.write(errReply)
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

const FIXTURES = resolve(import.meta.dir, "fixtures")

async function main() {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e-phase2", version: "1.0" } })
  console.log("Initialized\n")

  // 1. list_tasks (new tool)
  ok("list_tasks", await call("list_tasks", {}))

  // 2. Create iris task
  try { await call("reset_task", { task_id: "iris", confirm: true, delete_task: true }) } catch { /* ok */ }
  ok("create_task iris", await call("create_task", {
    id: "iris",
    kind: "classification",
    feature_shape: [4],
    sample_shape: [4],
  }))

  // 3. load_csv
  const csvPath = resolve(FIXTURES, "iris.csv")
  ok("load_csv", await call("load_csv", {
    task_id: "iris",
    path: csvPath,
    label_column: "species",
    feature_columns: ["sepal_length", "sepal_width", "petal_length", "petal_width"],
  }))

  // 4. list_samples to confirm
  ok("list_samples after csv", await call("list_samples", { task_id: "iris" }))

  // 5. load_json
  const jsonPath = resolve(FIXTURES, "xor.json")
  writeFileSync(jsonPath, JSON.stringify([
    { features: [0, 0], label: "0" },
    { features: [0, 1], label: "1" },
    { features: [1, 0], label: "1" },
    { features: [1, 1], label: "0" },
  ]))
  try { await call("reset_task", { task_id: "json-test", confirm: true, delete_task: true }) } catch { /* ok */ }
  await call("create_task", { id: "json-test", kind: "classification", feature_shape: [2] })
  ok("load_json", await call("load_json", { task_id: "json-test", path: jsonPath }))

  // 6. Train iris + poll get_run_status
  console.log("\nTraining iris (this takes ~5s)…")
  const trainPromise = call("train", { task_id: "iris", lr: 0.05, epochs: 1000, head_arch: [4, 32, 3] })

  // Poll status a few times while training
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try {
      const latestRuns = await call("list_runs", { task_id: "iris", limit: 1 }) as { content?: Array<{ text?: string }> }
      const runsText = latestRuns?.content?.[0]?.text ?? "{}"
      const { runs } = JSON.parse(runsText) as { runs: Array<{ id: number }> }
      if (runs[0]) {
        const statusResult = await call("get_run_status", { run_id: runs[0].id })
        const statusText = (statusResult as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "{}"
        const st = JSON.parse(statusText)
        console.log(`  Status poll: ${st.status} | ${st.stage ?? "—"} | ${st.message}`)
      }
    } catch { /* training may not have started yet */ }
  }

  const trainResult = ok("train iris", await trainPromise) as { run_id?: number; accuracy?: number }
  console.log(`\nIris accuracy: ${((trainResult?.accuracy ?? 0) * 100).toFixed(1)}%`)

  // 7. get_run_status for completed run
  if (trainResult?.run_id) {
    ok("get_run_status (completed)", await call("get_run_status", { run_id: trainResult.run_id }))
  }

  // 8. list_tasks shows both tasks
  ok("list_tasks final", await call("list_tasks", {}))

  console.log("\n\nPhase 2 verification complete.")
  server.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error("FAIL:", e)
  server.kill()
  process.exit(1)
})
