import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../server.ts")

let _client: Client | null = null

export async function getClient(): Promise<Client> {
  if (_client) return _client

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", SERVER_PATH],
    env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
  })

  _client = new Client({ name: "neuron-tui", version: "0.2.0" }, { capabilities: {} })
  await _client.connect(transport)
  return _client
}

export async function call<T>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = await getClient()
  const result = await client.callTool({ name: toolName, arguments: args })
  const content = result.content as Array<{ type: string; text?: string }>
  const text = content.find((c) => c.type === "text")?.text ?? "{}"
  return JSON.parse(text) as T
}

// Typed helpers matching tool names
export const neuron = {
  listTasks: () => call<{ tasks: Task[] }>("list_tasks", {}),
  createTask: (args: Record<string, unknown>) => call("create_task", args),
  listSamples: (task_id: string, opts?: { label?: string; limit?: number; offset?: number }) =>
    call<{ total: number; counts: Record<string, number>; items: SampleItem[] }>("list_samples", { task_id, ...opts }),
  deleteSample: (args: Record<string, unknown>) => call("delete_sample", args),
  preflight: (task_id: string) => call("preflight_check", { task_id }),
  suggestHyperparams: (task_id: string) => call<HyperparamSuggestion>("suggest_hyperparams", { task_id }),
  train: (args: Record<string, unknown>) => call<TrainResult>("train", args),
  cancelTraining: (task_id?: string, run_id?: number) => call("cancel_training", { task_id, run_id }),
  listRuns: (task_id: string, limit = 20) => call<{ total: number; runs: RunSummary[] }>("list_runs", { task_id, limit }),
  evaluate: (run_id: number) => call<RunDetail>("evaluate", { run_id }),
  predict: (task_id: string, features: number[]) => call<PredictResult>("predict", { task_id, features }),
  diagnose: (run_id: number) => call<DiagnoseResult>("diagnose", { run_id }),
  compareRuns: (run_id_a: number, run_id_b: number) => call("compare_runs", { run_id_a, run_id_b }),
  registerModel: (task_id: string, run_id: number) => call("register_model", { task_id, run_id }),
  exportModel: (task_id: string) => call("export_model", { task_id }),
  resetTask: (task_id: string) => call("reset_task", { task_id, confirm: true }),
  getRunStatus: (run_id: number) => call<RunStatus>("get_run_status", { run_id }),
  loadCsv: (args: Record<string, unknown>) => call<LoadResult>("load_csv", args),
  loadJson: (path: string, task_id: string) => call<LoadResult>("load_json", { path, task_id }),
  loadImages: (task_id: string, dir: string) => call<LoadResult>("load_images", { task_id, dir }),
  inspectData: (task_id: string) => call<InspectResult>("inspect_data", { task_id }),
}

// Shared types for the TUI
export interface Task {
  id: string
  kind: string
  labels: string[]
  featureShape: number[]
  sampleShape?: number[]
  createdAt: number
}

export interface SampleItem {
  id: number
  label: string
  created_at: number
  feature_dim: number
}

export interface RunSummary {
  id: number
  status: string
  accuracy: number | null
  hyperparams: Record<string, unknown>
  started_at: number | null
  finished_at: number | null
  duration_s: number | null
}

export interface RunDetail extends RunSummary {
  task_id: string
  per_class_accuracy: Record<string, number> | null
  confusion_matrix: number[][] | null
  loss_history: number[] | null
  sample_counts: Record<string, number> | null
  val_accuracy: number | null
  mae: number | null
  rmse: number | null
  r2: number | null
}

export interface RunStatus {
  run_id: number
  status: string
  stage: string | null
  i: number | null
  n: number | null
  message: string
  loss_history: number[]
  epochs_done: number
}

export interface TrainResult {
  ok: boolean
  run_id: number
  accuracy: number
  per_class_accuracy: Record<string, number>
  labels: string[]
}

export interface HyperparamSuggestion {
  lr: number
  epochs: number
  head_arch: number[]
  reasoning: string
}

export interface PredictResult {
  label: string
  confidence: number
  scores: Record<string, number>
}

export interface DiagnoseResult {
  ok: boolean
  severity: string
  root_causes: string[]
  recommendations: string[]
  summary: string
}

export interface LoadResult {
  ok: boolean
  inserted: number
  skipped: number
  errors: string[]
  per_label: Record<string, number>
}

export interface InspectResult {
  ok: boolean
  task_id?: string
  kind?: string
  total: number
  splits?: { train: number; test: number }
  features?: { count: number; names: string[] }
  class_distribution?: Record<string, number> | null
  imbalance_ratio?: number | null
  normalize_enabled?: boolean
  warnings?: string[]
  message?: string
}
