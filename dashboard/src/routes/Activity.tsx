import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Activity as ActivityIcon, RefreshCw } from "lucide-react"
import { api, type ApiEvent } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { useFeed } from "../components/ActivityFeed"
import { clsx } from "clsx"

const KIND_COLOR: Record<string, string> = {
  run_completed:    "text-[var(--success)]",
  sweep_completed:  "text-[var(--success)]",
  auto_completed:   "text-[var(--success)]",
  model_registered: "text-[var(--success)]",
  run_failed:       "text-[var(--danger)]",
  task_deleted:     "text-[var(--danger)]",
  run_cancelled:    "text-[var(--warning)]",
  sweep_cancelled:  "text-[var(--warning)]",
  run_stage:        "text-[var(--accent-text)]",
  run_progress:     "text-[var(--text-3)]",
  auto_note:        "text-[var(--accent-text)]",
  auto_started:     "text-[var(--accent-text)]",
  tool_call:        "text-[var(--text-2)]",
}

const SOURCE_COLOR: Record<string, string> = {
  mcp:  "bg-violet-500/20 text-violet-400",
  api:  "bg-blue-500/20 text-blue-400",
  tui:  "bg-green-500/20 text-green-400",
  user: "bg-amber-500/20 text-amber-400",
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function eventSummary(ev: ApiEvent): string {
  const p = ev.payload as Record<string, unknown>
  switch (ev.kind) {
    case "tool_call": {
      const parts: string[] = [p.tool as string]
      if (p.lr != null) parts.push(`lr=${p.lr}`)
      if (p.epochs != null) parts.push(`epochs=${p.epochs}`)
      if (p.accuracy_target != null) parts.push(`target=${p.accuracy_target}`)
      if (p.totalConfigs != null) parts.push(`${p.totalConfigs} configs`)
      if (p.path != null) parts.push(String(p.path).split("/").pop()!)
      return parts.join(" · ")
    }
    case "run_started":    return `run #${ev.runId} started ${ev.taskId ? `(${ev.taskId})` : ""}`
    case "run_stage":      return `run #${ev.runId} → ${p.stage}`
    case "run_progress":   return `run #${ev.runId} ${p.stage}${p.i != null && p.n != null ? ` ${p.i}/${p.n}` : ""}`
    case "run_completed": {
      const acc = p.accuracy as number | undefined
      return `run #${ev.runId} completed${acc != null ? ` — ${(acc * 100).toFixed(1)}%` : ""}`
    }
    case "run_failed":     return `run #${ev.runId} failed: ${p.error ?? ""}`
    case "run_cancelled":  return `run #${ev.runId} cancelled`
    case "sweep_started":  return `sweep started · ${p.total ?? "?"} configs · ${ev.taskId}`
    case "sweep_progress": return `sweep ${p.idx != null && p.total != null ? `${(p.idx as number) + 1}/${p.total}` : "running"} · ${ev.taskId}`
    case "sweep_completed": {
      const best = p.bestAccuracy as number | undefined
      return `sweep done${best != null ? ` — ${(best * 100).toFixed(1)}%` : ""} · ${ev.taskId}`
    }
    case "auto_started":   return `auto_train started · target ${((p.accuracyTarget as number) * 100).toFixed(0)}% · ${ev.taskId}`
    case "auto_note":      return `[${p.stage}] ${p.note}`
    case "auto_completed": {
      const acc = p.accuracy as number | undefined
      return `auto_train done${acc != null ? ` — ${(acc * 100).toFixed(1)}%` : ""} · ${ev.taskId}`
    }
    case "model_registered": {
      const acc = p.accuracy as number | undefined
      return `model promoted${acc != null ? ` ${(acc * 100).toFixed(1)}%` : ""} for ${ev.taskId}`
    }
    case "upload":         return `uploaded ${p.total} rows → ${ev.taskId}`
    case "task_reset":     return `task reset: ${ev.taskId}`
    case "task_deleted":   return `task deleted: ${ev.taskId}`
    default:               return JSON.stringify(p).slice(0, 80)
  }
}

function eventLink(ev: ApiEvent): string | null {
  if (ev.taskId && ev.runId) return `/tasks/${encodeURIComponent(ev.taskId)}/runs/${ev.runId}`
  if (ev.taskId) return `/tasks/${encodeURIComponent(ev.taskId)}`
  return null
}

export function Activity() {
  const { events: liveEvents } = useFeed()
  const [kindFilter, setKindFilter] = useState("all")
  const [taskFilter, setTaskFilter] = useState("all")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [historicalEvents, setHistoricalEvents] = useState<ApiEvent[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const initialized = useRef(false)

  // Load initial history via REST
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    ;(async () => {
      const res = await api.events({ limit: 100 })
      const evs = res.events ?? []
      setHistoricalEvents(evs)
    })()
  }, [])

  async function loadMore() {
    const oldest = historicalEvents[historicalEvents.length - 1]
    if (!oldest) return
    setLoadingMore(true)
    try {
      const res = await api.events({ limit: 100 })
      const evs = (res.events ?? []).filter((e) => e.id < oldest.id)
      setHistoricalEvents((prev) => [...prev, ...evs])
    } finally {
      setLoadingMore(false)
    }
  }

  // Merge live events with historical (deduplicate by id)
  const seenIds = new Set(historicalEvents.map((e) => e.id))
  const freshLive = liveEvents.filter((e) => !seenIds.has(e.id))
  const allEvents = [...freshLive, ...historicalEvents].sort((a, b) => b.ts - a.ts)

  // Filters
  const kinds = [...new Set(allEvents.map((e) => e.kind))].sort()
  const tasks = [...new Set(allEvents.map((e) => e.taskId).filter(Boolean) as string[])].sort()
  const sources = [...new Set(allEvents.map((e) => e.source))].sort()

  const filtered = allEvents.filter((e) => {
    if (kindFilter !== "all" && e.kind !== kindFilter) return false
    if (taskFilter !== "all" && e.taskId !== taskFilter) return false
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false
    return true
  })

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Live event stream from MCP and API processes."
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { label: "Kind", value: kindFilter, setValue: setKindFilter, options: kinds },
          { label: "Task", value: taskFilter, setValue: setTaskFilter, options: tasks },
          { label: "Source", value: sourceFilter, setValue: setSourceFilter, options: sources },
        ].map(({ label, value, setValue, options }) => (
          <select
            key={label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={clsx(
              "text-xs font-mono px-3 py-1.5 rounded-md border transition-colors outline-none cursor-pointer",
              "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
              "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]"
            )}
          >
            <option value="all">All {label.toLowerCase()}s</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <span className="ml-auto text-xs text-[var(--text-3)] self-center">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="card p-8 text-center">
          <ActivityIcon size={24} className="mx-auto mb-2 text-[var(--text-3)]" />
          <p className="text-sm text-[var(--text-3)]">No events yet. Run a tool or train a model to see activity.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Time", "Kind", "Source", "Task", "Run", "Summary"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev, i) => {
                const link = eventLink(ev)
                const color = KIND_COLOR[ev.kind] ?? "text-[var(--text-3)]"
                const srcColor = SOURCE_COLOR[ev.source] ?? "bg-[var(--surface-3)] text-[var(--text-3)]"
                const summary = eventSummary(ev)
                return (
                  <motion.tr
                    key={ev.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.005, 0.15) }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-2xs text-[var(--text-3)] whitespace-nowrap">
                      {formatTs(ev.ts)}
                    </td>
                    <td className="px-4 py-2">
                      <span className={clsx("font-mono text-2xs", color)}>{ev.kind}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={clsx("text-2xs px-1.5 py-0.5 rounded font-mono", srcColor)}>{ev.source}</span>
                    </td>
                    <td className="px-4 py-2">
                      {ev.taskId ? (
                        <Link
                          to={`/tasks/${encodeURIComponent(ev.taskId)}`}
                          className="text-2xs font-mono text-[var(--accent-text)] hover:underline"
                        >
                          {ev.taskId}
                        </Link>
                      ) : <span className="text-[var(--text-3)]">—</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-2xs text-[var(--text-3)]">
                      {ev.runId ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--text-2)] max-w-xs truncate">
                      {link ? (
                        <Link to={link} className="hover:underline hover:text-[var(--text-1)]">{summary}</Link>
                      ) : summary}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>

          {historicalEvents.length >= 100 && (
            <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={11} className={loadingMore ? "animate-spin" : ""} />
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
