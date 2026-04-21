import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { handler as dataAuditHandler } from "./data_audit"
import { handler as suggestHandler } from "./suggest_hyperparams"

export const name = "auto_preflight"
export const description =
  "Full pre-training audit: data_audit + hyperparameter suggestion in one call. " +
  "If the data is not ready, returns the verdict and skips suggestion. Halves the " +
  "typical Claude-agent tool chain at the start of a training session."

export const schema = {
  task_id: z.string().describe("Task ID"),
}

export async function handler(
  args: z.infer<z.ZodObject<typeof schema>>,
  ctx: { server: Server },
) {
  const audit = (await dataAuditHandler({ task_id: args.task_id }, ctx)) as unknown as {
    ok: boolean
    verdict: string
    imbalance_ratio: number | null
    warnings: string[]
  } & Record<string, unknown>

  if (audit.verdict === "not_ready") {
    return {
      ok: false,
      reason: "data not ready — address warnings first",
      audit,
    }
  }

  // Feed the imbalance ratio into suggest_hyperparams for better defaults.
  const suggestion = await suggestHandler(
    {
      task_id: args.task_id,
      ...(audit.imbalance_ratio !== null
        ? { data_health: { imbalance_ratio: audit.imbalance_ratio, warnings: audit.warnings } }
        : {}),
    },
    ctx,
  )

  return {
    ok: true,
    task_id: args.task_id,
    audit,
    suggestion,
    // Hint for the caller on whether to proceed.
    ready_to_train: audit.verdict !== "not_ready",
    next_step: audit.verdict === "warning"
      ? "proceed with caution — see warnings in audit"
      : "safe to invoke auto_train or train with the suggested hyperparams",
  }
}
