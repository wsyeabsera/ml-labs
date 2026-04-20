import { listTasks } from "./db/tasks"
import { getRegisteredModel } from "./db/models"
import { getTaskState } from "./state"
import { safeParse } from "../util/json"
import { rsTensor } from "./mcp_client"
import { log } from "./logger"

export async function boot() {
  const tasks = listTasks()
  log(`Neuron boot: found ${tasks.length} task(s)`)

  for (const task of tasks) {
    const model = getRegisteredModel(task.id)
    if (!model?.run) continue
    const { status } = model.run
    if (status !== "completed" && status !== "imported") continue

    const run = model.run
    const s = getTaskState(task.id)

    s.trained = true
    s.accuracy = run.accuracy
    s.perClassAccuracy = run.perClassAccuracy ?? {}
    s.confusionMatrix = run.confusionMatrix ?? []
    s.lossHistory = run.lossHistory ?? []
    s.sampleCounts = run.sampleCounts ?? {}
    if (task.labels) s.labels = task.labels

    // Restore MLP into rs-tensor: init structure first, then overwrite weights
    const weights = run.weights
    if (weights) {
      const mlpName = `neuron_run_${run.id}_mlp`
      const headArch = (run.hyperparams as { headArch?: number[] }).headArch
      try {
        await rsTensor.restoreMlp(mlpName, weights, headArch)
        log(`Task "${task.id}" MLP restored (run #${run.id}) — accuracy ${s.accuracy !== null ? (s.accuracy * 100).toFixed(1) + "%" : "?"}`)
      } catch (e) {
        log(`  warn: could not restore MLP for task "${task.id}": ${e}`)
      }
    } else {
      log(`Task "${task.id}" restored (no weights to load) — accuracy ${s.accuracy !== null ? (s.accuracy * 100).toFixed(1) + "%" : "?"}`)
    }
  }
}
