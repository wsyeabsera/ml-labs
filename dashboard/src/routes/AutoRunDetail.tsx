import { useParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import {
  ArrowLeft, Bot, CheckCircle2, AlertTriangle, Clock, Target, Trophy,
  Layers, ChevronRight,
} from "lucide-react"
import { api, type ApiAutoLogEntry } from "../lib/api"
import { clsx } from "clsx"

function pct(v: number | null | undefined) {
  return v != null ? `${(v * 100).toFixed(1)}%` : "—"
}

function wallClockS(start: string, finish: string | null): string {
  const endTs = finish ? Date.parse(finish) : Date.now()
  const s = Math.max(0, Math.round((endTs - Date.parse(start)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s - m * 60}s`
}

const STATUS_COLOR: Record<string, string> = {
  running:         "text-[var(--accent-text)]",
  completed:       "text-[var(--success)]",
  failed:          "text-[var(--danger)]",
  data_issue:      "text-[var(--warning)]",
  budget_exceeded: "text-[var(--warning)]",
  no_improvement:  "text-[var(--warning)]",
}

const STAGE_ICON: Record<string, React.ReactNode> = {
  preflight:  <CheckCircle2 size={12} />,
  seed:       <Target size={12} />,
  diagnose:   <AlertTriangle size={12} />,
  promote:    <Trophy size={12} />,
  done:       <CheckCircle2 size={12} />,
}

function stageIcon(stage: string): React.ReactNode {
  if (stage.startsWith("wave")) return <Layers size={12} />
  return STAGE_ICON[stage] ?? <ChevronRight size={12} />
}

function Timeline({ log }: { log: ApiAutoLogEntry[] }) {
  if (log.length === 0) {
    return <p className="text-xs text-[var(--text-3)]">No decisions logged yet.</p>
  }
  return (
    <ol className="space-y-2">
      {log.map((e, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i * 0.02, 0.3) }}
          className="flex items-start gap-2.5 text-xs"
        >
          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-[var(--surface-2)] text-[var(--text-3)] mt-0.5">
            {stageIcon(e.stage)}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[var(--text-2)] uppercase tracking-wider text-2xs">{e.stage}</span>
              <span className="text-2xs text-[var(--text-3)] font-mono">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
            <p className="text-[var(--text-1)] mt-0.5 leading-snug">{e.note}</p>
            {e.payload != null && typeof e.payload === "object" && Object.keys(e.payload as object).length > 0 && (
              <details className="mt-1">
                <summary className="text-2xs text-[var(--text-3)] cursor-pointer hover:text-[var(--text-2)]">payload</summary>
                <pre className="mt-1 p-2 rounded bg-[var(--surface-2)] text-2xs text-[var(--text-2)] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </motion.li>
      ))}
    </ol>
  )
}

export function AutoRunDetail() {
  const { id } = useParams<{ id: string }>()
  const autoRunId = parseInt(id ?? "0")

  const { data, isLoading } = useQuery({
    queryKey: ["autoRun", autoRunId],
    queryFn: () => api.autoRun(autoRunId),
    enabled: !!autoRunId,
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  })

  if (isLoading || !data) return <div className="text-sm text-[var(--text-3)]">Loading auto-run…</div>

  const v = data.verdictJson
  const statusColor = STATUS_COLOR[data.status] ?? "text-[var(--text-2)]"
  const reachedTarget =
    data.accuracyTarget != null && data.finalAccuracy != null && data.finalAccuracy >= data.accuracyTarget

  return (
    <div>
      <Link to="/auto" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-2)] mb-5 transition-colors">
        <ArrowLeft size={12} />
        All auto-runs
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--accent-dim)]">
            <Bot size={18} className="text-[var(--accent-text)]" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-1)] font-mono">Auto-run #{data.id}</h1>
            <p className="text-sm text-[var(--text-3)] mt-0.5">
              <Link to={`/tasks/${encodeURIComponent(data.taskId)}`} className="text-[var(--accent-text)] hover:underline font-mono">
                {data.taskId}
              </Link>
              {" · "}
              <span className="font-mono">{wallClockS(data.startedAt, data.finishedAt)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx("text-sm font-mono", statusColor)}>{data.status}</span>
          {data.finalAccuracy != null && (
            <span className={clsx("stat-num text-lg", reachedTarget ? "text-[var(--success)]" : "text-[var(--text-1)]")}>
              {pct(data.finalAccuracy)}
            </span>
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Target",     value: pct(data.accuracyTarget) },
          { label: "Final",      value: pct(data.finalAccuracy), accent: reachedTarget },
          { label: "Waves",      value: `${data.wavesUsed}${data.maxWaves ? `/${data.maxWaves}` : ""}` },
          { label: "Budget",     value: data.budgetS != null ? `${data.budgetS}s` : "—" },
        ].map(({ label, value, accent }) => (
          <div key={label} className="card p-3">
            <p className="text-2xs text-[var(--text-3)] mb-1">{label}</p>
            <p className={clsx("stat-num text-base", accent ? "text-[var(--success)]" : "text-[var(--text-1)]")}>{value}</p>
          </div>
        ))}
      </div>

      {/* Winner */}
      {data.winnerRunId != null && (
        <div className="card p-4 mb-6 flex items-center gap-3">
          <Trophy size={16} className="text-[var(--success)] flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-[var(--text-1)]">Winner</p>
            <p className="text-2xs text-[var(--text-3)]">
              run{v?.winner?.metric_name ? ` · ${v.winner.metric_name} ${v.winner.metric_value?.toFixed(3) ?? "—"}` : ""}
              {v?.winner?.is_overfit ? " · possibly overfit" : ""}
              {v?.winner?.confidence ? ` · confidence ${v.winner.confidence}` : ""}
            </p>
          </div>
          <Link
            to={`/tasks/${encodeURIComponent(data.taskId)}/runs/${data.winnerRunId}`}
            className="text-xs font-mono text-[var(--accent-text)] hover:underline"
          >
            run #{data.winnerRunId} →
          </Link>
        </div>
      )}

      {/* Verdict: data issues */}
      {v?.data_issues && v.data_issues.length > 0 && (
        <div className="card p-4 mb-6 border-[var(--warning)]">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-[var(--warning)]" />
            <p className="text-xs font-medium text-[var(--text-1)]">Data issues</p>
          </div>
          <ul className="space-y-1">
            {v.data_issues.map((msg, i) => (
              <li key={i} className="text-xs text-[var(--text-2)] leading-relaxed">· {msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Verdict: next steps */}
      {v?.next_steps && v.next_steps.length > 0 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <ChevronRight size={14} className="text-[var(--accent-text)]" />
            <p className="text-xs font-medium text-[var(--text-1)]">Suggested next steps</p>
          </div>
          <ul className="space-y-1">
            {v.next_steps.map((msg, i) => (
              <li key={i} className="text-xs text-[var(--text-2)] leading-relaxed">· {msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* One-line verdict fallback when verdict_json absent */}
      {!v && data.verdict && (
        <div className="card p-4 mb-6">
          <p className="text-xs font-medium text-[var(--text-2)] mb-1">Verdict</p>
          <p className="text-xs text-[var(--text-1)]">{data.verdict}</p>
        </div>
      )}

      {/* Attempted stats */}
      {v?.attempted && (
        <div className="card p-4 mb-6">
          <p className="text-xs font-medium text-[var(--text-2)] mb-3">Attempted</p>
          <div className="grid grid-cols-3 gap-4">
            {v.attempted.configs_tried != null && (
              <div>
                <p className="text-2xs text-[var(--text-3)] mb-0.5">Configs tried</p>
                <p className="stat-num text-sm text-[var(--text-1)]">{v.attempted.configs_tried}</p>
              </div>
            )}
            {v.attempted.waves_used != null && (
              <div>
                <p className="text-2xs text-[var(--text-3)] mb-0.5">Waves used</p>
                <p className="stat-num text-sm text-[var(--text-1)]">{v.attempted.waves_used}</p>
              </div>
            )}
            {v.attempted.wall_clock_s != null && (
              <div>
                <p className="text-2xs text-[var(--text-3)] mb-0.5">Wall-clock</p>
                <p className="stat-num text-sm text-[var(--text-1)]">
                  <Clock size={11} className="inline mr-1 text-[var(--text-3)]" />
                  {v.attempted.wall_clock_s}s
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Decision log timeline */}
      <div className="card p-4">
        <p className="text-xs font-medium text-[var(--text-2)] mb-4">
          Decision log
          <span className="text-[var(--text-3)] font-normal ml-2">{data.decisionLog.length} entries</span>
        </p>
        <Timeline log={data.decisionLog} />
      </div>
    </div>
  )
}
