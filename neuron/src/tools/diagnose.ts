import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { getRun } from "../core/db/runs"
import { getTask } from "../core/db/tasks"
import { requestSampling, SamplingNotSupportedError } from "../core/sampling"

export const name = "diagnose"
export const description = "Ask Claude to diagnose a completed training run and suggest fixes. Uses MCP Sampling."

export const schema = {
  run_id: z.number().int().describe("Run ID to diagnose"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>, ctx: { server: Server }) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)
  if (run.status !== "completed") throw new Error(`Run ${args.run_id} is ${run.status} — can only diagnose completed runs`)

  const task = getTask(run.taskId)
  const K = Object.keys(run.sampleCounts ?? {}).length
  const labelNames = Object.keys(run.sampleCounts ?? {})

  const confusionRows = run.confusionMatrix?.map((row, i) =>
    `  ${labelNames[i] ?? i}: [${row.join(", ")}]`
  ).join("\n") ?? "unavailable"

  const perClassStr = run.perClassAccuracy
    ? labelNames.map((l) => `  ${l}: ${((run.perClassAccuracy![l] ?? 0) * 100).toFixed(1)}%`).join("\n")
    : "unavailable"

  const lossStr = run.lossHistory?.length
    ? `first=${run.lossHistory[0]?.toFixed(4)}, last=${run.lossHistory.at(-1)?.toFixed(4)}, points=${run.lossHistory.length}`
    : "unavailable"

  const prompt = `You are an ML engineering assistant. Diagnose this training run and suggest concrete improvements.

Task: "${run.taskId}" (${task?.kind ?? "classification"}, K=${K} classes)
Overall accuracy: ${run.accuracy !== null ? (run.accuracy * 100).toFixed(1) + "%" : "?"}
Loss curve: ${lossStr}

Per-class accuracy:
${perClassStr}

Confusion matrix (rows=true, cols=predicted):
${confusionRows}

Sample counts per class: ${JSON.stringify(run.sampleCounts)}
Hyperparams used: ${JSON.stringify(run.hyperparams)}

Diagnose what is wrong and give actionable recommendations. Be specific about which classes are confused and why.

Respond as JSON:
{
  "severity": "critical" | "moderate" | "minor",
  "root_causes": ["list of identified issues"],
  "class_issues": {"label": "issue description"},
  "recommendations": ["prioritized list of things to try"],
  "summary": "1-2 sentence summary"
}`

  let parsed: Record<string, unknown>
  try {
    const result = await requestSampling(ctx.server, {
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 768,
    })
    try { parsed = JSON.parse(result.text) as Record<string, unknown> }
    catch { parsed = { summary: result.text, root_causes: [], recommendations: [] } }
  } catch (e) {
    if (e instanceof SamplingNotSupportedError) {
      const acc = run.accuracy ?? 0
      const lowClasses = Object.entries(run.perClassAccuracy ?? {}).filter(([, v]) => v < 0.7).map(([k]) => k)
      const severity = acc < 0.5 ? "critical" : acc < 0.8 ? "moderate" : "minor"
      parsed = {
        severity,
        root_causes: acc < 0.6 ? ["Low overall accuracy — model may be underfitting"] : lowClasses.length ? [`Weak classes: ${lowClasses.join(", ")}`] : ["Training accuracy is reasonable"],
        class_issues: Object.fromEntries(lowClasses.map((l) => [l, `Below 70% accuracy`])),
        recommendations: ["Try more epochs", "Increase hidden layer size", "Add more training samples", "Lower learning rate"],
        summary: `Overall accuracy ${(acc * 100).toFixed(1)}%. ${lowClasses.length ? `Weak classes: ${lowClasses.join(", ")}.` : "All classes reasonable."}`,
        sampling_note: "MCP Sampling not available — used local heuristics",
      }
    } else throw e
  }

  return {
    ok: true,
    run_id: args.run_id,
    accuracy: run.accuracy,
    ...parsed,
  }
}
