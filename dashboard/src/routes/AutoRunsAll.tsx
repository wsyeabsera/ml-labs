import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Bot, ArrowRight } from "lucide-react"
import { api } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { Empty } from "../components/Empty"
import { clsx } from "clsx"

function pct(v: number | null) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

function wallClockS(start: string, finish: string | null): string {
  if (!finish) return "—"
  const s = Math.round((Date.parse(finish) - Date.parse(start)) / 1000)
  if (!Number.isFinite(s) || s < 0) return "—"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s - m * 60}s`
}

const STATUS_COLOR: Record<string, string> = {
  running:         "text-[var(--accent-text)]",
  completed:       "text-[var(--success)]",
  failed:          "text-[var(--danger)]",
  data_issue:      "text-[var(--warning)]",
  budget_exceeded: "text-[var(--warning)]",
  no_improvement:  "text-[var(--warning)]",
}

export function AutoRunsAll() {
  const [taskFilter, setTaskFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const { data, isLoading } = useQuery({
    queryKey: ["autoRuns"],
    queryFn: () => api.autoRuns({ limit: 100 }),
    refetchInterval: 5000,
  })

  const rows = data?.autoRuns ?? []
  const tasks = [...new Set(rows.map((r) => r.taskId))].sort()
  const statuses = [...new Set(rows.map((r) => r.status))].sort()

  const filtered = rows.filter((r) => {
    if (taskFilter !== "all" && r.taskId !== taskFilter) return false
    if (statusFilter !== "all" && r.status !== statusFilter) return false
    return true
  })

  return (
    <div>
      <PageHeader
        title="Auto-runs"
        subtitle="Coordinator-driven auto_train invocations, newest first."
      />

      <div className="flex gap-3 mb-5">
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="text-xs font-mono px-3 py-1.5 rounded-md border bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)] hover:border-[var(--accent-border)] focus:border-[var(--accent-border)] transition-colors outline-none cursor-pointer"
        >
          <option value="all">All tasks</option>
          {tasks.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs font-mono px-3 py-1.5 rounded-md border bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)] hover:border-[var(--accent-border)] focus:border-[var(--accent-border)] transition-colors outline-none cursor-pointer"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-xs text-[var(--text-3)] self-center">
          {filtered.length} run{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading && <div className="text-sm text-[var(--text-3)]">Loading auto-runs…</div>}
      {!isLoading && filtered.length === 0 && (
        <Empty icon={Bot} title="No auto-runs" desc="Call mcp__neuron__auto_train on a task to see runs here." />
      )}

      {filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Auto-run", "Task", "Status", "Accuracy", "Target", "Waves", "Wall-clock"].map((h) => (
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
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-2)]">
                    <Link to={`/auto/${r.id}`} className="hover:underline">#{r.id}</Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/tasks/${encodeURIComponent(r.taskId)}`}
                      className="text-xs font-mono text-[var(--accent-text)] hover:underline"
                    >
                      {r.taskId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx("text-xs font-mono", STATUS_COLOR[r.status] ?? "text-[var(--text-2)]")}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      "stat-num text-xs",
                      r.finalAccuracy != null && r.accuracyTarget != null && r.finalAccuracy >= r.accuracyTarget
                        ? "text-[var(--success)]"
                        : "text-[var(--text-1)]",
                    )}>
                      {pct(r.finalAccuracy)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-3)]">{pct(r.accuracyTarget)}</td>
                  <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                    {r.wavesUsed}{r.maxWaves ? `/${r.maxWaves}` : ""}
                  </td>
                  <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-2)]">
                    {wallClockS(r.startedAt, r.finishedAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to={`/auto/${r.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex">
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
