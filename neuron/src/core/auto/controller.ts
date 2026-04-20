import { recordEvent } from "../db/events"
import { appendAutoLog, getAutoRun, updateAutoRun, type AutoLogEntry } from "../db/auto"
import { runSweep } from "../sweep/orchestrator"
import type { SweepConfig } from "../sweep/configs"
import { collectSignals, computeDataHealth, type RunSignals } from "./signals"
import { refineFromSignals, shouldContinue } from "./rules"
import { runPlanner, seedPlan } from "./planner"
import { lookupBestPattern, savePattern, taskFingerprint } from "./patterns"
import {
  saveVerdictJson,
  verdictSummaryOneLiner,
  type StructuredVerdict,
  type VerdictStatus,
} from "./verdict"
import { registerModel } from "../db/models"
import { handler as publishHandler } from "../../tools/publish_model"

export interface ControllerArgs {
  task_id: string
  task_kind: "classification" | "regression"
  auto_run_id: number
  accuracy_target: number
  max_waves: number
  budget_s: number
  promote: boolean
  publish_name?: string
  publish_version?: string
}

export interface ControllerResult {
  status: VerdictStatus
  run_id: number | null
  accuracy: number | null
  waves_used: number
  verdict: string
  verdict_json: StructuredVerdict
  published_uri?: string
  wall_clock_s: number
}

function scoreClassification(r: RunSignals): number {
  // Prefer val accuracy; apply overfit penalty if train-val gap > 0.15
  if (r.val_accuracy != null && r.accuracy != null && r.accuracy - r.val_accuracy > 0.15) {
    return r.val_accuracy - 0.5 * (r.accuracy - r.val_accuracy)
  }
  return r.val_accuracy ?? r.accuracy ?? -Infinity
}

function scoreRegression(r: RunSignals): number {
  return r.r2 ?? -Infinity
}

function log(autoRunId: number, stage: string, note: string, payload?: unknown) {
  const entry: AutoLogEntry = { ts: new Date().toISOString(), stage, note }
  if (payload !== undefined) entry.payload = payload
  appendAutoLog(autoRunId, entry)
}

export async function runController(args: ControllerArgs): Promise<ControllerResult> {
  const t0 = Date.now()
  const ac = new AbortController()
  const hardTimeoutMs = Math.round(args.budget_s * 1.1 * 1000)
  let budgetExpired = false
  const budgetTimer = setTimeout(() => {
    budgetExpired = true
    ac.abort()
  }, hardTimeoutMs)

  const elapsed = () => Math.round((Date.now() - t0) / 1000)
  const isRegression = args.task_kind === "regression"
  const metricName: "accuracy" | "r2" = isRegression ? "r2" : "accuracy"

  // Step 1: data health + preflight
  const data = computeDataHealth(args.task_id)
  log(args.auto_run_id, "inspect", `N=${data.n} K=${data.k} D=${data.d} imbalance=${data.imbalance_ratio ?? "n/a"}`, {
    warnings: data.warnings,
    imbalance_ratio: data.imbalance_ratio,
    has_val_split: data.has_val_split,
  })

  if (data.n < 10 || (!isRegression && data.k < 2)) {
    clearTimeout(budgetTimer)
    const v: StructuredVerdict = {
      status: "data_issue",
      winner: { run_id: null, metric_value: null, metric_name: metricName, is_overfit: false, confidence: "low", config: null },
      attempted: { configs_tried: 0, waves_used: 0, wall_clock_s: elapsed() },
      data_issues: data.warnings.length ? data.warnings : [`insufficient data (N=${data.n}, K=${data.k})`],
      next_steps: ["collect more samples via load_csv / load_json / load_images, then re-run auto_train"],
      summary: `not ready: ${data.warnings.join("; ") || "too few samples"}`,
    }
    saveVerdictJson(args.auto_run_id, v)
    updateAutoRun(args.auto_run_id, {
      status: "data_issue",
      finished_at: new Date().toISOString(),
      verdict: verdictSummaryOneLiner(v),
    })
    log(args.auto_run_id, "preflight_fail", v.summary)
    return { status: "data_issue", run_id: null, accuracy: null, waves_used: 0, verdict: verdictSummaryOneLiner(v), verdict_json: v, wall_clock_s: elapsed() }
  }

  // Step 2: cross-task memory — warm-start from prior winner if we have one
  const fingerprint = taskFingerprint(args.task_kind, data)
  const prior = lookupBestPattern(fingerprint)
  if (prior) {
    log(args.auto_run_id, "warm_start", `prior pattern ${fingerprint}: ${prior.metric_name}=${prior.best_metric.toFixed(3)}`, {
      fingerprint, best_config: prior.best_config, best_metric: prior.best_metric,
    })
  } else {
    log(args.auto_run_id, "warm_start", `no prior patterns for fingerprint ${fingerprint}`)
  }

  // Step 3: main wave loop
  const allRunIds: number[] = []
  let allRunSignals: RunSignals[] = []
  let wavesDone = 0
  let lastWaveRunIds: number[] = []

  while (wavesDone < args.max_waves && !ac.signal.aborted) {
    if (elapsed() >= args.budget_s) break

    const bundle = collectSignals({
      task_id: args.task_id,
      task_kind: args.task_kind,
      target_value: args.accuracy_target,
      current_wave_run_ids: lastWaveRunIds,
      waves_done: wavesDone,
      budget_s: args.budget_s,
      budget_used_s: elapsed(),
      prior_best_metric: prior?.best_metric ?? null,
      prior_best_config: prior?.best_config ?? null,
    })

    // Decide stop vs continue (but always allow wave 0 = first wave)
    if (wavesDone > 0) {
      const cont = shouldContinue(bundle, args.max_waves)
      if (!cont.cont) {
        log(args.auto_run_id, "stop", cont.reason)
        break
      }
    }

    // Pick configs
    let plan
    if (wavesDone === 0) {
      // Seed: if we have a prior pattern, use it + small lr variants
      if (prior) {
        const base = prior.best_config
        const baseLr = base.lr ?? 0.005
        const configs: SweepConfig[] = [
          base,
          { ...base, lr: Math.max(0.001, Math.min(0.1, baseLr * 0.5)) },
          { ...base, lr: Math.max(0.001, Math.min(0.1, baseLr * 2)) },
        ]
        plan = { configs, rationale: `warm-start from prior ${prior.metric_name}=${prior.best_metric.toFixed(3)} ± lr variants`, rules_fired: ["warm_start"], source: "rules" as const }
      } else {
        plan = seedPlan(bundle)
      }
    } else {
      const rulesFallback = refineFromSignals(bundle)
      const autoRunNow = getAutoRun(args.auto_run_id)
      const reflection = autoRunNow?.decision_log ?? []
      plan = await runPlanner({ bundle, reflection, fallback: rulesFallback, signal: ac.signal })
    }

    log(args.auto_run_id, `sweep_wave_${wavesDone + 1}_plan`, plan.rationale, {
      source: plan.source,
      configs: plan.configs,
      rules_fired: plan.rules_fired,
    })

    recordEvent({
      source: "mcp",
      kind: "auto_wave_started",
      taskId: args.task_id,
      payload: { auto_run_id: args.auto_run_id, wave: wavesDone + 1, configs: plan.configs.length },
    })

    // Run sweep (parallel via existing sub-agent infra)
    const results = await runSweep(args.task_id, plan.configs, 3, ac.signal)
    const completedRunIds = results.filter((r) => r.status === "completed" && r.run_id != null).map((r) => r.run_id!)
    const failedCount = results.filter((r) => r.status === "failed").length
    lastWaveRunIds = completedRunIds
    allRunIds.push(...completedRunIds)
    wavesDone += 1

    // Collect signals for THIS wave
    const postBundle = collectSignals({
      task_id: args.task_id,
      task_kind: args.task_kind,
      target_value: args.accuracy_target,
      current_wave_run_ids: completedRunIds,
      waves_done: wavesDone,
      budget_s: args.budget_s,
      budget_used_s: elapsed(),
      prior_best_metric: prior?.best_metric ?? null,
      prior_best_config: prior?.best_config ?? null,
    })
    allRunSignals.push(...postBundle.current_wave)

    const bestThisWave = postBundle.current_wave.reduce<RunSignals | null>(
      (acc, r) => (acc == null || (r.metric ?? -Infinity) > (acc.metric ?? -Infinity)) ? r : acc,
      null,
    )
    log(args.auto_run_id, `sweep_wave_${wavesDone}_done`,
      `best ${metricName}=${bestThisWave?.metric?.toFixed(3) ?? "n/a"} (${completedRunIds.length} completed, ${failedCount} failed)`,
      {
        best_run_id: bestThisWave?.run_id ?? null,
        best_metric: bestThisWave?.metric ?? null,
        overfit_gap: bestThisWave?.overfit_gap ?? null,
        still_improving: bestThisWave?.still_improving ?? null,
        completed: completedRunIds.length,
        failed: failedCount,
      })

    recordEvent({
      source: "mcp",
      kind: "auto_wave_completed",
      taskId: args.task_id,
      payload: {
        auto_run_id: args.auto_run_id,
        wave: wavesDone,
        best_run_id: bestThisWave?.run_id ?? null,
        best_metric: bestThisWave?.metric ?? null,
      },
    })

    // Update waves_used on the auto_run row eagerly for cross-process polling
    updateAutoRun(args.auto_run_id, { waves_used: wavesDone })

    // Early stop if target hit
    if (bestThisWave?.metric != null && bestThisWave.metric >= args.accuracy_target) {
      log(args.auto_run_id, "target_reached", `${metricName}=${bestThisWave.metric.toFixed(3)} ≥ ${args.accuracy_target}`)
      break
    }
  }

  clearTimeout(budgetTimer)

  // Step 4: pick overall winner
  const score = isRegression ? scoreRegression : scoreClassification
  const winner = allRunSignals.reduce<RunSignals | null>(
    (acc, r) => (acc == null || score(r) > score(acc)) ? r : acc,
    null,
  )

  const isOverfit = winner !== null
    && !isRegression
    && winner.accuracy !== null
    && winner.val_accuracy !== null
    && (winner.accuracy - winner.val_accuracy) > 0.15

  const confidence: "high" | "low" = winner !== null
    && ((winner.val_accuracy !== null || isRegression) && !isOverfit)
    ? "high" : "low"

  const winnerMetric = winner ? score(winner) : null

  log(args.auto_run_id, "winner_selection",
    winner
      ? `run ${winner.run_id} score=${winnerMetric?.toFixed(3)} (raw ${metricName}=${winner.metric?.toFixed(3)}, overfit=${isOverfit})`
      : "no completed runs",
    { winner_run_id: winner?.run_id ?? null, score: winnerMetric, is_overfit: isOverfit })

  // Step 5: final status + verdict
  let status: VerdictStatus
  const nextSteps: string[] = []
  if (budgetExpired) {
    status = "budget_exceeded"
    nextSteps.push("re-run with a larger budget_s")
  } else if (winner == null) {
    status = "failed"
    nextSteps.push("all sweep configs failed — check logs and task data")
  } else if (winnerMetric != null && winnerMetric >= args.accuracy_target) {
    status = "completed"
  } else {
    status = "no_improvement"
    if (!isRegression && winner.per_class_variance != null && winner.per_class_variance > 0.03) {
      nextSteps.push("class accuracy variance is high — collect more samples for weak classes (suggest_samples)")
    }
    if (data.imbalance_ratio != null && data.imbalance_ratio > 3 && winner.config.class_weights !== "balanced") {
      nextSteps.push("imbalance remains: try class_weights=\"balanced\" or collect more minority-class data")
    }
    if (isOverfit) {
      nextSteps.push("best run is overfitting — try smaller head_arch or more training data")
    }
    if (nextSteps.length === 0) nextSteps.push("raise max_waves or budget_s; consider collecting more data")
  }

  // Step 6: promote + publish
  let publishedUri: string | undefined
  if (status === "completed" && args.promote && winner?.run_id != null) {
    registerModel(args.task_id, winner.run_id)
    log(args.auto_run_id, "promote", `registered run ${winner.run_id} as active model`)
    recordEvent({ source: "mcp", kind: "model_registered", taskId: args.task_id, runId: winner.run_id, payload: { via: "auto_train" } })

    if (args.publish_name) {
      try {
        const pub = await publishHandler({
          run_id: winner.run_id,
          name: args.publish_name,
          version: args.publish_version,
        } as Parameters<typeof publishHandler>[0])
        publishedUri = (pub as { uri?: string }).uri
        log(args.auto_run_id, "publish", `published as ${publishedUri}`)
      } catch (e) {
        log(args.auto_run_id, "publish_failed", String(e))
      }
    }
  }

  // Step 7: save pattern on success
  if (status === "completed" && winner?.run_id != null && winnerMetric != null) {
    savePattern({
      task_fingerprint: fingerprint,
      task_id: args.task_id,
      data,
      best_config: winner.config,
      best_metric: winnerMetric,
      metric_name: metricName,
    })
    log(args.auto_run_id, "pattern_saved", `fingerprint=${fingerprint}`)
  }

  // Step 8: persist verdict
  const verdict: StructuredVerdict = {
    status,
    winner: {
      run_id: winner?.run_id ?? null,
      metric_value: winnerMetric,
      metric_name: metricName,
      is_overfit: isOverfit,
      confidence,
      config: winner?.config ?? null,
    },
    attempted: {
      configs_tried: allRunIds.length,
      waves_used: wavesDone,
      wall_clock_s: elapsed(),
    },
    data_issues: data.warnings,
    next_steps: nextSteps,
    summary: status === "completed"
      ? `target reached: ${metricName}=${winnerMetric?.toFixed(3)} on run ${winner?.run_id}`
      : status === "budget_exceeded"
        ? `budget exceeded (${elapsed()}s)`
        : status === "no_improvement"
          ? `best ${metricName}=${winnerMetric?.toFixed(3) ?? "n/a"} < target ${args.accuracy_target}`
          : "no completed runs",
  }
  saveVerdictJson(args.auto_run_id, verdict)
  const oneLiner = verdictSummaryOneLiner(verdict)

  updateAutoRun(args.auto_run_id, {
    status,
    finished_at: new Date().toISOString(),
    winner_run_id: winner?.run_id ?? undefined,
    final_accuracy: winnerMetric ?? undefined,
    waves_used: wavesDone,
    verdict: oneLiner,
  })

  return {
    status,
    run_id: winner?.run_id ?? null,
    accuracy: winnerMetric,
    waves_used: wavesDone,
    verdict: oneLiner,
    verdict_json: verdict,
    published_uri: publishedUri,
    wall_clock_s: elapsed(),
  }
}
