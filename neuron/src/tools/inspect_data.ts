import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { getSamplesByTask, splitCounts, sampleCounts } from "../core/db/samples"

export const name = "inspect_data"
export const description = "Dataset health check: feature stats (mean/std/min/max per dimension), class distribution, imbalance ratio, split counts, and null/constant feature warnings."

export const schema = {
  task_id: z.string().describe("Task ID to inspect"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const samples = getSamplesByTask(args.task_id)
  if (samples.length === 0) return { ok: true, total: 0, message: "No samples loaded yet." }

  const D = samples[0]!.features.length
  const N = samples.length
  const featureNames = task.featureNames ?? Array.from({ length: D }, (_, i) => `feature_${i}`)

  // Per-feature stats
  const mins = new Array<number>(D).fill(Infinity)
  const maxs = new Array<number>(D).fill(-Infinity)
  const sums = new Array<number>(D).fill(0)
  const sumSqs = new Array<number>(D).fill(0)

  for (const s of samples) {
    for (let d = 0; d < D; d++) {
      const v = s.features[d] ?? 0
      if (v < mins[d]!) mins[d] = v
      if (v > maxs[d]!) maxs[d] = v
      sums[d]! += v
      sumSqs[d]! += v * v
    }
  }

  const featureStats = featureNames.map((name, d) => {
    const mean = sums[d]! / N
    const variance = sumSqs[d]! / N - mean * mean
    const std = Math.sqrt(Math.max(0, variance))
    const isConstant = (maxs[d]! - mins[d]!) < 1e-9
    return {
      name,
      mean: +mean.toFixed(6),
      std: +std.toFixed(6),
      min: +(mins[d]!).toFixed(6),
      max: +(maxs[d]!).toFixed(6),
      constant: isConstant,
    }
  })

  const warnings: string[] = []

  // Constant feature warning
  const constantFeatures = featureStats.filter((f) => f.constant).map((f) => f.name)
  if (constantFeatures.length > 0) {
    warnings.push(`Constant features (zero variance) — won't contribute to training: ${constantFeatures.join(", ")}`)
  }

  // Large scale difference warning (max range > 100x min range)
  const ranges = featureStats.map((f) => f.max - f.min).filter((r) => r > 0)
  if (ranges.length > 1) {
    const maxRange = Math.max(...ranges)
    const minRange = Math.min(...ranges)
    if (maxRange / minRange > 100) {
      warnings.push(`Feature scales differ by >100x (max range ${maxRange.toFixed(2)} vs min ${minRange.toFixed(2)}). Consider normalize=true on create_task.`)
    }
  }

  // Class distribution (classification)
  const isRegression = task.kind === "regression"
  let classDist: Record<string, number> | null = null
  let imbalanceRatio: number | null = null
  let imbalanceWarning: string | null = null

  if (!isRegression) {
    classDist = sampleCounts(args.task_id)
    const counts = Object.values(classDist)
    if (counts.length > 0) {
      const maxCount = Math.max(...counts)
      const minCount = Math.min(...counts)
      imbalanceRatio = maxCount / minCount
      if (imbalanceRatio > 3) {
        const minority = Object.entries(classDist).sort((a, b) => a[1] - b[1])[0]![0]
        warnings.push(`Class imbalance ratio ${imbalanceRatio.toFixed(1)}x. Minority class: "${minority}". Consider class_weights="balanced" in train.`)
      }
    }
  } else {
    // For regression: show target value distribution
    const values = samples.map((s) => parseFloat(s.label) || 0)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
    classDist = { target_mean: +mean.toFixed(4), target_std: +std.toFixed(4), target_min: +min.toFixed(4), target_max: +max.toFixed(4) } as unknown as Record<string, number>
  }

  const splits = splitCounts(args.task_id)

  return {
    ok: true,
    task_id: args.task_id,
    kind: task.kind,
    total: N,
    splits,
    features: {
      count: D,
      names: featureNames,
      stats: featureStats,
    },
    class_distribution: classDist,
    imbalance_ratio: imbalanceRatio,
    normalize_enabled: task.normalize,
    warnings,
  }
}
