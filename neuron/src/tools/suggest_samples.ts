import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"
import { getSamplesByTask } from "../core/db/samples"
import { rsTensor } from "../core/mcp_client"
import { softmax, argmax } from "../core/metrics"

export const name = "suggest_samples"
export const description =
  "Active learning helper: batch-evaluates all existing samples, identifies which classes " +
  "need more data and which samples are uncertain or misclassified. Use after training to " +
  "guide data collection before the next training round."

export const schema = {
  task_id: z.string().describe("Task ID to analyze"),
  n_suggestions: z
    .number()
    .int()
    .positive()
    .default(5)
    .describe("Number of uncertain/misclassified samples to surface (default: 5)"),
  confidence_threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe("Samples below this confidence are flagged as uncertain (default: 0.7)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}". Train first.`)
  }

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const samples = getSamplesByTask(args.task_id)
  if (samples.length === 0) {
    return {
      ok: true,
      task_id: args.task_id,
      n_samples: 0,
      overall_accuracy: null,
      per_class: [],
      uncertain_samples: [],
      recommendations: ["No samples found — load data first via load_csv, load_json, or collect."],
    }
  }

  const run = model.run
  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  if (!labels.length) throw new Error("No labels found on task")

  const K = labels.length
  const D = task.featureShape[0] ?? samples[0]!.features.length
  const N = samples.length

  // Build [N, D] input tensor
  const flatFeatures = samples.flatMap((s) => s.features)
  const inputName = "neuron_suggest_input"
  await rsTensor.createTensor(inputName, flatFeatures, [N, D])

  const mlpName = `neuron_run_${run.id}_mlp`
  let evalResult: { predictions?: { data: number[]; shape: number[] }; accuracy?: number }
  try {
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  } catch {
    if (!run.weights) throw new Error("MLP not in memory and no stored weights — retrain first")
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  }

  const rawPreds = evalResult.predictions?.data ?? []

  // Parse per-sample predictions
  type SampleResult = {
    sample_id: number
    true_label: string
    predicted_label: string
    confidence: number
    correct: boolean
    features: number[]
  }

  const sampleResults: SampleResult[] = []
  for (let i = 0; i < N; i++) {
    const logits = rawPreds.slice(i * K, (i + 1) * K)
    const probs = softmax(logits)
    const predIdx = argmax(probs)
    const confidence = probs[predIdx] ?? 0
    const predictedLabel = labels[predIdx] ?? "unknown"
    const trueLabel = samples[i]!.label
    sampleResults.push({
      sample_id: samples[i]!.id,
      true_label: trueLabel,
      predicted_label: predictedLabel,
      confidence,
      correct: predictedLabel === trueLabel,
      features: samples[i]!.features,
    })
  }

  // Per-class stats
  const classStats: Record<string, { count: number; correct: number; totalConf: number }> = {}
  for (const label of labels) classStats[label] = { count: 0, correct: 0, totalConf: 0 }

  for (const r of sampleResults) {
    const s = classStats[r.true_label]
    if (s) {
      s.count++
      if (r.correct) s.correct++
      s.totalConf += r.confidence
    }
  }

  const perClass = labels.map((label) => {
    const s = classStats[label] ?? { count: 0, correct: 0, totalConf: 0 }
    return {
      label,
      count: s.count,
      accuracy: s.count > 0 ? s.correct / s.count : 0,
      avg_confidence: s.count > 0 ? s.totalConf / s.count : 0,
    }
  })

  const overallAccuracy = sampleResults.filter((r) => r.correct).length / N

  // Most uncertain / misclassified samples
  const sortedByConfidence = [...sampleResults].sort((a, b) => a.confidence - b.confidence)
  const uncertainSamples = sortedByConfidence
    .filter((r) => r.confidence < args.confidence_threshold || !r.correct)
    .slice(0, args.n_suggestions)
    .map(({ sample_id, true_label, predicted_label, confidence, features }) => ({
      sample_id,
      true_label,
      predicted_label,
      confidence: Math.round(confidence * 1000) / 1000,
      features,
    }))

  // Build actionable recommendations
  const recommendations: string[] = []
  const totalSamples = N
  const weakClasses = perClass.filter((c) => c.accuracy < 0.8).sort((a, b) => a.accuracy - b.accuracy)
  const smallClasses = perClass.filter((c) => c.count < 20)
  const maxCount = Math.max(...perClass.map((c) => c.count))

  for (const cls of weakClasses) {
    const needed = Math.max(20, Math.round(maxCount * 0.8)) - cls.count
    if (needed > 0) {
      recommendations.push(
        `Collect ~${needed} more "${cls.label}" samples — current accuracy ${(cls.accuracy * 100).toFixed(0)}%`,
      )
    } else {
      recommendations.push(
        `Review "${cls.label}" labels — accuracy ${(cls.accuracy * 100).toFixed(0)}% suggests noise or overlap with other classes`,
      )
    }
  }

  for (const cls of smallClasses) {
    if (!weakClasses.find((w) => w.label === cls.label)) {
      recommendations.push(`"${cls.label}" has only ${cls.count} samples — add more for reliable training`)
    }
  }

  const nUncertain = sampleResults.filter((r) => r.confidence < args.confidence_threshold).length
  if (nUncertain > 0) {
    recommendations.push(
      `${nUncertain} of ${totalSamples} samples are below ${(args.confidence_threshold * 100).toFixed(0)}% confidence — consider reviewing these labels`,
    )
  }

  if (recommendations.length === 0) {
    recommendations.push("Training data looks healthy — all classes have strong accuracy and sufficient samples.")
  }

  return {
    ok: true,
    task_id: args.task_id,
    n_samples: N,
    overall_accuracy: Math.round(overallAccuracy * 1000) / 1000,
    per_class: perClass.map((c) => ({
      ...c,
      accuracy: Math.round(c.accuracy * 1000) / 1000,
      avg_confidence: Math.round(c.avg_confidence * 1000) / 1000,
    })),
    uncertain_samples: uncertainSamples,
    recommendations,
  }
}
