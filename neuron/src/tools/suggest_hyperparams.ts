import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { getTask } from "../core/db/tasks"
import { sampleCounts } from "../core/db/samples"
import { requestSampling, SamplingNotSupportedError } from "../core/sampling"
import { loadConfig } from "../adapter/loader"

export const name = "suggest_hyperparams"
export const description = "Ask Claude to recommend hyperparameters (learning rate, epochs, head architecture) for a task. Uses MCP Sampling."

export const schema = {
  task_id: z.string().describe("Task ID"),
  data_health: z
    .object({
      imbalance_ratio: z.number().optional().describe("max_class_count / min_class_count — if > 3, suggestion should flag class_weights=balanced"),
      warnings: z.array(z.string()).optional().describe("Pre-computed data-health warnings (e.g. constant features, scale issues)"),
    })
    .optional()
    .describe("Optional data-health signals from inspect_data. Improves suggestion quality when provided."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>, ctx: { server: Server }) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const counts = sampleCounts(args.task_id)
  const N = Object.values(counts).reduce((a, b) => a + b, 0)
  const K = Object.keys(counts).length
  const D = task.featureShape[0] ?? 1

  const config = await loadConfig()
  const configArch: number[] | null = config?.headArchitecture ? config.headArchitecture(K, D) : null

  const imbalance = args.data_health?.imbalance_ratio
  const healthWarnings = args.data_health?.warnings ?? []
  const isImbalanced = imbalance != null && imbalance > 3
  const dataHealthSection = args.data_health
    ? `Data health:
- imbalance_ratio: ${imbalance ?? "n/a"}${isImbalanced ? " (SEVERE — recommend class_weights=\"balanced\")" : ""}
- warnings: ${healthWarnings.length ? healthWarnings.join("; ") : "none"}
`
    : ""

  const prompt = `You are an ML engineering assistant. Recommend hyperparameters for this task.

Task: "${args.task_id}" (${task.kind})
Classes (K): ${K}
Total samples (N): ${N}
Feature dim (D): ${D}
Counts: ${JSON.stringify(counts)}
${dataHealthSection}${configArch ? `neuron.config.ts headArchitecture: [${configArch.join(", ")}] — use this exact architecture.` : ""}

Backend: rs-tensor MLP trainer. Constraints:
- Optimizer: SGD only (no Adam)
- Activation: tanh
- Loss: MSE
- Full-batch gradient (no mini-batches)
- Typical lr range: 0.001–0.05; typical epochs: 200–2000
- Supported class-weight modes: "balanced" (oversamples minority classes). Use when imbalance_ratio > 3.

Respond as JSON:
{
  "lr": <number>,
  "epochs": <number>,
  "head_arch": ${configArch ? JSON.stringify(configArch) : "[D, ...hidden..., K]"},
  "class_weights": <"balanced" | null — set to "balanced" if imbalance_ratio > 3 else null>,
  "reasoning": "brief explanation"
}`

  let parsed: Record<string, unknown>
  try {
    const result = await requestSampling(ctx.server, {
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 256,
    })
    try { parsed = JSON.parse(result.text) as Record<string, unknown> }
    catch { parsed = { reasoning: result.text } }
    if (configArch) parsed.head_arch = configArch
  } catch (e) {
    if (e instanceof SamplingNotSupportedError) {
      const lr = N < 50 ? 0.05 : N < 200 ? 0.01 : 0.005
      const epochs = N < 50 ? 1000 : N < 200 ? 600 : 400
      const head_arch = configArch ?? [D, Math.max(D * 2, 16), K]
      const class_weights = isImbalanced ? "balanced" : null
      parsed = {
        lr, epochs, head_arch, class_weights,
        reasoning: `Heuristic defaults (MCP Sampling not available)${isImbalanced ? ` — flagged class_weights=balanced for imbalance_ratio=${imbalance}` : ""}`,
        sampling_note: "MCP Sampling not available — used local heuristics",
      }
    } else throw e
  }

  const defaults = {
    lr: 0.005,
    epochs: 500,
    head_arch: configArch ?? [D, Math.max(D, 32), K],
    class_weights: isImbalanced ? "balanced" : null,
  }
  return { ok: true, n: N, k: K, d: D, ...defaults, ...parsed }
}
