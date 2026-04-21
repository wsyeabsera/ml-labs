import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"
import { AnimatePresence } from "framer-motion"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown, ChevronUp, Cpu, Play, CheckCircle2,
  AlertCircle, Upload, SlidersHorizontal, Wrench, Bot,
  Layers, RotateCcw, Trash2, BookOpen, Activity,
  Thermometer, Database, TrendingUp,
} from "lucide-react"
import { createGlobalEventSource, type ApiEvent } from "../lib/api"
import { ToastContainer, type ToastItem } from "./Toast"
import { clsx } from "clsx"

const MAX_EVENTS = 200

// ── Context ───────────────────────────────────────────────────────────────────

interface FeedCtx {
  events: ApiEvent[]
  pushToast: (t: Omit<ToastItem, "id">) => void
  activeJob: { label: string; message: string } | null
}

const Ctx = createContext<FeedCtx>({ events: [], pushToast: () => {}, activeJob: null })
export const useFeed = () => useContext(Ctx)

// ── Provider (mounts once in App) ─────────────────────────────────────────────

export function ActivityFeedProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [activeJob, setActiveJob] = useState<{ label: string; message: string } | null>(null)
  const qc = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  // Events with id ≤ liveAfterId are considered historical (from the initial
  // snapshot or a reconnect replay) and never trigger toasts. Set from the
  // max id in the snapshot on each (re)connect.
  const liveAfterIdRef = useRef<number>(Number.POSITIVE_INFINITY)
  // Dedupe toast ids across the provider's lifetime — belt for the suspenders.
  const toastedIdsRef = useRef<Set<number>>(new Set())

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

    // Toasts fire only for events strictly newer than the snapshot watermark,
    // and only once per event id. Historical events (via snapshot or reconnect
    // replay) update the feed + invalidate queries but stay silent.
    const isLive = ev.id > liveAfterIdRef.current && !toastedIdsRef.current.has(ev.id)
    const toastIfLive: typeof pushToast = (t) => {
      if (!isLive) return
      toastedIdsRef.current.add(ev.id)
      pushToast(t)
    }

    // Update active job pill
    if (ev.kind === "run_progress" || ev.kind === "run_stage") {
      const p = ev.payload as { stage?: string; message?: string }
      setActiveJob({ label: p.stage ?? "training", message: p.message ?? "" })
    }
    if (ev.kind === "auto_note" || ev.kind === "auto_started") {
      const p = ev.payload as { stage?: string; note?: string }
      setActiveJob({ label: p.stage ?? "auto_train", message: p.note ?? "" })
    }
    const clearKinds = ["run_completed", "run_cancelled", "run_failed", "auto_completed"]
    if (clearKinds.includes(ev.kind)) setActiveJob(null)

    // React Query invalidation
    if (ev.kind === "run_started") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["tasks"] })
      }
      qc.invalidateQueries({ queryKey: ["allRuns"] })
    }
    if (ev.kind === "run_stage" || ev.kind === "run_progress") {
      if (ev.runId) qc.invalidateQueries({ queryKey: ["run", ev.runId] })
    }
    if (ev.kind === "run_completed") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["tasks"] })
      }
      qc.invalidateQueries({ queryKey: ["allRuns"] })
      const acc = (ev.payload as { accuracy?: number }).accuracy
      toastIfLive({
        kind: "success",
        message: `Run #${ev.runId} completed${acc != null ? ` — ${(acc * 100).toFixed(1)}%` : ""}`,
      })
    }
    if (ev.kind === "run_failed" || ev.kind === "run_cancelled") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
      }
      qc.invalidateQueries({ queryKey: ["allRuns"] })
    }
    if (ev.kind === "sweep_completed") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["runs", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["sweep", ev.taskId] })
      }
      const best = (ev.payload as { bestAccuracy?: number }).bestAccuracy
      toastIfLive({
        kind: "success",
        message: `Sweep done${best != null ? ` — best ${(best * 100).toFixed(1)}%` : ""}`,
      })
    }
    if (ev.kind === "sweep_started" || ev.kind === "sweep_cancelled" || ev.kind === "sweep_progress") {
      if (ev.taskId) qc.invalidateQueries({ queryKey: ["sweep", ev.taskId] })
    }
    if (ev.kind === "model_registered" && ev.taskId) {
      qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      toastIfLive({ kind: "info", message: `Model promoted for ${ev.taskId}` })
    }
    if (ev.kind === "auto_started" || ev.kind === "auto_note" || ev.kind === "auto_completed") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["auto", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["tasks"] })
      }
      if (ev.kind === "auto_completed") {
        const p = ev.payload as { accuracy?: number }
        if (p.accuracy != null) {
          toastIfLive({ kind: "success", message: `Auto-train done — ${(p.accuracy * 100).toFixed(1)}%` })
        }
      }
    }
    if (ev.kind === "upload" && ev.taskId) {
      qc.invalidateQueries({ queryKey: ["tasks"] })
    }
    if (ev.kind === "calibrated" && ev.runId) {
      qc.invalidateQueries({ queryKey: ["run", ev.runId] })
      const T = (ev.payload as { temperature?: number }).temperature
      toastIfLive({
        kind: "info",
        message: `Run #${ev.runId} calibrated${T != null ? ` — T=${T.toFixed(3)}` : ""}`,
      })
    }
    if (ev.kind === "drift_detected" && ev.taskId) {
      qc.invalidateQueries({ queryKey: ["drift", ev.taskId] })
      const verdict = (ev.payload as { verdict?: string }).verdict
      toastIfLive({
        kind: verdict === "severe" ? "danger" : "warning",
        message: `Drift ${verdict ?? "detected"}${ev.taskId ? ` · ${ev.taskId}` : ""}`,
      })
    }
    if (ev.kind === "auto_collect_start" || ev.kind === "auto_collect_added") {
      if (ev.taskId) {
        qc.invalidateQueries({ queryKey: ["task", ev.taskId] })
        qc.invalidateQueries({ queryKey: ["auto", ev.taskId] })
      }
    }
    if (ev.kind === "sweep_wave_started" || ev.kind === "sweep_wave_completed") {
      if (ev.taskId) qc.invalidateQueries({ queryKey: ["sweep", ev.taskId] })
    }
    if (ev.kind === "batch_predict_started" || ev.kind === "batch_predict_progress" ||
        ev.kind === "batch_predict_completed" || ev.kind === "batch_predict_failed") {
      const p = ev.payload as { batchId?: number }
      if (p.batchId != null) qc.invalidateQueries({ queryKey: ["batch-predict-run", p.batchId] })
      if (ev.taskId) qc.invalidateQueries({ queryKey: ["batch-predict-runs", ev.taskId] })

      if (ev.kind === "batch_predict_completed") {
        const pp = ev.payload as { accuracy?: number | null; processed?: number }
        const accPart = pp.accuracy != null ? ` — ${(pp.accuracy * 100).toFixed(1)}% accuracy` : ""
        toastIfLive({
          kind: "success",
          message: `Batch #${p.batchId} done${pp.processed != null ? ` (${pp.processed.toLocaleString()} rows)` : ""}${accPart}`,
        })
      }
      if (ev.kind === "batch_predict_failed") {
        toastIfLive({
          kind: "danger",
          message: `Batch #${p.batchId} failed`,
        })
      }
    }
  }, [qc, pushToast])

  useEffect(() => {
    function connect() {
      const es = createGlobalEventSource()
      esRef.current = es

      es.addEventListener("snapshot", (e: MessageEvent) => {
        try {
          const evs = JSON.parse(e.data) as ApiEvent[]
          // Raise the watermark to the newest id in the snapshot. Any event
          // with id ≤ this came from history; only strictly newer events
          // trigger toasts. On a first connect (liveAfterIdRef = +Infinity),
          // snapshot ids are all historical by definition.
          if (evs.length > 0) {
            const maxId = evs.reduce((m, ev) => Math.max(m, ev.id), 0)
            liveAfterIdRef.current = Number.isFinite(liveAfterIdRef.current)
              ? Math.max(liveAfterIdRef.current, maxId)
              : maxId
          } else if (!Number.isFinite(liveAfterIdRef.current)) {
            // Empty snapshot + first connect: anything that arrives is live.
            liveAfterIdRef.current = 0
          }
          setEvents((prev) => {
            // Merge by id to avoid duplicates across reconnects.
            const seen = new Set(prev.map((e) => e.id))
            const add = evs.filter((e) => !seen.has(e.id))
            const all = [...prev, ...add]
            return all.length > MAX_EVENTS ? all.slice(-MAX_EVENTS) : all
          })
        } catch { /* ignore */ }
      })

      const handler = (e: MessageEvent) => {
        try {
          const ev = JSON.parse(e.data) as ApiEvent
          addEvent(ev)
        } catch { /* ignore */ }
      }

      for (const kind of [
        "tool_call", "run_started", "run_stage", "run_progress",
        "run_completed", "run_cancelled", "run_failed",
        "model_registered", "sweep_started", "sweep_completed",
        "sweep_cancelled", "sweep_progress",
        "sweep_wave_started", "sweep_wave_completed",
        "upload",
        "auto_started", "auto_note", "auto_completed",
        "auto_collect_start", "auto_collect_added",
        "calibrated", "drift_detected",
        "batch_predict_started", "batch_predict_progress",
        "batch_predict_completed", "batch_predict_failed",
        "request", "response", "config_reload",
        "task_reset", "task_deleted",
      ]) {
        es.addEventListener(kind, handler)
      }

      es.onerror = () => {
        es.close()
        setTimeout(connect, 3000)
      }
    }

    connect()
    return () => { esRef.current?.close() }
  }, [addEvent])

  return (
    <Ctx.Provider value={{ events, pushToast, activeJob }}>
      {children}
      <AnimatePresence>
        <ToastContainer toasts={toasts} onClose={removeToast} />
      </AnimatePresence>
    </Ctx.Provider>
  )
}

// ── Sidebar feed widget ────────────────────────────────────────────────────────

const KIND_ICON: Record<string, React.ReactNode> = {
  tool_call:        <Wrench size={10} />,
  run_started:      <Play size={10} />,
  run_stage:        <Layers size={10} />,
  run_progress:     <Cpu size={10} />,
  run_completed:    <CheckCircle2 size={10} />,
  run_cancelled:    <AlertCircle size={10} />,
  run_failed:       <AlertCircle size={10} />,
  sweep_started:    <SlidersHorizontal size={10} />,
  sweep_completed:  <SlidersHorizontal size={10} />,
  sweep_cancelled:  <SlidersHorizontal size={10} />,
  sweep_progress:   <SlidersHorizontal size={10} />,
  sweep_wave_started:   <Layers size={10} />,
  sweep_wave_completed: <Layers size={10} />,
  upload:           <Upload size={10} />,
  auto_started:     <Bot size={10} />,
  auto_note:        <BookOpen size={10} />,
  auto_completed:   <Bot size={10} />,
  auto_collect_start: <Database size={10} />,
  auto_collect_added: <Database size={10} />,
  calibrated:       <Thermometer size={10} />,
  drift_detected:   <TrendingUp size={10} />,
  batch_predict_started:   <Cpu size={10} />,
  batch_predict_progress:  <Cpu size={10} />,
  batch_predict_completed: <CheckCircle2 size={10} />,
  batch_predict_failed:    <AlertCircle size={10} />,
  model_registered: <CheckCircle2 size={10} />,
  request:          <Cpu size={10} />,
  response:         <CheckCircle2 size={10} />,
  task_reset:       <RotateCcw size={10} />,
  task_deleted:     <Trash2 size={10} />,
}

const KIND_COLOR: Record<string, string> = {
  run_completed:    "text-[var(--success)]",
  sweep_completed:  "text-[var(--success)]",
  auto_completed:   "text-[var(--success)]",
  model_registered: "text-[var(--success)]",
  run_failed:       "text-[var(--danger)]",
  task_deleted:     "text-[var(--danger)]",
  run_cancelled:    "text-[var(--warning)]",
  sweep_cancelled:  "text-[var(--warning)]",
  request:          "text-[var(--info)]",
  response:         "text-[var(--info)]",
  auto_note:        "text-[var(--accent-text)]",
  auto_started:     "text-[var(--accent-text)]",
  calibrated:       "text-[var(--info)]",
  drift_detected:   "text-[var(--warning)]",
  sweep_wave_completed: "text-[var(--accent-text)]",
  batch_predict_completed: "text-[var(--success)]",
  batch_predict_failed:    "text-[var(--danger)]",
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function eventLabel(ev: ApiEvent): string {
  const p = ev.payload as Record<string, unknown>
  switch (ev.kind) {
    case "tool_call": {
      const parts: string[] = [p.tool as string]
      if (p.lr != null) parts.push(`lr=${p.lr}`)
      if (p.epochs != null) parts.push(`epochs=${p.epochs}`)
      if (p.accuracy_target != null) parts.push(`target=${p.accuracy_target}`)
      if (p.totalConfigs != null) parts.push(`${p.totalConfigs} configs`)
      if (p.path != null) parts.push(`${String(p.path).split("/").pop()}`)
      return parts.join(" · ")
    }
    case "run_started":   return `run started${ev.taskId ? ` (${ev.taskId})` : ""}`
    case "run_stage":     return `${p.stage as string}${p.message ? ` — ${p.message}` : ""}`
    case "run_progress":  return `${p.stage as string}${p.i != null && p.n != null ? ` ${p.i}/${p.n}` : ""}`
    case "run_completed": {
      const acc = p.accuracy as number | undefined
      return `run #${ev.runId} done${acc != null ? ` ${(acc * 100).toFixed(1)}%` : ""}`
    }
    case "run_failed":    return `run #${ev.runId} failed`
    case "run_cancelled": return `run #${ev.runId} cancelled`
    case "sweep_started": return `sweep started (${p.total ?? "?"} configs)`
    case "sweep_progress": return `sweep ${p.idx != null && p.total != null ? `${(p.idx as number) + 1}/${p.total}` : "running"}`
    case "sweep_completed": {
      const best = p.bestAccuracy as number | undefined
      return `sweep done${best != null ? ` — ${(best * 100).toFixed(1)}%` : ""}`
    }
    case "sweep_cancelled": return "sweep cancelled"
    case "auto_started":  return `auto_train started (target ${((p.accuracyTarget as number) * 100).toFixed(0)}%)`
    case "auto_note":     return `[${p.stage}] ${String(p.note).slice(0, 60)}`
    case "auto_completed": {
      const acc = p.accuracy as number | undefined
      return `auto_train done${acc != null ? ` ${(acc * 100).toFixed(1)}%` : ""}`
    }
    case "model_registered": {
      const acc = p.accuracy as number | undefined
      return `model promoted${acc != null ? ` ${(acc * 100).toFixed(1)}%` : ""}${ev.taskId ? ` · ${ev.taskId}` : ""}`
    }
    case "upload":        return `uploaded ${p.total} rows → ${ev.taskId}`
    case "request":       return `asked: ${((p.prompt as string) || "").slice(0, 40)}`
    case "response":      return `Claude answered`
    case "task_reset":    return `task reset: ${ev.taskId}`
    case "task_deleted":  return `task deleted: ${ev.taskId}`
    case "calibrated": {
      const T = p.temperature as number | undefined
      return `calibrated${ev.runId ? ` run #${ev.runId}` : ""}${T != null ? ` · T=${T.toFixed(3)}` : ""}`
    }
    case "drift_detected": {
      const verdict = p.verdict as string | undefined
      const n = p.drifting_features as number | undefined
      return `drift ${verdict ?? "detected"}${n != null ? ` · ${n} features` : ""}${ev.taskId ? ` · ${ev.taskId}` : ""}`
    }
    case "auto_collect_start": {
      const n = p.n_requested as number | undefined
      return `auto_collect started${n != null ? ` · want ${n}` : ""}`
    }
    case "auto_collect_added": {
      const n = p.n_added as number | undefined
      return `auto_collect added${n != null ? ` ${n} samples` : ""}`
    }
    case "sweep_wave_started": {
      const w = p.wave as number | undefined
      const src = p.source as string | undefined
      const total = p.total as number | undefined
      return `wave${w != null ? ` ${w}` : ""} started${src ? ` · ${src}` : ""}${total != null ? ` · ${total} configs` : ""}`
    }
    case "sweep_wave_completed": {
      const w = p.wave as number | undefined
      const best = p.bestAccuracy as number | undefined
      return `wave${w != null ? ` ${w}` : ""} done${best != null ? ` · ${(best * 100).toFixed(1)}%` : ""}`
    }
    case "batch_predict_started": {
      const total = p.total as number | undefined
      return `batch #${p.batchId} started${total != null ? ` · ${total.toLocaleString()} rows` : ""}`
    }
    case "batch_predict_progress": {
      const processed = p.processed as number | undefined
      const total = p.total as number | undefined
      const acc = p.accuracy as number | null | undefined
      const accPart = acc != null ? ` · ${(acc * 100).toFixed(1)}%` : ""
      return `batch #${p.batchId} · ${processed ?? "?"}/${total ?? "?"}${accPart}`
    }
    case "batch_predict_completed": {
      const acc = p.accuracy as number | null | undefined
      const processed = p.processed as number | undefined
      return `batch #${p.batchId} done${processed != null ? ` · ${processed.toLocaleString()} rows` : ""}${acc != null ? ` · ${(acc * 100).toFixed(1)}%` : ""}`
    }
    case "batch_predict_failed":  return `batch #${p.batchId} failed`
    default:              return ev.kind
  }
}

function eventLink(ev: ApiEvent): string | null {
  if (ev.taskId && ev.runId && ["run_completed", "run_started", "run_stage", "calibrated"].includes(ev.kind)) {
    return `/tasks/${encodeURIComponent(ev.taskId)}/runs/${ev.runId}`
  }
  if (ev.taskId && ev.kind === "drift_detected") {
    return `/drift`
  }
  if (ev.kind === "auto_started" || ev.kind === "auto_completed" || ev.kind === "auto_note" ||
      ev.kind === "auto_collect_start" || ev.kind === "auto_collect_added") {
    const autoId = (ev.payload as { autoRunId?: number; auto_run_id?: number }).autoRunId
      ?? (ev.payload as { auto_run_id?: number }).auto_run_id
    if (autoId != null) return `/auto/${autoId}`
    if (ev.taskId) return `/tasks/${encodeURIComponent(ev.taskId)}`
  }
  if (ev.taskId && ["upload", "sweep_completed", "sweep_started", "sweep_wave_started", "sweep_wave_completed"].includes(ev.kind)) {
    return `/tasks/${encodeURIComponent(ev.taskId)}`
  }
  return null
}

// Collapse run_progress rows: keep the latest one per runId, replace older ones in-place
function collapseProgressEvents(events: ApiEvent[]): ApiEvent[] {
  const latestProgressByRun = new Map<number, number>() // runId → index in result
  const result: ApiEvent[] = []

  for (const ev of events) {
    if (ev.kind === "run_progress" && ev.runId != null) {
      const existing = latestProgressByRun.get(ev.runId)
      if (existing !== undefined) {
        result[existing] = ev // update in-place
      } else {
        latestProgressByRun.set(ev.runId, result.length)
        result.push(ev)
      }
    } else {
      result.push(ev)
    }
  }
  return result
}

export function ActivityFeedWidget() {
  const { events } = useFeed()
  const [collapsed, setCollapsed] = useState(false)

  const collapsed_events = collapseProgressEvents(events)
  const visible = collapsed_events.slice(-15).reverse()

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
        <div className="px-1 pb-1 space-y-0.5 max-h-[200px] overflow-y-auto">
          {visible.map((ev) => {
            const link = eventLink(ev)
            const color = KIND_COLOR[ev.kind] ?? "text-[var(--text-3)]"
            const isLive = ev.kind === "run_progress" || ev.kind === "run_stage"
            const content = (
              <div className={clsx(
                "flex items-start gap-1.5 px-2 py-1 rounded hover:bg-[var(--surface-2)] transition-colors",
                color
              )}>
                <span className={clsx("mt-0.5 flex-shrink-0", isLive && "animate-pulse")}>
                  {KIND_ICON[ev.kind] ?? <Activity size={10} />}
                </span>
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

// ── Active job pill (exported for Sidebar) ────────────────────────────────────

export function ActiveJobPill() {
  const { activeJob } = useFeed()
  if (!activeJob) return null

  return (
    <div className="mx-3 mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-border)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-medium text-[var(--accent-text)] capitalize truncate">{activeJob.label}</p>
        {activeJob.message && (
          <p className="text-2xs text-[var(--text-3)] truncate">{activeJob.message}</p>
        )}
      </div>
    </div>
  )
}
