import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { getSamplesByTask } from "../core/db/samples"
import { createRun, getRun } from "../core/db/runs"
import { recordEvent } from "../core/db/events"
import { startTrainBackground } from "../api/trainBg"
import { buildRunContext } from "../core/run-context"
import { kfoldSplits } from "../core/kfold"
import { resolveSeed } from "../util/rng"
import { db } from "../core/db/schema"
import { log } from "../core/logger"

export const name = "cv_train"
export const description = "K-fold cross-validation training. Runs k training passes with rotating folds, reports mean ± std of the primary metric (accuracy for classification, R² for regression). Each fold run is stored in the runs table linked to a parent run via cv_parent_id."

export const schema = {
  task_id: z.string().describe("Task ID"),
  k: z.number().int().min(2).max(10).default(5).describe("Number of folds (default 5)"),
  lr: z.number().positive().optional(),
  epochs: z.number().int().positive().optional(),
  head_arch: z.array(z.number().int().positive()).optional(),
  class_weights: z.enum(["balanced"]).optional(),
  weight_decay: z.number().nonnegative().optional(),
  early_stop_patience: z.number().int().positive().optional(),
  seed: z.number().int().optional().describe("Seed for fold assignment. Respects NEURON_SEED env var when omitted."),
  stratify: z.union([z.literal("auto"), z.boolean()]).default("auto")
    .describe("Stratify folds by class. 'auto' stratifies for classification, random for regression."),
}

function waitForRun(runId: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (signal?.aborted) return resolve()
      const r = getRun(runId)
      if (r && r.status !== "running" && r.status !== "pending") return resolve()
      setTimeout(check, 200)
    }
    check()
  })
}

// Assign per-sample split override via direct SQL for this fold only.
// We use a temporary task row with copied samples? That's expensive. Instead,
// we temporarily flip the `split` column on the samples table for this fold,
// then restore. Safer: use a per-run config that overrides split in trainBg.
// Simplest: write fold split directly to samples.split column, swapping train/test.
// Since samples table has a `split` column, we can assign fold-specific splits.
async function runOneFold(args: {
  task_id: string
  fold: number
  trainIds: number[]
  testIds: number[]
  parentRunId: number
  hyperparams: {
    lr?: number; epochs?: number; head_arch?: number[]
    class_weights?: "balanced"; weight_decay?: number; early_stop_patience?: number
  }
  seed?: number
}): Promise<{ runId: number; accuracy: number | null; valAccuracy: number | null }> {
  // Save current splits so we can restore after the fold.
  const current = db.query(
    `SELECT id, split FROM samples WHERE task_id = ? AND id IN (${
      [...args.trainIds, ...args.testIds].join(",")
    })`,
  ).all(args.task_id) as { id: number; split: string | null }[]

  const trainSet = new Set(args.trainIds)
  const testSet = new Set(args.testIds)

  try {
    // Assign fold-specific splits.
    const updateTrain = db.prepare(`UPDATE samples SET split = 'train' WHERE id = ?`)
    const updateTest = db.prepare(`UPDATE samples SET split = 'test' WHERE id = ?`)
    const tx = db.transaction(() => {
      for (const id of trainSet) updateTrain.run(id)
      for (const id of testSet) updateTest.run(id)
    })
    tx()

    const { runId } = await startTrainBackground({
      taskId: args.task_id,
      lr: args.hyperparams.lr,
      epochs: args.hyperparams.epochs,
      headArch: args.hyperparams.head_arch,
      classWeights: args.hyperparams.class_weights,
      weightDecay: args.hyperparams.weight_decay,
      earlyStopPatience: args.hyperparams.early_stop_patience,
      seed: args.seed,
      cvFoldId: args.fold,
      cvParentId: args.parentRunId,
      // Per-fold runs are diagnostic — they must not clobber the task's
      // registered model (v1.6.1 bug fix).
      autoRegister: false,
    })
    await waitForRun(runId)
    const run = getRun(runId)
    return {
      runId,
      accuracy: run?.accuracy ?? null,
      valAccuracy: run?.valAccuracy ?? null,
    }
  } finally {
    // Restore original splits.
    const restoreStmt = db.prepare(`UPDATE samples SET split = ? WHERE id = ?`)
    const tx = db.transaction(() => {
      for (const row of current) restoreStmt.run(row.split ?? "train", row.id)
    })
    tx()
  }
}

function mean(vals: number[]): number {
  if (vals.length === 0) return NaN
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function std(vals: number[]): number {
  if (vals.length < 2) return 0
  const m = mean(vals)
  const variance = vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length
  return Math.sqrt(variance)
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const samples = getSamplesByTask(args.task_id)
  if (samples.length < args.k) {
    throw new Error(`Need at least k=${args.k} samples, found ${samples.length}`)
  }

  const isRegression = task.kind === "regression"
  const stratify = args.stratify === "auto" ? !isRegression : args.stratify
  const seed = resolveSeed(args.seed)

  // Parent "container" run — no weights, just metadata.
  const runContext = buildRunContext({ rng_seed: seed ?? undefined })
  const parent = createRun(
    args.task_id,
    {
      lr: args.lr, epochs: args.epochs, headArch: args.head_arch,
      classWeights: args.class_weights, weightDecay: args.weight_decay,
      earlyStopPatience: args.early_stop_patience,
      k: args.k, stratify, cv: true,
    },
    { runContext, status: "cv_parent" },
  )
  log(`CV parent run ${parent.id}: k=${args.k}, stratify=${stratify}, N=${samples.length}`)
  recordEvent({
    source: "mcp", kind: "cv_started", taskId: args.task_id, runId: parent.id,
    payload: { k: args.k, stratify, n: samples.length },
  })

  const splits = kfoldSplits(
    samples.map((s) => s.id),
    samples.map((s) => s.label),
    { k: args.k, seed, stratify },
  )

  const foldResults: Array<{
    fold: number; run_id: number; accuracy: number | null; val_accuracy: number | null
  }> = []

  for (const split of splits) {
    const r = await runOneFold({
      task_id: args.task_id,
      fold: split.fold,
      trainIds: split.trainIds,
      testIds: split.testIds,
      parentRunId: parent.id,
      hyperparams: {
        lr: args.lr, epochs: args.epochs, head_arch: args.head_arch,
        class_weights: args.class_weights, weight_decay: args.weight_decay,
        early_stop_patience: args.early_stop_patience,
      },
      seed,
    })
    foldResults.push({
      fold: split.fold,
      run_id: r.runId,
      accuracy: r.accuracy,
      val_accuracy: r.valAccuracy,
    })
  }

  // Primary metric: val_accuracy for classification (each fold's held-out metric
  // IS the val accuracy). For regression, R² from each fold's run.
  const primaryMetrics: number[] = foldResults
    .map((r) => {
      if (isRegression) {
        const run = getRun(r.run_id)
        return run?.r2 ?? null
      }
      return r.val_accuracy ?? r.accuracy ?? null
    })
    .filter((v): v is number => v != null)

  const mean_metric = mean(primaryMetrics)
  const std_metric = std(primaryMetrics)

  recordEvent({
    source: "mcp", kind: "cv_completed", taskId: args.task_id, runId: parent.id,
    payload: { k: args.k, mean_metric, std_metric, folds: foldResults.length },
  })

  return {
    ok: true,
    parent_run_id: parent.id,
    k: args.k,
    metric_name: isRegression ? "r2" : "accuracy",
    mean_metric,
    std_metric,
    per_fold: foldResults,
  }
}
