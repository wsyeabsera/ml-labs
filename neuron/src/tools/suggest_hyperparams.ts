import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { getTask } from "../core/db/tasks"
import { sampleCounts } from "../core/db/samples"
import { requestSampling, SamplingNotSupportedError } from "../core/sampling"

export const name = "suggest_hyperparams"
export const description = "Ask Claude to recommend hyperparameters (learning rate, epochs, head architecture) for a task. Uses MCP Sampling."

export const schema = {
  task_id: z.string().describe("Task ID"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>, ctx: { server: Server }) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const counts = sampleCounts(args.task_id)
  const N = Object.values(counts).reduce((a, b) => a + b, 0)
  const K = Object.keys(counts).length
  const D = task.featureShape[0] ?? 1

  const prompt = `You are an ML engineering assistant. Recommend hyperparameters for this task.

Task: "${args.task_id}" (${task.kind})
Classes (K): ${K}
Total samples (N): ${N}
Feature dim (D): ${D}
Counts: ${JSON.stringify(counts)}

Backend: rs-tensor MLP trainer. Constraints:
- Optimizer: SGD only (no Adam)
- Activation: tanh
- Loss: MSE
- Full-batch gradient (no mini-batches)
- Typical lr range: 0.001–0.05; typical epochs: 200–2000

Respond as JSON:
{
  "lr": <number>,
  "epochs": <number>,
  "head_arch": [D, ...hidden..., K],
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
  } catch (e) {
    if (e instanceof SamplingNotSupportedError) {
      // Heuristic defaults when Sampling unavailable
      const lr = N < 50 ? 0.05 : N < 200 ? 0.01 : 0.005
      const epochs = N < 50 ? 1000 : N < 200 ? 600 : 400
      parsed = { lr, epochs, head_arch: [D, Math.max(D * 2, 16), K], reasoning: "Heuristic defaults (MCP Sampling not available)", sampling_note: "MCP Sampling not available — used local heuristics" }
    } else throw e
  }

  const defaults = { lr: 0.005, epochs: 500, head_arch: [D, Math.max(D, 32), K] }
  return { ok: true, n: N, k: K, d: D, ...defaults, ...parsed }
}
