import { useEffect } from "react"
import { motion } from "framer-motion"
import { X } from "lucide-react"

export interface ToastItem {
  id: string
  message: string
  kind: "success" | "warning" | "info" | "danger"
}

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  success: "border-[var(--success)] bg-[var(--success-dim)] text-[var(--success)]",
  warning: "border-[var(--warning)] bg-[var(--warning-dim)] text-[var(--warning)]",
  info:    "border-[var(--info)]    bg-[var(--info-dim)]    text-[var(--info)]",
  danger:  "border-[var(--danger)]  bg-[var(--danger-dim)]  text-[var(--danger)]",
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ duration: 0.18 }}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm shadow-lg max-w-xs ${KIND_STYLES[item.kind]}`}
    >
      <span className="flex-1 text-[var(--text-1)] text-xs">{item.message}</span>
      <button onClick={onClose} className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity">
        <X size={12} />
      </button>
    </motion.div>
  )
}

export function ToastContainer({ toasts, onClose }: { toasts: ToastItem[]; onClose: (id: string) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  )
}
