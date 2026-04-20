import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { BarChart3, ArrowRight } from "lucide-react"
import { api } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { StatusDot } from "../components/StatusDot"
import { Empty } from "../components/Empty"
import { clsx } from "clsx"

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
                {["Run", "Task", "Status", "Accuracy", "Duration", "LR / Epochs"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.015, 0.3) }}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors group"
                >
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
