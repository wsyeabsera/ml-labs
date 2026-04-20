import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { Play, Square, Trophy, Loader2, CheckCircle2, AlertCircle, ChevronDown } from "lucide-react"
import { api, type ApiSweepResult } from "../lib/api"
import { clsx } from "clsx"

// ── helpers ────────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

function parseNums(s: string): number[] {
  return s.split(",").map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x))
}

const inputCls = clsx(
  "text-sm font-mono px-3 py-2 rounded-md border outline-none transition-colors",
  "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-1)] w-full",
  "hover:border-[var(--accent-border)] focus:border-[var(--accent-border)]",
  "placeholder:text-[var(--text-3)]",
)

// ── Row status icon ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ApiSweepResult["status"] }) {
  if (status === "done")    return <CheckCircle2 size={13} className="text-[var(--success)]" />
  if (status === "failed")  return <AlertCircle  size={13} className="text-[var(--danger)]" />
  if (status === "running") return <Loader2      size={13} className="animate-spin text-[var(--accent-text)]" />
  return <span className="w-3 h-3 rounded-full border border-[var(--border)] inline-block" />
}

// ── Accuracy mini-bar ──────────────────────────────────────────────────────────

function AccBar({ v, best }: { v: number | null; best: number | null }) {
  if (v == null) return <span className="text-[var(--text-3)]">—</span>
  const isBest = best != null && v === best
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${v * 100}%` }}
          transition={{ duration: 0.5 }}
          className={clsx("h-full rounded-full", isBest ? "bg-[var(--warning)]" : "bg-[var(--accent-text)]")}
        />
      </div>
      <span className={clsx("stat-num text-xs", isBest ? "text-[var(--warning)]" : "text-[var(--text-1)]")}>
        {pct(v)}
      </span>
    </div>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

function Leaderboard({
  results,
  bestRunId,
  bestAccuracy,
  status,
  taskId,
}: {
  results: ApiSweepResult[]
  bestRunId: number | null | undefined
  bestAccuracy: number | null | undefined
  status: string | undefined
  taskId: string
}) {
  // Sort a copy by accuracy desc for display rank, keeping original idx for running highlight
  const ranked = [...results]
    .map((r, i) => ({ ...r, origIdx: i }))
    .sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return -1
      if (b.status === "done" && a.status !== "done") return 1
      if (a.accuracy != null && b.accuracy != null) return b.accuracy - a.accuracy
      return a.origIdx - b.origIdx
    })

  const done = results.filter((r) => r.status === "done").length
  const total = results.length
  const isRunning = status === "running"

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className={clsx(
        "card p-3 flex items-center gap-3",
        status === "completed" && bestRunId != null
          ? "border-[var(--warning)]/40 bg-[var(--warning-dim)]"
          : "border-[var(--border)]"
      )}>
        {status === "completed" && bestRunId != null
          ? <Trophy size={15} className="text-[var(--warning)] flex-shrink-0" />
          : isRunning
            ? <Loader2 size={15} className="animate-spin text-[var(--accent-text)] flex-shrink-0" />
            : <Square size={15} className="text-[var(--text-3)] flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          {status === "completed" && bestRunId != null ? (
            <p className="text-sm font-medium text-[var(--warning)]">
              Sweep complete — winner{" "}
              <Link
                to={`/tasks/${encodeURIComponent(taskId)}/runs/${bestRunId}`}
                className="underline underline-offset-2 hover:opacity-80"
              >
                run #{bestRunId}
              </Link>
              : <span className="font-mono ml-1">{pct(bestAccuracy)}</span>
            </p>
          ) : status === "cancelled" ? (
            <p className="text-sm text-[var(--text-3)]">Sweep cancelled — {done}/{total} completed</p>
          ) : (
            <p className="text-sm text-[var(--text-2)]">
              Running {done}/{total} configs complete…
            </p>
          )}
        </div>
        <span className="text-2xs font-mono text-[var(--text-3)]">{done}/{total}</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-8">#</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">LR</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">Epochs</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-44">Accuracy</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-20">Val acc</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-24">Run</th>
              <th className="w-8 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, rank) => {
              const isBest = r.runId != null && r.runId === bestRunId
              return (
                <motion.tr
                  key={r.origIdx}
                  layout
                  className={clsx(
                    "border-b border-[var(--border-subtle)] transition-colors",
                    isBest && "bg-[var(--warning-dim)]",
                    r.status === "running" && "bg-[var(--accent-dim)]",
                  )}
                >
                  <td className="px-4 py-2.5 font-mono text-[var(--text-3)]">
                    {r.status === "done" ? rank + 1 : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[var(--text-1)]">
                    {r.config.lr ?? <span className="text-[var(--text-3)]">default</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[var(--text-1)]">
                    {r.config.epochs ?? <span className="text-[var(--text-3)]">default</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <AccBar v={r.accuracy} best={bestAccuracy ?? null} />
                  </td>
                  <td className="px-4 py-2.5 stat-num text-[var(--text-2)]">{pct(r.valAccuracy)}</td>
                  <td className="px-4 py-2.5">
                    {r.runId != null ? (
                      <Link
                        to={`/tasks/${encodeURIComponent(taskId)}/runs/${r.runId}`}
                        className="font-mono text-[var(--accent-text)] hover:underline"
                      >
                        #{r.runId}
                      </Link>
                    ) : (
                      <span className="text-[var(--text-3)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon status={r.status} />
                      {isBest && <Trophy size={11} className="text-[var(--warning)]" />}
                    </div>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sweep page ─────────────────────────────────────────────────────────────────

export function Sweep() {
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: tasksData } = useQuery({ queryKey: ["tasks"], queryFn: api.tasks })
  const tasks = tasksData?.tasks ?? []

  const taskId = searchParams.get("task") ?? tasks[0]?.id ?? ""
  const task = tasks.find((t) => t.id === taskId) ?? tasks[0] ?? null

  const [lrInput, setLrInput] = useState("0.001, 0.005, 0.01")
  const [epochsInput, setEpochsInput] = useState("300, 500")
  const [promoteWinner, setPromoteWinner] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  // Poll sweep state
  const { data: sweep, refetch: refetchSweep } = useQuery({
    queryKey: ["sweep", taskId],
    queryFn: () => api.getSweep(taskId),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const s = q.state.data
      return s?.active && s?.status === "running" ? 1000 : false
    },
  })

  // Sync task with URL
  function selectTask(id: string) {
    setSearchParams({ task: id })
  }

  const lrs = parseNums(lrInput)
  const epochs = parseNums(epochsInput)
  const totalConfigs = Math.max(lrs.length, 1) * Math.max(epochs.length, 1)
  const isRunning = sweep?.active && sweep?.status === "running"

  async function handleLaunch() {
    if (!task) return
    setLaunching(true)
    setLaunchError(null)
    try {
      await api.startSweep(task.id, {
        search: { lr: lrs.length ? lrs : undefined, epochs: epochs.length ? epochs : undefined },
        promote_winner: promoteWinner,
      })
      await refetchSweep()
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLaunching(false)
    }
  }

  async function handleCancel() {
    if (!task) return
    try { await api.cancelSweep(task.id) } catch { /* ignore */ }
    await refetchSweep()
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Sweep</h1>
        <p className="text-xs text-[var(--text-3)]">Grid search over hyperparameters</p>
      </div>

      {/* Task selector */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative">
          <select
            value={task?.id ?? ""}
            onChange={(e) => selectTask(e.target.value)}
            className={clsx(inputCls, "pr-8 appearance-none cursor-pointer w-auto")}
            disabled={!!isRunning}
          >
            {tasks.length === 0 && <option value="">No tasks</option>}
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.id} ({t.kind})</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
        </div>
        {task?.accuracy != null && (
          <span className="text-xs text-[var(--text-3)]">
            Current model: <span className={clsx("font-mono stat-num", task.accuracy >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-2)]")}>{pct(task.accuracy)}</span>
          </span>
        )}
      </div>

      {/* Config panel */}
      <div className="card p-5 mb-6">
        <p className="text-xs font-semibold text-[var(--text-2)] uppercase tracking-wider mb-4">Grid configuration</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[180px]">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
              Learning rates <span className="normal-case font-normal text-[var(--text-3)]">(comma-separated)</span>
            </label>
            <input
              value={lrInput}
              onChange={(e) => setLrInput(e.target.value)}
              disabled={!!isRunning}
              placeholder="0.001, 0.005, 0.01"
              className={clsx(inputCls, "disabled:opacity-50")}
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-2xs text-[var(--text-3)] uppercase tracking-wider font-semibold block mb-1.5">
              Epochs <span className="normal-case font-normal text-[var(--text-3)]">(comma-separated)</span>
            </label>
            <input
              value={epochsInput}
              onChange={(e) => setEpochsInput(e.target.value)}
              disabled={!!isRunning}
              placeholder="300, 500"
              className={clsx(inputCls, "disabled:opacity-50")}
            />
          </div>

          <div className="flex items-center gap-3 self-end pb-0.5">
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={promoteWinner}
                onChange={(e) => setPromoteWinner(e.target.checked)}
                disabled={!!isRunning}
                className="accent-[var(--accent)]"
              />
              Auto-promote winner
            </label>
          </div>

          <div className="flex items-end gap-2 self-end">
            <span className="text-xs text-[var(--text-3)] font-mono mb-2.5 mr-1">
              {totalConfigs} config{totalConfigs !== 1 ? "s" : ""}
            </span>

            {isRunning ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors"
              >
                <Square size={13} />
                Cancel
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                disabled={!task || launching || totalConfigs === 0}
                className={clsx(
                  "flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-colors",
                  task && !launching && totalConfigs > 0
                    ? "bg-[var(--accent)] text-white hover:opacity-90"
                    : "bg-[var(--surface-3)] text-[var(--text-3)] cursor-not-allowed"
                )}
              >
                {launching ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {launching ? "Launching…" : "Launch sweep"}
              </button>
            )}
          </div>
        </div>

        {launchError && (
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-dim)] rounded-md px-3 py-2">
            <AlertCircle size={12} />
            {launchError}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <AnimatePresence>
        {task && sweep?.active && sweep.results && sweep.results.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Leaderboard
              results={sweep.results}
              bestRunId={sweep.bestRunId}
              bestAccuracy={sweep.bestAccuracy}
              status={sweep.status}
              taskId={task.id}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!sweep?.active && !isRunning && task && (
        <div className="text-center text-sm text-[var(--text-3)] mt-8">
          Configure your grid and launch a sweep to see the leaderboard.
        </div>
      )}
    </div>
  )
}
