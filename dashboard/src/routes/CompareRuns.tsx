import { useParams, useSearchParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts"
import { api, type ApiRun } from "../lib/api"
import { StatusDot } from "../components/StatusDot"
import { clsx } from "clsx"

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

// ── Delta badge ────────────────────────────────────────────────────────────────

function Delta({ a, b, higherBetter = true, fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%` }: {
  a: number | null
  b: number | null
  higherBetter?: boolean
  fmt?: (v: number) => string
}) {
  if (a == null || b == null) return <span className="text-[var(--text-3)]">—</span>
  const diff = b - a
  if (Math.abs(diff) < 0.0005) return <span className="text-[var(--text-3)] flex items-center gap-0.5"><Minus size={10} />0</span>
  const improved = higherBetter ? diff > 0 : diff < 0
  return (
    <span className={clsx("flex items-center gap-0.5 text-xs font-mono", improved ? "text-[var(--success)]" : "text-[var(--danger)]")}>
      {improved ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {fmt(diff)}
    </span>
  )
}

// ── Overlaid loss curves ───────────────────────────────────────────────────────

function LossComparison({ runA, runB }: { runA: ApiRun; runB: ApiRun }) {
  const histA = runA.lossHistory ?? []
  const histB = runB.lossHistory ?? []
  if (histA.length === 0 && histB.length === 0) return null

  const maxLen = Math.max(histA.length, histB.length)
  const data = Array.from({ length: maxLen }, (_, i) => ({
    epoch: i + 1,
    [`#${runA.id}`]: histA[i] != null ? +histA[i]!.toFixed(5) : undefined,
    [`#${runB.id}`]: histB[i] != null ? +histB[i]!.toFixed(5) : undefined,
  }))

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-[var(--text-2)] mb-4">Loss Curves</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => v.toFixed(3)} />
          <Tooltip
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: "var(--text-1)" }}
            formatter={(v: number) => v.toFixed(5)}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-2)" }} />
          <Line type="monotone" dataKey={`#${runA.id}`} stroke="var(--accent-text)"  strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey={`#${runB.id}`} stroke="var(--warning)"      strokeWidth={1.5} dot={false} connectNulls strokeDasharray="5 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Per-class comparison ───────────────────────────────────────────────────────

function PerClassComparison({ runA, runB }: { runA: ApiRun; runB: ApiRun }) {
  const pcA = runA.perClassAccuracy ?? {}
  const pcB = runB.perClassAccuracy ?? {}
  const labels = [...new Set([...Object.keys(pcA), ...Object.keys(pcB)])].sort()
  if (labels.length === 0) return null

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-[var(--text-2)] mb-4">Per-class Accuracy</p>
      <div className="space-y-4">
        {labels.map((label) => {
          const accA = pcA[label] ?? null
          const accB = pcB[label] ?? null
          return (
            <div key={label}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-mono text-[var(--text-1)]">{label}</span>
                <Delta a={accA} b={accB} fmt={(v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`} />
              </div>
              {/* Run A bar */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xs text-[var(--accent-text)] w-8 flex-shrink-0 font-mono">#{runA.id}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(accA ?? 0) * 100}%` }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full bg-[var(--accent-text)]"
                  />
                </div>
                <span className="text-2xs stat-num text-[var(--text-2)] w-12 text-right flex-shrink-0">{pct(accA)}</span>
              </div>
              {/* Run B bar */}
              <div className="flex items-center gap-2">
                <span className="text-2xs text-[var(--warning)] w-8 flex-shrink-0 font-mono">#{runB.id}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(accB ?? 0) * 100}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="h-full rounded-full bg-[var(--warning)]"
                  />
                </div>
                <span className="text-2xs stat-num text-[var(--text-2)] w-12 text-right flex-shrink-0">{pct(accB)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── CompareRuns ────────────────────────────────────────────────────────────────

export function CompareRuns() {
  const { id: taskIdRaw } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const taskId = decodeURIComponent(taskIdRaw ?? "")
  const aId = parseInt(searchParams.get("a") ?? "0")
  const bId = parseInt(searchParams.get("b") ?? "0")

  const { data: runA, isLoading: loadingA } = useQuery({
    queryKey: ["run", aId],
    queryFn: () => api.run(aId),
    enabled: !!aId,
  })
  const { data: runB, isLoading: loadingB } = useQuery({
    queryKey: ["run", bId],
    queryFn: () => api.run(bId),
    enabled: !!bId,
  })

  if (loadingA || loadingB || !runA || !runB) {
    return <div className="text-sm text-[var(--text-3)]">Loading runs…</div>
  }

  const hpA = runA.hyperparams as { lr?: number; epochs?: number }
  const hpB = runB.hyperparams as { lr?: number; epochs?: number }

  const metrics: Array<{
    label: string
    a: string
    b: string
    delta?: React.ReactNode
  }> = [
    {
      label: "Accuracy",
      a: pct(runA.accuracy),
      b: pct(runB.accuracy),
      delta: <Delta a={runA.accuracy} b={runB.accuracy} fmt={(v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`} />,
    },
    {
      label: "Val accuracy",
      a: pct(runA.valAccuracy),
      b: pct(runB.valAccuracy),
      delta: <Delta a={runA.valAccuracy} b={runB.valAccuracy} fmt={(v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`} />,
    },
    {
      label: "Learning rate",
      a: String(hpA.lr ?? "—"),
      b: String(hpB.lr ?? "—"),
    },
    {
      label: "Epochs",
      a: String(hpA.epochs ?? "—"),
      b: String(hpB.epochs ?? "—"),
      delta: hpA.epochs != null && hpB.epochs != null
        ? <Delta a={hpA.epochs} b={hpB.epochs} higherBetter={false} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}`} />
        : undefined,
    },
    {
      label: "Duration",
      a: runA.durationS != null ? `${runA.durationS}s` : "—",
      b: runB.durationS != null ? `${runB.durationS}s` : "—",
      delta: runA.durationS != null && runB.durationS != null
        ? <Delta a={runA.durationS} b={runB.durationS} higherBetter={false} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}s`} />
        : undefined,
    },
    ...(runA.mae != null || runB.mae != null ? [{
      label: "MAE",
      a: runA.mae != null ? runA.mae.toFixed(4) : "—",
      b: runB.mae != null ? runB.mae.toFixed(4) : "—",
      delta: <Delta a={runA.mae} b={runB.mae} higherBetter={false} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(4)}`} />,
    }] : []),
  ]

  return (
    <div>
      {/* Back */}
      <Link
        to={`/tasks/${encodeURIComponent(taskId)}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] mb-5 transition-colors"
      >
        <ArrowLeft size={12} />
        {taskId}
      </Link>

      {/* Header */}
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-[var(--text-1)]">Compare runs</h1>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[var(--accent-text)]">#{runA.id}</span>
          <span className="text-[var(--text-3)]">vs</span>
          <span className="font-mono text-sm text-[var(--warning)]">#{runB.id}</span>
        </div>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { run: runA, color: "var(--accent-text)" },
          { run: runB, color: "var(--warning)" },
        ].map(({ run, color }) => (
          <div key={run.id} className="card p-4" style={{ borderColor: `${color}33` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-sm font-semibold" style={{ color }}>Run #{run.id}</span>
              <div className="flex items-center gap-1.5">
                <StatusDot status={run.status} />
                <span className="text-xs text-[var(--text-2)]">{run.status}</span>
              </div>
            </div>
            <p className={clsx(
              "stat-num text-2xl",
              (run.accuracy ?? 0) >= 0.9 ? "text-[var(--success)]" : "text-[var(--text-1)]"
            )}>
              {pct(run.accuracy)}
            </p>
            <p className="text-2xs text-[var(--text-3)] mt-1 font-mono">
              lr {(run.hyperparams as { lr?: number }).lr ?? "?"} · {(run.hyperparams as { epochs?: number }).epochs ?? "?"} epochs
            </p>
          </div>
        ))}
      </div>

      {/* Metrics table */}
      <div className="card overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider w-1/3">Metric</th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent-text)" }}>
                #{runA.id}
              </th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
                #{runB.id}
              </th>
              <th className="text-left px-4 py-2.5 text-2xs font-semibold text-[var(--text-3)] uppercase tracking-wider">Delta</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label} className="border-b border-[var(--border-subtle)]">
                <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">{m.label}</td>
                <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-1)]">{m.a}</td>
                <td className="px-4 py-2.5 stat-num text-xs text-[var(--text-1)]">{m.b}</td>
                <td className="px-4 py-2.5">{m.delta ?? <span className="text-[var(--text-3)] text-xs">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LossComparison runA={runA} runB={runB} />
        <PerClassComparison runA={runA} runB={runB} />
      </div>
    </div>
  )
}
