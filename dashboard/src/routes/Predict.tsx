import { useState, useRef, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Upload, ChevronDown, AlertCircle, Loader2 } from "lucide-react"
import { api, type ApiTask, type ApiPredictResult } from "../lib/api"
import { clsx } from "clsx"

// ── Confidence bars ────────────────────────────────────────────────────────────

const PALETTE = [
  "var(--accent-text)",
  "var(--warning)",
  "var(--success)",
  "var(--info)",
  "#a78bfa",
]

function ConfidenceChart({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  return (
    <div className="space-y-2">
      {sorted.map(([label, prob], i) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--text-1)] w-20 truncate shrink-0">{label}</span>
          <div className="flex-1 h-2.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${prob * 100}%` }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="h-full rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
          </div>
          <span className="text-xs font-mono text-[var(--text-2)] w-14 text-right shrink-0">
            {(prob * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Input + select shared styles ───────────────────────────────────────────────

const inputCls = clsx(
  "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors w-full",
  "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
  "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
  "placeholder:text-[var(--text-3)]",
)

// ── Single predict panel ───────────────────────────────────────────────────────

function SinglePredict({ task }: { task: ApiTask }) {
  const D = task.featureShape[0] ?? 1
  const names = task.featureNames ?? Array.from({ length: D }, (_, i) => `feature_${i}`)
  const [values, setValues] = useState<string[]>(() => Array(D).fill(""))
  const [result, setResult] = useState<ApiPredictResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setValues(Array(task.featureShape[0] ?? 1).fill(""))
    setResult(null)
    setError(null)
  }, [task.id])

  async function runPredict() {
    const features = values.map((v) => parseFloat(v))
    if (features.some((v) => isNaN(v))) {
      setError("All feature values must be valid numbers")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const r = await api.predict(task.id, features)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <p className="text-xs font-medium text-[var(--text-2)] mb-3">
          Feature values
          <span className="text-[var(--text-3)] font-normal ml-1.5">({D} features)</span>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {names.map((name, i) => (
            <div key={i}>
              <label className="text-2xs text-[var(--text-3)] font-mono block mb-1 truncate">{name}</label>
              <input
                type="number"
                step="any"
                value={values[i] ?? ""}
                onChange={(e) => {
                  const next = [...values]
                  next[i] = e.target.value
                  setValues(next)
                }}
                onKeyDown={(e) => e.key === "Enter" && runPredict()}
                className={inputCls}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={runPredict}
        disabled={loading}
        className={clsx(
          "w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium transition-colors",
          loading
            ? "bg-[var(--accent)] text-white opacity-70 cursor-not-allowed"
            : "bg-[var(--accent)] text-white hover:opacity-90"
        )}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
        {loading ? "Predicting…" : "Predict"}
      </button>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={JSON.stringify(result)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card p-5 border-[var(--accent-border)]"
            style={{ background: "var(--accent-dim)" }}
          >
            {result.label != null ? (
              <>
                <div className="flex items-baseline gap-2 mb-5">
                  <span className="text-xs text-[var(--text-3)]">Prediction</span>
                  <span className="font-semibold text-xl text-[var(--text-1)] font-mono">{result.label}</span>
                  {result.calibrated && (
                    <span
                      className="text-2xs font-mono px-1.5 py-0.5 rounded border border-[var(--success)] text-[var(--success)]"
                      title="Confidence was temperature-scaled using a calibrated temperature"
                    >
                      calibrated
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-3)] ml-auto font-mono">
                    {((result.confidence ?? 0) * 100).toFixed(1)}% confidence
                  </span>
                </div>
                {result.scores && <ConfidenceChart scores={result.scores} />}
              </>
            ) : (
              <div>
                <p className="text-xs text-[var(--text-3)] mb-1.5">Predicted value</p>
                <p className="stat-num text-3xl text-[var(--text-1)]">{result.value?.toFixed(4)}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Batch predict panel ────────────────────────────────────────────────────────

function BatchPredict({ task }: { task: ApiTask }) {
  const [csvText, setCsvText] = useState("")
  const [labelCol, setLabelCol] = useState("")
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCsvText("")
    setActiveBatchId(null)
    setError(null)
    setLabelCol("")
  }, [task.id])

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(ev.target?.result as string ?? "")
    reader.readAsText(file)
    e.target.value = ""
  }

  async function runBatch() {
    if (!csvText.trim()) { setError("Paste CSV data or upload a file"); return }
    setSubmitting(true)
    setError(null)
    try {
      const r = await api.batchPredict(task.id, csvText, labelCol || undefined)
      setActiveBatchId(r.batchId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch predict failed")
    } finally {
      setSubmitting(false)
    }
  }

  const featureNames = task.featureNames ?? Array.from({ length: task.featureShape[0] ?? 1 }, (_, i) => `feature_${i}`)
  const placeholderHeader = [...featureNames.slice(0, 4), labelCol || "label"].join(",")

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-[var(--text-2)]">CSV data</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--accent-border)] hover:text-[var(--accent-text)] transition-colors"
          >
            <Upload size={11} />
            Upload file
          </button>
          <input type="file" accept=".csv,text/csv,text/plain" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
        </div>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={`${placeholderHeader}\n1.2,3.4,5.6,...`}
          className={clsx(inputCls, "resize-y min-h-[120px] font-mono text-xs")}
          spellCheck={false}
        />
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
            Label column <span className="normal-case font-normal">(optional — enables accuracy)</span>
          </label>
          <input
            type="text"
            value={labelCol}
            onChange={(e) => setLabelCol(e.target.value)}
            placeholder="e.g. species"
            className={inputCls}
          />
        </div>
        <button
          onClick={runBatch}
          disabled={submitting}
          className={clsx(
            "flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-colors shrink-0",
            submitting
              ? "bg-[var(--accent)] text-white opacity-70 cursor-not-allowed"
              : "bg-[var(--accent)] text-white hover:opacity-90"
          )}
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          {submitting ? "Starting…" : "Run batch"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <AnimatePresence>
        {activeBatchId != null && (
          <BatchPredictLiveCard batchId={activeBatchId} classification={task.kind === "classification"} />
        )}
      </AnimatePresence>
    </div>
  )
}

function BatchPredictLiveCard({ batchId, classification }: { batchId: number; classification: boolean }) {
  const { data } = useQuery({
    queryKey: ["batch-predict-run", batchId],
    queryFn: () => api.batchPredictRun(batchId),
    refetchInterval: (q) => q.state.data?.batch.status === "running" ? 800 : false,
  })

  if (!data) return null
  const b = data.batch
  const pct = b.total > 0 ? Math.min(100, (b.processed / b.total) * 100) : 0
  const elapsedS = Math.max(1, Math.round(
    ((b.finishedAt ?? Date.now() / 1000) - b.startedAt),
  ))
  const rowsPerS = b.processed > 0 ? (b.processed / elapsedS).toFixed(1) : "—"
  const etaS = b.status === "running" && b.processed > 0 && b.total > b.processed
    ? Math.round((elapsedS / b.processed) * (b.total - b.processed))
    : null

  const statusColor =
    b.status === "completed" ? "text-[var(--success)]" :
    b.status === "failed"    ? "text-[var(--danger)]"  :
                               "text-[var(--accent-text)]"

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4 border-[var(--accent-border)] bg-[var(--accent-dim)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {b.status === "running" && <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />}
          <span className={clsx("text-xs font-medium capitalize", statusColor)}>
            Batch #{b.id} · {b.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-2xs font-mono text-[var(--text-3)]">
          <span>{elapsedS}s</span>
          {etaS != null && <span>eta {etaS}s</span>}
          <span>{rowsPerS} rows/s</span>
        </div>
      </div>

      {b.total > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-2xs text-[var(--text-3)] mb-1 font-mono">
            <span>{b.processed.toLocaleString()} / {b.total.toLocaleString()} rows</span>
            <span>{pct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-300",
                b.status === "failed" ? "bg-[var(--danger)]" : "bg-[var(--accent)]",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-[var(--surface-2)] p-2">
          <p className="text-2xs text-[var(--text-3)]">Processed</p>
          <p className="stat-num text-sm text-[var(--text-1)]">{b.processed.toLocaleString()}</p>
        </div>
        {classification && b.hasLabels && (
          <div className="rounded-md bg-[var(--surface-2)] p-2">
            <p className="text-2xs text-[var(--text-3)]">Accuracy</p>
            <p className={clsx(
              "stat-num text-sm",
              (b.accuracy ?? 0) >= 0.9 ? "text-[var(--success)]" :
              (b.accuracy ?? 0) >= 0.7 ? "text-[var(--warning)]" :
              b.accuracy != null       ? "text-[var(--danger)]"  :
                                         "text-[var(--text-3)]",
            )}>
              {b.accuracy != null ? `${(b.accuracy * 100).toFixed(1)}%` : "—"}
            </p>
          </div>
        )}
        <div className="rounded-md bg-[var(--surface-2)] p-2">
          <p className="text-2xs text-[var(--text-3)]">Avg latency</p>
          <p className="stat-num text-sm text-[var(--text-1)]">
            {b.latencyMsAvg != null ? `${b.latencyMsAvg.toFixed(1)}ms` : "—"}
          </p>
        </div>
      </div>

      {b.errors.length > 0 && (
        <div className="mt-3 text-2xs text-[var(--warning)] font-mono space-y-0.5">
          {b.errors.slice(0, 5).map((e, i) => <p key={i}>· {e}</p>)}
          {b.errors.length > 5 && <p className="text-[var(--text-3)]">+ {b.errors.length - 5} more…</p>}
        </div>
      )}
    </motion.div>
  )
}

// ── Predict page ───────────────────────────────────────────────────────────────

export function Predict() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<"single" | "batch">("single")

  const { data: tasksData } = useQuery({ queryKey: ["tasks"], queryFn: api.tasks })
  const tasks = tasksData?.tasks ?? []

  const taskId = searchParams.get("task") ?? tasks[0]?.id ?? ""
  const task = tasks.find((t) => t.id === taskId) ?? tasks[0] ?? null

  function selectTask(id: string) {
    setSearchParams({ task: id })
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Predict</h1>
        <p className="text-xs text-[var(--text-3)]">Run inference on trained models</p>
      </div>

      {/* Task selector */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative">
          <select
            value={task?.id ?? ""}
            onChange={(e) => selectTask(e.target.value)}
            className={clsx(inputCls, "pr-8 appearance-none cursor-pointer w-auto")}
          >
            {tasks.length === 0 && <option value="">No tasks</option>}
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.id} ({t.kind})</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
        </div>
        {task?.accuracy != null && (
          <span className="text-xs text-[var(--text-3)]">
            Registered model accuracy:{" "}
            <span className={clsx("font-mono stat-num", task.accuracy >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-2)]")}>
              {(task.accuracy * 100).toFixed(1)}%
            </span>
          </span>
        )}
      </div>

      {!task ? (
        <div className="card p-10 text-center text-sm text-[var(--text-3)]">
          No tasks found. Create a task and train a model first.
        </div>
      ) : task.accuracy == null ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-[var(--text-3)] mb-2">
            No trained model for <span className="font-mono text-[var(--text-2)]">{task.id}</span>
          </p>
          <p className="text-xs text-[var(--text-3)]">Head to the Training Console to get started.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-[var(--surface-2)] rounded-lg p-1 w-fit">
            {(["single", "batch"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "px-4 py-1.5 text-xs rounded-md transition-colors font-medium",
                  tab === t
                    ? "bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                )}
              >
                {t === "single" ? "Single predict" : "Batch CSV"}
              </button>
            ))}
          </div>

          {tab === "single" ? <SinglePredict task={task} /> : <BatchPredict task={task} />}
        </>
      )}
    </div>
  )
}
