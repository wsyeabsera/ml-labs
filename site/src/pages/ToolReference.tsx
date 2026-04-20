import { useMemo, useState } from "react"
import { PageHeader } from "../components/PageHeader"
import { ToolCard } from "../components/ToolCard"
import { tools } from "../data/tools"
import { Search } from "lucide-react"
import { motion } from "framer-motion"

const categories = ["All", "Task", "Data", "Training", "Auto", "Inspection", "Model", "Inference"]

export function ToolReference() {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("All")

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return tools.filter((t) => {
      if (cat !== "All" && t.category !== cat) return false
      if (!query) return true
      return (
        t.name.toLowerCase().includes(query) ||
        t.desc.toLowerCase().includes(query) ||
        t.signature.toLowerCase().includes(query)
      )
    })
  }, [q, cat])

  return (
    <div>
      <PageHeader
        eyebrow={`${tools.length} tools, one protocol`}
        accent="purple"
        title={<>The full <span className="gradient-text">MCP surface</span>.</>}
        lede="Everything Claude can call on the Neuron server. Filter by category or search inline. Signatures are copy-paste-friendly."
      />

      <div className="lab-panel p-4 mb-6 sticky top-4 z-10 backdrop-blur-md">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-lab-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tool name, description, or argument…"
              className="w-full pl-10 pr-4 py-2.5 bg-lab-bg border border-lab-border rounded-lg text-sm text-lab-heading placeholder:text-lab-muted focus:outline-none focus:border-cyan-neon/60 focus:ring-1 focus:ring-cyan-neon/30"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  cat === c
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/40"
                    : "border border-lab-border text-lab-text/70 hover:text-lab-heading hover:border-lab-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-lab-muted mt-3">
          Showing <span className="text-lab-heading font-semibold">{filtered.length}</span> of{" "}
          {tools.length}
        </div>
      </div>

      <motion.div layout className="grid md:grid-cols-2 gap-4">
        {filtered.map((t, i) => (
          <ToolCard key={t.name} tool={t} index={i} />
        ))}
      </motion.div>

      {filtered.length === 0 && (
        <div className="lab-panel p-8 text-center text-lab-muted text-sm">
          Nothing matches. Try a different search.
        </div>
      )}
    </div>
  )
}
