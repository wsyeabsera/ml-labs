import { motion } from "framer-motion"

export interface Stat {
  value: string
  label: string
  accent?: "cyan" | "purple" | "green" | "orange" | "pink"
}

const accentText = {
  cyan: "text-cyan-neon",
  purple: "text-purple-neon",
  green: "text-green-neon",
  orange: "text-orange-neon",
  pink: "text-pink-neon",
}

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-8">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.35, delay: i * 0.06 }}
          className="lab-panel p-4"
        >
          <div className={`text-2xl md:text-3xl font-bold font-mono ${accentText[s.accent ?? "cyan"]}`}>
            {s.value}
          </div>
          <div className="text-xs text-lab-muted mt-1 uppercase tracking-wider">{s.label}</div>
        </motion.div>
      ))}
    </div>
  )
}
