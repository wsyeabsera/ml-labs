import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { BarChart3, ArrowRight, GitCompare, X } from "lucide-react"
import { api } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { StatusDot } from "../components/StatusDot"
import { Empty } from "../components/Empty"
import { clsx } from "clsx"

const MAX_COMPARE = 6

function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor(Date.now() / 1000 - startedAt))
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor(Date.now() / 1000 - startedAt)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return <span>{elapsed}s</span>
}

function pct(v: number | null) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

export function RunsAll() {
  const [taskFilter, setTaskFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ["allRuns"],
    queryFn: api.allRuns,
    refetchInterval: 5000,
  })

  const runs = data?.runs ?? []
  const tasks = [...new Set(runs.map((r) => r.taskId))].sort()
  const statuses = [...new Set(runs.map((r) => r.status))].sort()

  const filtered = runs.filter((r) => {
    if (taskFilter !== "all" && r.taskId !== taskFilter) return false
    if (statusFilter !== "all" && r.status !== statusFilter) return false
    return true
  })

  const toggleSelect = (runId: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) {
        next.delete(runId)
      } else if (next.size < MAX_COMPARE) {
        next.add(runId)
      }
      return next
    })
  }

  const compare = () => {
    if (selected.size < 2) return
    // All selected runs must share a task for /tasks/:id/compare routing.
    const selectedRuns = runs.filter((r) => selected.has(r.id))
    const taskIds = new Set(selectedRuns.map((r) => r.taskId))
    if (taskIds.size > 1) {
      alert("Select runs from the same task to compare.")
      return
    }
    const taskId = selectedRuns[0]!.taskId
    const runsParam = [...selected].join(",")
    navigate(`/tasks/${encodeURIComponent(taskId)}/compare?runs=${runsParam}`)
  }

  return (
    <div>
      <PageHeader
        title="Runs"
        subtitle="All training runs across tasks, newest first."
      />

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className={clsx(
            "text-xs font-mono px-3 py-1.5 rounded-md border transition-colors outline-none cursor-pointer",
            "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
            "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]"
          )}
        >
          <option value="all">All tasks</option>
          {tasks.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={clsx(
            "text-xs font-mono px-3 py-1.5 rounded-md border transition-colors outline-none cursor-pointer",
            "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
            "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]"
          )}
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-xs text-[var(--text-3)] self-center">
          {filtered.length} run{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading && (
        <div className="text-sm text-[var(--text-3)]">Loading runs…</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Empty icon={BarChart3} title="No runs" desc="Train a task to see runs here." />
      )}

      {filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="w-8" />
                {["Run", "Task", "Status", "Accuracy", "Duration", "LR / Epochs"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const isSelected = selected.has(r.id)
                const canSelect = isSelected || selected.size < MAX_COMPARE
                return (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.015, 0.3) }}
                  className={clsx(
                    "border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors group",
                    isSelected && "bg-[var(--surface-2)]",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!canSelect}
                      onChange={() => toggleSelect(r.id)}
                      className={clsx(
                        "w-3.5 h-3.5 cursor-pointer accent-[var(--accent-text)]",
                        !canSelect && "opacity-40 cursor-not-allowed",
                      )}
                      aria-label={`Select run ${r.id} for comparison`}
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-2)]">#{r.id}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/tasks/${encodeURIComponent(r.taskId)}`}
                      className="text-xs font-mono text-[var(--accent-text)] hover:underline"
                    >
                      {r.taskId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={r.status} />
                      <span className="text-xs text-[var(--text-2)]">{r.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.status === "running" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--text-3)]">
                        <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-pulse" />
                        training…
                      </span>
                    ) : (
                      <span className={clsx(
                        "stat-num text-xs",
                        r.accuracy != null && r.accuracy >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-1)]"
                      )}>
                        {r.accuracy != null ? pct(r.accuracy) : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                    {r.durationS != null
                      ? `${r.durationS}s`
                      : r.status === "running" && r.startedAt
                      ? <LiveElapsed startedAt={r.startedAt} />
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">
                    {(r.hyperparams as { lr?: number; epochs?: number }).lr ?? "—"} / {(r.hyperparams as { lr?: number; epochs?: number }).epochs ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/tasks/${encodeURIComponent(r.taskId)}/runs/${r.id}`}
                      className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex"
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
      )}

      {/* Floating Compare button — appears when ≥2 runs selected */}
      <AnimatePresence>
        {selected.size >= 2 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--accent-border)] shadow-lg"
          >
            <span className="text-xs text-[var(--text-2)]">
              {selected.size} run{selected.size !== 1 ? "s" : ""} selected
              {selected.size >= MAX_COMPARE && " (max)"}
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
              aria-label="Clear selection"
            >
              <X size={14} />
            </button>
            <button
              onClick={compare}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--accent-text)] text-[var(--surface-1)] text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <GitCompare size={13} />
              Compare
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
