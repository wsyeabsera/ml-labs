import type { LucideIcon } from "lucide-react"

interface Props {
  icon: LucideIcon
  title: string
  desc?: string
}

export function Empty({ icon: Icon, title, desc }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--surface-3)] mb-3">
        <Icon size={18} className="text-[var(--text-3)]" />
      </div>
      <p className="text-sm font-medium text-[var(--text-2)]">{title}</p>
      {desc && <p className="text-xs text-[var(--text-3)] mt-1 max-w-xs">{desc}</p>}
    </div>
  )
}
