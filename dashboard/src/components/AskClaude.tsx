import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, X, Send, Loader2 } from "lucide-react"
import { useLocation, useParams } from "react-router-dom"
import { api } from "../lib/api"
import { useFeed } from "./ActivityFeed"
import { clsx } from "clsx"

function useRouteContext() {
  const location = useLocation()
  const params = useParams<{ id?: string; runId?: string }>()
  return {
    route: location.pathname,
    taskId: params.id,
    runId: params.runId ? parseInt(params.runId) : undefined,
  }
}

interface PendingRequest {
  id: number
  prompt: string
  answer?: string
}

export function AskClaude() {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<PendingRequest[]>([])
  const ctx = useRouteContext()
  const { events } = useFeed()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Listen for response events and match them to pending requests
  useEffect(() => {
    const lastEvent = events[events.length - 1]
    if (!lastEvent || lastEvent.kind !== "response") return
    const p = lastEvent.payload as { requestId?: number; answer?: string }
    if (p.requestId != null && p.answer) {
      setPending((prev) =>
        prev.map((r) => r.id === p.requestId ? { ...r, answer: p.answer } : r)
      )
    }
  }, [events])

  async function handleSubmit() {
    if (!prompt.trim() || submitting) return
    setSubmitting(true)
    try {
      const { id } = await api.askClaude(prompt.trim(), ctx)
      setPending((prev) => [...prev, { id, prompt: prompt.trim() }])
      setPrompt("")
      setOpen(false)
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open])

  const unanswered = pending.filter((r) => !r.answer)
  const answered = pending.filter((r) => r.answer)

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className={clsx(
          "fixed bottom-4 left-[236px] z-40 flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium shadow-lg transition-all",
          "bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[var(--accent-text)]",
          "hover:bg-[var(--accent)] hover:text-white",
          unanswered.length > 0 && "pr-4"
        )}
      >
        <MessageSquare size={13} />
        Ask Claude
        {unanswered.length > 0 && (
          <span className="ml-1 w-4 h-4 rounded-full bg-[var(--warning)] text-[var(--bg-base)] text-2xs flex items-center justify-center font-bold">
            {unanswered.length}
          </span>
        )}
      </button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-start"
            style={{ paddingLeft: "236px", paddingBottom: "64px" }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="card-elevated w-[400px] p-4 shadow-xl border border-[var(--border)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-[var(--accent-text)]" />
                  <span className="text-sm font-medium text-[var(--text-1)]">Ask Claude</span>
                </div>
                <button onClick={() => setOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors">
                  <X size={14} />
                </button>
              </div>

              {/* Context chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="badge badge-surface">{ctx.route}</span>
                {ctx.taskId && <span className="badge badge-violet">{ctx.taskId}</span>}
                {ctx.runId && <span className="badge badge-surface">run #{ctx.runId}</span>}
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit() }}
                placeholder="What do you want to ask? (⌘↵ to send)"
                rows={3}
                className="w-full bg-[var(--surface-1)] border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] resize-none outline-none focus:border-[var(--accent-border)] transition-colors mb-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-2xs text-[var(--text-3)]">{prompt.length}/500</span>
                <button
                  onClick={handleSubmit}
                  disabled={!prompt.trim() || submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent-dim)] text-[var(--accent-text)] border border-[var(--accent-border)] text-xs font-medium hover:bg-[var(--accent)] hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Send
                </button>
              </div>

              {/* Answered requests */}
              {answered.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="section-label">Responses</p>
                  {answered.slice(-3).map((r) => (
                    <div key={r.id} className="bg-[var(--surface-1)] rounded-md p-2.5 border border-[var(--border)]">
                      <p className="text-2xs text-[var(--text-3)] mb-1 truncate">{r.prompt}</p>
                      <p className="text-xs text-[var(--text-1)] whitespace-pre-wrap">{r.answer}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending (unanswered) */}
              {unanswered.length > 0 && (
                <div className="mt-3">
                  <p className="section-label mb-1.5">Waiting on Claude ({unanswered.length})</p>
                  {unanswered.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs text-[var(--text-2)] bg-[var(--surface-1)] rounded px-2.5 py-1.5 mb-1 border border-[var(--border)]">
                      <Loader2 size={10} className="animate-spin flex-shrink-0 text-[var(--accent-text)]" />
                      <span className="truncate">{r.prompt}</span>
                    </div>
                  ))}
                  <p className="text-2xs text-[var(--text-3)] mt-1.5">Run <span className="font-mono">/neuron-ask</span> in your terminal to answer</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
