import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"
import { AnimatePresence } from "framer-motion"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown, ChevronUp, Cpu, Play, CheckCircle2,
  AlertCircle, Upload, SlidersHorizontal, Wrench,
} from "lucide-react"
import { createGlobalEventSource, type ApiEvent } from "../lib/api"
import { ToastContainer, type ToastItem } from "./Toast"
import { clsx } from "clsx"

const MAX_EVENTS = 200

// ── Context ───────────────────────────────────────────────────────────────────

interface FeedCtx {
  events: ApiEvent[]
  pushToast: (t: Omit<ToastItem, "id">) => void
}

const Ctx = createContext<FeedCtx>({ events: [], pushToast: () => {} })
export const useFeed = () => useContext(Ctx)

// ── Provider (mounts once in App) ─────────────────────────────────────────────

export function ActivityFeedProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const qc = useQueryClient()
  const esRef = useRef<EventSource | null>(null)

  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { ...t, id }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addEvent = useCallback((ev: ApiEvent) => {
    setEvents((prev) => {
      const next = [...prev, ev]
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
    })

    // Side-effects: invalidate React Query caches + show toasts
    if (ev.kind === "run_completed") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["tasks"] })
      }
      qc.invalidateQueries({ queryKey: ["allRuns"] })
      const acc = (ev.payload as { accuracy?: number }).accuracy
      pushToast({
        kind: "success",
        message: `Run #${ev.runId} completed${acc != null ? ` — ${(acc * 100).toFixed(1)}%` : ""}`,
      })
    }
    if (ev.kind === "sweep_completed") {
      if (ev.taskId) qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
      const best = (ev.payload as { bestAccuracy?: number }).bestAccuracy
      pushToast({
        kind: "success",
        message: `Sweep done${best != null ? ` — best ${(best * 100).toFixed(1)}%` : ""}`,
      })
    }
    if (ev.kind === "model_registered" && ev.taskId) {
      qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      pushToast({ kind: "info", message: `Model promoted for ${ev.taskId}` })
    }
    if (ev.kind === "upload" && ev.taskId) {
      qc.invalidateQueries({ queryKey: ["tasks"] })
    }
  }, [qc, pushToast])

  useEffect(() => {
    function connect() {
      const es = createGlobalEventSource()
      esRef.current = es

      es.addEventListener("snapshot", (e: MessageEvent) => {
        try {
          const evs = JSON.parse(e.data) as ApiEvent[]
          setEvents((prev) => {
            const all = [...prev, ...evs]
            return all.length > MAX_EVENTS ? all.slice(-MAX_EVENTS) : all
          })
        } catch { /* ignore */ }
      })

      // Listen to all event kinds via the generic message + specific events
      const handler = (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as ApiEvent
          addEvent(ev)
        } catch { /* ignore */ }
      }

      for (const kind of ["tool_call","run_started","run_progress","run_completed","run_cancelled","run_failed","model_registered","sweep_started","sweep_completed","sweep_cancelled","upload","request","response","config_reload"]) {
        es.addEventListener(kind, handler)
      }

      es.onerror = () => {
        es.close()
        // Reconnect after 3s
        setTimeout(connect, 3000)
      }
    }

    connect()
    return () => { esRef.current?.close() }
  }, [addEvent])

  return (
    <Ctx.Provider value={{ events, pushToast }}>
      {children}
      <AnimatePresence>
        <ToastContainer toasts={toasts} onClose={removeToast} />
      </AnimatePresence>
    </Ctx.Provider>
  )
}

// ── Sidebar feed widget ────────────────────────────────────────────────────────

const KIND_ICON: Record<string, React.ReactNode> = {
  tool_call:       <Wrench size={10} />,
  run_started:     <Play size={10} />,
  run_progress:    <Cpu size={10} />,
  run_completed:   <CheckCircle2 size={10} />,
  run_cancelled:   <AlertCircle size={10} />,
  run_failed:      <AlertCircle size={10} />,
  sweep_started:   <SlidersHorizontal size={10} />,
  sweep_completed: <SlidersHorizontal size={10} />,
  upload:          <Upload size={10} />,
  request:         <Cpu size={10} />,
  response:        <CheckCircle2 size={10} />,
}

const KIND_COLOR: Record<string, string> = {
  run_completed:   "text-[var(--success)]",
  sweep_completed: "text-[var(--success)]",
  model_registered:"text-[var(--success)]",
  run_failed:      "text-[var(--danger)]",
  run_cancelled:   "text-[var(--warning)]",
  request:         "text-[var(--info)]",
  response:        "text-[var(--info)]",
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function eventLabel(ev: ApiEvent): string {
  const p = ev.payload as Record<string, unknown>
  if (ev.kind === "tool_call") return `${p.tool as string}`
  if (ev.kind === "run_started") return `run started${ev.taskId ? ` (${ev.taskId})` : ""}`
  if (ev.kind === "run_completed") {
    const acc = p.accuracy as number | undefined
    return `run #${ev.runId} done${acc != null ? ` ${(acc * 100).toFixed(1)}%` : ""}`
  }
  if (ev.kind === "run_progress") return `training… ${(p.message as string) || ""}`
  if (ev.kind === "run_failed") return `run #${ev.runId} failed`
  if (ev.kind === "run_cancelled") return `run #${ev.runId} cancelled`
  if (ev.kind === "sweep_started") return `sweep started (${p.total} configs)`
  if (ev.kind === "sweep_completed") {
    const best = p.bestAccuracy as number | undefined
    return `sweep done${best != null ? ` — ${(best * 100).toFixed(1)}%` : ""}`
  }
  if (ev.kind === "upload") return `uploaded ${p.total} rows → ${ev.taskId}`
  if (ev.kind === "request") return `asked: ${((p.prompt as string) || "").slice(0, 40)}…`
  if (ev.kind === "response") return `Claude answered`
  return ev.kind
}

function eventLink(ev: ApiEvent): string | null {
  if (ev.taskId && ev.runId && ["run_completed","run_started"].includes(ev.kind)) {
    return `/tasks/${encodeURIComponent(ev.taskId)}/runs/${ev.runId}`
  }
  if (ev.taskId && ["upload","sweep_completed","sweep_started"].includes(ev.kind)) {
    return `/tasks/${encodeURIComponent(ev.taskId)}`
  }
  return null
}

export function ActivityFeedWidget() {
  const { events } = useFeed()
  const [collapsed, setCollapsed] = useState(false)

  // Show last 8 non-progress events in the sidebar
  const visible = events.filter((e) => e.kind !== "run_progress").slice(-8).reverse()

  if (visible.length === 0) return null

  return (
    <div className="border-t border-[var(--border-subtle)] pt-2">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-1 section-label hover:text-[var(--text-2)] transition-colors"
      >
        <span>Activity</span>
        {collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
      </button>

      {!collapsed && (
        <div className="px-1 pb-1 space-y-0.5 max-h-[180px] overflow-y-auto">
          {visible.map((ev) => {
            const link = eventLink(ev)
            const color = KIND_COLOR[ev.kind] ?? "text-[var(--text-3)]"
            const content = (
              <div className={clsx("flex items-start gap-1.5 px-2 py-1 rounded hover:bg-[var(--surface-2)] transition-colors", color)}>
                <span className="mt-0.5 flex-shrink-0">{KIND_ICON[ev.kind] ?? <Cpu size={10} />}</span>
                <span className="text-2xs text-[var(--text-2)] flex-1 truncate leading-tight">{eventLabel(ev)}</span>
                <span className="text-2xs text-[var(--text-3)] flex-shrink-0">{timeAgo(ev.ts)}</span>
              </div>
            )
            return link
              ? <Link key={ev.id} to={link}>{content}</Link>
              : <div key={ev.id}>{content}</div>
          })}
        </div>
      )}
    </div>
  )
}
