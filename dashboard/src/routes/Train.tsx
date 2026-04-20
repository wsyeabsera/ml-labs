import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { PlayCircle, StopCircle, CheckCircle2, Loader2, AlertCircle } from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import { api, createRunEventSource } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { clsx } from "clsx"

// ── Types ──────────────────────────────────────────────────────────────────────

type Stage = "featurize" | "tensors" | "init" | "train" | "eval" | "weights"
const STAGES: Stage[] = ["featurize", "tensors", "init", "train", "eval", "weights"]
const STAGE_LABELS: Record<Stage, string> = {
  featurize: "Featurize",
  tensors:   "Tensors",
  init:      "Init MLP",
  train:     "Train",
  eval:      "Evaluate",
  weights:   "Weights",
}

interface LiveProgress {
  stage: Stage
  i?: number
  n?: number
  message: string
  lossHistory: number[]
  epochsDone: number
}

interface CompletionData {
  status: string
  accuracy: number | null
  lossHistory: number[] | null
  perClassAccuracy: Record<string, number> | null
  confusionMatrix: number[][] | null
  mae: number | null
  rmse: number | null
  r2: number | null
}

// ── Stage stepper ──────────────────────────────────────────────────────────────

function StageStepper({ current, done }: { current: Stage | null; done: boolean }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STAGES.map((s, i) => {
        const stageIdx = current ? STAGES.indexOf(current) : -1
        const isDone = done || stageIdx > i
        const isActive = !done && stageIdx === i
        const isPending = stageIdx < i && !done

        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center">
              <div className={clsx(
                "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300",
                isDone  && "bg-[var(--success)] text-[var(--bg-base)]",
                isActive && "bg-[var(--accent)] text-white ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-base)]",
                isPending && "bg-[var(--surface-3)] text-[var(--text-3)]",
              )}>
                {isDone  && <CheckCircle2 size={14} />}
                {isActive && <Loader2 size={14} className="animate-spin" />}
                {isPending && <span className="text-2xs font-mono">{i + 1}</span>}
              </div>
              <span className={clsx(
                "text-2xs mt-1 whitespace-nowrap",
                isDone  && "text-[var(--success)]",
                isActive && "text-[var(--accent-text)]",
                isPending && "text-[var(--text-3)]",
              )}>
                {STAGE_LABELS[s]}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={clsx(
                "flex-1 h-px mx-1 -mt-4 transition-colors duration-300",
                stageIdx > i || done ? "bg-[var(--success)]" : "bg-[var(--surface-3)]"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Results panel ──────────────────────────────────────────────────────────────

function ResultsPanel({ data, runId }: { data: CompletionData; runId: number }) {
  const isSuccess = data.status === "completed"
  const lossData = (data.lossHistory ?? []).map((v, i) => ({ epoch: i + 1, loss: +v.toFixed(5) }))
  const perClass = data.perClassAccuracy ?? {}
  const classEntries = Object.entries(perClass).sort(([, a], [, b]) => b - a)

  function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "—" }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      {/* Status banner */}
      <div className={clsx(
        "card p-4 flex items-center gap-3",
        isSuccess ? "border-[var(--success)] bg-[var(--success-dim)]" : "border-[var(--danger)] bg-[var(--danger-dim)]"
      )}>
        {isSuccess
          ? <CheckCircle2 size={18} className="text-[var(--success)] flex-shrink-0" />
          : <AlertCircle  size={18} className="text-[var(--danger)]  flex-shrink-0" />
        }
        <div>
          <p className={clsx("text-sm font-medium", isSuccess ? "text-[var(--success)]" : "text-[var(--danger)]")}>
            {isSuccess ? "Training complete" : `Run ${data.status}`}
          </p>
          {isSuccess && data.accuracy != null && (
            <p className="text-xs text-[var(--text-2)]">
              Run #{runId} · accuracy <span className="stat-num text-[var(--success)]">{pct(data.accuracy)}</span>
            </p>
          )}
        </div>
      </div>

      {isSuccess && (
        <>
          {/* Metrics */}
          {(data.mae != null || data.rmse != null || data.r2 != null) ? (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "MAE",  value: data.mae  != null ? data.mae.toFixed(4)  : "—" },
                { label: "RMSE", value: data.rmse != null ? data.rmse.toFixed(4) : "—" },
                { label: "R²",   value: data.r2   != null ? data.r2.toFixed(4)   : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="card p-3">
                  <p className="text-2xs text-[var(--text-3)] mb-1">{label}</p>
                  <p className="stat-num text-base text-[var(--text-1)]">{value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Loss curve + per-class */}
          <div className={clsx(
            "grid gap-4",
            lossData.length > 0 && classEntries.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          )}>
            {lossData.length > 0 && (
              <div className="card p-4">
                <p className="text-xs font-medium text-[var(--text-2)] mb-4">
                  Loss Curve
                  <span className="text-[var(--text-3)] font-normal ml-2">{lossData.length} epochs sampled</span>
                </p>
                <motion.div
                  initial={{ opacity: 0, scaleY: 0.8 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  style={{ transformOrigin: "bottom" }}
                >
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={lossData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                      <YAxis tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => v.toFixed(3)} />
                      <Tooltip
                        contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: "var(--text-1)" }}
                        formatter={(v: number) => [v.toFixed(5), "loss"]}
                      />
                      <Line type="monotone" dataKey="loss" stroke="var(--accent-text)" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </motion.div>
              </div>
            )}

            {classEntries.length > 0 && (
              <div className="card p-4">
                <p className="text-xs font-medium text-[var(--text-2)] mb-4">Per-class Accuracy</p>
                <div className="space-y-2.5">
                  {classEntries.map(([label, acc], i) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono text-[var(--text-1)]">{label}</span>
                        <span className={clsx(
                          "stat-num",
                          acc >= 0.9 ? "text-[var(--success)]" : acc >= 0.7 ? "text-[var(--warning)]" : "text-[var(--danger)]"
                        )}>{pct(acc)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${acc * 100}%` }}
                          transition={{ duration: 0.6, delay: 0.2 + i * 0.08 }}
                          className={clsx(
                            "h-full rounded-full",
                            acc >= 0.9 ? "bg-[var(--success)]" : acc >= 0.7 ? "bg-[var(--warning)]" : "bg-[var(--danger)]"
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}

// ── Train form ─────────────────────────────────────────────────────────────────

export function Train() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: tasksData } = useQuery({ queryKey: ["tasks"], queryFn: api.tasks, refetchInterval: 10000 })
  const tasks = tasksData?.tasks ?? []

  const [selectedTask, setSelectedTask] = useState<string>(searchParams.get("task") ?? "")
  const [lr, setLr] = useState("0.005")
  const [epochs, setEpochs] = useState("500")
  const [classWeights, setClassWeights] = useState<"" | "balanced">("")

  const [phase, setPhase] = useState<"idle" | "starting" | "training" | "done">("idle")
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [completion, setCompletion] = useState<CompletionData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)

  // Sync task selector with URL param
  useEffect(() => {
    if (selectedTask) setSearchParams({ task: selectedTask }, { replace: true })
  }, [selectedTask])

  useEffect(() => {
    const t = searchParams.get("task")
    if (t && !selectedTask) setSelectedTask(t)
  }, [])

  // SSE listener
  function attachSSE(runId: number) {
    esRef.current?.close()
    const es = createRunEventSource(runId)
    esRef.current = es

    es.addEventListener("init", (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (d.progress) setProgress(d.progress as LiveProgress)
    })

    es.addEventListener("progress", (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setProgress(d as LiveProgress)
    })

    es.addEventListener("complete", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as CompletionData
      setCompletion(d)
      setPhase("done")
      esRef.current?.close()
    })

    es.addEventListener("error", () => {
      esRef.current?.close()
    })
  }

  async function handleTrain() {
    if (!selectedTask) return
    setError(null)
    setPhase("starting")
    setProgress(null)
    setCompletion(null)

    try {
      const { runId } = await api.startTrain(selectedTask, {
        lr: parseFloat(lr) || 0.005,
        epochs: parseInt(epochs) || 500,
        class_weights: classWeights === "balanced" ? "balanced" : undefined,
      })
      setActiveRunId(runId)
      setPhase("training")
      attachSSE(runId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase("idle")
    }
  }

  async function handleCancel() {
    if (!selectedTask) return
    try {
      await api.cancelTrain(selectedTask)
    } catch { /* ignore */ }
  }

  const currentStage = progress?.stage ?? null
  const isTraining = phase === "training"

  return (
    <div>
      <PageHeader
        title="Training Console"
        subtitle="Configure hyperparameters and watch your model train live."
      />

      {/* Config form */}
      <div className="card p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* Task selector */}
          <div className="flex flex-col gap-1.5 min-w-[180px]">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold">Task</label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              disabled={isTraining}
              className={clsx(
                "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors",
                "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
                "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <option value="">Select a task…</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
            </select>
          </div>

          {/* LR */}
          <div className="flex flex-col gap-1.5 w-28">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold">Learning rate</label>
            <input
              type="number"
              value={lr}
              onChange={(e) => setLr(e.target.value)}
              disabled={isTraining}
              step="0.001"
              min="0.0001"
              className={clsx(
                "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors",
                "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
                "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            />
          </div>

          {/* Epochs */}
          <div className="flex flex-col gap-1.5 w-28">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold">Epochs</label>
            <input
              type="number"
              value={epochs}
              onChange={(e) => setEpochs(e.target.value)}
              disabled={isTraining}
              step="100"
              min="10"
              className={clsx(
                "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors",
                "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
                "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            />
          </div>

          {/* Class weights */}
          <div className="flex flex-col gap-1.5 w-36">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold">Class weights</label>
            <select
              value={classWeights}
              onChange={(e) => setClassWeights(e.target.value as "" | "balanced")}
              disabled={isTraining}
              className={clsx(
                "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors",
                "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)]",
                "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <option value="">None</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>

          {/* Train / Cancel */}
          <div className="flex gap-2 ml-auto">
            {(phase === "training" || phase === "starting") && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
              >
                <StopCircle size={14} />
                Cancel
              </button>
            )}
            {(phase === "idle" || phase === "done") && (
              <button
                onClick={handleTrain}
                disabled={!selectedTask}
                className={clsx(
                  "flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-colors",
                  selectedTask
                    ? "bg-[var(--accent)] text-white hover:opacity-90"
                    : "bg-[var(--surface-3)] text-[var(--text-3)] cursor-not-allowed"
                )}
              >
                <PlayCircle size={14} />
                {phase === "done" ? "Train again" : "Train"}
              </button>
            )}
            {phase === "starting" && (
              <button disabled className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium bg-[var(--accent)] text-white opacity-70">
                <Loader2 size={14} className="animate-spin" />
                Starting…
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card p-4 mb-5 border-[var(--danger)] bg-[var(--danger-dim)]"
          >
            <div className="flex items-center gap-2 text-sm text-[var(--danger)]">
              <AlertCircle size={14} />
              {error}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live progress */}
      <AnimatePresence>
        {(phase === "training" || phase === "starting" || phase === "done") && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            {/* Stage stepper */}
            <StageStepper current={currentStage} done={phase === "done" && completion?.status === "completed"} />

            {/* Live message */}
            {phase === "training" && progress && (
              <div className="card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                  <span className="text-xs text-[var(--text-2)] font-mono">{progress.message}</span>
                  {activeRunId && (
                    <span className="ml-auto text-2xs text-[var(--text-3)] font-mono">run #{activeRunId}</span>
                  )}
                </div>

                {/* Featurize progress bar */}
                {progress.stage === "featurize" && progress.i != null && progress.n != null && (
                  <div>
                    <div className="flex justify-between text-2xs text-[var(--text-3)] mb-1.5">
                      <span>Featurizing samples</span>
                      <span>{progress.i} / {progress.n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${(progress.i / progress.n) * 100}%` }}
                        transition={{ duration: 0.15 }}
                      />
                    </div>
                  </div>
                )}

                {/* Training pulse */}
                {progress.stage === "train" && (
                  <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                    <div className="flex gap-0.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1 rounded-full bg-[var(--accent)]"
                          animate={{ height: ["8px", "20px", "8px"] }}
                          transition={{ duration: 1.2, delay: i * 0.15, repeat: Infinity }}
                        />
                      ))}
                    </div>
                    <span>Training in progress…</span>
                  </div>
                )}
              </div>
            )}

            {/* Starting spinner */}
            {phase === "starting" && (
              <div className="card p-4 flex items-center gap-3 text-sm text-[var(--text-2)]">
                <Loader2 size={14} className="animate-spin text-[var(--accent-text)]" />
                Initializing training run…
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results */}
      <AnimatePresence>
        {phase === "done" && completion && activeRunId && (
          <ResultsPanel data={completion} runId={activeRunId} />
        )}
      </AnimatePresence>
    </div>
  )
}
