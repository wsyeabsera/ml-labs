import { NavLink, Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  Beaker, Layers, Workflow, Zap, Package, Rocket,
  BookMarked, Github, Sparkles, Download, Terminal,
  ScrollText, Menu, X,
  Brain, Gauge, ShieldCheck, Activity, SlidersHorizontal,
  Monitor, MessageSquare, Trophy,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

const VERSION = "1.10.1"
const GITHUB = "https://github.com/wsyeabsera/ml-labs"

const navSections = [
  {
    label: "Getting Started",
    items: [
      { to: "/", label: "Home", icon: Sparkles },
      { to: "/install", label: "Installation", icon: Download },
      { to: "/quick-start", label: "Quick Start", icon: Rocket },
      { to: "/cli", label: "CLI Reference", icon: Terminal },
    ],
  },
  {
    label: "How It Works",
    items: [
      { to: "/architecture", label: "Architecture", icon: Layers },
      { to: "/training-flow", label: "Training Flow", icon: Workflow },
      { to: "/sweeps-auto", label: "Sweeps & Auto-Train", icon: Zap },
      { to: "/registry-learning", label: "Registry & Active Learning", icon: Package },
    ],
  },
  {
    label: "Deep Dives",
    items: [
      { to: "/auto-train-deep-dive", label: "Auto-Train Deep Dive", icon: Brain },
      { to: "/sweep-modes", label: "Sweep Modes", icon: Zap },
      { to: "/memory-budget", label: "Memory Budget", icon: Gauge },
      { to: "/validation", label: "Validation & Reliability", icon: ShieldCheck },
      { to: "/training-config", label: "Training Config", icon: SlidersHorizontal },
      { to: "/observability", label: "Events & Observability", icon: Activity },
    ],
  },
  {
    label: "Surfaces",
    items: [
      { to: "/dashboard", label: "HTTP Dashboard", icon: Monitor },
      { to: "/tui", label: "TUI", icon: Terminal },
      { to: "/llm", label: "LLM / GGUF", icon: MessageSquare },
    ],
  },
  {
    label: "Reference",
    items: [
      { to: "/tool-reference", label: "Tool Reference", icon: BookMarked },
      { to: "/benchmarks", label: "Benchmarks", icon: Trophy },
      { to: "/changelog", label: "Changelog", icon: ScrollText },
    ],
  },
]


function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Sparkles }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-cyan-neon/10 text-cyan-neon"
            : "text-lab-text/70 hover:text-lab-heading hover:bg-lab-border/40"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-cyan-neon" : "text-lab-muted"}`} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  )
}

function SidebarContent({ onNav }: { onNav?: () => void }) {
  return (
    <div className="flex flex-col h-full" onClick={onNav}>
      {/* Logo */}
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5 border-b border-lab-border shrink-0">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-neon via-purple-neon to-pink-neon p-[1px]">
          <div className="w-full h-full rounded-[7px] bg-lab-bg flex items-center justify-center">
            <Beaker className="w-5 h-5 text-cyan-neon" />
          </div>
        </div>
        <div>
          <div className="text-lab-heading font-bold text-sm leading-none">ML-Labs</div>
          <div className="text-lab-muted text-[10px] mt-0.5 font-mono">v{VERSION}</div>
        </div>
      </Link>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-lab-muted/70 font-mono px-3 mb-1.5">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-lab-border px-5 py-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="chip-cyan">rs-tensor</span>
          <span className="chip-purple">Claude MCP</span>
          <span className="chip-green">Bun</span>
        </div>
        <a
          href={GITHUB}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs text-lab-muted hover:text-cyan-neon transition-colors"
        >
          <Github className="w-3.5 h-3.5" /> wsyeabsera/ml-labs
        </a>
      </div>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-lab-border bg-lab-panel/40 backdrop-blur-sm sticky top-0 h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-3 bg-lab-panel/90 backdrop-blur-md border-b border-lab-border">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-neon via-purple-neon to-pink-neon p-[1px]">
            <div className="w-full h-full rounded-[5px] bg-lab-bg flex items-center justify-center">
              <Beaker className="w-4 h-4 text-cyan-neon" />
            </div>
          </div>
          <span className="text-lab-heading font-bold text-sm">ML-Labs</span>
          <span className="text-lab-muted text-[10px] font-mono">v{VERSION}</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-lg text-lab-muted hover:text-lab-heading hover:bg-lab-border/40 transition-colors"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 z-20 bg-lab-bg/70 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="md:hidden fixed top-0 left-0 z-30 w-72 h-full bg-lab-panel border-r border-lab-border"
            >
              <SidebarContent onNav={() => setMobileOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="flex-1 min-w-0 md:mt-0 mt-14">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="px-5 md:px-10 py-10 md:py-12 max-w-5xl"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
