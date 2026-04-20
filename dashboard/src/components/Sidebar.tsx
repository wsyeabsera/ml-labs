import { NavLink } from "react-router-dom"
import { LayoutDashboard, Database, PlayCircle, BarChart3, Cpu, Zap, SlidersHorizontal, Upload } from "lucide-react"
import { clsx } from "clsx"
import { ThemeToggle } from "./ThemeToggle"
import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/api"
import { ActivityFeedWidget } from "./ActivityFeed"

const nav = [
  { to: "/",        label: "Overview",  icon: LayoutDashboard, end: true },
  { to: "/tasks",   label: "Tasks",     icon: Database },
  { to: "/runs",    label: "Runs",      icon: BarChart3 },
  { to: "/train",   label: "Train",     icon: PlayCircle },
  { to: "/predict", label: "Predict",   icon: Zap },
  { to: "/sweep",   label: "Sweep",     icon: SlidersHorizontal },
  { to: "/upload",  label: "Upload",    icon: Upload },
]

export function Sidebar() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 5000,
    retry: false,
  })

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] flex flex-col border-r border-[var(--border)] bg-[var(--surface-1)] z-20">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--accent-dim)]">
          <Cpu size={13} className="text-[var(--accent-text)]" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold text-[var(--text-1)]">Neuron</span>
          <span className="text-2xs text-[var(--text-3)] font-mono">ml-labs dashboard</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <p className="section-label px-3 mb-2">Workspace</p>
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => clsx("nav-item", isActive && "active")}
          >
            <Icon size={14} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Activity feed */}
      <ActivityFeedWidget />

      {/* Bottom: status + theme */}
      <div className="px-3 py-3 border-t border-[var(--border-subtle)] space-y-2">
        {/* Server status */}
        <div className="space-y-1">
          <p className="section-label">Servers</p>
          <ServerPill
            label="neuron"
            ok={!!health?.ok}
          />
        </div>

        {/* Version + theme */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-2xs font-mono text-[var(--text-3)]">
            {health?.version ?? "—"}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  )
}

function ServerPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-2)]">
      <span className={clsx(
        "w-1.5 h-1.5 rounded-full flex-shrink-0",
        ok ? "bg-[var(--success)]" : "bg-[var(--text-3)]"
      )} />
      <span className="font-mono">{label}</span>
      <span className={clsx("ml-auto text-2xs font-mono", ok ? "text-[var(--success)]" : "text-[var(--text-3)]")}>
        {ok ? "online" : "offline"}
      </span>
    </div>
  )
}
