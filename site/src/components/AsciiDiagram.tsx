import { motion } from "framer-motion"

/**
 * Monospace "ASCII-ish" diagram box. Use for branching flows, lifecycles, and
 * anything where a 2D layout matters. Pass the drawing as a single string;
 * whitespace is preserved.
 */
export function AsciiDiagram({
  title,
  children,
  accent = "cyan",
}: {
  title?: string
  children: string
  accent?: "cyan" | "purple" | "green" | "orange" | "pink"
}) {
  const accentText = {
    cyan: "text-cyan-neon",
    purple: "text-purple-neon",
    green: "text-green-neon",
    orange: "text-orange-neon",
    pink: "text-pink-neon",
  }[accent]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      className="my-6 overflow-hidden rounded-xl border border-lab-border bg-lab-bg/60"
    >
      {title && (
        <div className={`px-4 py-2 border-b border-lab-border text-[11px] font-mono uppercase tracking-[0.18em] ${accentText} bg-lab-panel/40`}>
          {title}
        </div>
      )}
      <pre className="p-5 text-xs md:text-sm overflow-x-auto leading-relaxed text-lab-text/90 font-mono">
        {children}
      </pre>
    </motion.div>
  )
}
