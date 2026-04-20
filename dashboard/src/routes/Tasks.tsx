import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Database, AlertTriangle } from "lucide-react"
import { api } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { StatusDot } from "../components/StatusDot"
import { Empty } from "../components/Empty"
import { clsx } from "clsx"

function pct(v: number | null) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

export function TaskDetail() {
  const { id } = useParams<{ id: string }>()
  const taskId = decodeURIComponent(id ?? "")

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.task(taskId),
    enabled: !!taskId,
    refetchInterval: 3000,
  })
  const { data: inspectData } = useQuery({
    queryKey: ["inspect", taskId],
    queryFn: () => api.inspect(taskId),
    enabled: !!taskId,
    refetchInterval: 10000,
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
      />

      {/* Meta grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Labels / features */}
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
        </div>

        {/* Data warnings */}
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

      {/* Recent runs */}
      <div>
        <p className="section-label mb-3">Recent runs</p>
        {runs.length === 0 ? (
          <Empty icon={Database} title="No runs yet" desc="Train this task to see runs here." />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Run", "Status", "Accuracy", "Duration", "lr / epochs"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-2)] transition-colors"
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
                      {r.durationS != null ? `${r.durationS}s` : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">
                      {(r.hyperparams as { lr?: number; epochs?: number }).lr ?? "—"} / {(r.hyperparams as { lr?: number; epochs?: number }).epochs ?? "—"}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
