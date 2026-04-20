import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { motion } from "framer-motion"

type Accent = "cyan" | "purple" | "green" | "orange" | "pink"

interface InfoCardProps {
  icon?: LucideIcon
  title: string
  children: ReactNode
  accent?: Accent
  delay?: number
}

const accentRing: Record<Accent, string> = {
  cyan: "hover:border-cyan-neon/50 hover:shadow-glow",
  purple: "hover:border-purple-neon/50 hover:shadow-glow-purple",
  green: "hover:border-green-neon/50 hover:shadow-glow-green",
  orange: "hover:border-orange-neon/50",
  pink: "hover:border-pink-neon/50",
}

const accentIcon: Record<Accent, string> = {
  cyan: "text-cyan-neon bg-cyan-neon/10",
  purple: "text-purple-neon bg-purple-neon/10",
  green: "text-green-neon bg-green-neon/10",
  orange: "text-orange-neon bg-orange-neon/10",
  pink: "text-pink-neon bg-pink-neon/10",
}

export function InfoCard({ icon: Icon, title, children, accent = "cyan", delay = 0 }: InfoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className={`lab-panel p-6 transition-all duration-300 ${accentRing[accent]}`}
    >
      <div className="flex items-start gap-4">
        {Icon && (
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accentIcon[accent]}`}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lab-heading font-semibold mb-1.5">{title}</h3>
          <div className="text-sm text-lab-text/80 leading-relaxed">{children}</div>
        </div>
      </div>
    </motion.div>
  )
}
