import type { ReactNode } from "react"
import { motion } from "framer-motion"

interface SectionProps {
  title?: string
  eyebrow?: string
  children: ReactNode
  className?: string
}

export function Section({ title, eyebrow, children, className }: SectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45 }}
      className={`my-14 ${className ?? ""}`}
    >
      {eyebrow && (
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-cyan-neon mb-2">
          {eyebrow}
        </div>
      )}
      {title && <h2 className="text-2xl md:text-3xl font-bold mb-5">{title}</h2>}
      <div className="text-lab-text/85 leading-relaxed space-y-4">{children}</div>
    </motion.section>
  )
}
