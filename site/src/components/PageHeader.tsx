import type { ReactNode } from "react"
import { motion } from "framer-motion"

interface PageHeaderProps {
  eyebrow?: string
  title: ReactNode
  lede?: ReactNode
  accent?: "cyan" | "purple" | "green" | "orange" | "pink"
}

const accentMap = {
  cyan: "text-cyan-neon",
  purple: "text-purple-neon",
  green: "text-green-neon",
  orange: "text-orange-neon",
  pink: "text-pink-neon",
}

export function PageHeader({ eyebrow, title, lede, accent = "cyan" }: PageHeaderProps) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mb-12"
    >
      {eyebrow && (
        <div
          className={`text-xs font-mono uppercase tracking-[0.2em] mb-3 ${accentMap[accent]}`}
        >
          {eyebrow}
        </div>
      )}
      <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">{title}</h1>
      {lede && (
        <p className="text-lg text-lab-text/80 leading-relaxed max-w-3xl">{lede}</p>
      )}
    </motion.header>
  )
}
