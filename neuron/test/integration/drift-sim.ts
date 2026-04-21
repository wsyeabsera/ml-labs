/**
 * Drift-detection regression guard.
 *
 * Seeds a synthetic task with N(0, 1) training features, logs a window of
 * predictions drawn from the same distribution, then shifts the distribution
 * by 2σ on feature[0] and logs a second window. Asserts drift_check flags
 * the shift.
 *
 * Not in the default `bun test` lane (it touches a real DB). Run explicitly:
 *   bun run test/integration/drift-sim.ts
 */
import { createTask, deleteTask } from "../../src/core/db/tasks"
import { insertSamplesBatch } from "../../src/core/db/samples"
import { logPrediction } from "../../src/core/db/predictions"
import { handler as driftCheck } from "../../src/tools/drift_check"

const TASK_ID = `drift_sim_${Date.now()}`
const N_TRAIN = 500
const N_STABLE = 500
const N_SHIFTED = 100
const D = 2

// Box–Muller transform for N(mean, std) samples.
function rnorm(mean = 0, std = 1): number {
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function features(meanF0 = 0): number[] {
  return [rnorm(meanF0, 1), rnorm(0, 1)]
}

async function main() {
  console.log(`[drift-sim] task=${TASK_ID}`)

  // Seed the task with N(0, 1) samples.
  createTask({
    id: TASK_ID,
    kind: "classification",
    labels: ["a", "b"],
    featureShape: [D],
    sampleShape: [D],
    normalize: false,
    featureNames: ["f0", "f1"],
  })

  const samples = Array.from({ length: N_TRAIN }, () => {
    const f = features()
    return {
      taskId: TASK_ID,
      label: f[0]! > 0 ? "a" : "b",
      features: f,
      split: "train" as const,
    }
  })
  insertSamplesBatch(samples)
  console.log(`[drift-sim] inserted ${N_TRAIN} training samples`)

  // Stable window — same distribution as training.
  for (let i = 0; i < N_STABLE; i++) {
    logPrediction({
      taskId: TASK_ID,
      features: features(),
      output: { label: "a", confidence: 0.7 },
    })
  }
  console.log(`[drift-sim] logged ${N_STABLE} stable predictions`)

  // Confirm no drift on a stable window.
  const stableReport = await driftCheck({ task_id: TASK_ID, current_window: N_STABLE })
  console.log(`[drift-sim] stable verdict: ${stableReport.overall_verdict}`)
  if (stableReport.overall_verdict === "severe") {
    throw new Error(`stable window falsely flagged as severe — PSI is too eager`)
  }

  // Shifted window — feature[0] mean moved by +2σ.
  for (let i = 0; i < N_SHIFTED; i++) {
    logPrediction({
      taskId: TASK_ID,
      features: [rnorm(2, 1), rnorm(0, 1)],
      output: { label: "a", confidence: 0.5 },
    })
  }
  console.log(`[drift-sim] logged ${N_SHIFTED} shifted predictions (+2σ on f0)`)

  // The drift_check current_window covers the last K predictions. We want the
  // window to contain roughly the shifted portion, so use the shifted count.
  const shiftedReport = await driftCheck({ task_id: TASK_ID, current_window: N_SHIFTED })
  console.log(`[drift-sim] shifted verdict: ${shiftedReport.overall_verdict}`)

  const perFeat = shiftedReport.features.map((f) => `${f.feature_name} psi=${f.psi.toFixed(3)} verdict=${f.verdict}`)
  for (const line of perFeat) console.log(`[drift-sim]   ${line}`)

  // Cleanup before asserting so the DB doesn't accumulate test tasks.
  deleteTask(TASK_ID)

  const failures: string[] = []
  if (shiftedReport.overall_verdict !== "drifting" && shiftedReport.overall_verdict !== "severe") {
    failures.push(`expected overall verdict drifting|severe, got ${shiftedReport.overall_verdict}`)
  }
  const f0 = shiftedReport.features.find((f) => f.feature_idx === 0)
  if (!f0 || (f0.verdict === "stable" || f0.verdict === "insufficient_data")) {
    failures.push(`expected feature[0] to be flagged; got ${f0?.verdict ?? "missing"}`)
  }

  if (failures.length) {
    console.error("\n✗ drift-sim failed:")
    for (const f of failures) console.error("  -", f)
    process.exit(1)
  }
  console.log("\n✓ drift-sim passed")
  process.exit(0)
}

main().catch((e) => {
  try { deleteTask(TASK_ID) } catch {}
  console.error(e)
  process.exit(1)
})
