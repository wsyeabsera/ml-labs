import { useQuery } from "@tanstack/react-query"
import { Settings2, CheckCircle2, Circle } from "lucide-react"
import { clsx } from "clsx"
import { api, type ApiConfig } from "../lib/api"

function FnBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={clsx("badge", active ? "badge-green" : "badge-surface")}>
      {active ? <CheckCircle2 size={10} /> : <Circle size={10} />}
      {label}
    </span>
  )
}

function ConfigDetails({ cfg }: { cfg: ApiConfig }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Task id */}
      {cfg.taskId && (
        <span className="text-xs text-[var(--text-2)]">
          task: <span className="font-mono text-[var(--text-1)]">{cfg.taskId}</span>
        </span>
      )}

      {/* Feature shape */}
      {cfg.featureShape && (
        <span className="text-xs text-[var(--text-2)]">
          shape: <span className="font-mono text-[var(--text-1)]">[{cfg.featureShape.join(",")}]</span>
        </span>
      )}

      {/* Default hyperparams */}
      <span className="text-xs text-[var(--text-2)]">
        lr: <span className="font-mono text-[var(--text-1)]">{cfg.defaultHyperparams.lr}</span>
      </span>
      <span className="text-xs text-[var(--text-2)]">
        epochs: <span className="font-mono text-[var(--text-1)]">{cfg.defaultHyperparams.epochs}</span>
      </span>

      {/* Extension badges */}
      <div className="flex items-center gap-1.5">
        <FnBadge label="featurize" active={cfg.hasFeaturize} />
        <FnBadge label="headArch" active={cfg.hasHeadArchitecture} />
        <FnBadge label="decodeImg" active={cfg.hasDecodeImage} />
      </div>
    </div>
  )
}

export function ConfigCard() {
  const { data } = useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    staleTime: 5000,
    retry: false,
  })

  if (!data || !data.taskId) return null

  return (
    <div className="card p-3 mb-6 flex items-start gap-3">
      <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface-3)] flex-shrink-0 mt-0.5">
        <Settings2 size={13} className="text-[var(--text-2)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--text-2)] mb-1.5">
          neuron.config.ts
        </p>
        <ConfigDetails cfg={data} />
      </div>
    </div>
  )
}
