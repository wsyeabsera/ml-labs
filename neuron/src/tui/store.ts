import { useSyncExternalStore, useEffect } from "react"
import { neuron, type Task, type RunSummary, type RunDetail, type RunStatus } from "./client/mcp"

export interface TaskWithMeta {
  id: string
  kind: string
  labels: string[]
  featureShape: number[]
  normalize: boolean
  sampleCount: number
  countsByLabel: Record<string, number>
  trained: boolean
  accuracy: number | null
  activeRunId: number | null
}

export interface Store {
  tasks: TaskWithMeta[]
  currentTaskId: string | null
  currentRunId: number | null
  runs: RunSummary[]
  activeRunStatus: RunStatus | null
  error: string | null
  loading: boolean
}

const initial: Store = {
  tasks: [],
  currentTaskId: null,
  currentRunId: null,
  runs: [],
  activeRunStatus: null,
  error: null,
  loading: false,
}

let state: Store = { ...initial }
const listeners = new Set<() => void>()

function setState(updater: (s: Store) => Partial<Store>) {
  state = { ...state, ...updater(state) }
  listeners.forEach((l) => l())
}

export function useStore(): Store {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => state,
  )
}

export function setCurrentTask(id: string | null) {
  setState(() => ({ currentTaskId: id, runs: [], activeRunStatus: null }))
}

export function setCurrentRun(id: number | null) {
  setState(() => ({ currentRunId: id }))
}

export function clearError() {
  setState(() => ({ error: null }))
}

export async function refreshTasks() {
  try {
    const result = await neuron.listTasks()
    const tasks: TaskWithMeta[] = (result.tasks as unknown as Array<{
      id: string; kind: string; labels: string[]; feature_shape: number[];
      normalize?: boolean; feature_names?: string[] | null;
      sample_count: number; counts_by_label: Record<string, number>;
      trained: boolean; accuracy: number | null; active_run_id: number | null;
    }>).map((t) => ({
      id: t.id,
      kind: t.kind,
      labels: t.labels ?? [],
      featureShape: t.feature_shape,
      normalize: t.normalize ?? false,
      sampleCount: t.sample_count,
      countsByLabel: t.counts_by_label ?? {},
      trained: t.trained,
      accuracy: t.accuracy,
      activeRunId: t.active_run_id,
    }))
    setState(() => ({ tasks, error: null }))
  } catch (e) {
    setState(() => ({ error: `Failed to load tasks: ${e instanceof Error ? e.message : String(e)}` }))
  }
}

export async function refreshRuns(taskId: string) {
  try {
    const result = await neuron.listRuns(taskId, 20)
    setState(() => ({ runs: result.runs, error: null }))
  } catch (e) {
    setState(() => ({ error: `Failed to load runs: ${e instanceof Error ? e.message : String(e)}` }))
  }
}

export async function pollRunStatus(runId: number): Promise<boolean> {
  try {
    const status = await neuron.getRunStatus(runId)
    setState(() => ({ activeRunStatus: status }))
    return status.status === "running"
  } catch {
    return false
  }
}

export async function startTrain(taskId: string, opts: { lr: number; epochs: number; headArch?: number[] }) {
  setState(() => ({ loading: true, error: null }))
  try {
    const result = await neuron.train({
      task_id: taskId,
      lr: opts.lr,
      epochs: opts.epochs,
      ...(opts.headArch ? { head_arch: opts.headArch } : {}),
    })
    setState(() => ({ loading: false }))
    await refreshTasks()
    return result
  } catch (e) {
    setState(() => ({ loading: false, error: `Training failed: ${e instanceof Error ? e.message : String(e)}` }))
    return null
  }
}

// Hook: auto-refresh tasks every 2s while mounted
export function useTaskPoller(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    refreshTasks()
    const timer = setInterval(refreshTasks, 2000)
    return () => clearInterval(timer)
  }, [enabled])
}

// Hook: poll a specific run's status every 500ms while running
export function useRunPoller(runId: number | null) {
  useEffect(() => {
    if (!runId) return
    let active = true
    async function poll() {
      if (!runId) return
      const stillRunning = await pollRunStatus(runId)
      if (active && stillRunning) setTimeout(poll, 500)
    }
    poll()
    return () => { active = false }
  }, [runId])
}
