import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { getSamplesByTask } from "../core/db/samples"
import { listRecentPredictions } from "../core/db/predictions"
import { driftReportFromArrays } from "../core/drift"
import { recordEvent, listEvents } from "../core/db/events"

export const name = "drift_check"
export const description =
  "Compare a task's training-data distribution to recent served predictions. " +
  "Returns per-feature PSI + KS p-value + verdict (stable | drifting | severe | insufficient_data). " +
  "Use after deploying a model to watch for distribution shift."

export const schema = {
  task_id: z.string().describe("Task ID"),
  current_window: z
    .number()
    .int()
    .min(30)
    .max(10000)
    .default(1000)
    .describe("How many recent predictions to compare against training data (default 1000)."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const trainSamples = getSamplesByTask(args.task_id)
  const reference = trainSamples.map((s) => s.features)

  const recent = listRecentPredictions(args.task_id, args.current_window)
  const current = recent.map((r) => r.features)

  const report = driftReportFromArrays(
    reference,
    current,
    task.featureNames ?? undefined,
    args.task_id,
  )

  // Emit drift_detected only when there's meaningful drift (not stable or insufficient).
  // Dedupe: skip if the same task saw the same verdict within the last 5 minutes —
  // avoids event-bus spam when a caller runs drift_check in a tight loop.
  if (report.overall_verdict === "drifting" || report.overall_verdict === "severe") {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    const recentSame = listEvents({ taskId: args.task_id, since: fiveMinAgo, limit: 10 })
      .find((e) => e.kind === "drift_detected" &&
        (e.payload as { verdict?: string } | null)?.verdict === report.overall_verdict)
    if (!recentSame) {
      recordEvent({
        source: "mcp",
        kind: "drift_detected",
        taskId: args.task_id,
        payload: {
          verdict: report.overall_verdict,
          drifting_features: report.verdict_summary.drifting + report.verdict_summary.severe,
          total_features: report.features.length,
        },
      })
    }
  }

  return report
}
