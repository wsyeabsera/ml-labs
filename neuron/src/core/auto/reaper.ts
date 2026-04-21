/**
 * Startup zombie reaper — called once on server / api process boot to clean up
 * runs and auto_runs that were left in the `running` state by a prior process
 * that crashed, was force-killed, or was cancelled out-of-band.
 *
 * Without this, stranded rows stay `running` forever and pollute list_runs,
 * get_auto_status, and the dashboard.
 */
import { db } from "../db/schema"
import { listStaleRunningRuns, forceCancelRun } from "../db/runs"
import { recordEvent } from "../db/events"

/** Minimum age (seconds) before a running row is considered stranded. */
const STALE_AGE_S = 30 * 60  // 30 minutes

/**
 * Reap both run rows and auto_run rows that look abandoned. Safe to call once
 * at startup — won't touch rows from coordinators that are still live in this
 * process because their in-memory registry entries reflect reality, not the DB.
 * The DB-level check is a fallback for truly dead processes.
 */
export function reapZombies(): { runsReaped: number; autoRunsReaped: number } {
  const runsReaped = reapStaleRuns()
  const autoRunsReaped = reapStaleAutoRuns()
  return { runsReaped, autoRunsReaped }
}

function reapStaleRuns(): number {
  const stale = listStaleRunningRuns(STALE_AGE_S)
  let count = 0
  for (const r of stale) {
    if (forceCancelRun(r.id, "failed")) {
      count++
      recordEvent({
        source: "api",
        kind: "run_reaped",
        taskId: r.taskId,
        runId: r.id,
        payload: { reason: "abandoned on server restart", age_s: Math.round(Date.now() / 1000 - (r.startedAt ?? 0)) },
      })
    }
  }
  return count
}

function reapStaleAutoRuns(): number {
  // auto_runs.started_at is an ISO string; compute age in JS.
  const rows = db.query(
    `SELECT id, task_id, started_at, coordinator_pid FROM auto_runs WHERE status = 'running'`,
  ).all() as { id: number; task_id: string; started_at: string; coordinator_pid: number | null }[]

  const nowMs = Date.now()
  const currentPid = process.pid
  let count = 0

  for (const row of rows) {
    const ageMs = nowMs - Date.parse(row.started_at)
    const oldEnough = ageMs >= STALE_AGE_S * 1000
    // Reap if:
    //  (a) the row is older than STALE_AGE_S AND not owned by this very process, OR
    //  (b) the coordinator_pid is set and points at a different process (even if
    //      the row is young) — that process crashed before finalizing.
    const differentProcess = row.coordinator_pid != null && row.coordinator_pid !== currentPid
    if (!oldEnough && !differentProcess) continue
    if (row.coordinator_pid === currentPid) continue

    db.prepare(
      `UPDATE auto_runs SET status = 'failed', finished_at = ?, verdict = ? WHERE id = ? AND status = 'running'`,
    ).run(
      new Date().toISOString(),
      `abandoned on server restart (stale for ${Math.round(ageMs / 1000)}s)`,
      row.id,
    )
    count++
    recordEvent({
      source: "api",
      kind: "auto_reaped",
      taskId: row.task_id,
      payload: {
        auto_run_id: row.id,
        reason: "abandoned on server restart",
        age_s: Math.round(ageMs / 1000),
        prior_pid: row.coordinator_pid,
      },
    })
  }
  return count
}
