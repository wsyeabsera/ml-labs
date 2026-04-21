/**
 * In-process registry of running auto_train coordinators.
 *
 * `runController` registers itself on entry and deregisters on exit. External
 * callers (`cancel_auto_train` MCP tool, `cancel_training(force)`, server
 * shutdown) look up coordinators here to trigger cooperative abort.
 *
 * Child run ids produced during the coordinator's lifetime are tracked so that
 * a cancel can reap any still-running workers (mark DB rows as cancelled).
 */

export interface ControllerEntry {
  autoRunId: number
  taskId: string
  abortController: AbortController
  childRunIds: Set<number>
  startedAt: number
}

const byAutoRunId = new Map<number, ControllerEntry>()
const autoRunIdByTask = new Map<string, number>()

export function registerController(entry: Omit<ControllerEntry, "childRunIds" | "startedAt"> & { childRunIds?: Set<number> }): ControllerEntry {
  const full: ControllerEntry = {
    autoRunId: entry.autoRunId,
    taskId: entry.taskId,
    abortController: entry.abortController,
    childRunIds: entry.childRunIds ?? new Set(),
    startedAt: Date.now(),
  }
  byAutoRunId.set(full.autoRunId, full)
  autoRunIdByTask.set(full.taskId, full.autoRunId)
  return full
}

export function deregisterController(autoRunId: number): void {
  const entry = byAutoRunId.get(autoRunId)
  if (!entry) return
  byAutoRunId.delete(autoRunId)
  // Only remove the task mapping if it still points at THIS auto_run
  // (a new coordinator for the same task may have taken over).
  if (autoRunIdByTask.get(entry.taskId) === autoRunId) {
    autoRunIdByTask.delete(entry.taskId)
  }
}

export function getController(autoRunId: number): ControllerEntry | null {
  return byAutoRunId.get(autoRunId) ?? null
}

export function getActiveAutoRunForTask(taskId: string): ControllerEntry | null {
  const id = autoRunIdByTask.get(taskId)
  return id != null ? byAutoRunId.get(id) ?? null : null
}

export function trackChildRun(autoRunId: number, runId: number): void {
  const entry = byAutoRunId.get(autoRunId)
  if (entry) entry.childRunIds.add(runId)
}

/**
 * Abort a registered coordinator by auto_run_id or task_id. Returns the
 * entry that was aborted, or null if nothing was registered for that key.
 */
export function abortByAutoRun(autoRunId: number): ControllerEntry | null {
  const entry = byAutoRunId.get(autoRunId)
  if (!entry) return null
  entry.abortController.abort()
  return entry
}

export function abortByTask(taskId: string): ControllerEntry | null {
  const id = autoRunIdByTask.get(taskId)
  if (id == null) return null
  return abortByAutoRun(id)
}

export function listActive(): ControllerEntry[] {
  return [...byAutoRunId.values()]
}
