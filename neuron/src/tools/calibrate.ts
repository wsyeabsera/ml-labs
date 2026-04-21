import { z } from "zod"
import { getRun, updateCalibrationTemperature } from "../core/db/runs"
import { getTask } from "../core/db/tasks"
import { getSamplesByTaskAndSplit } from "../core/db/samples"
import { rsTensor } from "../core/mcp_client"
import { applyNorm } from "../core/metrics"
import { fitTemperature } from "../core/calibration"
import { recordEvent } from "../core/db/events"
import { log } from "../core/logger"

export const name = "calibrate"
export const description =
  "Post-hoc confidence calibration via temperature scaling. Fits T > 0 on the run's " +
  "held-out test split, stores it on the run, and makes predict/batch_predict divide " +
  "logits by T before softmax. Classification only; requires a test split."

export const schema = {
  run_id: z.number().int().describe("Completed run to calibrate"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const run = getRun(args.run_id)
  if (!run) throw new Error(`Run ${args.run_id} not found`)
  if (run.status !== "completed") throw new Error(`Run ${args.run_id} is ${run.status}, not completed`)

  const task = getTask(run.taskId)
  if (!task) throw new Error(`Task "${run.taskId}" not found`)
  if (task.kind === "regression") {
    return { ok: false, reason: "calibration is classification-only" }
  }

  const testSamples = getSamplesByTaskAndSplit(run.taskId, "test")
  if (testSamples.length === 0) {
    return { ok: false, reason: "no test split — nothing to calibrate on" }
  }

  const labels = task.labels ?? []
  if (labels.length === 0) {
    return { ok: false, reason: "task labels not recorded on the run — retrain to repopulate" }
  }
  const labelIndex = new Map(labels.map((l, i) => [l, i]))

  // Run inference on the test samples to collect raw logits.
  const mlpName = `neuron_run_${run.id}_mlp`
  const D = task.featureShape[0] ?? testSamples[0]!.features.length
  const flatFeatures = testSamples.flatMap((s) =>
    run.normStats
      ? applyNorm(s.features, run.normStats.mean, run.normStats.std)
      : s.features,
  )
  const inputName = `neuron_run_${run.id}_calib_inputs`
  await rsTensor.createTensor(inputName, flatFeatures, [testSamples.length, D])

  let evalResult: { predictions?: { data: number[]; shape: number[] } }
  try {
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  } catch {
    // MLP not in memory; restore and retry.
    if (!run.weights) {
      return { ok: false, reason: "MLP not in memory and no stored weights — retrain or load_model first" }
    }
    const headArch = (run.hyperparams as { headArch?: number[] }).headArch
    await rsTensor.restoreMlp(mlpName, run.weights, headArch)
    evalResult = await rsTensor.evaluateMlp(mlpName, inputName)
  }

  const rawPreds = evalResult.predictions?.data ?? []
  const K = labels.length
  const logits: number[][] = []
  const labelInts: number[] = []
  for (let i = 0; i < testSamples.length; i++) {
    logits.push(rawPreds.slice(i * K, (i + 1) * K))
    const idx = labelIndex.get(testSamples[i]!.label)
    if (idx === undefined) continue
    labelInts.push(idx)
  }
  if (labelInts.length !== testSamples.length) {
    return { ok: false, reason: "some test sample labels are not in the task's label list" }
  }

  const fit = fitTemperature(logits, labelInts)
  updateCalibrationTemperature(run.id, fit.T)
  log(`Calibrated run ${run.id}: T=${fit.T.toFixed(3)}, ECE ${fit.ece_before.toFixed(4)} → ${fit.ece_after.toFixed(4)}`)
  recordEvent({
    source: "mcp", kind: "calibrated", taskId: run.taskId, runId: run.id,
    payload: { T: fit.T, ece_before: fit.ece_before, ece_after: fit.ece_after },
  })

  return {
    ok: true,
    run_id: run.id,
    temperature: +fit.T.toFixed(6),
    ece_before: +fit.ece_before.toFixed(6),
    ece_after: +fit.ece_after.toFixed(6),
    nll_before: +fit.nll_before.toFixed(6),
    nll_after: +fit.nll_after.toFixed(6),
    n_test_samples: testSamples.length,
  }
}
