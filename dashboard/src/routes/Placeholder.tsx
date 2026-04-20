import type { LucideIcon } from "lucide-react"
import { motion } from "framer-motion"

interface Props {
  icon: LucideIcon
  title: string
  phase: string
  items: string[]
}

export function Placeholder({ icon: Icon, title, phase, items }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        className="text-center max-w-sm"
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--accent-dim)] mx-auto mb-4">
          <Icon size={22} className="text-[var(--accent-text)]" />
        </div>
        <h2 className="text-base font-semibold text-[var(--text-1)] mb-1">{title}</h2>
        <p className="text-xs text-[var(--text-3)] mb-4 font-mono">{phase}</p>
        <div className="card p-4 text-left space-y-1.5">
          {items.map((item) => (
            <div key={item} className="flex items-start gap-2 text-xs text-[var(--text-2)]">
              <span className="w-1 h-1 rounded-full bg-[var(--accent-text)] mt-1.5 flex-shrink-0" />
              {item}
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
