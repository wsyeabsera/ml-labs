const BASE = "/api"

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Shared types ───────────────────────────────────────────────────────────────

export interface ApiTask {
  id: string
  kind: "classification" | "regression"
  featureShape: number[]
  featureNames: string[] | null
  labels: string[] | null
  normalize: boolean
  sampleCount: number
  trainCount: number
  testCount: number
  runCount: number
  activeRunId: number | null
  lastRunStatus: string | null
  accuracy: number | null
  createdAt: number
}

export interface ApiRun {
  id: number
  taskId: string
  status: string
  hyperparams: Record<string, unknown>
  accuracy: number | null
  valAccuracy: number | null
  perClassAccuracy: Record<string, number> | null
  confusionMatrix: number[][] | null
  lossHistory: number[] | null
  mae: number | null
  rmse: number | null
  r2: number | null
  sampleCounts: Record<string, number> | null
  startedAt: number | null
  finishedAt: number | null
  durationS: number | null
}

export interface ApiRunProgress {
  stage: string
  i?: number
  n?: number
  message: string
  lossHistory: number[]
  epochsDone: number
}

export interface ApiHealth {
  ok: boolean
  version: string
  dbPath: string
  taskCount: number
}

export interface ApiInspect {
  ok: boolean
  total: number
  splits?: { train: number; test: number }
  features?: { count: number; names: string[]; stats: Array<{ name: string; mean: number; std: number; min: number; max: number; constant: boolean }> }
  class_distribution?: Record<string, number> | null
  imbalance_ratio?: number | null
  normalize_enabled?: boolean
  warnings?: string[]
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export const api = {
  health: ()                      => get<ApiHealth>("/health"),
  tasks:  ()                      => get<{ tasks: ApiTask[] }>("/tasks"),
  task:   (id: string)            => get<ApiTask>(`/tasks/${encodeURIComponent(id)}`),
  runs:   (taskId: string)        => get<{ runs: ApiRun[] }>(`/tasks/${encodeURIComponent(taskId)}/runs`),
  run:    (id: number)            => get<ApiRun>(`/runs/${id}`),
  inspect:(taskId: string)        => get<ApiInspect>(`/tasks/${encodeURIComponent(taskId)}/inspect`),
}

// ── SSE hook helper ───────────────────────────────────────────────────────────

export function createRunEventSource(runId: number): EventSource {
  return new EventSource(`${BASE}/runs/${runId}/events`)
}
