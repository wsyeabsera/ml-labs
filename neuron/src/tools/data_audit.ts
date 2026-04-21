import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { handler as inspectHandler } from "./inspect_data"
import { handler as preflightHandler } from "./preflight_check"

export const name = "data_audit"
export const description =
  "One-call data health audit: inspect_data + preflight_check + combined summary. " +
  "Replaces the typical chain of 2-3 tool calls Claude makes at the start of a session."

export const schema = {
  task_id: z.string().describe("Task ID"),
}

export async function handler(
  args: z.infer<z.ZodObject<typeof schema>>,
  ctx: { server: Server },
) {
  const [inspect, preflight] = await Promise.all([
    inspectHandler({ task_id: args.task_id }),
    preflightHandler({ task_id: args.task_id }, ctx),
  ])

  // Roll up the two results into a single structured audit.
  const inspectObj = inspect as Record<string, unknown>
  const preflightObj = preflight as Record<string, unknown>

  const warnings: string[] = []
  if (Array.isArray(inspectObj.warnings)) warnings.push(...(inspectObj.warnings as string[]))
  if (Array.isArray(preflightObj.issues)) warnings.push(...(preflightObj.issues as string[]))

  return {
    ok: true,
    task_id: args.task_id,
    verdict: preflightObj.verdict ?? "unknown",
    summary: preflightObj.summary ?? null,
    total: inspectObj.total ?? 0,
    splits: inspectObj.splits ?? null,
    class_distribution: inspectObj.class_distribution ?? null,
    imbalance_ratio: inspectObj.imbalance_ratio ?? null,
    features: inspectObj.features ?? null,
    normalize_enabled: inspectObj.normalize_enabled ?? null,
    warnings,
    // For consumers that want the raw underlying responses:
    _inspect: inspect,
    _preflight: preflight,
  }
}
