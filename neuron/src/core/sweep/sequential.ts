/**
 * Sequential sweep runner — no Claude sub-agents, no MCP protocol hops.
 * Used by benchmarks and any headless scenario that needs determinism.
 *
 * Triggered by `NEURON_SWEEP_MODE=sequential` env var in the controller.
 */
import { startTrainBackground } from "../../api/trainBg"
import { getRun } from "../db/runs"
import type { SweepConfig } from "./configs"
import type { AgentRunResult } from "./orchestrator"

async function waitForRunCompletion(runId: number, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    const run = getRun(runId)
    if (!run) throw new Error(`Run ${runId} vanished`)
    if (run.status !== "running" && run.status !== "pending") return
    await new Promise<void>((r) => setTimeout(r, 200))
  }
}

export async function runSweepSequential(
  taskId: string,
  configs: SweepConfig[],
  signal?: AbortSignal,
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = []

  for (const config of configs) {
    if (signal?.aborted) break

    try {
      const { runId } = await startTrainBackground({
        taskId,
        lr: config.lr,
        epochs: config.epochs,
        headArch: config.head_arch,
        classWeights: config.class_weights,
        weightDecay: config.weight_decay,
        earlyStopPatience: config.early_stop_patience,
      })

      await waitForRunCompletion(runId, signal)

      const run = getRun(runId)
      if (run?.status === "completed") {
        results.push({
          config,
          run_id: runId,
          accuracy: run.accuracy,
          status: "completed",
          session_id: "sequential",
        })
      } else {
        results.push({
          config,
          run_id: runId,
          accuracy: null,
          status: "failed",
          session_id: "sequential",
          error: `run status: ${run?.status ?? "unknown"}`,
        })
      }
    } catch (e) {
      results.push({
        config,
        run_id: null,
        accuracy: null,
        status: "failed",
        session_id: "sequential",
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return results
}
