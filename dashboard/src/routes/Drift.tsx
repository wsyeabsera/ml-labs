import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Activity } from "lucide-react"
import { api, type ApiDriftReport } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { Empty } from "../components/Empty"
import { clsx } from "clsx"

function VerdictPill({ v }: { v: ApiDriftReport["overall_verdict"] }) {
  const color =
    v === "stable" ? "var(--success)" :
    v === "drifting" ? "var(--warning)" :
    v === "severe" ? "var(--danger)" :
    "var(--text-3)"
  const label = v === "insufficient_data" ? "no data" : v
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {label}
    </span>
  )
}

function TaskDriftCard({ taskId }: { taskId: string }) {
  const [expanded, setExpanded] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ["drift", taskId],
    queryFn: () => api.drift(taskId, 1000),
    staleTime: 30000,
  })

  if (isLoading) {
    return (
      <div className="card p-4 text-xs text-[var(--text-3)]">
        Loading drift for {taskId}…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="card p-4 text-xs text-[var(--danger)]">
        {(error as Error)?.message ?? "failed to load"}
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-sm text-[var(--text-1)]">{taskId}</span>
          <VerdictPill v={data.overall_verdict} />
        </div>
        <p className="text-xs text-[var(--text-3)]">{data.reason ?? "no drift data"}</p>
      </div>
    )
  }

  const s = data.verdict_summary
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--surface-2)] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-[var(--text-1)]">{taskId}</span>
          <VerdictPill v={data.overall_verdict} />
        </div>
        <div className="flex items-center gap-3 text-2xs font-mono text-[var(--text-3)]">
          <span>ref {data.ref_window_size} / cur {data.cur_window_size}</span>
          <span>
            <span className="text-[var(--success)]">{s.stable}</span>
            {" / "}
            <span className="text-[var(--warning)]">{s.drifting}</span>
            {" / "}
            <span className="text-[var(--danger)]">{s.severe}</span>
            {s.insufficient_data > 0 && ` / ${s.insufficient_data} n/a`}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left py-1.5 text-2xs font-semibold text-[var(--text-3)] uppercase">Feature</th>
                <th className="text-left py-1.5 text-2xs font-semibold text-[var(--text-3)] uppercase">PSI</th>
                <th className="text-left py-1.5 text-2xs font-semibold text-[var(--text-3)] uppercase">KS p</th>
                <th className="text-left py-1.5 text-2xs font-semibold text-[var(--text-3)] uppercase">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((f) => (
                <tr key={f.feature_idx} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="py-1.5 font-mono text-[var(--text-1)]">{f.feature_name}</td>
                  <td className={clsx(
                    "py-1.5 stat-num",
                    f.psi >= 0.25 ? "text-[var(--danger)]" :
                    f.psi >= 0.1 ? "text-[var(--warning)]" :
                    "text-[var(--text-2)]"
                  )}>
                    {Number.isFinite(f.psi) ? f.psi.toFixed(3) : "—"}
                  </td>
                  <td className="py-1.5 stat-num text-[var(--text-2)]">
                    {f.ks_p_value != null ? f.ks_p_value.toFixed(3) : "—"}
                  </td>
                  <td className="py-1.5"><VerdictPill v={f.verdict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Drift() {
  const { data: tasksData, isLoading: loadingTasks } = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
  })

  const tasks = tasksData?.tasks ?? []
  const classificationTasks = tasks.filter((t) => t.kind !== "regression")

  return (
    <div>
      <PageHeader
        title="Drift"
        subtitle="Monitor feature-distribution shift between training data and recent served predictions. PSI ≥ 0.1 is drifting; ≥ 0.25 is severe."
      />

      {loadingTasks && <p className="text-sm text-[var(--text-3)]">Loading tasks…</p>}

      {!loadingTasks && classificationTasks.length === 0 && (
        <Empty icon={Activity} title="No tasks yet" desc="Train and publish a model, then send predictions through /api/registry/…/predict to see drift here." />
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-2"
      >
        {classificationTasks.map((t) => (
          <TaskDriftCard key={t.id} taskId={t.id} />
        ))}
      </motion.div>
    </div>
  )
}
