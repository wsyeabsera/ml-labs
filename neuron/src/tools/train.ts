import { z } from "zod"
import { getTask, updateTaskLabels } from "../core/db/tasks"
import { getSamplesByTask, sampleCounts } from "../core/db/samples"
import { createRun, updateRunStatus, updateRunCheckpoint, finalizeRun, getRun } from "../core/db/runs"
import { registerModel } from "../core/db/models"
import { setActiveRun, clearActiveRun, setTaskTrained, setRunProgress, clearRunProgress } from "../core/state"
import { updateRunProgress, clearRunProgressDb } from "../core/db/runs"
import { trainHead, type TrainHyperparams } from "../core/train"
import { loadConfig } from "../adapter/loader"
import { log, clearLog } from "../core/logger"

export const name = "train"
export const description = "Train an MLP classifier head for the task. Streams progress notifications. Resumable via run_id."

export const schema = {
  task_id: z.string().describe("Task ID to train"),
  lr: z.number().positive().optional().describe("Learning rate (default: 0.005)"),
  epochs: z.number().int().positive().optional().describe("Training epochs (default: 500)"),
  head_arch: z.array(z.number().int().positive()).optional().describe("MLP architecture [D, ...hidden, K]. Defaults to [D, max(D,32), K]"),
  run_id: z.number().int().optional().describe("Resume a cancelled run from its checkpoint"),
  auto_register: z.boolean().default(true).describe("Auto-register as active model on completion"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const config = await loadConfig()
  const samples = getSamplesByTask(args.task_id)
  if (samples.length === 0) throw new Error("No samples — use collect first")

  const labelNames = [...new Set(samples.map((s) => s.label))].sort()
  if (labelNames.length < 2) throw new Error("Need at least 2 classes to train")

  const K = labelNames.length
  const D = task.featureShape[0] ?? samples[0]?.features.length ?? 1

  const hyperparams: TrainHyperparams = {
    lr: args.lr ?? config?.defaultHyperparams?.lr ?? 0.005,
    epochs: args.epochs ?? config?.defaultHyperparams?.epochs ?? 500,
  }

  const headArchFn = config?.headArchitecture ?? ((k: number, d: number) => [d, Math.max(d, 32), k])
  const headArch = args.head_arch ?? headArchFn(K, D)

  clearLog()
  log(`Training "${args.task_id}": ${samples.length} samples, ${K} classes: [${labelNames.join(", ")}]`)
  log(`Head: [${headArch.join(" → ")}], lr=${hyperparams.lr}, epochs=${hyperparams.epochs}`)

  const run = createRun(args.task_id, { ...hyperparams, headArch })
  const ac = new AbortController()
  setActiveRun(args.task_id, run.id, ac)

  try {
    const result = await trainHead({
      samples,
      labels: labelNames,
      featurize: async (s) => {
        if (config?.featurize && !(s as { features?: number[] }).features?.length) {
          return config.featurize((s as { raw?: unknown }).raw)
        }
        return (s as { features: number[] }).features
      },
      headArch: () => headArch,
      hyperparams,
      runId: run.id,
      signal: ac.signal,
      onProgress: (p) => {
        log(p.message)
        setRunProgress(run.id, p, [], 0)
        // Persist to DB on stage change so cross-process pollers (sweeps) can see progress
        updateRunProgress(run.id, { stage: p.stage, i: p.i, n: p.n, message: p.message, lossHistory: [], epochsDone: 0 })
        if (p.stage === "featurize" && p.i && p.i % 20 === 0) {
          updateRunCheckpoint(run.id, {
            epochsDone: 0,
            mlpName: `neuron_run_${run.id}_mlp`,
            inputsTensorName: `neuron_${run.id}_inputs`,
            targetsTensorName: `neuron_${run.id}_targets`,
          }, [])
        }
      },
    })

    // Update progress with full loss history for TUI polling
    setRunProgress(run.id, { stage: "eval", message: "Evaluating…" }, result.lossHistory, hyperparams.epochs)

    // Finalize
    finalizeRun(run.id, {
      accuracy: result.metrics.accuracy,
      perClassAccuracy: result.metrics.perClassAccuracy,
      confusionMatrix: result.metrics.confusionMatrix,
      lossHistory: result.lossHistory,
      sampleCounts: result.sampleCounts,
      weights: result.weights,
    })

    updateTaskLabels(args.task_id, labelNames)

    if (args.auto_register !== false) {
      registerModel(args.task_id, run.id)
    }

    setTaskTrained(args.task_id, {
      labels: labelNames,
      metrics: result.metrics,
      lossHistory: result.lossHistory,
      sampleCounts: result.sampleCounts,
      runId: run.id,
    })

    clearRunProgress(run.id)
    clearRunProgressDb(run.id)
    log(`Run ${run.id} completed — accuracy ${(result.metrics.accuracy * 100).toFixed(1)}%`)

    return {
      ok: true,
      run_id: run.id,
      accuracy: result.metrics.accuracy,
      per_class_accuracy: result.metrics.perClassAccuracy,
      loss_history_tail: result.lossHistory.slice(-5),
      labels: labelNames,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cancelled = msg.includes("cancelled")
    updateRunStatus(run.id, cancelled ? "cancelled" : "failed")
    clearActiveRun(args.task_id)
    clearRunProgress(run.id)
    clearRunProgressDb(run.id)
    log(`Run ${run.id} ${cancelled ? "cancelled" : "failed"}: ${msg}`)
    throw e
  }
}
