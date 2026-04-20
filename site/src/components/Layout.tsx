import { NavLink, Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  Beaker,
  Layers,
  Workflow,
  Zap,
  Package,
  Rocket,
  BookMarked,
  Github,
  Sparkles,
} from "lucide-react"
import type { ReactNode } from "react"

const nav = [
  { to: "/", label: "Home", icon: Sparkles },
  { to: "/architecture", label: "Architecture", icon: Layers },
  { to: "/training-flow", label: "Training Flow", icon: Workflow },
  { to: "/sweeps-auto", label: "Sweeps & Auto-Train", icon: Zap },
  { to: "/registry-learning", label: "Registry & Active Learning", icon: Package },
  { to: "/quick-start", label: "Quick Start", icon: Rocket },
  { to: "/tool-reference", label: "Tool Reference", icon: BookMarked },
]

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 border-r border-lab-border bg-lab-panel/40 backdrop-blur-sm sticky top-0 h-screen overflow-y-auto">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-6 border-b border-lab-border">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-neon via-purple-neon to-pink-neon p-[1px]">
            <div className="w-full h-full rounded-[7px] bg-lab-bg flex items-center justify-center">
              <Beaker className="w-5 h-5 text-cyan-neon" />
            </div>
          </div>
          <div>
            <div className="text-lab-heading font-bold text-sm leading-none">ML-Labs</div>
            <div className="text-lab-muted text-[10px] mt-0.5 font-mono uppercase tracking-widest">
              Docs · v1
            </div>
          </div>
        </Link>

        <nav className="p-3 space-y-0.5">
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-cyan-neon/10 text-cyan-neon"
                      : "text-lab-text/70 hover:text-lab-heading hover:bg-lab-border/40"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`w-4 h-4 shrink-0 ${isActive ? "text-cyan-neon" : "text-lab-muted"}`}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="px-5 py-4 mt-4 border-t border-lab-border">
          <div className="text-[10px] uppercase tracking-widest text-lab-muted mb-2 font-mono">
            Built with
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="chip-cyan">rs-tensor</span>
            <span className="chip-purple">Claude MCP</span>
            <span className="chip-green">Bun</span>
          </div>
        </div>

        <a
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-5 py-3 text-xs text-lab-muted hover:text-cyan-neon transition-colors"
        >
          <Github className="w-3.5 h-3.5" /> Source on GitHub
        </a>
      </aside>

      <main className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="px-10 py-12 max-w-5xl"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
