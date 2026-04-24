import type { ReactNode } from "react"
import { motion } from "framer-motion"

type Accent = "cyan" | "purple" | "green" | "orange" | "pink"

export interface TableColumn {
  key: string
  header: ReactNode
  accent?: Accent
  mono?: boolean
  width?: string
}

export interface TableRow {
  [key: string]: ReactNode
}

const headerAccent: Record<Accent, string> = {
  cyan: "text-cyan-neon",
  purple: "text-purple-neon",
  green: "text-green-neon",
  orange: "text-orange-neon",
  pink: "text-pink-neon",
}

export function Table({
  columns,
  rows,
  caption,
  compact = false,
}: {
  columns: TableColumn[]
  rows: TableRow[]
  caption?: ReactNode
  compact?: boolean
}) {
  const pad = compact ? "px-3 py-2" : "px-4 py-3"

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
      className="my-6 overflow-hidden rounded-xl border border-lab-border bg-lab-panel/40 backdrop-blur-sm"
    >
      {caption && (
        <div className="px-4 py-2.5 border-b border-lab-border text-xs text-lab-muted font-mono uppercase tracking-wider bg-lab-bg/40">
          {caption}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-lab-border bg-lab-bg/30">
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={`${pad} text-left font-semibold text-xs uppercase tracking-wider ${
                    c.accent ? headerAccent[c.accent] : "text-lab-muted"
                  }`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-lab-border/50 last:border-0 hover:bg-lab-bg/30 transition-colors"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${pad} align-top text-lab-text/85 ${
                      c.mono ? "font-mono text-xs" : ""
                    }`}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
