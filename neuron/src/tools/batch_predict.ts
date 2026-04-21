import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"
import { rsTensor } from "../core/mcp_client"
import { softmax, argmax, applyNorm } from "../core/metrics"
import { loadCsv } from "../core/loaders/csv"
import { loadConfig } from "../adapter/loader"
import { existsSync } from "node:fs"

export const name = "batch_predict"
export const description = "Run inference on every row of a CSV file. Returns per-row predictions and confidence. Use this for holdout evaluation, leaderboard scoring, or bulk inference."

export const schema = {
  task_id: z.string().describe("Task ID"),
  path: z.string().describe("Path to CSV file containing feature columns"),
  feature_columns: z.array(z.string()).optional().describe("Feature column names. Omit to use all columns."),
  label_column: z.string().optional().describe("If the CSV has ground-truth labels, include for accuracy computation."),
  has_header: z.boolean().default(true).describe("Whether the CSV has a header row"),
}

export const outputSchema = {
  ok: z.boolean(),
  total: z.number().describe("Number of rows processed"),
  errors: z.array(z.string()),
  predictions: z.array(z.record(z.string(), z.unknown())),
  accuracy: z.number().optional().describe("Overall accuracy if ground-truth labels were provided"),
  correct: z.number().optional(),
  calibrated: z.boolean().optional(),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}". Train first.`)
  }

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  if (!existsSync(args.path)) throw new Error(`File not found: ${args.path}`)

  const isRegression = task.kind === "regression"
  const run = model.run

  // Load CSV — use label_column as label if provided, otherwise use first column as dummy
  const labelCol = args.label_column ?? "__none__"
  const { rows, errors } = loadCsv({
    path: args.path,
    featureColumns: args.feature_columns ?? "all",
    labelColumn: labelCol,
    hasHeader: args.has_header,
    expectedDim: undefined,
  })

  if (rows.length === 0) {
    return { ok: true, predictions: [], errors: errors.slice(0, 20) }
  }

  const config = await loadConfig()
  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  const K = isRegression ? 1 : labels.length
  const mlpName = `neuron_run_${run.id}_mlp`

  // Ensure model is in memory
  try {
    const probe = rows[0]!.features
    const probeName = "neuron_batch_probe"
    await rsTensor.createTensor(probeName, probe, [1, probe.length])
    await rsTensor.evaluateMlp(mlpName, probeName)
  } catch {
    if (!run.weights) throw new Error("Model weights not found. Retrain to enable batch predict.")
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
  }

  const predictions: unknown[] = []
  let correct = 0
  const hasGroundTruth = !!args.label_column

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    let features = row.features

    // Apply custom featurizer if configured
    if (config?.featurize && features.length === 0) {
      features = await config.featurize(row)
    }

    // Apply normalization
    if (run.normStats) features = applyNorm(features, run.normStats.mean, run.normStats.std)

    const inputName = `neuron_batch_${i % 50}`
    await rsTensor.createTensor(inputName, features, [1, features.length])
    const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)

    if (isRegression) {
      const scale = run.weights?.["__regression_scale__"]?.data
      const targetMin = scale?.[0] ?? 0
      const targetRange = scale?.[1] ?? 1
      const rawOutput = evalResult.predictions?.data?.[0] ?? 0
      const value = rawOutput * targetRange + targetMin
      const entry: Record<string, unknown> = { row: i + 1, value: +value.toFixed(6) }
      if (hasGroundTruth) {
        const truth = parseFloat(row.label) || 0
        entry.truth = truth
        entry.error = +(value - truth).toFixed(6)
      }
      predictions.push(entry)
    } else {
      const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
      const T = run.calibrationTemperature ?? null
      const scaled = T !== null && T > 0 ? rawScores.map((v) => v / T) : rawScores
      const probs = softmax(scaled)
      const predIdx = argmax(probs)
      const label = labels[predIdx] ?? "unknown"
      const confidence = +(probs[predIdx] ?? 0).toFixed(4)
      const entry: Record<string, unknown> = { row: i + 1, label, confidence }
      if (hasGroundTruth) {
        entry.truth = row.label
        entry.correct = label === row.label
        if (label === row.label) correct++
      }
      // Include top-3 scores
      const scored = labels.map((l, idx) => ({ label: l, prob: +(probs[idx] ?? 0).toFixed(4) }))
        .sort((a, b) => b.prob - a.prob).slice(0, 3)
      entry.scores = scored
      predictions.push(entry)
    }
  }

  const result: Record<string, unknown> = {
    ok: true,
    total: rows.length,
    errors: errors.slice(0, 20),
    predictions,
    calibrated: run.calibrationTemperature != null,
  }

  if (hasGroundTruth && !isRegression && rows.length > 0) {
    result.accuracy = +(correct / rows.length).toFixed(4)
    result.correct = correct
  }

  return result
}
