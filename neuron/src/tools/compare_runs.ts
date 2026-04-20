import { z } from "zod"
import { getRun } from "../core/db/runs"

export const name = "compare_runs"
export const description = "Compare two training runs side by side — accuracy, per-class metrics, hyperparams."

export const schema = {
  run_id_a: z.number().int().describe("First run ID"),
  run_id_b: z.number().int().describe("Second run ID"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const a = getRun(args.run_id_a)
  const b = getRun(args.run_id_b)
  if (!a) throw new Error(`Run ${args.run_id_a} not found`)
  if (!b) throw new Error(`Run ${args.run_id_b} not found`)

  const allLabels = [
    ...new Set([
      ...Object.keys(a.perClassAccuracy ?? {}),
      ...Object.keys(b.perClassAccuracy ?? {}),
    ]),
  ].sort()

  const perClassDiff: Record<string, { a: number; b: number; delta: number }> = {}
  for (const l of allLabels) {
    const va = a.perClassAccuracy?.[l] ?? 0
    const vb = b.perClassAccuracy?.[l] ?? 0
    perClassDiff[l] = { a: va, b: vb, delta: +(vb - va).toFixed(4) }
  }

  return {
    run_a: { id: a.id, accuracy: a.accuracy, hyperparams: a.hyperparams, status: a.status },
    run_b: { id: b.id, accuracy: b.accuracy, hyperparams: b.hyperparams, status: b.status },
    accuracy_delta: +((b.accuracy ?? 0) - (a.accuracy ?? 0)).toFixed(4),
    per_class_diff: perClassDiff,
    winner: (b.accuracy ?? 0) > (a.accuracy ?? 0) ? args.run_id_b : args.run_id_a,
  }
}
