import type { ReactNode } from "react"
import { motion } from "framer-motion"

export interface TimelineStep {
  step: string
  title: string
  body: ReactNode
  accent?: "cyan" | "purple" | "green" | "orange" | "pink"
}

const dotAccent = {
  cyan: "bg-cyan-neon shadow-glow",
  purple: "bg-purple-neon shadow-glow-purple",
  green: "bg-green-neon shadow-glow-green",
  orange: "bg-orange-neon",
  pink: "bg-pink-neon",
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="relative my-6 pl-8 border-l border-lab-border/80">
      {steps.map((s, i) => {
        const accent = s.accent ?? "cyan"
        return (
          <motion.div
            key={s.step + i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className="relative mb-7"
          >
            <div
              className={`absolute -left-[35px] top-1.5 w-3 h-3 rounded-full ${dotAccent[accent]}`}
            />
            <div className="text-[10px] font-mono uppercase tracking-widest text-lab-muted mb-1">
              Step {s.step}
            </div>
            <h4 className="text-lab-heading font-semibold text-base mb-1.5">{s.title}</h4>
            <div className="text-sm text-lab-text/80 leading-relaxed">{s.body}</div>
          </motion.div>
        )
      })}
    </div>
  )
}
