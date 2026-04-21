import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Copy as CopyIcon, Trash2, Trophy, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { api, type ApiRun } from "../lib/api"
import { clsx } from "clsx"

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

interface Props {
  taskId: string
  runs: ApiRun[]
}

export function ShadowCard({ taskId, runs }: Props) {
  const qc = useQueryClient()
  const [picker, setPicker] = useState(false)

  const { data } = useQuery({
    queryKey: ["shadow", taskId],
    queryFn: () => api.getShadow(taskId),
    refetchInterval: 5000,
  })

  const attach = useMutation({
    mutationFn: (runId: number) => api.attachShadow(taskId, runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shadow", taskId] })
      setPicker(false)
    },
  })
  const detach = useMutation({
    mutationFn: () => api.detachShadow(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shadow", taskId] }),
  })
  const promote = useMutation({
    mutationFn: () => api.promoteShadow(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shadow", taskId] })
      qc.invalidateQueries({ queryKey: ["task", taskId] })
      qc.invalidateQueries({ queryKey: ["tasks"] })
      qc.invalidateQueries({ queryKey: ["runs", taskId] })
    },
  })

  const shadow = data?.shadow
  const agreement = data?.agreement
  const primaryAcc = runs.find((r) => r.status === "completed" || r.status === "imported")?.accuracy ?? null

  // Eligible shadow candidates: completed/imported runs that aren't the current shadow.
  const candidates = runs.filter(
    (r) => (r.status === "completed" || r.status === "imported") && r.id !== shadow?.runId,
  )

  if (!shadow && !picker) {
    // Only offer shadow once we have ≥2 completed runs — no point shadowing when you only have one.
    const eligible = runs.filter((r) => r.status === "completed" || r.status === "imported")
    if (eligible.length < 2) return null
    return (
      <div className="card p-3 mb-4 flex items-center gap-3">
        <CopyIcon size={14} className="text-[var(--text-3)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-1)]">Shadow mode available</p>
          <p className="text-2xs text-[var(--text-3)]">
            Run a second model alongside the primary on every prediction and compare outputs.
          </p>
        </div>
        <button
          onClick={() => setPicker(true)}
          className="text-xs font-medium px-2.5 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--accent-border)] hover:text-[var(--text-1)] transition-colors"
        >
          Attach shadow
        </button>
      </div>
    )
  }

  if (picker) {
    return (
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-[var(--text-1)]">Choose a shadow run</p>
          <button
            onClick={() => setPicker(false)}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
            aria-label="Cancel"
          >
            <X size={12} />
          </button>
        </div>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {candidates.map((r) => (
            <button
              key={r.id}
              onClick={() => attach.mutate(r.id)}
              disabled={attach.isPending}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-[var(--surface-2)] text-left transition-colors"
            >
              <span className="font-mono text-xs text-[var(--text-2)]">run #{r.id}</span>
              <span className="text-2xs text-[var(--text-3)] font-mono">
                {pct(r.accuracy)} · {(r.hyperparams as { lr?: number }).lr ?? "—"}lr · {(r.hyperparams as { epochs?: number }).epochs ?? "—"}ep
              </span>
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="text-2xs text-[var(--text-3)]">No eligible runs.</p>
          )}
        </div>
      </div>
    )
  }

  // shadow attached
  const rate = agreement?.rate ?? 0
  const total = agreement?.total ?? 0
  const rateTone =
    total < 10 ? "text-[var(--text-3)]" :
    rate >= 0.95 ? "text-[var(--success)]" :
    rate >= 0.8  ? "text-[var(--warning)]" :
                   "text-[var(--danger)]"

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-4 mb-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <CopyIcon size={14} className="text-[var(--accent-text)]" />
          <p className="text-xs font-medium text-[var(--text-1)]">Shadow mode</p>
          <span className="ml-auto text-2xs font-mono text-[var(--text-3)]">
            {total} comparison{total !== 1 ? "s" : ""} logged
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="rounded-md bg-[var(--surface-2)] p-2.5">
            <p className="text-2xs text-[var(--text-3)] mb-0.5">Primary</p>
            <p className="stat-num text-sm text-[var(--text-1)]">{pct(primaryAcc)}</p>
          </div>
          <div className="rounded-md bg-[var(--surface-2)] p-2.5">
            <p className="text-2xs text-[var(--text-3)] mb-0.5">Shadow (run #{shadow!.runId})</p>
            <p className={clsx(
              "stat-num text-sm",
              (shadow!.accuracy ?? 0) > (primaryAcc ?? 0) ? "text-[var(--success)]" : "text-[var(--text-1)]",
            )}>{pct(shadow!.accuracy)}</p>
          </div>
          <div className="rounded-md bg-[var(--surface-2)] p-2.5">
            <p className="text-2xs text-[var(--text-3)] mb-0.5">Agreement</p>
            <p className={clsx("stat-num text-sm", rateTone)}>
              {total > 0 ? `${(rate * 100).toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>

        {total > 0 && (
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden mb-3">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-300",
                rate >= 0.95 ? "bg-[var(--success)]" :
                rate >= 0.8  ? "bg-[var(--warning)]" :
                               "bg-[var(--danger)]",
              )}
              style={{ width: `${rate * 100}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Link
            to={`/tasks/${encodeURIComponent(taskId)}/runs/${shadow!.runId}`}
            className="text-2xs text-[var(--accent-text)] hover:underline"
          >
            view shadow run →
          </Link>
          <button
            onClick={() => promote.mutate()}
            disabled={promote.isPending || total < 10}
            title={total < 10 ? "Run at least 10 comparisons before promoting" : "Promote shadow to primary"}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-medium bg-[var(--success)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trophy size={10} />
            Promote
          </button>
          <button
            onClick={() => detach.mutate()}
            disabled={detach.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-medium text-[var(--text-3)] border border-[var(--border)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors disabled:opacity-40"
          >
            <Trash2 size={10} />
            Detach
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
