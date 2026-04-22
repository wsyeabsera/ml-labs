import { z } from "zod"
import { getTask } from "../core/db/tasks"
import { createAutoRun } from "../core/db/auto"
import { runController } from "../core/auto/controller"
import { recordEvent } from "../core/db/events"
import { countSamplesByTaskAndSplit, sampleCounts } from "../core/db/samples"
import { estimateTrainingBudget } from "../core/memory_budget"
import { log } from "../core/logger"

export const name = "auto_train"
export const description =
  "Fully automated ML pipeline: spawns a Claude coordinator sub-agent that runs preflight, " +
  "suggests hyperparams, sweeps in waves, evaluates, and promotes the winner. " +
  "Budget is enforced at wave boundaries (one wave may exceed budget_s). " +
  "Use get_auto_status to follow coordinator progress cross-process."

export const schema = {
  task_id: z.string().describe("Task ID to auto-train"),
  accuracy_target: z
    .number()
    .min(0)
    .max(1)
    .default(0.9)
    .describe("Target accuracy to stop early (default: 0.9)"),
  max_waves: z
    .number()
    .int()
    .positive()
    .default(2)
    .describe("Max sweep waves (default: 2 — coarse then refinement)"),
  budget_s: z
    .number()
    .int()
    .positive()
    .default(180)
    .describe("Soft wall-clock budget in seconds (default: 180). One wave may exceed this."),
  promote: z
    .boolean()
    .default(true)
    .describe("Register winner as active model after training (default: true)"),
  publish_name: z
    .string()
    .optional()
    .describe("If set, publish winner to registry with this name after promotion"),
  publish_version: z
    .string()
    .optional()
    .describe("Registry version string (default: today's date)"),
  tournament: z
    .boolean()
    .default(false)
    .describe("Enable multi-strategy tournament mode: for each wave run 3 parallel planners (aggressive/conservative/exploratory) and merge their proposals. Trades cost for robustness on hard tasks."),
  seed: z
    .number()
    .int()
    .optional()
    .describe("Deterministic seed threaded through the controller. When combined with NEURON_PLANNER=rules, produces identical output across runs. Primarily for benchmarks and reproducibility."),
  auto_collect: z
    .boolean()
    .default(false)
    .describe("Active-learning loop (Phase 7): after training, if accuracy < target AND neuron.config.ts has a `collect` callback, invoke it to gather new samples and re-train. Up to `max_collect_rounds` iterations. No-op without a callback."),
  max_collect_rounds: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(2)
    .describe("Max active-learning rounds when auto_collect=true (default 2)."),
  force: z
    .boolean()
    .default(false)
    .describe("Override the memory-budget guardrail. Required when the estimated training workload would exceed ~1.5GB peak memory (Fashion-MNIST-scale and up). Only pass when you know your machine has headroom."),
  dry_run: z
    .boolean()
    .default(false)
    .describe("Return a plan preview (memory budget + seed configs + wall-clock estimate + whether it would refuse) WITHOUT starting training. Use this for the heavy/refuse workloads before asking the user to confirm. Pair with a real auto_train call afterward when confirmed."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found — create it first`)

  // Phase 11.7: memory-budget preflight. Refuse workloads that will likely
  // crash the host unless the caller explicitly passes force: true. Warn on
  // "heavy" workloads without blocking.
  const N_train = countSamplesByTaskAndSplit(args.task_id, "train")
  const D = task.featureShape[0] ?? 0
  const K = task.kind === "regression" ? 1 : (task.labels?.length ?? Object.keys(sampleCounts(args.task_id)).length)
  const budget = estimateTrainingBudget({
    N: N_train, D, K,
    kind: task.kind === "regression" ? "regression" : "classification",
  })

  // Dry-run preview: materialize the plan (budget + seed configs + ETA)
  // without spawning the coordinator. Intended flow for heavy workloads:
  //   1. Claude calls auto_train({dry_run: true}) → shows preview to user
  //   2. User confirms
  //   3. Claude calls auto_train() for real
  if (args.dry_run) {
    const { refineFromSignals } = await import("../core/auto/rules")
    const { computeDataHealth } = await import("../core/auto/signals")
    const data = computeDataHealth(args.task_id)
    const seedPlan = refineFromSignals({
      task_id: args.task_id,
      task_kind: task.kind === "regression" ? "regression" : "classification",
      target: { metric: task.kind === "regression" ? "r2" : "accuracy", value: args.accuracy_target },
      data,
      current_wave: [],
      history: {
        waves_done: 0,
        budget_s: args.budget_s,
        budget_used_s: 0,
        prior_best_metric: null,
        prior_best_config: null,
      },
    })

    // Estimate per-wave wall-clock. The budget's [low, high] is for ONE config;
    // waves have multiple configs and may run concurrent vs sequential.
    // Concurrent (budget=safe/advisory): all configs in parallel → 1× per-config estimate
    // Sequential (budget=heavy): configs run one at a time → Nconfigs × per-config
    const perConfigLow = budget.wall_clock_estimate_s[0]
    const perConfigHigh = budget.wall_clock_estimate_s[1]
    const nConfigs = seedPlan.configs.length
    const concurrent = budget.level === "safe" || budget.level === "advisory"
    const waveWallClockLow = concurrent ? perConfigLow : perConfigLow * nConfigs
    const waveWallClockHigh = concurrent ? perConfigHigh : perConfigHigh * nConfigs
    // With max_waves > 1, refinement waves add more — cap expectation at waves × per-wave.
    const totalLow = waveWallClockLow * args.max_waves
    const totalHigh = waveWallClockHigh * args.max_waves

    return {
      ok: true,
      dry_run: true,
      task_id: args.task_id,
      would_refuse: budget.level === "refuse" && !args.force,
      budget,
      seed_configs: seedPlan.configs,
      n_configs: nConfigs,
      sweep_mode: concurrent ? "concurrent" : "sequential",
      max_waves: args.max_waves,
      estimated_wall_clock_s: {
        per_config: [perConfigLow, perConfigHigh],
        seed_wave: [waveWallClockLow, waveWallClockHigh],
        full_training: [totalLow, totalHigh],
      },
      recommendation: budget.level === "refuse"
        ? "Workload too large — show the user the budget advice and ask them to subset / reduce dimensions / pass force:true."
        : budget.level === "heavy"
          ? "Heavy workload. Show the user the estimated wall-clock and peak memory, then ask them to confirm before starting."
          : "Safe to proceed.",
    }
  }

  if (budget.level === "refuse" && !args.force) {
    const adviceLines = budget.advice.map((a) => `  • ${a}`).join("\n")
    throw new Error(
      `Refusing to start auto_train: workload is too large for the CPU-only MLP backend.\n\n` +
      `  ${budget.headline}\n\n` +
      `Options:\n${adviceLines}\n\n` +
      `If you're confident your machine has the memory, pass force: true.`,
    )
  }
  if (budget.level === "heavy") {
    log(`auto_train starting on a heavy workload: ${budget.headline}`)
    recordEvent({
      source: "mcp",
      kind: "auto_heavy_workload",
      taskId: args.task_id,
      payload: {
        N_train, D, K,
        peak_mb: budget.peak_mb,
        wall_clock_estimate_s: budget.wall_clock_estimate_s,
        advice: budget.advice,
      },
    })
  }

  const autoRun = createAutoRun(args.task_id, {
    accuracy_target: args.accuracy_target,
    budget_s: args.budget_s,
    max_waves: args.max_waves,
  })

  recordEvent({ source: "mcp", kind: "auto_started", taskId: args.task_id, payload: { autoRunId: autoRun.id, accuracyTarget: args.accuracy_target, budgetS: args.budget_s } })

  const taskKind: "classification" | "regression" = task.kind === "regression" ? "regression" : "classification"

  const result = await runController({
    task_id: args.task_id,
    task_kind: taskKind,
    auto_run_id: autoRun.id,
    accuracy_target: args.accuracy_target,
    max_waves: args.max_waves,
    budget_s: args.budget_s,
    promote: args.promote,
    publish_name: args.publish_name,
    publish_version: args.publish_version ?? new Date().toISOString().slice(0, 10),
    tournament: args.tournament,
    seed: args.seed,
    auto_collect: args.auto_collect,
    max_collect_rounds: args.max_collect_rounds,
  })

  recordEvent({ source: "mcp", kind: "auto_completed", taskId: args.task_id, payload: { autoRunId: autoRun.id, status: result.status, runId: result.run_id, accuracy: result.accuracy, wallClockS: result.wall_clock_s } })

  return {
    ok: result.status === "completed",
    auto_run_id: autoRun.id,
    status: result.status,
    run_id: result.run_id,
    accuracy: result.accuracy,
    waves_used: result.waves_used,
    verdict: result.verdict,
    verdict_json: result.verdict_json,
    published_uri: result.published_uri,
    wall_clock_s: result.wall_clock_s,
  }
}
