import { z } from "zod"
import { getRun } from "../core/db/runs"
import { getTask } from "../core/db/tasks"

export const name = "get_training_curves"
export const description = "Return loss history and derived signals for a completed run: convergence epoch, overfitting gap (if val split exists), and whether training is still improving."

export const schema = {
  run_id: z.number().int().describe("Run ID to get curves for"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)

  const task = getTask(run.taskId)
  const isRegression = task?.kind === "regression"

  const loss = run.lossHistory ?? []
  const N = loss.length

  // Convergence: epoch where loss stopped improving by >0.1% per step
  let convergenceEpoch: number | null = null
  if (N > 10) {
    for (let i = N - 1; i > 0; i--) {
      const improvement = ((loss[i - 1] ?? 0) - (loss[i] ?? 0)) / (loss[i - 1] ?? 1)
      if (improvement > 0.001) {
        const totalEpochs = (run.hyperparams as { epochs?: number }).epochs ?? N
        convergenceEpoch = Math.round((i / N) * totalEpochs)
        break
      }
    }
  }

  // Still improving? Compare last 10% vs prior 10%
  let stillImproving = false
  if (N > 20) {
    const tail = loss.slice(-Math.ceil(N * 0.1))
    const prior = loss.slice(-Math.ceil(N * 0.2), -Math.ceil(N * 0.1))
    const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length
    const priorMean = prior.reduce((a, b) => a + b, 0) / prior.length
    stillImproving = priorMean - tailMean > 0.001 * priorMean
  }

  const result: Record<string, unknown> = {
    run_id: args.run_id,
    task_id: run.taskId,
    status: run.status,
    epochs_total: (run.hyperparams as { epochs?: number }).epochs ?? null,
    loss_history: loss,
    loss_initial: loss[0] ?? null,
    loss_final: loss.at(-1) ?? null,
    loss_reduction_pct: loss[0] && loss.at(-1) ? +((1 - loss.at(-1)! / loss[0]) * 100).toFixed(1) : null,
    convergence_epoch: convergenceEpoch,
    still_improving: stillImproving,
    suggestion: stillImproving ? "Loss is still decreasing — consider training for more epochs." : convergenceEpoch !== null ? `Converged around epoch ${convergenceEpoch}. Current epoch count is reasonable.` : null,
  }

  if (isRegression) {
    result.mae = run.mae
    result.rmse = run.rmse
    result.r2 = run.r2
  } else {
    result.train_accuracy = run.accuracy
    result.val_accuracy = run.valAccuracy
    if (run.accuracy !== null && run.valAccuracy !== null) {
      const gap = run.accuracy - run.valAccuracy
      result.overfit_gap = +gap.toFixed(4)
      result.overfit_warning = gap > 0.1
        ? `Overfitting detected: train accuracy ${(run.accuracy * 100).toFixed(1)}% vs val ${(run.valAccuracy * 100).toFixed(1)}%. Consider fewer epochs or more data.`
        : null
    }
    result.per_class_accuracy = run.perClassAccuracy
    result.confusion_matrix = run.confusionMatrix
  }

  return result
}
