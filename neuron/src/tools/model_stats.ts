import { z } from "zod"
import { getRegisteredModel } from "../core/db/models"
import { getTask } from "../core/db/tasks"
import { getSamplesByTaskAndSplit, getSamplesByTask } from "../core/db/samples"
import { rsTensor } from "../core/mcp_client"
import { softmax, argmax, applyNorm } from "../core/metrics"

export const name = "model_stats"
export const description = "Run the registered model on all loaded samples and return confidence distribution, low-confidence count, and per-class confidence. Useful for diagnosing uncertainty and calibration."

export const schema = {
  task_id: z.string().describe("Task ID"),
  split: z.enum(["train", "test", "all"]).default("all").describe("Which split to evaluate on (default: all)"),
  confidence_threshold: z.number().min(0).max(1).default(0.7).describe("Samples below this confidence are flagged as low-confidence (default: 0.7)"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const model = getRegisteredModel(args.task_id)
  if (!model?.run || (model.run.status !== "completed" && model.run.status !== "imported")) {
    throw new Error(`No trained model for task "${args.task_id}". Train first.`)
  }

  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const isRegression = task.kind === "regression"
  if (isRegression) {
    throw new Error("model_stats is for classification tasks. Use get_training_curves for regression metrics.")
  }

  const run = model.run
  const labels = task.labels ?? Object.keys(run.sampleCounts ?? {})
  if (!labels.length) throw new Error("No labels found")

  const samples =
    args.split === "train" ? getSamplesByTaskAndSplit(args.task_id, "train")
    : args.split === "test" ? getSamplesByTaskAndSplit(args.task_id, "test")
    : getSamplesByTask(args.task_id)

  if (samples.length === 0) return { ok: true, message: "No samples in the selected split." }

  const K = labels.length
  const mlpName = `neuron_run_${run.id}_mlp`

  // Restore model if needed
  try {
    await rsTensor.evaluateMlp(mlpName, `neuron_pred_stats_probe`)
  } catch {
    if (run.weights) {
      const headArch = (run.hyperparams as { headArch?: number[] }).headArch
      await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    }
  }

  const confidences: number[] = []
  const correctCount: Record<string, number> = {}
  const totalCount: Record<string, number> = {}
  const confidenceByClass: Record<string, number[]> = {}
  let lowConfidenceCount = 0
  let correctTotal = 0

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    let features = s.features
    if (run.normStats) features = applyNorm(features, run.normStats.mean, run.normStats.std)

    const inputName = `neuron_stats_${i % 20}`
    await rsTensor.createTensor(inputName, features, [1, features.length])
    const evalResult = await rsTensor.evaluateMlp(mlpName, inputName)

    const rawScores = evalResult.predictions?.data?.slice(0, K) ?? []
    const probs = softmax(rawScores)
    const predIdx = argmax(probs)
    const confidence = probs[predIdx] ?? 0
    confidences.push(confidence)

    if (confidence < args.confidence_threshold) lowConfidenceCount++

    const predLabel = labels[predIdx] ?? ""
    const trueLabel = s.label
    totalCount[trueLabel] = (totalCount[trueLabel] ?? 0) + 1
    if (!confidenceByClass[trueLabel]) confidenceByClass[trueLabel] = []
    confidenceByClass[trueLabel]!.push(confidence)

    if (predLabel === trueLabel) {
      correctCount[trueLabel] = (correctCount[trueLabel] ?? 0) + 1
      correctTotal++
    }
  }

  const N = confidences.length
  const meanConf = confidences.reduce((a, b) => a + b, 0) / N
  const sortedConf = [...confidences].sort((a, b) => a - b)

  // Histogram (10 bins 0→1)
  const histogram = new Array<number>(10).fill(0)
  for (const c of confidences) histogram[Math.min(9, Math.floor(c * 10))]!++

  const perClass = labels.map((label) => ({
    label,
    total: totalCount[label] ?? 0,
    correct: correctCount[label] ?? 0,
    accuracy: (totalCount[label] ?? 0) > 0 ? (correctCount[label] ?? 0) / (totalCount[label] ?? 1) : 0,
    mean_confidence: confidenceByClass[label]?.length
      ? +(confidenceByClass[label]!.reduce((a, b) => a + b, 0) / confidenceByClass[label]!.length).toFixed(4)
      : 0,
  }))

  return {
    ok: true,
    task_id: args.task_id,
    split: args.split,
    total_evaluated: N,
    overall_accuracy: +(correctTotal / N).toFixed(4),
    mean_confidence: +meanConf.toFixed(4),
    median_confidence: +sortedConf[Math.floor(N / 2)]!.toFixed(4),
    low_confidence_count: lowConfidenceCount,
    low_confidence_pct: +((lowConfidenceCount / N) * 100).toFixed(1),
    confidence_threshold: args.confidence_threshold,
    confidence_histogram: { bins: "0.0-0.1 ... 0.9-1.0", counts: histogram },
    per_class: perClass,
  }
}
