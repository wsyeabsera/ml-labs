import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { getSamplesByTask, sampleCounts } from "../core/db/samples"
import { getTask } from "../core/db/tasks"
import { requestSampling, SamplingNotSupportedError } from "../core/sampling"

export const name = "preflight_check"
export const description = "Ask Claude to analyze your dataset before training. Checks class balance, sample counts, and feature separability. Uses MCP Sampling."

export const schema = {
  task_id: z.string().describe("Task ID to analyze"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>, ctx: { server: Server }) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const counts = sampleCounts(args.task_id)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (total === 0) {
    return { ok: false, verdict: "no_data", message: "No samples collected yet. Use collect to add samples." }
  }

  const samples = getSamplesByTask(args.task_id)
  const labelNames = Object.keys(counts)
  const K = labelNames.length

  // Compute per-class mean + std for the first few feature dimensions
  const perClassStats: Record<string, { mean: number[]; std: number[]; n: number }> = {}
  for (const label of labelNames) {
    const labelSamples = samples.filter((s) => s.label === label)
    if (!labelSamples.length) continue
    const D = labelSamples[0]!.features.length
    const dims = Math.min(D, 8)
    const mean = new Array<number>(dims).fill(0)
    for (const s of labelSamples) for (let d = 0; d < dims; d++) mean[d]! += (s.features[d] ?? 0)
    for (let d = 0; d < dims; d++) mean[d]! /= labelSamples.length
    const variance = new Array<number>(dims).fill(0)
    for (const s of labelSamples) for (let d = 0; d < dims; d++) variance[d]! += ((s.features[d] ?? 0) - mean[d]!) ** 2
    const std = variance.map((v) => Math.sqrt(v / labelSamples.length))
    perClassStats[label] = { mean: mean.map((v) => +v.toFixed(4)), std: std.map((v) => +v.toFixed(4)), n: labelSamples.length }
  }

  const statsTable = Object.entries(perClassStats)
    .map(([l, s]) => `  ${l} (n=${s.n}): mean[0:8]=[${s.mean.join(",")}] std=[${s.std.join(",")}]`)
    .join("\n")

  const minCount = Math.min(...Object.values(counts))
  const maxCount = Math.max(...Object.values(counts))
  const imbalanceRatio = maxCount / Math.max(minCount, 1)

  const prompt = `You are an ML engineering assistant. Analyze this dataset and give a pre-training assessment.

Task: "${args.task_id}" (${task.kind}, ${K} classes)
Sample counts: ${JSON.stringify(counts)} (total=${total})
Feature shape: [${task.featureShape.join(",")}] (D=${task.featureShape[0] ?? "?"})
Imbalance ratio: ${imbalanceRatio.toFixed(1)}x

Per-class feature statistics (first 8 dims of feature vector):
${statsTable}

Respond as JSON:
{
  "verdict": "ready" | "warning" | "not_ready",
  "issues": ["list of specific issues"],
  "recommendations": ["list of actionable suggestions"],
  "summary": "1-2 sentence human-readable summary"
}`

  let parsed: Record<string, unknown>
  try {
    const result = await requestSampling(ctx.server, {
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 512,
    })
    try { parsed = JSON.parse(result.text) as Record<string, unknown> }
    catch { parsed = { verdict: "warning", summary: result.text, issues: [], recommendations: [] } }
  } catch (e) {
    if (e instanceof SamplingNotSupportedError) {
      // Local heuristic fallback when client doesn't support MCP Sampling
      const issues: string[] = []
      const recommendations: string[] = []
      if (total < 20) { issues.push(`Only ${total} samples — need at least 20 per class`); recommendations.push("Collect more samples") }
      if (imbalanceRatio > 2) { issues.push(`Imbalance ratio ${imbalanceRatio.toFixed(1)}x`); recommendations.push("Balance class counts") }
      const verdict = total < 10 ? "not_ready" : issues.length ? "warning" : "ready"
      parsed = { verdict, issues, recommendations, summary: `${total} samples across ${K} classes. ${issues.length ? issues.join("; ") : "Looks good."}`, sampling_note: "MCP Sampling not available — used local heuristics" }
    } else throw e
  }

  return { ok: true, counts, total, imbalance_ratio: +imbalanceRatio.toFixed(2), ...parsed }
}
