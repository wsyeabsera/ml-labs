import type { ClassificationMetrics } from "./metrics"

export interface TaskState {
  taskId: string
  trained: boolean
  labels: string[]
  accuracy: number | null
  perClassAccuracy: Record<string, number>
  confusionMatrix: number[][]
  lossHistory: number[]
  sampleCounts: Record<string, number>
  trainedAt: string | null
  activeRunId: number | null
  abortController: AbortController | null
}

function emptyTaskState(taskId: string): TaskState {
  return {
    taskId, trained: false, labels: [], accuracy: null,
    perClassAccuracy: {}, confusionMatrix: [], lossHistory: [],
    sampleCounts: {}, trainedAt: null, activeRunId: null, abortController: null,
  }
}

const tasks = new Map<string, TaskState>()

export function getTaskState(taskId: string): TaskState {
  if (!tasks.has(taskId)) tasks.set(taskId, emptyTaskState(taskId))
  return tasks.get(taskId)!
}

export function setTaskTrained(taskId: string, params: {
  labels: string[]
  metrics: ClassificationMetrics
  lossHistory: number[]
  sampleCounts: Record<string, number>
  runId: number
}) {
  const s = getTaskState(taskId)
  s.trained = true
  s.labels = params.labels
  s.accuracy = params.metrics.accuracy
  s.perClassAccuracy = params.metrics.perClassAccuracy
  s.confusionMatrix = params.metrics.confusionMatrix
  s.lossHistory = params.lossHistory
  s.sampleCounts = params.sampleCounts
  s.trainedAt = new Date().toISOString()
  s.activeRunId = null
  s.abortController = null
}

export function setActiveRun(taskId: string, runId: number, ac: AbortController) {
  const s = getTaskState(taskId)
  s.activeRunId = runId
  s.abortController = ac
}

export function clearActiveRun(taskId: string) {
  const s = getTaskState(taskId)
  s.activeRunId = null
  s.abortController = null
}

export function resetTaskState(taskId: string) {
  tasks.set(taskId, emptyTaskState(taskId))
}

export function allTaskIds(): string[] {
  return [...tasks.keys()]
}

export interface RunProgress {
  stage: "featurize" | "tensors" | "init" | "train" | "eval" | "weights"
  i?: number
  n?: number
  message: string
  lossHistory: number[]
  epochsDone: number
}

// Per-run live progress (polled by get_run_status tool)
const runProgress = new Map<number, RunProgress>()

export function setRunProgress(runId: number, p: { stage: RunProgress["stage"]; i?: number; n?: number; message: string }, lossHistory: number[], epochsDone: number) {
  runProgress.set(runId, { ...p, lossHistory, epochsDone })
}

export function getRunProgress(runId: number) {
  return runProgress.get(runId) ?? null
}

export function clearRunProgress(runId: number) {
  runProgress.delete(runId)
}
