import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Database, ArrowRight, BrainCircuit, FlaskConical, TrendingUp, Activity } from "lucide-react"
import { api, type ApiTask } from "../lib/api"
import { PageHeader } from "../components/PageHeader"
import { StatusDot } from "../components/StatusDot"
import { Empty } from "../components/Empty"
import { ConfigCard } from "../components/ConfigCard"
import { ActiveRunCard } from "../components/ActiveRunCard"
import { clsx } from "clsx"

function pct(v: number | null) {
  if (v == null) return "—"
  return `${(v * 100).toFixed(1)}%`
}

function kindBadge(kind: string) {
  return kind === "regression"
    ? <span className="badge badge-blue">regression</span>
    : <span className="badge badge-violet">classify</span>
}

function TaskCard({ task, delay }: { task: ApiTask; delay: number }) {
  const hasSplit = task.trainCount + task.testCount > 0 && task.testCount > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay }}
    >
      <Link
        to={`/tasks/${encodeURIComponent(task.id)}`}
        className="block card p-4 hover:border-[var(--accent-border)] transition-colors group"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface-3)] flex-shrink-0">
              <BrainCircuit size={13} className="text-[var(--text-2)]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-1)] truncate font-mono">{task.id}</p>
              <p className="text-xs text-[var(--text-3)]">{task.featureShape[0]}D features · {task.runCount} run{task.runCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {kindBadge(task.kind)}
            {task.normalize && <span className="badge badge-surface">norm</span>}
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Metric
            label="accuracy"
            value={task.accuracy != null ? pct(task.accuracy) : "—"}
            accent={task.accuracy != null && task.accuracy >= 0.9}
          />
          <Metric
            label="samples"
            value={String(task.sampleCount)}
          />
          <Metric
            label={hasSplit ? "train/test" : "labels"}
            value={hasSplit ? `${task.trainCount}/${task.testCount}` : String(task.labels?.length ?? "—")}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
            {task.lastRunStatus && (
              <>
                <StatusDot status={task.lastRunStatus} />
                <span className="font-mono">{task.lastRunStatus}</span>
              </>
            )}
            {!task.lastRunStatus && <span>no runs yet</span>}
          </div>
          <ArrowRight
            size={13}
            className="text-[var(--text-3)] group-hover:text-[var(--accent-text)] transition-colors"
          />
        </div>
      </Link>
    </motion.div>
  )
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
      <p className="text-2xs text-[var(--text-3)] mb-0.5">{label}</p>
      <p className={clsx(
        "stat-num text-sm",
        accent ? "text-[var(--success)]" : "text-[var(--text-1)]"
      )}>{value}</p>
    </div>
  )
}

function SummaryBar({ tasks }: { tasks: ApiTask[] }) {
  const totalSamples = tasks.reduce((s, t) => s + t.sampleCount, 0)
  const activeRuns = tasks.filter((t) => t.activeRunId && t.lastRunStatus === "running").length
  const bestAccuracy = tasks.reduce<number | null>((best, t) => {
    if (t.accuracy == null) return best
    return best == null || t.accuracy > best ? t.accuracy : best
  }, null)

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {[
        { icon: Database,     label: "Tasks",          value: String(tasks.length) },
        { icon: FlaskConical, label: "Total samples",   value: totalSamples.toLocaleString() },
        { icon: TrendingUp,   label: "Best accuracy",  value: bestAccuracy != null ? `${(bestAccuracy * 100).toFixed(1)}%` : "—", accent: bestAccuracy != null && bestAccuracy >= 0.9 },
        { icon: Activity,     label: "Active runs",    value: String(activeRuns), accent: activeRuns > 0 },
      ].map(({ icon: Icon, label, value, accent }) => (
        <div key={label} className="card p-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex-shrink-0">
            <Icon size={15} className="text-[var(--accent-text)]" />
          </div>
          <div>
            <p className="text-2xs text-[var(--text-3)]">{label}</p>
            <p className={`stat-num text-base ${accent ? "text-[var(--success)]" : "text-[var(--text-1)]"}`}>{value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function LiveStrip({ tasks }: { tasks: ApiTask[] }) {
  const activeTasks = tasks.filter((t) => t.activeRunId && t.lastRunStatus === "running")
  if (activeTasks.length === 0) return null

  return (
    <div className="mb-6">
      <p className="section-label mb-2">Live</p>
      <div className="space-y-2">
        {activeTasks.map((t) => (
          <ActiveRunCard key={t.id} taskId={t.id} runId={t.activeRunId!} compact />
        ))}
      </div>
    </div>
  )
}

export function Overview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
    refetchInterval: 3000,
  })

  const tasks = data?.tasks ?? []

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="All tasks at a glance. Click any task to drill in."
      />

      <ConfigCard />

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-3)] animate-pulse" />
          Connecting to neuron…
        </div>
      )}

      {error && (
        <div className="card p-4 border-[var(--danger-dim)] bg-[var(--danger-dim)]">
          <p className="text-sm text-[var(--danger)]">
            Cannot reach neuron API. Make sure ml-labs dashboard is running.
          </p>
          <p className="text-xs text-[var(--text-3)] mt-1 font-mono">{String(error)}</p>
        </div>
      )}

      {!isLoading && !error && tasks.length > 0 && (
        <>
          <SummaryBar tasks={tasks} />
          <LiveStrip tasks={tasks} />
        </>
      )}

      {!isLoading && !error && tasks.length === 0 && (
        <Empty
          icon={Database}
          title="No tasks yet"
          desc="Create your first task in Claude Code using create_task, then load data with load_csv."
        />
      )}

      {tasks.length > 0 && (
        <div>
          <p className="section-label mb-3">Tasks ({tasks.length})</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {tasks.map((t, i) => (
              <TaskCard key={t.id} task={t} delay={i * 0.04} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
