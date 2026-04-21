import { db } from "./schema"

export interface DbEvent {
  id: number
  ts: number
  source: "mcp" | "api" | "tui" | "user"
  kind: string
  taskId: string | null
  runId: number | null
  payload: unknown
}

interface RecordEventArgs {
  source: "mcp" | "api" | "tui" | "user"
  kind: string
  taskId?: string
  runId?: number
  payload?: unknown
}

const insertEvent = db.prepare<{ id: number }, [string, string, string | null, number | null, string]>(
  `INSERT INTO events (source, kind, task_id, run_id, payload)
   VALUES (?, ?, ?, ?, ?)
   RETURNING id`
)

export function recordEvent(e: RecordEventArgs): number {
  try {
    const row = insertEvent.get(
      e.source,
      e.kind,
      e.taskId ?? null,
      e.runId ?? null,
      JSON.stringify(e.payload ?? {})
    )
    return row?.id ?? 0
  } catch {
    return 0
  }
}

interface ListEventsOpts {
  sinceId?: number
  since?: number
  taskId?: string
  limit?: number
  /**
   * When set, returns the NEWEST N events (by id desc) instead of the oldest.
   * Results are re-reversed into chronological order so callers always see
   * ascending ids. Use this for SSE snapshots — the activity feed wants recent
   * history, not the first events the DB ever recorded.
   */
  newest?: boolean
}

export function listEvents(opts: ListEventsOpts = {}): DbEvent[] {
  const limit = opts.limit ?? 200
  const parts: string[] = []
  const params: (string | number)[] = []

  if (opts.sinceId != null) { parts.push("id > ?"); params.push(opts.sinceId) }
  if (opts.since != null)   { parts.push("ts >= ?"); params.push(opts.since) }
  if (opts.taskId != null)  { parts.push("task_id = ?"); params.push(opts.taskId) }

  const where = parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : ""
  const order = opts.newest ? "DESC" : "ASC"
  const rows = db.query<{
    id: number; ts: number; source: string; kind: string;
    task_id: string | null; run_id: number | null; payload: string
  }, (string | number)[]>(`SELECT id, ts, source, kind, task_id, run_id, payload
     FROM events ${where} ORDER BY id ${order} LIMIT ${limit}`).all(...params)

  const mapped = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    source: r.source as DbEvent["source"],
    kind: r.kind,
    taskId: r.task_id,
    runId: r.run_id,
    payload: (() => { try { return JSON.parse(r.payload) } catch { return {} } })(),
  }))

  // Always return in chronological order. When we queried newest-first, reverse.
  return opts.newest ? mapped.reverse() : mapped
}
