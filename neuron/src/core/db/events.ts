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
}

export function listEvents(opts: ListEventsOpts = {}): DbEvent[] {
  const limit = opts.limit ?? 200
  const parts: string[] = []
  const params: (string | number)[] = []

  if (opts.sinceId != null) { parts.push("id > ?"); params.push(opts.sinceId) }
  if (opts.since != null)   { parts.push("ts >= ?"); params.push(opts.since) }
  if (opts.taskId != null)  { parts.push("task_id = ?"); params.push(opts.taskId) }

  const where = parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : ""
  const rows = db.query<{
    id: number; ts: number; source: string; kind: string;
    task_id: string | null; run_id: number | null; payload: string
  }, (string | number)[]>(`SELECT id, ts, source, kind, task_id, run_id, payload
     FROM events ${where} ORDER BY id ASC LIMIT ${limit}`).all(...params)

  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    source: r.source as DbEvent["source"],
    kind: r.kind,
    taskId: r.task_id,
    runId: r.run_id,
    payload: (() => { try { return JSON.parse(r.payload) } catch { return {} } })(),
  }))
}
