import { clsx } from "clsx"

interface Props {
  status: string
  className?: string
}

const colorMap: Record<string, string> = {
  completed: "bg-[var(--success)]",
  running:   "bg-[var(--info)]",
  failed:    "bg-[var(--danger)]",
  cancelled: "bg-[var(--text-3)]",
  pending:   "bg-[var(--warning)]",
  imported:  "bg-[var(--accent-text)]",
}

export function StatusDot({ status, className }: Props) {
  const isRunning = status === "running"
  return (
    <span className={clsx("relative inline-flex items-center justify-center w-2 h-2", className)}>
      {isRunning && (
        <span className="absolute inline-flex w-full h-full rounded-full bg-[var(--info)] opacity-60 animate-ping" />
      )}
      <span className={clsx("relative inline-flex rounded-full w-2 h-2", colorMap[status] ?? "bg-[var(--text-3)]")} />
    </span>
  )
}
