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

export interface ApiPredictResult {
  label?: string
  confidence?: number
  scores?: Record<string, number>
  value?: number
  raw_output?: number
}

export interface ApiBatchRow {
  row: number
  label?: string
  confidence?: number
  scores?: Array<{ label: string; prob: number }>
  value?: number
  truth?: string | number
  correct?: boolean
  error?: number
}

export interface ApiUploadResult {
  ok: boolean
  taskId: string
  total: number
  trainCount: number
  testCount: number
  featureNames: string[]
  labels: string[] | null
  labelCounts: Record<string, number> | null
  warnings: string[]
  skipped: number
}

export interface ApiSweepResult {
  config: { lr?: number; epochs?: number }
  runId: number | null
  accuracy: number | null
  valAccuracy: number | null
  status: "pending" | "running" | "done" | "failed"
  error?: string
}

export interface ApiConfig {
  ok: boolean
  taskId: string | null
  configPath: string | null
  featureShape: number[] | null
  sampleShape: number[] | null
  hasFeaturize: boolean
  hasDecodeImage: boolean
  hasHeadArchitecture: boolean
  defaultHyperparams: { lr: number; epochs: number }
}

export interface ApiEvent {
  id: number
  ts: number
  source: "mcp" | "api" | "tui" | "user"
  kind: string
  taskId: string | null
  runId: number | null
  payload: Record<string, unknown>
}

export interface ApiSweepState {
  active: boolean
  taskId?: string
  status?: "running" | "completed" | "cancelled"
  currentIdx?: number
  total?: number
  results?: ApiSweepResult[]
  bestRunId?: number | null
  bestAccuracy?: number | null
  promoteWinner?: boolean
}

export interface ApiBatchPredictResult {
  ok: boolean
  total: number
  processed: number
  errors: string[]
  predictions: ApiBatchRow[]
  accuracy?: number
  correct?: number
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
  health:  ()                     => get<ApiHealth>("/health"),
  tasks:   ()                     => get<{ tasks: ApiTask[] }>("/tasks"),
  task:    (id: string)           => get<ApiTask>(`/tasks/${encodeURIComponent(id)}`),
  allRuns: ()                     => get<{ runs: ApiRun[] }>("/runs"),
  runs:    (taskId: string)       => get<{ runs: ApiRun[] }>(`/tasks/${encodeURIComponent(taskId)}/runs`),
  run:     (id: number)           => get<ApiRun>(`/runs/${id}`),
  inspect: (taskId: string)       => get<ApiInspect>(`/tasks/${encodeURIComponent(taskId)}/inspect`),

  startTrain: (taskId: string, params: { lr?: number; epochs?: number; head_arch?: number[]; class_weights?: "balanced" }) =>
    fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; runId?: number; error?: string }
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      return data as { ok: true; runId: number }
    }),

  cancelTrain: (taskId: string) =>
    fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/train`, { method: "DELETE" })
      .then((r) => r.json() as Promise<{ ok: boolean; runId?: number }>),

  predict: (taskId: string, features: number[]) =>
    fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
    }).then(async (res) => {
      const data = await res.json() as ApiPredictResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data as ApiPredictResult
    }),

  upload: (csv: string, params: { task_id: string; kind: string; label_column: string; feature_columns?: string; normalize?: boolean; test_size?: number; replace?: boolean }) => {
    const url = new URL(`${window.location.origin}${BASE}/upload`)
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, String(v)) })
    return fetch(url.toString(), { method: "POST", headers: { "Content-Type": "text/plain" }, body: csv })
      .then(async (res) => {
        const data = await res.json() as ApiUploadResult & { error?: string }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        return data as ApiUploadResult
      })
  },

  startSweep: (taskId: string, body: { search?: { lr?: number[]; epochs?: number[] }; promote_winner?: boolean }) =>
    fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; error?: string; total?: number }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data as { ok: true; total: number }
    }),

  getSweep: (taskId: string) =>
    get<ApiSweepState>(`/tasks/${encodeURIComponent(taskId)}/sweep`),

  cancelSweep: (taskId: string) =>
    fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}/sweep`, { method: "DELETE" })
      .then((r) => r.json() as Promise<{ ok: boolean }>),

  config: () => get<ApiConfig>("/config"),

  events: (opts?: { sinceId?: number; task?: string; limit?: number }) => {
    const url = new URL(`${window.location.origin}${BASE}/events`)
    if (opts?.sinceId != null) url.searchParams.set("since_id", String(opts.sinceId))
    if (opts?.task) url.searchParams.set("task", opts.task)
    if (opts?.limit) url.searchParams.set("limit", String(opts.limit))
    return fetch(url.toString()).then((r) => r.json() as Promise<{ events: ApiEvent[] }>)
  },

  askClaude: (prompt: string, context: { route?: string; taskId?: string; runId?: number }) =>
    fetch(`${BASE}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, context }),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; id?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data as { ok: true; id: number }
    }),

  batchPredict: (taskId: string, csv: string, labelColumn?: string) => {
    const url = new URL(`${window.location.origin}${BASE}/tasks/${encodeURIComponent(taskId)}/batch_predict`)
    if (labelColumn) url.searchParams.set("label_column", labelColumn)
    return fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: csv,
    }).then(async (res) => {
      const data = await res.json() as ApiBatchPredictResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      return data as ApiBatchPredictResult
    })
  },
}

// ── SSE hook helpers ──────────────────────────────────────────────────────────

export function createRunEventSource(runId: number): EventSource {
  return new EventSource(`${BASE}/runs/${runId}/events`)
}

export function createGlobalEventSource(): EventSource {
  return new EventSource(`${BASE}/events?stream=1`)
}
