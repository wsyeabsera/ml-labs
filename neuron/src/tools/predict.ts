import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"
import { rsTensor } from "../core/mcp_client"
import { softmax, argmax, applyNorm } from "../core/metrics"
import { loadConfig } from "../adapter/loader"

let predCounter = 0

export const name = "predict"
export const description = "Run inference on a single sample using the task's registered model."

export const schema = {
  task_id: z.string().describe("Task ID"),
  features: z.array(z.number()).optional().describe("Pre-computed feature vector"),
  raw: z.unknown().optional().describe("Raw input (server featurizes via neuron.config.ts)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}". Train first.`)
  }

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  let features = args.features
  if (!features) {
    if (!args.raw) throw new Error("Provide features or raw input")
    const config = await loadConfig()
    if (!config?.featurize) throw new Error("No featurize in neuron.config.ts")
    features = await config.featurize(args.raw)
  }

  const run = model.run
  const isRegression = task.kind === "regression"

  // Apply normalization if the run was trained with it
  if (run.normStats) {
    features = applyNorm(features, run.normStats.mean, run.normStats.std)
  }

  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  if (!isRegression && !labels.length) throw new Error("No labels found — check task and run data")

  const K = isRegression ? 1 : labels.length
  const D = features.length
  const inputName = `neuron_pred_${predCounter++ % 10}`

  await rsTensor.createTensor(inputName, features, [1, D])
  const mlpName = `neuron_run_${run.id}_mlp`

  let evalResult: { predictions?: { data: number[]; shape: number[] }; accuracy?: number }
  try {
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  } catch {
    if (!run.weights) {
      throw new Error(
        `Model for task "${args.task_id}" is not in memory and has no stored weights. Retrain to enable predict.`,
      )
    }
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  }

  if (isRegression) {
    // Reverse the min-max scale stored in the weights metadata
    const scale = run.weights?.["__regression_scale__"]?.data
    const targetMin = scale?.[0] ?? 0
    const targetRange = scale?.[1] ?? 1
    const rawOutput = evalResult.predictions?.data?.[0] ?? 0
    const value = rawOutput * targetRange + targetMin
    return { value, raw_output: rawOutput }
  }

  const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
  // Apply temperature scaling if the run has been calibrated (Phase 4).
  const T = run.calibrationTemperature ?? null
  const scaled = T !== null && T > 0 ? rawScores.map((v) => v / T) : rawScores
  const probs = softmax(scaled)
  const idx = argmax(probs)
  const label = labels[idx] ?? labels[0] ?? "unknown"
  const confidence = probs[idx] ?? 0

  const scores: Record<string, number> = {}
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]
    if (l) scores[l] = probs[i] ?? 0
  }

  return { label, confidence, scores, calibrated: T !== null }
}
