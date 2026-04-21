import { useParams, useSearchParams, Link } from "react-router-dom"
import { useQueries } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { ArrowLeft } from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts"
import { api, type ApiRun } from "../lib/api"
import { StatusDot } from "../components/StatusDot"
import { clsx } from "clsx"

// ── Palette for up to 6 runs ──────────────────────────────────────────────────
// Uses theme CSS vars where possible, plus explicit hex for the rest.
const RUN_COLORS = [
  "var(--accent-text)",  // blue-ish
  "var(--warning)",      // amber
  "var(--success)",      // green
  "var(--danger)",       // red
  "#a855f7",             // purple
  "#ec4899",             // pink
]

const MAX_RUNS = 6

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

function parseRunIds(params: URLSearchParams): number[] {
  const runsParam = params.get("runs")
  if (runsParam) {
    return runsParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, MAX_RUNS)
  }
  // Backward-compat: support the old ?a=X&b=Y format
  const a = parseInt(params.get("a") ?? "0", 10)
  const b = parseInt(params.get("b") ?? "0", 10)
  return [a, b].filter((n) => n > 0)
}

// ── Overlaid loss curves for N runs ──────────────────────────────────────────

function LossComparisonN({ runs }: { runs: ApiRun[] }) {
  const histories = runs.map((r) => r.lossHistory ?? [])
  if (histories.every((h) => h.length === 0)) return null

  const maxLen = Math.max(...histories.map((h) => h.length))
  const data = Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number | undefined> = { epoch: i + 1 }
    runs.forEach((r, idx) => {
      const v = histories[idx]![i]
      row[`#${r.id}`] = v != null ? +v.toFixed(5) : undefined
    })
    return row
  })

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-[var(--text-2)] mb-4">Loss Curves</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="epoch"
            tick={{ fontSize: 9, fill: "var(--text-3)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "var(--text-3)" }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v) => v.toFixed(3)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--text-1)",
            }}
            formatter={(v: number) => v.toFixed(5)}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-2)" }} />
          {runs.map((r, idx) => (
            <Line
              key={r.id}
              type="monotone"
              dataKey={`#${r.id}`}
              stroke={RUN_COLORS[idx % RUN_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Per-class accuracy bars for N runs ───────────────────────────────────────

function PerClassComparisonN({ runs }: { runs: ApiRun[] }) {
  const pcs = runs.map((r) => r.perClassAccuracy ?? {})
  const labels = [...new Set(pcs.flatMap((pc) => Object.keys(pc)))].sort()
  if (labels.length === 0) return null

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-[var(--text-2)] mb-4">Per-class Accuracy</p>
      <div className="space-y-4">
        {labels.map((label) => (
          <div key={label}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-[var(--text-1)]">{label}</span>
            </div>
            <div className="space-y-1">
              {runs.map((r, idx) => {
                const acc = pcs[idx]![label] ?? null
                const color = RUN_COLORS[idx % RUN_COLORS.length]
                return (
                  <div key={r.id} className="flex items-center gap-2">
                    <span
                      className="text-2xs w-10 flex-shrink-0 font-mono"
                      style={{ color }}
                    >
                      #{r.id}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(acc ?? 0) * 100}%` }}
                        transition={{ duration: 0.5, delay: idx * 0.05 }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    </div>
                    <span className="text-2xs stat-num text-[var(--text-2)] w-12 text-right flex-shrink-0">
                      {pct(acc)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function CompareRuns() {
  const { id: taskIdRaw } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const taskId = decodeURIComponent(taskIdRaw ?? "")
  const runIds = parseRunIds(searchParams)

  const queries = useQueries({
    queries: runIds.map((id) => ({
      queryKey: ["run", id],
      queryFn: () => api.run(id),
      enabled: !!id,
    })),
  })

  const anyLoading = queries.some((q) => q.isLoading)
  const allLoaded = queries.every((q) => q.data)

  if (runIds.length < 2) {
    return (
      <div className="text-sm text-[var(--text-3)] p-4">
        Select at least 2 runs to compare. Use <code>?runs=1,2,3</code> in the URL or select checkboxes on the Runs page.
      </div>
    )
  }
  if (anyLoading || !allLoaded) {
    return <div className="text-sm text-[var(--text-3)]">Loading {runIds.length} runs…</div>
  }

  const runs = queries.map((q) => q.data!) as ApiRun[]

  // Identify winner by val_accuracy (or accuracy as fallback)
  const scored = runs.map((r) => ({
    run: r,
    score: r.valAccuracy ?? r.accuracy ?? -Infinity,
  }))
  const winnerId = scored.reduce((best, cur) => (cur.score > best.score ? cur : best), scored[0]!).run.id

  return (
    <div>
      <Link
        to={`/tasks/${encodeURIComponent(taskId)}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] mb-5 transition-colors"
      >
        <ArrowLeft size={12} />
        {taskId}
      </Link>

      <div className="flex items-baseline gap-3 mb-6 flex-wrap">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Compare runs</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {runs.map((r, idx) => (
            <span
              key={r.id}
              className="font-mono text-sm"
              style={{ color: RUN_COLORS[idx % RUN_COLORS.length] }}
            >
              #{r.id}
            </span>
          ))}
        </div>
      </div>

      {/* Status cards grid (responsive) */}
      <div className={clsx(
        "grid gap-3 mb-6",
        runs.length <= 2 ? "grid-cols-2" :
        runs.length <= 3 ? "grid-cols-3" :
        "grid-cols-2 lg:grid-cols-3",
      )}>
        {runs.map((run, idx) => {
          const color = RUN_COLORS[idx % RUN_COLORS.length]
          const isWinner = run.id === winnerId
          return (
            <div
              key={run.id}
              className="card p-4"
              style={{ borderColor: `${color}33` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm font-semibold" style={{ color }}>
                  Run #{run.id}
                  {isWinner && <span className="ml-1.5 text-2xs text-[var(--success)]">★</span>}
                </span>
                <div className="flex items-center gap-1.5">
                  <StatusDot status={run.status} />
                  <span className="text-xs text-[var(--text-2)]">{run.status}</span>
                </div>
              </div>
              <p
                className={clsx(
                  "stat-num text-2xl",
                  (run.valAccuracy ?? run.accuracy ?? 0) >= 0.9
                    ? "text-[var(--success)]"
                    : "text-[var(--text-1)]"
                )}
              >
                {pct(run.valAccuracy ?? run.accuracy)}
              </p>
              <p className="text-2xs text-[var(--text-3)] mt-1 font-mono">
                lr {(run.hyperparams as { lr?: number }).lr ?? "?"} ·{" "}
                {(run.hyperparams as { epochs?: number }).epochs ?? "?"} epochs
              </p>
            </div>
          )
        })}
      </div>

      {/* Metrics table — one column per run */}
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-1/5">
                Metric
              </th>
              {runs.map((r, idx) => (
                <th
                  key={r.id}
                  className="text-left px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider"
                  style={{ color: RUN_COLORS[idx % RUN_COLORS.length] }}
                >
                  #{r.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { key: "accuracy", label: "Train accuracy", format: pct, value: (r: ApiRun) => r.accuracy },
              { key: "val", label: "Val accuracy", format: pct, value: (r: ApiRun) => r.valAccuracy },
              { key: "lr", label: "Learning rate", format: (v: unknown) => String(v ?? "—"), value: (r: ApiRun) => (r.hyperparams as { lr?: number }).lr },
              { key: "epochs", label: "Epochs", format: (v: unknown) => String(v ?? "—"), value: (r: ApiRun) => (r.hyperparams as { epochs?: number }).epochs },
              { key: "duration", label: "Duration", format: (v: unknown) => (v != null ? `${v}s` : "—"), value: (r: ApiRun) => r.durationS },
              { key: "mae", label: "MAE", format: (v: unknown) => (typeof v === "number" ? v.toFixed(4) : "—"), value: (r: ApiRun) => r.mae },
              { key: "r2", label: "R²", format: (v: unknown) => (typeof v === "number" ? v.toFixed(4) : "—"), value: (r: ApiRun) => r.r2 },
            ]
              .filter((m) => runs.some((r) => m.value(r) != null))
              .map((m) => (
                <tr key={m.key} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">{m.label}</td>
                  {runs.map((r) => (
                    <td key={r.id} className="px-4 py-2.5 stat-num text-xs text-[var(--text-1)]">
                      {m.format(m.value(r))}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LossComparisonN runs={runs} />
        <PerClassComparisonN runs={runs} />
      </div>
    </div>
  )
}
