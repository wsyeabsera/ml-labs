import { useParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, X } from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import { api, createRunEventSource } from "../lib/api"
import { StatusDot } from "../components/StatusDot"
import { clsx } from "clsx"

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

// ── Loss curve ─────────────────────────────────────────────────────────────────

function LossCurve({ history }: { history: number[] }) {
  const data = history.map((loss, i) => ({ epoch: i + 1, loss: +loss.toFixed(5) }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="epoch"
          tick={{ fontSize: 10, fill: "var(--text-3)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          label={{ value: "epoch", position: "insideBottom", offset: -2, fontSize: 9, fill: "var(--text-3)" }}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--text-3)" }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => v.toFixed(3)}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--text-1)",
          }}
          formatter={(v: number) => [v.toFixed(5), "loss"]}
        />
        <Line
          type="monotone"
          dataKey="loss"
          stroke="var(--accent-text)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "var(--accent-text)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Confusion matrix ───────────────────────────────────────────────────────────

function ConfusionMatrix({
  matrix, labels, onCellClick,
}: {
  matrix: number[][]
  labels: string[]
  onCellClick?: (trueLabel: string, predLabel: string, count: number) => void
}) {
  const n = matrix.length
  const rowMaxes = matrix.map((row) => Math.max(...row, 1))

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        {/* Column headers */}
        <div className="flex gap-0.5 mb-0.5 pl-16">
          {labels.slice(0, n).map((l) => (
            <div key={l} className="w-12 text-center text-2xs text-[var(--text-3)] truncate px-0.5">{l}</div>
          ))}
        </div>
        {matrix.map((row, i) => (
          <div key={i} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-16 text-right pr-2 text-2xs text-[var(--text-3)] truncate">{labels[i] ?? `C${i}`}</div>
            {row.map((val, j) => {
              const intensity = val / rowMaxes[i]!
              const isDiag = i === j
              const clickable = onCellClick != null && val > 0
              return (
                <motion.button
                  key={j}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onCellClick!(labels[i] ?? `C${i}`, labels[j] ?? `C${j}`, val)}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (i * n + j) * 0.02 }}
                  className={clsx(
                    "w-12 h-10 flex items-center justify-center text-xs font-mono rounded-sm",
                    isDiag ? "font-semibold" : "font-normal",
                    clickable ? "cursor-pointer hover:ring-2 hover:ring-[var(--accent-border)] transition-all" : "cursor-default",
                  )}
                  style={{
                    background: isDiag
                      ? `rgba(124, 58, 237, ${0.15 + intensity * 0.7})`
                      : `rgba(248, 113, 113, ${intensity * 0.5})`,
                    color: isDiag
                      ? `rgba(196, 181, 253, ${0.6 + intensity * 0.4})`
                      : val > 0 ? "var(--danger)" : "var(--text-3)",
                  }}
                >
                  {val}
                </motion.button>
              )
            })}
          </div>
        ))}
        <p className="text-2xs text-[var(--text-3)] mt-2 pl-16">
          ← actual / predicted →  {onCellClick ? "(click a non-zero cell to see samples)" : ""}
        </p>
      </div>
    </div>
  )
}

// ── Confusion drill-through drawer ───────────────────────────────────────────

function ConfusionDrawer({
  runId, trueLabel, predLabel, onClose,
}: {
  runId: number
  trueLabel: string
  predLabel: string
  onClose: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["confusions", runId, trueLabel, predLabel],
    queryFn: () => api.runConfusions(runId, trueLabel, predLabel),
  })

  const isMismatch = trueLabel !== predLabel

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.2 }}
      className="fixed top-0 right-0 bottom-0 w-full max-w-xl z-50 bg-[var(--surface-1)] border-l border-[var(--border)] shadow-2xl overflow-y-auto"
    >
      <div className="sticky top-0 bg-[var(--surface-1)] border-b border-[var(--border)] px-5 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--text-3)]">Samples where</p>
          <p className="text-sm font-mono">
            <span className="text-[var(--text-1)]">true=</span>
            <span className="text-[var(--accent-text)]">{trueLabel}</span>
            <span className="text-[var(--text-3)]"> → </span>
            <span className="text-[var(--text-1)]">predicted=</span>
            <span className={isMismatch ? "text-[var(--danger)]" : "text-[var(--success)]"}>{predLabel}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors p-1"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-5">
        {isLoading && <p className="text-sm text-[var(--text-3)]">Loading matching samples…</p>}
        {error && <p className="text-sm text-[var(--danger)]">{(error as Error).message}</p>}
        {data && (
          <>
            <p className="text-xs text-[var(--text-2)] mb-3">
              {data.samples.length} sample{data.samples.length !== 1 ? "s" : ""} — sorted by model confidence
            </p>
            {data.samples.length === 0 && (
              <p className="text-sm text-[var(--text-3)]">No samples match this combination.</p>
            )}
            <div className="space-y-2">
              {data.samples.map((s) => (
                <div key={s.sample_id} className="card p-3 text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[var(--text-2)]">sample #{s.sample_id}</span>
                    <span className={clsx(
                      "stat-num",
                      s.confidence >= 0.9 ? "text-[var(--danger)]" :
                      s.confidence >= 0.7 ? "text-[var(--warning)]" :
                      "text-[var(--text-3)]"
                    )}>
                      conf {(s.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-2xs text-[var(--text-3)] font-mono truncate">
                    features: [{s.features.slice(0, 8).map((f) => f.toFixed(2)).join(", ")}{s.features.length > 8 ? ", …" : ""}]
                  </p>
                  {/* Top-3 scores */}
                  <div className="mt-1.5 flex items-center gap-2 text-2xs font-mono">
                    {data.labels.slice(0, 5).map((l, i) => {
                      const p = s.scores[i] ?? 0
                      if (p < 0.05) return null
                      return (
                        <span
                          key={l}
                          className={l === trueLabel ? "text-[var(--success)]" : l === predLabel ? "text-[var(--danger)]" : "text-[var(--text-3)]"}
                        >
                          {l}={(p * 100).toFixed(0)}%
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ── Per-class accuracy bars ────────────────────────────────────────────────────

function PerClassAccuracy({ perClass }: { perClass: Record<string, number> }) {
  const entries = Object.entries(perClass).sort(([, a], [, b]) => b - a)

  return (
    <div className="space-y-2.5">
      {entries.map(([label, acc]) => (
        <div key={label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-mono text-[var(--text-1)]">{label}</span>
            <span className={clsx(
              "stat-num",
              acc >= 0.9 ? "text-[var(--success)]" : acc >= 0.7 ? "text-[var(--warning)]" : "text-[var(--danger)]"
            )}>{pct(acc)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${acc * 100}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={clsx(
                "h-full rounded-full",
                acc >= 0.9 ? "bg-[var(--success)]" : acc >= 0.7 ? "bg-[var(--warning)]" : "bg-[var(--danger)]"
              )}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── RunDetail ──────────────────────────────────────────────────────────────────

export function RunDetail() {
  const { id: taskIdRaw, runId } = useParams<{ id: string; runId: string }>()
  const taskId = decodeURIComponent(taskIdRaw ?? "")
  const runIdNum = parseInt(runId ?? "0")

  const { data: run, isLoading } = useQuery({
    queryKey: ["run", runIdNum],
    queryFn: () => api.run(runIdNum),
    enabled: !!runIdNum,
    refetchInterval: (q) => q.state.data?.status === "running" ? 1000 : false,
  })

  const [elapsed, setElapsed] = useState(0)
  const [liveStage, setLiveStage] = useState<string | null>(null)
  const [liveMessage, setLiveMessage] = useState<string | null>(null)
  const [drill, setDrill] = useState<{ trueLabel: string; predLabel: string } | null>(null)

  // Live elapsed clock
  useEffect(() => {
    if (run?.status !== "running" || !run.startedAt) return
    const update = () => setElapsed(Math.floor(Date.now() / 1000 - run.startedAt!))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [run?.status, run?.startedAt])

  // SSE subscription for stage/message updates
  useEffect(() => {
    if (!runIdNum || run?.status !== "running") return
    const es = createRunEventSource(runIdNum)
    const onProgress = (e: Event) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { stage?: string; message?: string }
        if (d.stage) setLiveStage(d.stage)
        if (d.message) setLiveMessage(d.message)
      } catch {}
    }
    es.addEventListener("progress", onProgress)
    es.addEventListener("complete", () => es.close())
    es.onerror = () => es.close()
    return () => es.close()
  }, [run?.status, runIdNum])

  if (isLoading || !run) {
    return <div className="text-sm text-[var(--text-3)]">Loading run…</div>
  }

  const hp = run.hyperparams as { lr?: number; epochs?: number; hidden_layers?: number[]; activation?: string }
  const stage = liveStage ?? run.runProgress?.stage ?? null
  const stageMsg = liveMessage ?? run.runProgress?.message ?? null
  const durationDisplay = run.durationS != null
    ? `${run.durationS}s`
    : run.status === "running" && run.startedAt
    ? `${elapsed}s`
    : "—"
  const hasLoss = run.lossHistory && run.lossHistory.length > 0
  const hasMatrix = run.confusionMatrix && run.confusionMatrix.length > 0
  const hasPerClass = run.perClassAccuracy && Object.keys(run.perClassAccuracy).length > 0
  const classLabels = hasPerClass ? Object.keys(run.perClassAccuracy!) : []

  return (
    <div>
      {/* Back */}
      <Link
        to={`/tasks/${encodeURIComponent(taskId)}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] mb-5 transition-colors"
      >
        <ArrowLeft size={12} />
        {taskId}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-1)] font-mono">Run #{run.id}</h1>
          <p className="text-sm text-[var(--text-3)] mt-0.5">
            {hp.lr != null ? `lr ${hp.lr}` : ""}
            {hp.epochs != null ? ` · ${hp.epochs} epochs` : ""}
            {` · ${durationDisplay}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <StatusDot status={run.status} />
            <span className="text-sm text-[var(--text-2)]">{run.status}</span>
          </div>
          {run.accuracy != null && (
            <span className={clsx(
              "stat-num text-lg",
              run.accuracy >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-1)]"
            )}>
              {pct(run.accuracy)}
            </span>
          )}
        </div>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Accuracy",     value: pct(run.accuracy),    accent: (run.accuracy ?? 0) >= 0.9 },
          { label: "Val accuracy", value: pct(run.valAccuracy), accent: (run.valAccuracy ?? 0) >= 0.9 },
          { label: "Epochs",       value: hp.epochs != null ? String(hp.epochs) : "—", accent: false },
          { label: "Duration",     value: durationDisplay, accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} className="card p-3">
            <p className="text-2xs text-[var(--text-3)] mb-1">{label}</p>
            <p className={clsx("stat-num text-base", accent ? "text-[var(--success)]" : "text-[var(--text-1)]")}>{value}</p>
          </div>
        ))}
      </div>

      {/* Live training progress */}
      {run.status === "running" && (
        <div className="card p-4 mb-6 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--text-1)] capitalize">{stage ?? "training"}</p>
            {stageMsg && <p className="text-2xs text-[var(--text-3)] mt-0.5 truncate">{stageMsg}</p>}
          </div>
          <span className="ml-auto stat-num text-xs text-[var(--text-3)] flex-shrink-0">{elapsed}s</span>
        </div>
      )}

      {/* Regression metrics */}
      {(run.mae != null || run.rmse != null || run.r2 != null) && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "MAE",  value: run.mae  != null ? run.mae.toFixed(4)  : "—" },
            { label: "RMSE", value: run.rmse != null ? run.rmse.toFixed(4) : "—" },
            { label: "R²",   value: run.r2   != null ? run.r2.toFixed(4)   : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="card p-3">
              <p className="text-2xs text-[var(--text-3)] mb-1">{label}</p>
              <p className="stat-num text-base text-[var(--text-1)]">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loss curve + Confusion matrix */}
      {(hasLoss || hasMatrix) && (
        <div className={clsx("grid gap-4 mb-6", hasLoss && hasMatrix ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1")}>
          {hasLoss && (
            <div className="card p-4">
              <p className="text-xs font-medium text-[var(--text-2)] mb-4">
                Loss Curve
                <span className="text-[var(--text-3)] font-normal ml-2">{run.lossHistory!.length} epochs</span>
              </p>
              <LossCurve history={run.lossHistory!} />
            </div>
          )}
          {hasMatrix && (
            <div className="card p-4">
              <p className="text-xs font-medium text-[var(--text-2)] mb-4">Confusion Matrix</p>
              <ConfusionMatrix
                matrix={run.confusionMatrix!}
                labels={classLabels}
                onCellClick={(trueLabel, predLabel) => setDrill({ trueLabel, predLabel })}
              />
            </div>
          )}
        </div>
      )}

      {/* Per-class accuracy */}
      {hasPerClass && (
        <div className="card p-4 mb-6">
          <p className="text-xs font-medium text-[var(--text-2)] mb-4">Per-class Accuracy</p>
          <PerClassAccuracy perClass={run.perClassAccuracy!} />
        </div>
      )}

      {/* Hyperparams */}
      <div className="card p-4">
        <p className="text-xs font-medium text-[var(--text-2)] mb-3">Hyperparameters</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
          {Object.entries(hp).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 text-xs border-b border-[var(--border-subtle)] pb-1.5">
              <span className="text-[var(--text-3)] font-mono">{k}</span>
              <span className="text-[var(--text-1)] font-mono">{JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Confusion drill-through drawer */}
      <AnimatePresence>
        {drill && (
          <ConfusionDrawer
            runId={runIdNum}
            trueLabel={drill.trueLabel}
            predLabel={drill.predLabel}
            onClose={() => setDrill(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
