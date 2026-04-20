/**
 * Neuron HTTP API — serves the ml-labs dashboard on port 2626.
 * Start with: bun src/api.ts
 * Env: NEURON_DB (path to SQLite), DASHBOARD_DIST (path to built React app)
 */
import { join } from "node:path"
import { existsSync } from "node:fs"
import { listTasks } from "./core/db/tasks"
import { getTask } from "./core/db/tasks"
import { listRuns, getRun } from "./core/db/runs"
import { sampleCounts, splitCounts } from "./core/db/samples"
import { countRuns } from "./core/db/runs"
import { getRegisteredModel } from "./core/db/models"
import { getTaskState } from "./core/state"

// Force DB initialization via schema import
import "./core/db/schema"

const PORT = parseInt(process.env.NEURON_API_PORT ?? "2626")
const DIST = process.env.DASHBOARD_DIST ?? join(import.meta.dir, "../../dashboard/dist")
const VERSION = "0.2.1"

// ── CORS ───────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status)
}

// ── Route handlers ─────────────────────────────────────────────────────────────

function handleHealth(): Response {
  const tasks = listTasks()
  return json({
    ok: true,
    version: VERSION,
    dbPath: process.env.NEURON_DB ?? "default",
    taskCount: tasks.length,
  })
}

function handleTasks(): Response {
  const tasks = listTasks()
  const items = tasks.map((t) => {
    const counts = sampleCounts(t.id)
    const splits = splitCounts(t.id)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const runs = listRuns(t.id, 1)
    const lastRun = runs[0] ?? null
    const model = getRegisteredModel(t.id)
    const state = getTaskState(t.id)
    return {
      id: t.id,
      kind: t.kind,
      featureShape: t.featureShape,
      featureNames: t.featureNames,
      labels: t.labels,
      normalize: t.normalize,
      sampleCount: total,
      trainCount: splits.train,
      testCount: splits.test,
      runCount: countRuns(t.id),
      activeRunId: model?.run?.id ?? null,
      lastRunStatus: lastRun?.status ?? null,
      accuracy: state.accuracy,
      createdAt: t.createdAt,
    }
  })
  return json({ tasks: items })
}

function handleTask(id: string): Response {
  const t = getTask(id)
  if (!t) return err(`Task "${id}" not found`, 404)
  const counts = sampleCounts(id)
  const splits = splitCounts(id)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const state = getTaskState(id)
  return json({
    id: t.id, kind: t.kind, featureShape: t.featureShape,
    featureNames: t.featureNames, labels: t.labels, normalize: t.normalize,
    sampleCount: total, trainCount: splits.train, testCount: splits.test,
    runCount: countRuns(id), activeRunId: null,
    lastRunStatus: (listRuns(id, 1)[0]?.status) ?? null,
    accuracy: state.accuracy, createdAt: t.createdAt,
  })
}

function handleRuns(taskId: string): Response {
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)
  const runs = listRuns(taskId, 50).map((r) => ({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    perClassAccuracy: r.perClassAccuracy, confusionMatrix: r.confusionMatrix,
    lossHistory: r.lossHistory, mae: r.mae, rmse: r.rmse, r2: r.r2,
    sampleCounts: r.sampleCounts,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
  }))
  return json({ runs })
}

function handleRun(id: number): Response {
  const r = getRun(id)
  if (!r) return err(`Run ${id} not found`, 404)
  return json({
    id: r.id, taskId: r.taskId, status: r.status, hyperparams: r.hyperparams,
    accuracy: r.accuracy, valAccuracy: r.valAccuracy,
    perClassAccuracy: r.perClassAccuracy, confusionMatrix: r.confusionMatrix,
    lossHistory: r.lossHistory, mae: r.mae, rmse: r.rmse, r2: r.r2,
    sampleCounts: r.sampleCounts, runProgress: r.runProgress,
    startedAt: r.startedAt, finishedAt: r.finishedAt,
    durationS: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
  })
}

async function handleInspect(taskId: string): Promise<Response> {
  // Re-use the inspect_data tool handler logic inline (avoids circular dep)
  const task = getTask(taskId)
  if (!task) return err(`Task "${taskId}" not found`, 404)

  const { getSamplesByTask } = await import("./core/db/samples")
  const samples = getSamplesByTask(taskId)
  if (samples.length === 0) return json({ ok: true, total: 0, message: "No samples loaded yet." })

  const D = samples[0]!.features.length
  const N = samples.length
  const featureNames = task.featureNames ?? Array.from({ length: D }, (_, i) => `feature_${i}`)
  const splits = splitCounts(taskId)
  const counts = sampleCounts(taskId)

  const mins = new Array<number>(D).fill(Infinity)
  const maxs = new Array<number>(D).fill(-Infinity)
  const sums = new Array<number>(D).fill(0)
  const sumSqs = new Array<number>(D).fill(0)
  for (const s of samples) {
    for (let d = 0; d < D; d++) {
      const v = s.features[d] ?? 0
      if (v < mins[d]!) mins[d] = v
      if (v > maxs[d]!) maxs[d] = v
      sums[d]! += v
      sumSqs[d]! += v * v
    }
  }
  const featureStats = featureNames.map((name, d) => {
    const mean = sums[d]! / N
    const std = Math.sqrt(Math.max(0, sumSqs[d]! / N - mean * mean))
    return { name, mean: +mean.toFixed(4), std: +std.toFixed(4), min: +(mins[d]!).toFixed(4), max: +(maxs[d]!).toFixed(4), constant: (maxs[d]! - mins[d]!) < 1e-9 }
  })

  const warnings: string[] = []
  const constantFeatures = featureStats.filter((f) => f.constant).map((f) => f.name)
  if (constantFeatures.length > 0) warnings.push(`Constant features: ${constantFeatures.join(", ")}`)
  const ranges = featureStats.map((f) => f.max - f.min).filter((r) => r > 0)
  if (ranges.length > 1 && Math.max(...ranges) / Math.min(...ranges) > 100) {
    warnings.push(`Feature scales differ by >100x — consider normalize=true`)
  }
  if (task.kind !== "regression") {
    const vals = Object.values(counts)
    if (vals.length > 0) {
      const ratio = Math.max(...vals) / Math.min(...vals)
      if (ratio > 3) warnings.push(`Class imbalance ${ratio.toFixed(1)}x — consider class_weights="balanced"`)
    }
  }

  return json({
    ok: true, task_id: taskId, kind: task.kind, total: N, splits,
    features: { count: D, names: featureNames, stats: featureStats },
    class_distribution: task.kind !== "regression" ? counts : null,
    normalize_enabled: task.normalize,
    warnings,
  })
}

// ── SSE: live run progress ─────────────────────────────────────────────────────

function handleRunEvents(runId: number): Response {
  let closed = false

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder()
      function send(event: string, data: unknown) {
        if (closed) return
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Initial state
      const run = getRun(runId)
      if (!run) {
        send("error", { message: `Run ${runId} not found` })
        ctrl.close()
        return
      }

      send("init", {
        id: run.id, status: run.status,
        hyperparams: run.hyperparams,
        progress: run.runProgress,
      })

      if (run.status !== "running" && run.status !== "pending") {
        send("complete", {
          status: run.status, accuracy: run.accuracy,
          lossHistory: run.lossHistory, perClassAccuracy: run.perClassAccuracy,
          confusionMatrix: run.confusionMatrix, mae: run.mae, rmse: run.rmse, r2: run.r2,
        })
        ctrl.close()
        return
      }

      // Poll until done
      let lastProgress = JSON.stringify(run.runProgress)
      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return }
        const r = getRun(runId)
        if (!r) { clearInterval(interval); ctrl.close(); return }

        const prog = JSON.stringify(r.runProgress)
        if (prog !== lastProgress) {
          lastProgress = prog
          send("progress", r.runProgress)
        }

        if (r.status !== "running" && r.status !== "pending") {
          clearInterval(interval)
          send("complete", {
            status: r.status, accuracy: r.accuracy,
            lossHistory: r.lossHistory, perClassAccuracy: r.perClassAccuracy,
            confusionMatrix: r.confusionMatrix, mae: r.mae, rmse: r.rmse, r2: r.r2,
          })
          if (!closed) ctrl.close()
        }
      }, 500)
    },
    cancel() { closed = true },
  })

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}

// ── Static file server ─────────────────────────────────────────────────────────

async function serveStatic(pathname: string): Promise<Response> {
  if (!existsSync(DIST)) {
    return new Response("Dashboard not built. Run: bun run build (in dashboard/)", { status: 503 })
  }
  const clean = pathname === "/" ? "/index.html" : pathname
  const file = Bun.file(join(DIST, clean))
  if (await file.exists()) return new Response(file)
  // SPA fallback
  return new Response(Bun.file(join(DIST, "index.html")))
}

// ── Router ─────────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS })
    }

    // API routes
    if (path === "/api/health")                 return handleHealth()
    if (path === "/api/tasks" && req.method === "GET") return handleTasks()

    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch && req.method === "GET")       return handleTask(decodeURIComponent(taskMatch[1]!))

    const taskRunsMatch = path.match(/^\/api\/tasks\/([^/]+)\/runs$/)
    if (taskRunsMatch && req.method === "GET")   return handleRuns(decodeURIComponent(taskRunsMatch[1]!))

    const taskInspectMatch = path.match(/^\/api\/tasks\/([^/]+)\/inspect$/)
    if (taskInspectMatch && req.method === "GET") return handleInspect(decodeURIComponent(taskInspectMatch[1]!))

    const runMatch = path.match(/^\/api\/runs\/(\d+)$/)
    if (runMatch && req.method === "GET")        return handleRun(parseInt(runMatch[1]!))

    const runEventsMatch = path.match(/^\/api\/runs\/(\d+)\/events$/)
    if (runEventsMatch && req.method === "GET")  return handleRunEvents(parseInt(runEventsMatch[1]!))

    if (path.startsWith("/api/")) return err("Not found", 404)

    // Serve React app
    return serveStatic(path)
  },
})

console.log(`Neuron API + Dashboard → http://localhost:${PORT}`)
console.log(`DB: ${process.env.NEURON_DB ?? "default"}`)
