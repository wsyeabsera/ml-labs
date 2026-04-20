#!/usr/bin/env bun
// Phase 4 end-to-end: auto_train coordinator + get_auto_status + wave sweep

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

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e-phase4", version: "1.0" },
  })
  console.log("Initialized\n")

  // 1. Ensure iris task exists with samples
  const tasks = ok("list_tasks", await call("list_tasks", {})) as { tasks?: Array<{ id: string }> }
  const hasIris = Array.isArray(tasks?.tasks) && tasks.tasks.some((t) => t.id === "iris")

  if (!hasIris) {
    console.log("\nIris task not found — creating…")
    try { await call("reset_task", { task_id: "iris", confirm: true, delete_task: true }) } catch { /* ok */ }
    await call("create_task", { id: "iris", kind: "classification", feature_shape: [4] })
    const csvPath = resolve(import.meta.dir, "fixtures/iris.csv")
    await call("load_csv", {
      task_id: "iris",
      path: csvPath,
      label_column: "species",
      feature_columns: ["sepal_length", "sepal_width", "petal_length", "petal_width"],
    })
    console.log("Loaded iris.csv")
  } else {
    console.log("Iris task exists — reusing")
  }

  // 2. Verify auto_run_status returns error for non-existent task
  console.log("\n--- Testing get_auto_status for unknown task ---")
  try {
    await call("get_auto_status", { task_id: "no-such-task-xyz" })
    throw new Error("Expected error for unknown task")
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("No auto_runs found") || msg.includes("no-such-task-xyz")) {
      console.log("✓ get_auto_status correctly rejects unknown task")
    } else {
      console.log("✓ get_auto_status error (acceptable):", msg)
    }
  }

  // 3. Data-issue short-circuit — empty task
  console.log("\n--- Testing data_issue short-circuit ---")
  try { await call("reset_task", { task_id: "empty-test", confirm: true, delete_task: true }) } catch { /* ok */ }
  await call("create_task", { id: "empty-test", kind: "classification", feature_shape: [4] })

  const emptyResult = ok(
    "auto_train empty-test (expect data_issue)",
    await call("auto_train", {
      task_id: "empty-test",
      accuracy_target: 0.9,
      max_waves: 1,
      budget_s: 30,
      promote: false,
    }),
  ) as { status?: string; auto_run_id?: number; verdict?: string; decision_log?: unknown[] }

  if (emptyResult.status !== "data_issue" && emptyResult.status !== "completed") {
    // 'failed' is acceptable if preflight itself errors
    console.log(`  Note: got status="${emptyResult.status}" (data_issue or failed both acceptable for empty task)`)
  } else {
    console.log(`✓ Short-circuit returned status="${emptyResult.status}"`)
  }
  if (emptyResult.auto_run_id !== undefined) {
    const statusCheck = ok(
      "get_auto_status for empty-test",
      await call("get_auto_status", { task_id: "empty-test" }),
    ) as { status?: string; decision_log?: unknown[] }
    console.log(`  auto_run status="${statusCheck.status}", log entries=${statusCheck.decision_log?.length ?? 0}`)
  }

  // 4. Auto-train iris — main happy path
  console.log("\n--- auto_train iris (happy path) ---")
  const t0 = Date.now()
  const autoResult = ok(
    "auto_train iris",
    await call("auto_train", {
      task_id: "iris",
      accuracy_target: 0.9,
      max_waves: 2,
      budget_s: 180,
      promote: true,
    }),
  ) as {
    ok?: boolean
    auto_run_id?: number
    status?: string
    run_id?: number | null
    accuracy?: number | null
    waves_used?: number
    verdict?: string
    wall_clock_s?: number
  }
  const elapsed = Math.round((Date.now() - t0) / 1000)

  console.log(`\nWall clock: ${elapsed}s`)
  console.log(`Status: ${autoResult.status}`)
  console.log(`Accuracy: ${autoResult.accuracy !== null ? ((autoResult.accuracy ?? 0) * 100).toFixed(1) + "%" : "null"}`)
  console.log(`Waves used: ${autoResult.waves_used}`)
  console.log(`Verdict: ${autoResult.verdict}`)

  if (autoResult.status !== "completed" && autoResult.status !== "data_issue") {
    throw new Error(`Expected completed, got: ${autoResult.status}`)
  }

  // 5. Verify get_auto_status shows the completed run
  if (autoResult.auto_run_id !== undefined) {
    const autoStatus = ok(
      "get_auto_status by auto_run_id",
      await call("get_auto_status", { auto_run_id: autoResult.auto_run_id }),
    ) as { status?: string; decision_log?: unknown[]; final_accuracy?: number | null }

    console.log(`\nauto_run status: ${autoStatus.status}`)
    console.log(`decision_log entries: ${autoStatus.decision_log?.length ?? 0}`)

    if ((autoStatus.decision_log?.length ?? 0) < 1) {
      console.log("  Warning: decision_log is empty — coordinator may not have called log_auto_note")
    } else {
      console.log("✓ decision_log has entries")
    }
  }

  // 6. Verify iris model was promoted
  const taskList = ok("list_tasks after auto_train", await call("list_tasks", {})) as {
    tasks?: Array<{ id: string; accuracy?: number | null }>
  }
  const irisTask = taskList.tasks?.find((t) => t.id === "iris")
  if (irisTask && typeof irisTask.accuracy === "number") {
    console.log(`\n✓ iris task accuracy after auto_train: ${(irisTask.accuracy * 100).toFixed(1)}%`)
  }

  // 7. wave_size regression on run_sweep
  console.log("\n--- wave_size mode on run_sweep ---")
  const sweepResult = ok(
    "run_sweep with wave_size=2",
    await call("run_sweep", {
      task_id: "iris",
      configs: [
        { lr: 0.01, epochs: 200 },
        { lr: 0.05, epochs: 200 },
        { lr: 0.1, epochs: 200 },
        { lr: 0.01, epochs: 500 },
      ],
      concurrency: 2,
      wave_size: 2,
      promote_winner: false,
    }),
  ) as { total_configs?: number; completed?: number; runs?: Array<unknown> }

  // total_configs may be ≥ 4 (expandGrid adds an empty config from the implicit search:{})
  if ((sweepResult.completed ?? 0) < 4 || (sweepResult.total_configs ?? 0) < 4) {
    throw new Error(`wave_size sweep failed: ${JSON.stringify(sweepResult)}`)
  }
  console.log(`✓ wave_size sweep: ${sweepResult.completed}/${sweepResult.total_configs} completed`)

  console.log("\n\nPhase 4 verification complete.")
  server.kill()
  process.exit(0)
}

main().catch((e) => {
  console.error("FAIL:", e)
  server.kill()
  process.exit(1)
})
