import type { ReactNode } from "react"
import { Info, AlertTriangle, Lightbulb, CheckCircle2, BookOpen } from "lucide-react"
import { motion } from "framer-motion"

type Kind = "note" | "warn" | "tip" | "success" | "learn"

const kindConfig: Record<Kind, { icon: typeof Info; border: string; bg: string; text: string; label: string }> = {
  note:    { icon: Info,           border: "border-cyan-neon/40",   bg: "bg-cyan-neon/5",   text: "text-cyan-neon",   label: "Note" },
  warn:    { icon: AlertTriangle,  border: "border-orange-neon/40", bg: "bg-orange-neon/5", text: "text-orange-neon", label: "Heads up" },
  tip:     { icon: Lightbulb,      border: "border-purple-neon/40", bg: "bg-purple-neon/5", text: "text-purple-neon", label: "Tip" },
  success: { icon: CheckCircle2,   border: "border-green-neon/40",  bg: "bg-green-neon/5",  text: "text-green-neon",  label: "Works" },
  learn:   { icon: BookOpen,       border: "border-pink-neon/40",   bg: "bg-pink-neon/5",   text: "text-pink-neon",   label: "For newcomers" },
}

export function Callout({
  kind = "note",
  title,
  children,
}: {
  kind?: Kind
  title?: string
  children: ReactNode
}) {
  const c = kindConfig[kind]
  const Icon = c.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3 }}
      className={`my-5 flex gap-3 p-4 rounded-xl border ${c.border} ${c.bg}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${c.text}`} />
      <div className="min-w-0 flex-1">
        <div className={`text-[11px] font-mono uppercase tracking-[0.18em] mb-1 ${c.text}`}>
          {title ?? c.label}
        </div>
        <div className="text-sm text-lab-text/85 leading-relaxed">{children}</div>
      </div>
    </motion.div>
  )
}
