import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AlertTriangle, X, Zap } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { api } from "../lib/api"
import { clsx } from "clsx"

function dismissKey(taskId: string, eventId: number): string {
  return `driftBanner:dismissed:${taskId}:${eventId}`
}

export function DriftBanner({ taskId, compact = false }: { taskId: string; compact?: boolean }) {
  const { data } = useQuery({
    queryKey: ["drift-status", taskId],
    queryFn: () => api.driftStatus(taskId),
    refetchInterval: 15000,
  })
  const [dismissed, setDismissed] = useState(false)

  const drift = data?.drift ?? null
  const key = drift ? dismissKey(taskId, drift.eventId) : null

  useEffect(() => {
    if (!key) return
    setDismissed(localStorage.getItem(key) === "1")
  }, [key])

  if (!drift || dismissed) return null

  const severe = drift.verdict === "severe"
  const tone = severe ? "danger" : "warning"
  const ageMin = Math.max(1, Math.round((Date.now() - drift.ts) / 60000))

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        className={clsx(
          "card flex items-center gap-3",
          compact ? "p-3 mb-3" : "p-4 mb-4",
          tone === "danger"
            ? "border-[var(--danger)] bg-[var(--danger-dim)]"
            : "border-[var(--warning)] bg-[var(--warning-dim)]",
        )}
      >
        <AlertTriangle
          size={compact ? 14 : 16}
          className={clsx("flex-shrink-0", tone === "danger" ? "text-[var(--danger)]" : "text-[var(--warning)]")}
        />
        <div className="flex-1 min-w-0">
          <p className={clsx("text-xs font-medium", tone === "danger" ? "text-[var(--danger)]" : "text-[var(--warning)]")}>
            {severe ? "Severe drift detected" : "Drift detected"}
            <span className="text-[var(--text-3)] font-normal ml-1.5">
              · {drift.driftingFeatures}/{drift.totalFeatures} features · {ageMin}m ago
            </span>
          </p>
          {!compact && (
            <p className="text-2xs text-[var(--text-3)] mt-0.5">
              Input distribution has shifted from training. Consider retraining on fresh data.
            </p>
          )}
        </div>
        <Link
          to={`/train?task=${encodeURIComponent(taskId)}`}
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium flex-shrink-0 transition-opacity hover:opacity-90",
            tone === "danger"
              ? "bg-[var(--danger)] text-white"
              : "bg-[var(--warning)] text-white",
          )}
        >
          <Zap size={11} />
          Retrain
        </Link>
        <button
          onClick={() => {
            if (key) localStorage.setItem(key, "1")
            setDismissed(true)
          }}
          className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex-shrink-0 p-1 -m-1"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
