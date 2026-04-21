import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Zap, Clock } from "lucide-react"
import { api, type ApiBatchPredictRun } from "../lib/api"
import { clsx } from "clsx"

function pct(v: number | null) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

function duration(start: number, end: number | null): string {
  const s = (end ?? Math.floor(Date.now() / 1000)) - start
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s - m * 60}s`
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const STATUS_TONE: Record<ApiBatchPredictRun["status"], string> = {
  running:   "text-[var(--accent-text)]",
  completed: "text-[var(--success)]",
  failed:    "text-[var(--danger)]",
}

export function BatchPredictHistory({ taskId, classification }: { taskId: string; classification: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["batch-predict-runs", taskId],
    queryFn: () => api.batchPredictRuns(taskId, 20),
    refetchInterval: (q) => {
      const running = q.state.data?.batches.some((b) => b.status === "running")
      return running ? 1500 : 15000
    },
  })

  if (isLoading) return null
  const batches = data?.batches ?? []
  if (batches.length === 0) return null

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={13} className="text-[var(--accent-text)]" />
        <p className="text-xs font-medium text-[var(--text-1)]">Recent batch predictions</p>
        <span className="ml-auto text-2xs text-[var(--text-3)] font-mono">{batches.length}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Batch", "Status", "Rows", "Accuracy", "Avg latency", "Duration", "When"].map((h) => (
                <th key={h} className="text-left px-2 py-1.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <motion.tr
                key={b.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.015, 0.2) }}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <td className="px-2 py-1.5 font-mono text-[var(--text-2)]">#{b.id}</td>
                <td className="px-2 py-1.5">
                  <span className={clsx("font-mono", STATUS_TONE[b.status])}>
                    {b.status === "running" && "● "}
                    {b.status}
                  </span>
                </td>
                <td className="px-2 py-1.5 font-mono text-[var(--text-2)]">
                  {b.processed.toLocaleString()} / {b.total.toLocaleString()}
                </td>
                <td className="px-2 py-1.5 font-mono">
                  {classification && b.hasLabels ? (
                    <span className={clsx(
                      (b.accuracy ?? 0) >= 0.9 ? "text-[var(--success)]" :
                      (b.accuracy ?? 0) >= 0.7 ? "text-[var(--warning)]" :
                      b.accuracy != null       ? "text-[var(--danger)]"  :
                                                 "text-[var(--text-3)]",
                    )}>{pct(b.accuracy)}</span>
                  ) : (
                    <span className="text-[var(--text-3)]">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-[var(--text-2)]">
                  {b.latencyMsAvg != null ? `${b.latencyMsAvg.toFixed(1)}ms` : "—"}
                </td>
                <td className="px-2 py-1.5 font-mono text-[var(--text-2)] inline-flex items-center gap-1">
                  <Clock size={10} className="text-[var(--text-3)]" />
                  {duration(b.startedAt, b.finishedAt)}
                </td>
                <td className="px-2 py-1.5 font-mono text-[var(--text-3)]">{timeAgo(b.startedAt)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
