import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask, type Task } from "../core/db/tasks"
import type { Run } from "../core/db/runs"
import { rsTensor } from "../core/mcp_client"
import { softmax, argmax, applyNorm } from "../core/metrics"
import { loadConfig } from "../adapter/loader"
import { logPrediction } from "../core/db/predictions"

let predCounter = 0

export interface PredictOutput {
  label?: string
  confidence?: number
  scores?: Record<string, number>
  value?: number
  raw_output?: number
  calibrated?: boolean
}

/**
 * Run inference using a specific run's weights. Used by both the primary predict
 * path (via the tool handler below) and the shadow-serving path (Phase 8.5).
 * Assumes `features` is already in raw (pre-norm) shape.
 */
export async function runInference(run: Run, task: Task, features: number[]): Promise<PredictOutput> {
  const isRegression = task.kind === "regression"
  let feats = features
  if (run.normStats) feats = applyNorm(feats, run.normStats.mean, run.normStats.std)

  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  if (!isRegression && !labels.length) throw new Error("No labels found — check task and run data")

  const K = isRegression ? 1 : labels.length
  const inputName = `neuron_pred_${predCounter++ % 10}`
  await rsTensor.createTensor(inputName, feats, [1, feats.length])
  const mlpName = `neuron_run_${run.id}_mlp`

  let evalResult: { predictions?: { data: number[]; shape: number[] }; accuracy?: number }
  try {
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  } catch {
    if (!run.weights) {
      throw new Error(
        `Model for run ${run.id} is not in memory and has no stored weights. Retrain to enable predict.`,
      )
    }
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  }

  if (isRegression) {
    const scale = run.weights?.["__regression_scale__"]?.data
    const targetMin = scale?.[0] ?? 0
    const targetRange = scale?.[1] ?? 1
    const rawOutput = evalResult.predictions?.data?.[0] ?? 0
    const value = rawOutput * targetRange + targetMin
    return { value, raw_output: rawOutput }
  }

  const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
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

export const name = "predict"
export const description = "Run inference on a single sample using the task's registered model."

export const schema = {
  task_id: z.string().describe("Task ID"),
  features: z.array(z.number()).optional().describe("Pre-computed feature vector"),
  raw: z.unknown().optional().describe("Raw input (server featurizes via neuron.config.ts)"),
}

export const outputSchema = {
  label: z.string().optional().describe("Predicted class (classification)"),
  confidence: z.number().optional().describe("Max-softmax probability for the predicted class"),
  scores: z.record(z.string(), z.number()).optional().describe("Per-class probabilities"),
  value: z.number().optional().describe("Predicted numeric value (regression)"),
  raw_output: z.number().optional().describe("Unscaled regression output before min-max reverse"),
  calibrated: z.boolean().optional().describe("True when a temperature was applied to logits"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>): Promise<PredictOutput> {
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

  const t0 = Date.now()
  const output = await runInference(model.run, task, features)

  // Log for drift detection. Sampled via NEURON_PREDICTION_SAMPLE_RATE env var
  // (default 1.0 — log everything). Single predicts were previously only logged
  // from the registry-serving endpoints, so drift_check saw an empty table on
  // locally-driven mcp__neuron__predict traffic (v1.6.1 bug fix).
  logPrediction({
    taskId: args.task_id,
    runId: model.run.id,
    modelUri: `neuron://local/run/${model.run.id}`,
    features,
    output,
    latencyMs: Date.now() - t0,
  })

  return output
}
