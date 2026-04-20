import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"

export interface FlowNode {
  label: string
  sub?: string
  accent?: "cyan" | "purple" | "green" | "orange" | "pink"
}

const accentMap = {
  cyan: "border-cyan-neon/50 bg-cyan-neon/10 text-cyan-neon",
  purple: "border-purple-neon/50 bg-purple-neon/10 text-purple-neon",
  green: "border-green-neon/50 bg-green-neon/10 text-green-neon",
  orange: "border-orange-neon/50 bg-orange-neon/10 text-orange-neon",
  pink: "border-pink-neon/50 bg-pink-neon/10 text-pink-neon",
}

export function DataFlow({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="my-8 flex flex-wrap items-stretch gap-2">
      {nodes.map((n, i) => {
        const accent = n.accent ?? "cyan"
        return (
          <div key={n.label + i} className="flex items-center gap-2">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.08 }}
              className={`px-4 py-3 rounded-lg border text-center min-w-[120px] ${accentMap[accent]}`}
            >
              <div className="text-sm font-semibold">{n.label}</div>
              {n.sub && <div className="text-[10px] font-mono opacity-70 mt-0.5">{n.sub}</div>}
            </motion.div>
            {i < nodes.length - 1 && <ArrowRight className="w-4 h-4 text-lab-muted shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}
