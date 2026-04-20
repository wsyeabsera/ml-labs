import { motion } from "framer-motion"

export interface ToolEntry {
  name: string
  signature: string
  desc: string
  category: string
}

const categoryColor: Record<string, string> = {
  Task: "chip-cyan",
  Data: "chip-purple",
  Training: "chip-orange",
  Inspection: "chip-green",
  Model: "chip-pink",
  Inference: "chip-cyan",
  Auto: "chip-pink",
}

export function ToolCard({ tool, index }: { tool: ToolEntry; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.25) }}
      className="lab-panel p-5 hover:border-cyan-neon/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <code className="text-cyan-neon font-mono text-sm font-semibold">{tool.name}</code>
        <span className={categoryColor[tool.category] ?? "chip-cyan"}>{tool.category}</span>
      </div>
      <div className="text-xs font-mono text-lab-muted bg-lab-bg/60 rounded-md px-2.5 py-1.5 mb-3 border border-lab-border/60 overflow-x-auto whitespace-nowrap">
        {tool.signature}
      </div>
      <p className="text-sm text-lab-text/80 leading-relaxed">{tool.desc}</p>
    </motion.div>
  )
}
