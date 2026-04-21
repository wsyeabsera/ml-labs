import { useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { Database, AlertTriangle, ArrowRight, GitCompare, Trash2, RotateCcw } from "lucide-react"
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts"
import { api, type ApiRun } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { StatusDot } from "../components/StatusDot"
import { Empty } from "../components/Empty"
import { ActiveRunCard } from "../components/ActiveRunCard"
import { DriftBanner } from "../components/DriftBanner"
import { ShadowCard } from "../components/ShadowCard"
import { clsx } from "clsx"

function pct(v: number | null) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

// ── Accuracy trend chart ───────────────────────────────────────────────────────

function AccuracyTrend({ runs }: { runs: ApiRun[] }) {
  const completed = [...runs]
    .filter((r) => r.accuracy != null && r.status === "completed")
    .reverse()
    .slice(-30)

  if (completed.length < 2) return null

  const data = completed.map((r) => ({
    run: `#${r.id}`,
    accuracy: +(r.accuracy! * 100).toFixed(1),
  }))

  const best = Math.max(...data.map((d) => d.accuracy))
  const worst = Math.min(...data.map((d) => d.accuracy))
  const range = best - worst
  const yMin = Math.max(0, Math.floor((worst - range * 0.1) / 5) * 5)
  const yMax = Math.min(100, Math.ceil((best + range * 0.1) / 5) * 5)

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium text-[var(--text-2)]">Accuracy trend</p>
        <span className="text-2xs text-[var(--text-3)]">last {completed.length} completed runs</span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="accGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="run"
            tick={{ fontSize: 9, fill: "var(--text-3)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: "var(--text-3)" }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-2)", border: "1px solid var(--border)",
              borderRadius: 6, fontSize: 11, color: "var(--text-1)",
            }}
            formatter={(v: number) => [`${v}%`, "accuracy"]}
          />
          <ReferenceLine y={90} stroke="var(--success)" strokeDasharray="4 3" strokeWidth={1} />
          <Area
            type="monotone"
            dataKey="accuracy"
            stroke="var(--accent-text)"
            strokeWidth={1.5}
            fill="url(#accGradient)"
            dot={{ r: 3, fill: "var(--accent-text)", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "var(--accent-text)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Dataset tab ────────────────────────────────────────────────────────────────

function FeatureRangeBar({ min, max, mean }: { min: number; max: number; mean: number }) {
  const range = max - min
  const pct = range > 0 ? ((mean - min) / range) * 100 : 50
  return (
    <div className="relative h-1.5 w-20 rounded-full bg-[var(--surface-3)]">
      <div
        className="absolute h-1.5 rounded-full bg-[var(--accent-dim)]"
        style={{ left: 0, width: `${Math.min(100, pct)}%` }}
      />
      <div
        className="absolute w-1.5 h-1.5 rounded-full bg-[var(--accent-text)] -translate-x-1/2"
        style={{ left: `${Math.min(100, pct)}%` }}
      />
    </div>
  )
}

function DatasetTab({
  inspect,
}: {
  inspect: NonNullable<ReturnType<typeof useQuery>["data"]> & {
    features?: { stats: Array<{ name: string; mean: number; std: number; min: number; max: number; constant: boolean }> }
    class_distribution?: Record<string, number> | null
    splits?: { train: number; test: number }
  }
}) {
  const stats = inspect.features?.stats ?? []
  const classDist = inspect.class_distribution ?? {}
  const classEntries = Object.entries(classDist)
  const maxCount = classEntries.length > 0 ? Math.max(...classEntries.map(([, v]) => v)) : 1
  const total = classEntries.reduce((s, [, v]) => s + v, 0) || 1

  return (
    <div className="space-y-6">
      {/* Split info */}
      {inspect.splits && (inspect.splits.train > 0 || inspect.splits.test > 0) && (
        <div className="card p-4">
          <p className="text-xs font-medium text-[var(--text-2)] mb-3">Train / Test Split</p>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-2xs text-[var(--text-3)]">Train</p>
              <p className="stat-num text-base text-[var(--text-1)]">{inspect.splits.train}</p>
            </div>
            <div className="text-[var(--text-3)]">/</div>
            <div>
              <p className="text-2xs text-[var(--text-3)]">Test</p>
              <p className="stat-num text-base text-[var(--text-1)]">{inspect.splits.test}</p>
            </div>
            <div className="flex-1 h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${(inspect.splits.train / (inspect.splits.train + inspect.splits.test)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Feature stats */}
        {stats.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-xs font-medium text-[var(--text-2)]">Feature Statistics</p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  {["Feature", "Mean", "Std", "Range"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((f) => (
                  <tr
                    key={f.name}
                    className={clsx(
                      "border-b border-[var(--border-subtle)]",
                      f.constant && "opacity-50"
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-[var(--text-1)] max-w-[120px] truncate">{f.name}</td>
                    <td className="px-3 py-2 stat-num text-[var(--text-2)]">{f.mean.toFixed(2)}</td>
                    <td className="px-3 py-2 stat-num text-[var(--text-3)]">±{f.std.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <FeatureRangeBar min={f.min} max={f.max} mean={f.mean} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Class distribution */}
        {classEntries.length > 0 && (
          <div className="card p-4">
            <p className="text-xs font-medium text-[var(--text-2)] mb-4">Class Distribution</p>
            <div className="space-y-3">
              {classEntries.map(([label, count]) => (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-mono text-[var(--text-1)]">{label}</span>
                    <span className="text-[var(--text-3)]">{count} ({((count / total) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(count / maxCount) * 100}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className="h-full rounded-full bg-[var(--accent)]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Empty */}
      {stats.length === 0 && classEntries.length === 0 && (
        <Empty icon={Database} title="No data loaded" desc="Load data with load_csv to see dataset stats." />
      )}
    </div>
  )
}

// ── Reset dialog ──────────────────────────────────────────────────────────────

function ResetDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"reset" | "delete">("reset")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.resetTask(taskId, mode)
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.invalidateQueries({ queryKey: ["task", taskId] })
      qc.invalidateQueries({ queryKey: ["runs", taskId] })
      qc.invalidateQueries({ queryKey: ["allRuns"] })
      if (result.deleted) { navigate("/") } else { onClose() }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className="card-elevated w-[420px] p-5 shadow-2xl border border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[var(--danger-dim)] flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={15} className="text-[var(--danger)]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-1)]">Reset task</p>
            <p className="text-xs text-[var(--text-3)] font-mono">{taskId}</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {([
            { value: "reset",  icon: RotateCcw, label: "Clear data",   desc: "Wipe all samples, runs, and model weights. Keep the task ID so you can re-upload data." },
            { value: "delete", icon: Trash2,    label: "Delete task",  desc: "Remove everything including the task definition. Cannot be undone." },
          ] as const).map(({ value, icon: Icon, label, desc }) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={clsx(
                "w-full text-left p-3 rounded-lg border transition-colors",
                mode === value
                  ? "border-[var(--danger)] bg-[var(--danger-dim)]"
                  : "border-[var(--border)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]"
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Icon size={12} className={mode === value ? "text-[var(--danger)]" : "text-[var(--text-3)]"} />
                <span className={clsx("text-xs font-medium", mode === value ? "text-[var(--danger)]" : "text-[var(--text-1)]")}>{label}</span>
              </div>
              <p className="text-2xs text-[var(--text-3)] ml-[20px]">{desc}</p>
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-[var(--danger)] mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--danger-dim)] text-[var(--danger)] border border-[var(--danger)] hover:bg-[var(--danger)] hover:text-white transition-all disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "delete" ? "Delete task" : "Clear data"}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── TaskDetail ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "dataset" | "runs"

export function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const taskId = decodeURIComponent(id ?? "")
  const [tab, setTab] = useState<Tab>("overview")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showReset, setShowReset] = useState(false)
  const navigate = useNavigate()

  function toggleSelect(runId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) { next.delete(runId) } else { next.add(runId) }
      return next
    })
  }

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.task(taskId),
    enabled: !!taskId,
    refetchInterval: 3000,
  })
  const { data: inspectData } = useQuery({
    queryKey: ["inspect", taskId],
    queryFn: () => api.inspect(taskId),
    enabled: !!taskId && (tab === "dataset" || tab === "overview"),
    refetchInterval: 15000,
  })
  const { data: runsData } = useQuery({
    queryKey: ["runs", taskId],
    queryFn: () => api.runs(taskId),
    enabled: !!taskId,
    refetchInterval: 3000,
  })

  if (isLoading || !task) {
    return <div className="text-sm text-[var(--text-3)]">Loading…</div>
  }

  const inspect = inspectData
  const runs = runsData?.runs ?? []
  const hasSplit = task.testCount > 0

  return (
    <div>
      <PageHeader
        title={task.id}
        subtitle={`${task.kind} · ${task.featureShape[0]}D features`}
        action={
          <button
            onClick={() => setShowReset(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-3)] border border-[var(--border)] rounded-md hover:text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-dim)] transition-all"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        }
      />

      <AnimatePresence>
        {showReset && <ResetDialog taskId={taskId} onClose={() => setShowReset(false)} />}
      </AnimatePresence>

      <DriftBanner taskId={taskId} />
      <ShadowCard taskId={taskId} runs={runs} />

      {/* Meta grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Samples",  value: String(task.sampleCount) },
          { label: "Train",    value: hasSplit ? String(task.trainCount) : "—" },
          { label: "Test",     value: hasSplit ? String(task.testCount)  : "—" },
          { label: "Accuracy", value: pct(task.accuracy), accent: (task.accuracy ?? 0) >= 0.9 },
        ].map(({ label, value, accent }) => (
          <div key={label} className="card p-3">
            <p className="text-2xs text-[var(--text-3)] mb-1">{label}</p>
            <p className={clsx("stat-num text-lg", accent ? "text-[var(--success)]" : "text-[var(--text-1)]")}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 mb-5 border-b border-[var(--border)]">
        {(["overview", "dataset", "runs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-[var(--accent)] text-[var(--text-1)]"
                : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && task.activeRunId && task.lastRunStatus === "running" && (
        <div className="mb-5">
          <p className="section-label mb-2">Live</p>
          <ActiveRunCard taskId={taskId} runId={task.activeRunId} />
        </div>
      )}

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-xs font-medium text-[var(--text-2)] mb-3">
              {task.kind === "classification" ? "Classes" : "Target"}
            </p>
            {task.kind === "classification" && task.labels && (
              <div className="flex flex-wrap gap-1.5">
                {task.labels.map((l) => (
                  <span key={l} className="badge badge-violet">{l}</span>
                ))}
              </div>
            )}
            {task.kind === "regression" && (
              <p className="text-sm text-[var(--text-2)]">Continuous output</p>
            )}
            {task.normalize && (
              <p className="text-xs text-[var(--text-3)] mt-2">Z-score normalization enabled</p>
            )}
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium text-[var(--text-2)] mb-3">Diagnostics</p>
            {inspect?.warnings && inspect.warnings.length > 0 ? (
              <div className="space-y-1.5">
                {inspect.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2 text-xs text-[var(--warning)]">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--success)]">No warnings</p>
            )}
          </div>
        </div>
      )}

      {/* Dataset tab */}
      {tab === "dataset" && inspect && (
        <DatasetTab inspect={inspect as any} />
      )}
      {tab === "dataset" && !inspect && (
        <div className="text-sm text-[var(--text-3)]">Loading dataset stats…</div>
      )}

      {/* Runs tab */}
      {tab === "runs" && (
        <div>
          {runs.length === 0 ? (
            <Empty icon={Database} title="No runs yet" desc="Train this task to see runs here." />
          ) : (
            <>
              <AccuracyTrend runs={runs} />

              {/* Compare bar */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-2xs text-[var(--text-3)]">
                  {selected.size === 0
                    ? "Check two runs to compare them"
                    : selected.size === 1
                    ? "Select one more run to compare"
                    : `${selected.size} runs selected`}
                </p>
                {selected.size === 2 && (
                  <button
                    onClick={() => {
                      const [a, b] = [...selected]
                      navigate(`/tasks/${encodeURIComponent(taskId)}/compare?a=${a}&b=${b}`)
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium text-white bg-[var(--accent)] px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
                  >
                    <GitCompare size={12} />
                    Compare runs
                  </button>
                )}
              </div>

              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="w-10 px-3 py-2.5" />
                      {["Run", "Status", "Accuracy", "Val Acc", "Duration", "LR / Epochs"].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r, i) => {
                      const isSelected = selected.has(r.id)
                      const canSelect = r.status === "completed" && r.accuracy != null
                      return (
                        <motion.tr
                          key={r.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.02 }}
                          className={clsx(
                            "border-b border-[var(--border-subtle)] transition-colors group",
                            isSelected ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--surface-2)]"
                          )}
                        >
                          <td className="px-3 py-2.5">
                            {canSelect && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(r.id)}
                                disabled={selected.size >= 2 && !isSelected}
                                className="accent-[var(--accent)] cursor-pointer disabled:opacity-30"
                              />
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-2)]">#{r.id}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <StatusDot status={r.status} />
                              <span className="text-xs text-[var(--text-2)]">{r.status}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-1)]">
                            {r.accuracy != null ? pct(r.accuracy) : "—"}
                          </td>
                          <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                            {r.valAccuracy != null ? pct(r.valAccuracy) : "—"}
                          </td>
                          <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                            {r.durationS != null
                              ? `${r.durationS}s`
                              : r.status === "running" && r.startedAt
                              ? `${Math.floor(Date.now() / 1000 - r.startedAt)}s`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">
                            {(r.hyperparams as { lr?: number; epochs?: number }).lr ?? "—"} / {(r.hyperparams as { lr?: number; epochs?: number }).epochs ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <Link
                              to={`/tasks/${encodeURIComponent(taskId)}/runs/${r.id}`}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ArrowRight size={13} className="text-[var(--accent-text)]" />
                            </Link>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Default runs list on overview when no tab selected (mini version) */}
      {tab === "overview" && runs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Recent runs ({runs.length})</p>
            <button
              onClick={() => setTab("runs")}
              className="text-xs text-[var(--accent-text)] hover:underline"
            >
              View all
            </button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Run", "Status", "Accuracy", "Duration", "LR / Epochs"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors group"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-2)]">#{r.id}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={r.status} />
                        <span className="text-xs text-[var(--text-2)]">{r.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-1)]">
                      {r.accuracy != null ? pct(r.accuracy) : "—"}
                    </td>
                    <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                      {r.durationS != null
                        ? `${r.durationS}s`
                        : r.status === "running" && r.startedAt
                        ? `${Math.floor(Date.now() / 1000 - r.startedAt)}s`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">
                      {(r.hyperparams as { lr?: number; epochs?: number }).lr ?? "—"} / {(r.hyperparams as { lr?: number; epochs?: number }).epochs ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/tasks/${encodeURIComponent(taskId)}/runs/${r.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ArrowRight size={13} className="text-[var(--accent-text)]" />
                      </Link>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
