import { db } from "../db/schema"
import type { SweepConfig } from "../sweep/configs"

export type VerdictStatus =
  | "completed"
  | "data_issue"
  | "budget_exceeded"
  | "no_improvement"
  | "failed"

export interface StructuredVerdict {
  status: VerdictStatus
  winner: {
    run_id: number | null
    metric_value: number | null
    metric_name: "accuracy" | "r2"
    is_overfit: boolean
    confidence: "high" | "low"
    config: SweepConfig | null
  }
  attempted: {
    configs_tried: number
    waves_used: number
    wall_clock_s: number
  }
  data_issues: string[]
  next_steps: string[]
  summary: string
}

export function saveVerdictJson(autoRunId: number, v: StructuredVerdict): void {
  db.exec(`UPDATE auto_runs SET verdict_json = ? WHERE id = ?`, [JSON.stringify(v), autoRunId])
}

export function verdictSummaryOneLiner(v: StructuredVerdict): string {
  if (v.status === "completed" && v.winner.run_id != null) {
    const overfit = v.winner.is_overfit ? " (overfit penalty applied)" : ""
    return `${v.winner.metric_name}=${v.winner.metric_value?.toFixed(3) ?? "n/a"} on run ${v.winner.run_id}${overfit}; ${v.attempted.configs_tried} configs tried in ${v.attempted.waves_used} waves`
  }
  if (v.status === "data_issue") return v.summary
  if (v.status === "budget_exceeded") return `budget exceeded after ${v.attempted.configs_tried} configs in ${v.attempted.waves_used} waves`
  if (v.status === "no_improvement") return `no improvement after ${v.attempted.waves_used} waves — ${v.next_steps[0] ?? "inspect data"}`
  return v.summary
}
