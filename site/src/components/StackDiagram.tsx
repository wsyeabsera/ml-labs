import { motion } from "framer-motion"
import type { LucideIcon } from "lucide-react"

export interface StackLayer {
  label: string
  tag: string
  desc: string
  icon: LucideIcon
  accent: "cyan" | "purple" | "green" | "orange" | "pink"
}

const accentBorder = {
  cyan: "border-cyan-neon/40 text-cyan-neon",
  purple: "border-purple-neon/40 text-purple-neon",
  green: "border-green-neon/40 text-green-neon",
  orange: "border-orange-neon/40 text-orange-neon",
  pink: "border-pink-neon/40 text-pink-neon",
}

const accentBg = {
  cyan: "bg-cyan-neon/5",
  purple: "bg-purple-neon/5",
  green: "bg-green-neon/5",
  orange: "bg-orange-neon/5",
  pink: "bg-pink-neon/5",
}

export function StackDiagram({ layers }: { layers: StackLayer[] }) {
  return (
    <div className="my-8 space-y-3">
      {layers.map((layer, i) => {
        const Icon = layer.icon
        return (
          <motion.div
            key={layer.label}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className={`relative flex items-center gap-4 p-5 rounded-xl border ${accentBorder[layer.accent]} ${accentBg[layer.accent]}`}
          >
            <div
              className={`w-12 h-12 rounded-lg border ${accentBorder[layer.accent]} ${accentBg[layer.accent]} flex items-center justify-center shrink-0`}
            >
              <Icon className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lab-heading font-semibold">{layer.label}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-lab-border text-lab-muted">
                  {layer.tag}
                </span>
              </div>
              <div className="text-sm text-lab-text/75">{layer.desc}</div>
            </div>
            {i < layers.length - 1 && (
              <div className="absolute left-11 -bottom-3 w-px h-3 bg-lab-border" />
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
