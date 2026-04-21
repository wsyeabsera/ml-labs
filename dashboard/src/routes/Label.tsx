import { useState, useEffect, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Check, SkipForward, Zap, AlertCircle } from "lucide-react"
import { api, type ApiSuggestSamples } from "../lib/api"
import { clsx } from "clsx"

type Candidate = ApiSuggestSamples["uncertain_samples"][number]

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

export function Label() {
  const { id } = useParams<{ id: string }>()
  const taskId = decodeURIComponent(id ?? "")
  const qc = useQueryClient()

  const { data: task } = useQuery({ queryKey: ["task", taskId], queryFn: () => api.task(taskId), enabled: !!taskId })
  const { data: queue, isLoading, refetch } = useQuery({
    queryKey: ["label-queue", taskId],
    queryFn: () => api.labelQueue(taskId, 20),
    enabled: !!taskId,
  })

  const [idx, setIdx] = useState(0)
  const [labelsAdded, setLabelsAdded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)

  // Reset when the queue refetches
  useEffect(() => { setIdx(0) }, [queue?.task_id, queue?.uncertain_samples.length])

  const candidates: Candidate[] = queue?.uncertain_samples ?? []
  const current = candidates[idx] ?? null
  const labels = task?.labels ?? []

  const submit = useMutation({
    mutationFn: ({ features, label }: { features: number[]; label: string }) =>
      api.postSample(taskId, features, label),
    onSuccess: (_d, vars) => {
      setLabelsAdded((n) => n + 1)
      setLastAction(`labeled as "${vars.label}"`)
      setIdx((i) => i + 1)
      qc.invalidateQueries({ queryKey: ["task", taskId] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const labelSample = useCallback((label: string) => {
    if (!current) return
    setError(null)
    submit.mutate({ features: current.features, label })
  }, [current, submit])

  const skip = useCallback(() => {
    setLastAction("skipped")
    setIdx((i) => i + 1)
  }, [])

  const useTopPrediction = useCallback(() => {
    if (!current) return
    labelSample(current.predicted_label)
  }, [current, labelSample])

  // Keyboard shortcuts: digit keys = class, Enter = use predicted, S = skip, R = refresh queue
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key >= "1" && e.key <= "9") {
        const i = parseInt(e.key) - 1
        if (labels[i]) { e.preventDefault(); labelSample(labels[i]!) }
        return
      }
      if (e.key === "Enter") { e.preventDefault(); useTopPrediction(); return }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); skip(); return }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); refetch(); setIdx(0); return }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [labels, labelSample, useTopPrediction, skip, refetch])

  if (!task) return <div className="text-sm text-[var(--text-3)]">Loading…</div>

  const done = idx >= candidates.length

  return (
    <div>
      <Link
        to={`/tasks/${encodeURIComponent(taskId)}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] mb-5 transition-colors"
      >
        <ArrowLeft size={12} />
        {taskId}
      </Link>

      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Label</h1>
        <p className="text-sm text-[var(--text-3)]">Active learning — label the model's most uncertain samples.</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="card p-3 text-center">
          <p className="stat-num text-xl text-[var(--text-1)]">{labelsAdded}</p>
          <p className="text-2xs text-[var(--text-3)]">labels added</p>
        </div>
        <div className="card p-3 text-center">
          <p className="stat-num text-xl text-[var(--text-1)]">{Math.max(0, candidates.length - idx)}</p>
          <p className="text-2xs text-[var(--text-3)]">remaining in queue</p>
        </div>
        <div className="card p-3 text-center">
          <p className={clsx(
            "stat-num text-xl",
            (queue?.overall_accuracy ?? 0) >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-1)]",
          )}>
            {queue?.overall_accuracy != null ? pct(queue.overall_accuracy) : "—"}
          </p>
          <p className="text-2xs text-[var(--text-3)]">model accuracy</p>
        </div>
      </div>

      {labelsAdded >= 10 && (
        <div className="card p-3 mb-4 border-[var(--accent-border)] bg-[var(--accent-dim)] flex items-center gap-2">
          <Zap size={13} className="text-[var(--accent-text)]" />
          <p className="text-xs text-[var(--text-1)]">
            You've added {labelsAdded} labels — consider re-running auto_train to pick up the new data.
          </p>
          <Link
            to={`/train?task=${encodeURIComponent(taskId)}`}
            className="ml-auto text-xs font-medium text-[var(--accent-text)] hover:underline"
          >
            Retrain →
          </Link>
        </div>
      )}

      {isLoading && <p className="text-sm text-[var(--text-3)]">Loading queue…</p>}

      {!isLoading && candidates.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-[var(--text-2)]">No uncertain samples right now — your model is confident on everything loaded.</p>
          <p className="text-2xs text-[var(--text-3)] mt-1">Load more data or retrain to populate the queue.</p>
        </div>
      )}

      {!isLoading && done && candidates.length > 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-[var(--text-1)]">Queue cleared — {labelsAdded} labeled this session.</p>
          <button
            onClick={() => { refetch(); setIdx(0) }}
            className="mt-3 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:opacity-90"
          >
            Fetch a new batch
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!done && current && (
          <motion.div
            key={current.sample_id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-[var(--text-3)] font-mono">sample #{current.sample_id}</p>
              <p className="text-2xs text-[var(--text-3)]">
                true label stored: <span className="font-mono text-[var(--text-2)]">{current.true_label}</span>
              </p>
            </div>

            <div className="mb-4">
              <p className="text-2xs text-[var(--text-3)] mb-1.5">Features</p>
              <p className="text-xs text-[var(--text-1)] font-mono break-all leading-relaxed">
                [{current.features.slice(0, 12).map((f) => f.toFixed(3)).join(", ")}
                {current.features.length > 12 ? `, … (+${current.features.length - 12})` : ""}]
              </p>
            </div>

            <div className="mb-4">
              <p className="text-2xs text-[var(--text-3)] mb-1.5">
                Model prediction: <span className="font-mono text-[var(--accent-text)]">{current.predicted_label}</span>{" "}
                <span className="text-[var(--warning)]">({pct(current.confidence)})</span>
              </p>
            </div>

            <p className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold mb-2">
              Pick the correct label
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
              {labels.map((l, i) => (
                <button
                  key={l}
                  onClick={() => labelSample(l)}
                  disabled={submit.isPending}
                  className={clsx(
                    "flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-all text-left",
                    l === current.predicted_label
                      ? "border-[var(--accent-border)] bg-[var(--accent-dim)] text-[var(--accent-text)]"
                      : "border-[var(--border)] text-[var(--text-1)] hover:border-[var(--accent-border)]",
                  )}
                >
                  <span className="font-mono text-xs">{l}</span>
                  {i < 9 && <span className="text-2xs text-[var(--text-3)] font-mono">[{i + 1}]</span>}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={useTopPrediction}
                disabled={submit.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--success)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
                title="Accept model's prediction [Enter]"
              >
                <Check size={11} />
                Use prediction
              </button>
              <button
                onClick={skip}
                disabled={submit.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--border)] text-xs text-[var(--text-2)] hover:border-[var(--accent-border)] transition-colors disabled:opacity-40"
                title="Skip [S]"
              >
                <SkipForward size={11} />
                Skip
              </button>
              <span className="ml-auto text-2xs text-[var(--text-3)] font-mono">
                shortcuts: digits · Enter · S · R
              </span>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2 mt-3">
                <AlertCircle size={12} />
                {error}
              </div>
            )}

            {lastAction && (
              <p className="text-2xs text-[var(--text-3)] mt-3">{lastAction}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
