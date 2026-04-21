import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight } from "lucide-react"
import { api, createRunEventSource } from "../lib/api"
import { clsx } from "clsx"

interface Props {
  taskId: string
  runId: number
  compact?: boolean
}

interface LiveProgress {
  stage: string | null
  i: number | null
  n: number | null
  message: string | null
  lossHistory: number[] | null
  epochsDone: number | null
}

function formatEta(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—"
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s - m * 60)
  return `${m}m${sec ? ` ${sec}s` : ""}`
}

// Tiny inline SVG sparkline — avoids a recharts import in the sidebar hot-path.
function LossSparkline({ data, width = 120, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = Math.max(max - min, 1e-9)
  const step = width / Math.max(data.length - 1, 1)
  const pts = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="flex-shrink-0" aria-hidden>
      <polyline
        fill="none"
        stroke="var(--accent-text)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  )
}

export function ActiveRunCard({ taskId, runId, compact = false }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const [live, setLive] = useState<LiveProgress>({
    stage: null, i: null, n: null, message: null, lossHistory: null, epochsDone: null,
  })
  const esRef = useRef<EventSource | null>(null)

  const { data: run } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.run(runId),
    enabled: !!runId,
    refetchInterval: 5000,
  })

  // Elapsed ticker
  useEffect(() => {
    if (!run?.startedAt) return
    const update = () => setElapsed(Math.floor(Date.now() / 1000 - run.startedAt!))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [run?.startedAt])

  // SSE for live stage/progress
  useEffect(() => {
    if (!runId) return
    const es = createRunEventSource(runId)
    esRef.current = es

    const onMsg = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as {
          stage?: string; i?: number; n?: number; message?: string
          lossHistory?: number[]; epochsDone?: number
        }
        setLive({
          stage: d.stage ?? null,
          i: d.i ?? null,
          n: d.n ?? null,
          message: d.message ?? null,
          lossHistory: d.lossHistory ?? null,
          epochsDone: d.epochsDone ?? null,
        })
      } catch {}
    }

    es.addEventListener("progress", onMsg)
    es.addEventListener("complete", () => es.close())
    es.onerror = () => es.close()

    return () => es.close()
  }, [runId])

  if (!run || run.status !== "running") return null

  const stage = live.stage ?? run.runProgress?.stage ?? null
  const message = live.message ?? run.runProgress?.message ?? null
  const i = live.i ?? run.runProgress?.i ?? null
  const n = live.n ?? run.runProgress?.n ?? null
  const hp = run.hyperparams as { lr?: number; epochs?: number; lr_schedule?: string }
  const hasProgress = i != null && n != null && n > 0

  const lossHistory = live.lossHistory ?? run.runProgress?.lossHistory ?? null
  const hasLoss = (lossHistory?.length ?? 0) >= 2
  const lastLoss = lossHistory && lossHistory.length > 0 ? lossHistory[lossHistory.length - 1]! : null
  const epochsDone = live.epochsDone ?? run.runProgress?.epochsDone ?? null

  // ETA: prefer epochsDone + total epochs; fall back to i/n stage progress.
  let etaS: number | null = null
  if (elapsed > 0 && epochsDone != null && epochsDone > 0 && hp.epochs != null && hp.epochs > epochsDone) {
    etaS = (elapsed / epochsDone) * (hp.epochs - epochsDone)
  } else if (elapsed > 0 && hasProgress && i! > 0) {
    etaS = (elapsed / i!) * (n! - i!)
  }

  if (compact) {
    return (
      <Link
        to={`/tasks/${encodeURIComponent(taskId)}/runs/${runId}`}
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] hover:border-[var(--accent)] transition-colors group"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-[var(--accent-text)] font-mono truncate">{taskId}</span>
            <span className="text-2xs text-[var(--text-3)] capitalize flex-shrink-0">{stage ?? "training"}</span>
          </div>
          {hasProgress && (
            <div className="mt-1 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${(i! / n!) * 100}%` }}
              />
            </div>
          )}
        </div>
        <span className="text-2xs font-mono text-[var(--text-3)] flex-shrink-0">{elapsed}s</span>
        <ArrowRight size={11} className="text-[var(--text-3)] group-hover:text-[var(--accent-text)] transition-colors flex-shrink-0" />
      </Link>
    )
  }

  return (
    <div className="card p-4 border-[var(--accent-border)] bg-[var(--accent-dim)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse flex-shrink-0" />
          <span className="text-xs font-medium text-[var(--accent-text)] capitalize">{stage ?? "training"}</span>
          {stage === "train" && !hasProgress && !hasLoss && (
            <span className="text-2xs text-[var(--text-3)]">warming up…</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="stat-num text-xs text-[var(--text-3)]">{elapsed}s</span>
          {etaS != null && (
            <span className="stat-num text-xs text-[var(--text-3)]" title="estimated time remaining">
              eta {formatEta(etaS)}
            </span>
          )}
          <Link
            to={`/tasks/${encodeURIComponent(taskId)}/runs/${runId}`}
            className="text-2xs text-[var(--accent-text)] hover:underline"
          >
            run #{runId}
          </Link>
        </div>
      </div>

      {/* Progress bar (featurize/eval) */}
      {hasProgress && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-2xs text-[var(--text-3)] mb-1">
            <span>{message || stage}</span>
            <span>{i}/{n}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${(i! / n!) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Message (no i/n) */}
      {!hasProgress && message && (
        <p className="text-2xs text-[var(--text-3)] mb-2 truncate">{message}</p>
      )}

      {/* Live loss sparkline */}
      {hasLoss && lossHistory && (
        <div className="flex items-center gap-3 mb-2">
          <LossSparkline data={lossHistory} width={140} height={28} />
          <div className="flex flex-col leading-tight">
            <span className="text-2xs text-[var(--text-3)] font-mono">loss</span>
            <span className="text-xs text-[var(--text-1)] font-mono">{lastLoss?.toFixed(5)}</span>
          </div>
          {epochsDone != null && hp.epochs != null && (
            <div className="flex flex-col leading-tight ml-auto">
              <span className="text-2xs text-[var(--text-3)] font-mono">epoch</span>
              <span className="text-xs text-[var(--text-1)] font-mono">{epochsDone}/{hp.epochs}</span>
            </div>
          )}
        </div>
      )}

      {/* Hyperparams */}
      <div className="flex items-center gap-3 text-2xs text-[var(--text-3)] font-mono">
        {hp.lr != null && <span>lr {hp.lr}</span>}
        {hp.lr_schedule && <span>sched {hp.lr_schedule}</span>}
        {hp.epochs != null && <span>{hp.epochs} epochs</span>}
        <span
          className={clsx(
            "ml-auto",
            stage === "train" && !hasProgress && !hasLoss ? "animate-pulse" : ""
          )}
        >
          {stage === "train" && !hasProgress && !hasLoss ? "training…" : ""}
        </span>
      </div>
    </div>
  )
}
