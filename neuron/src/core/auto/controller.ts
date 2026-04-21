import { recordEvent } from "../db/events"
import { appendAutoLog, getAutoRun, updateAutoRun, type AutoLogEntry } from "../db/auto"
import { runSweep } from "../sweep/orchestrator"
import { runSweepSequential } from "../sweep/sequential"
import type { SweepConfig } from "../sweep/configs"
import { collectSignals, computeDataHealth, type RunSignals } from "./signals"
import { refineFromSignals, shouldContinue } from "./rules"
import { runPlanner, runTournament, seedPlan } from "./planner"
import { tpePlan } from "./tpe_adapter"
import { lookupBestPattern, savePattern, taskFingerprint } from "./patterns"
import { recordRulesFired, recordRulesProducedWinner, formatRuleStatsForPrompt } from "./rule-stats"
import { runDiagnoser, shouldDiagnose } from "./diagnoser"
import { getRun } from "../db/runs"
import { getTask } from "../db/tasks"
import { loadConfig } from "../../adapter/loader"
import {
  saveVerdictJson,
  verdictSummaryOneLiner,
  scoreClassification,
  scoreRegression,
  type StructuredVerdict,
  type VerdictStatus,
} from "./verdict"
import { registerModel } from "../db/models"
import { handler as publishHandler } from "../../tools/publish_model"
import { handler as calibrateHandler } from "../../tools/calibrate"
import {
  registerController, deregisterController, trackChildRun,
} from "./registry"
import { forceCancelRun } from "../db/runs"

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
  tournament?: boolean
  seed?: number
  auto_collect?: boolean
  max_collect_rounds?: number
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

  // Phase 10.6: register in the in-process coordinator registry so external
  // callers (cancel_auto_train tool, cancel_training(force), etc.) can abort us.
  const registryEntry = registerController({
    autoRunId: args.auto_run_id,
    taskId: args.task_id,
    abortController: ac,
  })

  try {
    return await runControllerBody(args, ac, t0, budgetTimer, () => budgetExpired, registryEntry)
  } finally {
    clearTimeout(budgetTimer)
    deregisterController(args.auto_run_id)
  }
}

async function runControllerBody(
  args: ControllerArgs,
  ac: AbortController,
  t0: number,
  budgetTimer: ReturnType<typeof setTimeout>,
  isBudgetExpired: () => boolean,
  registryEntry: { childRunIds: Set<number> },
): Promise<ControllerResult> {

  const elapsed = () => Math.round((Date.now() - t0) / 1000)
  const isRegression = args.task_kind === "regression"
  const metricName: "accuracy" | "r2" = isRegression ? "r2" : "accuracy"
  const waveDurationsS: number[] = []

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
  // Map each completed run id back to the rules that produced its wave.
  // Used to attribute "produced_winner" credit to the right rules after winner selection.
  const runIdToRules = new Map<number, string[]>()

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
        plan = {
          configs,
          rationale: `warm-start from prior ${prior.metric_name}=${prior.best_metric.toFixed(3)} ± lr variants`,
          rules_fired: ["warm_start"],
          rule_explanations: [
            {
              name: "warm_start",
              title: "Warm-start from a similar past task",
              why: "We've seen a task with this same shape before (same N/K/D bucket + imbalance). Its winning config is usually a strong starting point, so we try it plus two LR variants at 0.5× and 2×.",
              evidence: [
                `prior best: ${prior.metric_name}=${prior.best_metric.toFixed(3)}`,
                `fingerprint: ${fingerprint}`,
              ],
            },
          ],
          source: "rules" as const,
        }
      } else {
        plan = seedPlan(bundle)
      }
    } else if (wavesDone >= 2 && allRunSignals.length >= 3) {
      // Hand off to TPE once rules + planner have had two passes and we have
      // enough observations to do surrogate-style search. Rules still produce
      // a fallback list in case TPE returns unusable configs.
      const fallback = refineFromSignals(bundle)
      const tpe = tpePlan(allRunSignals, 3, args.seed)
      // Sanity-check TPE configs — if any are out of range, fall back to rules.
      const safeTpe = tpe.configs.every(
        (c) => (c.lr ?? 0) >= 0.001 && (c.lr ?? 0) <= 0.1 && (c.epochs ?? 0) >= 50,
      )
      plan = safeTpe ? tpe : { ...fallback, source: "rules" as const }
    } else {
      const rulesFallback = refineFromSignals(bundle)
      // NEURON_PLANNER=rules forces deterministic rules-only mode (used by benchmarks).
      // Skips the Claude planner entirely so repeated runs produce identical output.
      if (process.env.NEURON_PLANNER === "rules") {
        plan = { ...rulesFallback, source: "rules" as const }
      } else {
        const autoRunNow = getAutoRun(args.auto_run_id)
        const reflection = autoRunNow?.decision_log ?? []
        const ruleStatsText = formatRuleStatsForPrompt(fingerprint)
        plan = args.tournament
          ? await runTournament({ bundle, reflection, fallback: rulesFallback, ruleStatsText, signal: ac.signal })
          : await runPlanner({ bundle, reflection, fallback: rulesFallback, ruleStatsText, signal: ac.signal })
      }
    }

    log(args.auto_run_id, `sweep_wave_${wavesDone + 1}_plan`, plan.rationale, {
      source: plan.source,
      configs: plan.configs,
      rules_fired: plan.rules_fired,
      rule_explanations: plan.rule_explanations ?? [],
    })

    // Rule-effectiveness: every rule that fired this wave gets a fired_count bump.
    recordRulesFired(plan.rules_fired, fingerprint)

    recordEvent({
      source: "mcp",
      kind: "auto_wave_started",
      taskId: args.task_id,
      payload: {
        auto_run_id: args.auto_run_id,
        wave: wavesDone + 1,
        configs: plan.configs.length,
        strategy: plan.source,
        elapsed_s: elapsed(),
      },
    })

    // Run sweep — sequential for benchmarks/CI (no Claude sub-agents),
    // parallel via existing sub-agent infra otherwise.
    const waveT0 = Date.now()
    const results = process.env.NEURON_SWEEP_MODE === "sequential"
      ? await runSweepSequential(args.task_id, plan.configs, ac.signal)
      : await runSweep(args.task_id, plan.configs, 3, ac.signal)
    waveDurationsS.push(Math.round((Date.now() - waveT0) / 1000))
    const completedRunIds = results.filter((r) => r.status === "completed" && r.run_id != null).map((r) => r.run_id!)
    const failedCount = results.filter((r) => r.status === "failed").length
    lastWaveRunIds = completedRunIds
    allRunIds.push(...completedRunIds)
    wavesDone += 1
    // Track all run ids (completed or not) so a mid-wave cancel can reap them.
    for (const r of results) {
      if (r.run_id != null) trackChildRun(args.auto_run_id, r.run_id)
    }
    // Attribute this wave's rules_fired to each run it produced.
    for (const id of completedRunIds) runIdToRules.set(id, plan.rules_fired)

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

    // Partial verdict + ETA
    const bestOverallSoFar = allRunSignals.reduce<RunSignals | null>(
      (acc, r) => (acc == null || (r.metric ?? -Infinity) > (acc.metric ?? -Infinity)) ? r : acc,
      null,
    )
    const avgWaveS = waveDurationsS.reduce((a, b) => a + b, 0) / waveDurationsS.length
    const remainingWaves = Math.max(0, args.max_waves - wavesDone)
    const etaS = Math.round(avgWaveS * remainingWaves)
    const isOverfitSoFar = bestOverallSoFar != null && !isRegression
      && bestOverallSoFar.accuracy !== null && bestOverallSoFar.val_accuracy !== null
      && (bestOverallSoFar.accuracy - bestOverallSoFar.val_accuracy) > 0.15

    recordEvent({
      source: "mcp",
      kind: "auto_wave_completed",
      taskId: args.task_id,
      payload: {
        auto_run_id: args.auto_run_id,
        wave: wavesDone,
        best_run_id: bestThisWave?.run_id ?? null,
        best_metric: bestThisWave?.metric ?? null,
        best_overall_run_id: bestOverallSoFar?.run_id ?? null,
        best_overall_metric: bestOverallSoFar?.metric ?? null,
        configs_tried: allRunIds.length,
        waves_used: wavesDone,
        max_waves: args.max_waves,
        elapsed_s: elapsed(),
        eta_s: etaS,
        is_overfit: isOverfitSoFar,
        target_reached: (bestOverallSoFar?.metric ?? -Infinity) >= args.accuracy_target,
      },
    })

    // Update waves_used on the auto_run row eagerly for cross-process polling
    updateAutoRun(args.auto_run_id, { waves_used: wavesDone })

    // Diagnose if signals warrant (severity=critical or overfit_gap > 0.2).
    // Skipped on target-reached — everything's fine.
    if (bestThisWave && shouldDiagnose(bestThisWave) &&
        (bestThisWave.metric ?? -Infinity) < args.accuracy_target) {
      const fullRun = getRun(bestThisWave.run_id)
      const diagnosis = await runDiagnoser({
        bundle: postBundle,
        bestRun: bestThisWave,
        reflection: getAutoRun(args.auto_run_id)?.decision_log ?? [],
        confusionMatrix: fullRun?.confusionMatrix ?? null,
        labels: getTask(args.task_id)?.labels ?? null,
        signal: ac.signal,
      })
      log(args.auto_run_id, "diagnose",
        `${diagnosis.primary_cause} (confidence=${diagnosis.confidence}, source=${diagnosis.source})`,
        {
          primary_cause: diagnosis.primary_cause,
          evidence: diagnosis.evidence,
          recommendations: diagnosis.recommendations,
          source: diagnosis.source,
        })
    }

    // Early stop if target hit
    if (bestThisWave?.metric != null && bestThisWave.metric >= args.accuracy_target) {
      log(args.auto_run_id, "target_reached", `${metricName}=${bestThisWave.metric.toFixed(3)} ≥ ${args.accuracy_target}`)
      break
    }
  }

  clearTimeout(budgetTimer)

  // Step 3.5: active-learning auto-collect loop (opt-in, Phase 7).
  // Only fires when: flag is on, config has a collect() callback, target not hit,
  // and we have rounds remaining. Each round: suggest → collect → insert → 1 wave.
  if (args.auto_collect && !isRegression) {
    const config = await loadConfig()
    if (typeof config?.collect === "function") {
      const maxRounds = args.max_collect_rounds ?? 2
      const { handler: suggestHandler } = await import("../../tools/suggest_samples")
      const { insertSamplesBatch } = await import("../db/samples")

      for (let round = 0; round < maxRounds && !ac.signal.aborted; round++) {
        // Check if we've already hit target.
        const bestSoFar = allRunSignals.reduce<RunSignals | null>(
          (acc, r) => (acc == null || (r.metric ?? -Infinity) > (acc.metric ?? -Infinity)) ? r : acc,
          null,
        )
        if ((bestSoFar?.metric ?? -Infinity) >= args.accuracy_target) {
          log(args.auto_run_id, "auto_collect_skip", `target reached at round ${round}; stopping`)
          break
        }

        log(args.auto_run_id, "auto_collect_start", `round ${round + 1}/${maxRounds}`)
        recordEvent({
          source: "mcp", kind: "auto_collect_start", taskId: args.task_id,
          payload: { auto_run_id: args.auto_run_id, round: round + 1 },
        })

        // 1. Ask for uncertain+diverse samples (active learning).
        let suggestion: Awaited<ReturnType<typeof suggestHandler>> & Record<string, unknown>
        try {
          suggestion = await suggestHandler({
            task_id: args.task_id, n_suggestions: 10, confidence_threshold: 0.7,
          }) as Awaited<ReturnType<typeof suggestHandler>> & Record<string, unknown>
        } catch (e) {
          log(args.auto_run_id, "auto_collect_failed", `suggest_samples error: ${e instanceof Error ? e.message : String(e)}`)
          break
        }

        // 2. Invoke the user's collect callback.
        let collected: Array<{ label: string; features: number[]; raw?: unknown }>
        try {
          collected = await config.collect({
            uncertain_samples: (suggestion.uncertain_samples ?? []) as Array<{
              sample_id: number; true_label: string; predicted_label: string
              confidence: number; features: number[]
            }>,
            recommendations: (suggestion.recommendations ?? []) as string[],
            per_class: (suggestion.per_class ?? []) as Array<{ label: string; count: number; accuracy: number }>,
          })
        } catch (e) {
          log(args.auto_run_id, "auto_collect_failed", `collect() error: ${e instanceof Error ? e.message : String(e)}`)
          break
        }

        if (collected.length === 0) {
          log(args.auto_run_id, "auto_collect_empty", `round ${round + 1}: collect() returned 0 samples; stopping`)
          break
        }

        // 3. Insert into the DB as train samples.
        insertSamplesBatch(collected.map((s) => ({
          taskId: args.task_id, label: s.label, features: s.features,
          raw: s.raw, split: "train",
        })))
        log(args.auto_run_id, "auto_collect_added", `+${collected.length} samples`)
        recordEvent({
          source: "mcp", kind: "auto_collect_added", taskId: args.task_id,
          payload: { auto_run_id: args.auto_run_id, round: round + 1, added: collected.length },
        })

        // 4. Run ONE more refinement wave on the augmented data.
        const bundle = collectSignals({
          task_id: args.task_id,
          task_kind: args.task_kind,
          target_value: args.accuracy_target,
          current_wave_run_ids: lastWaveRunIds,
          waves_done: wavesDone,
          budget_s: args.budget_s,
          budget_used_s: elapsed(),
        })
        const extraPlan = refineFromSignals(bundle)
        recordRulesFired(extraPlan.rules_fired, fingerprint)
        const extraResults = process.env.NEURON_SWEEP_MODE === "sequential"
          ? await runSweepSequential(args.task_id, extraPlan.configs, ac.signal)
          : await runSweep(args.task_id, extraPlan.configs, 3, ac.signal)
        const extraCompletedIds = extraResults
          .filter((r) => r.status === "completed" && r.run_id != null)
          .map((r) => r.run_id!)
        for (const id of extraCompletedIds) runIdToRules.set(id, extraPlan.rules_fired)
        allRunIds.push(...extraCompletedIds)
        for (const r of extraResults) {
          if (r.run_id != null) trackChildRun(args.auto_run_id, r.run_id)
        }

        const extraBundle = collectSignals({
          task_id: args.task_id,
          task_kind: args.task_kind,
          target_value: args.accuracy_target,
          current_wave_run_ids: extraCompletedIds,
          waves_done: wavesDone,
          budget_s: args.budget_s,
          budget_used_s: elapsed(),
        })
        allRunSignals.push(...extraBundle.current_wave)
        lastWaveRunIds = extraCompletedIds

        const bestAfter = extraBundle.current_wave.reduce<RunSignals | null>(
          (acc, r) => (acc == null || (r.metric ?? -Infinity) > (acc.metric ?? -Infinity)) ? r : acc,
          null,
        )
        log(args.auto_run_id, "auto_collect_round_done",
          `round ${round + 1}: best ${metricName}=${bestAfter?.metric?.toFixed(3) ?? "n/a"}`)
      }
    } else {
      log(args.auto_run_id, "auto_collect_no_callback",
        "auto_collect=true but neuron.config.ts has no `collect` callback; skipping")
    }
  }

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

  // Structured reasoning for the "why this run won" UI.
  const why_winner: string[] = []
  const runners_up: Array<{ run_id: number; metric: number | null; score: number | null; reason_not_winner: string }> = []

  if (winner != null) {
    why_winner.push(
      isRegression
        ? `R² = ${winner.metric?.toFixed(3) ?? "n/a"} (highest across ${allRunSignals.length} runs)`
        : `val accuracy = ${winner.val_accuracy?.toFixed(3) ?? winner.accuracy?.toFixed(3) ?? "n/a"} (best across ${allRunSignals.length} runs)`,
    )
    if (!isOverfit) {
      why_winner.push("train/val gap is healthy — not overfitting")
    } else {
      why_winner.push(
        `note: train/val gap is ${((winner.accuracy ?? 0) - (winner.val_accuracy ?? 0)).toFixed(3)} — still the best score, but the gap suggests this run is overfitting`,
      )
    }
    if (winner.val_accuracy != null || isRegression) {
      why_winner.push("score is based on held-out data, so confidence is high")
    } else {
      why_winner.push("no validation split was available, so score is based on training data — confidence is low")
    }

    // Runners-up: every other run, sorted by score desc, with a short reason why each lost.
    const others = allRunSignals
      .filter((r) => r.run_id !== winner.run_id)
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => b.s - a.s)
    for (const { r, s } of others.slice(0, 5)) {
      const gap = (winnerMetric ?? 0) - s
      let reason = `score ${s.toFixed(3)} vs winner ${winnerMetric?.toFixed(3) ?? "n/a"} (gap ${gap.toFixed(3)})`
      if (r.accuracy != null && r.val_accuracy != null && (r.accuracy - r.val_accuracy) > 0.15) {
        reason = `overfitting (train/val gap ${(r.accuracy - r.val_accuracy).toFixed(3)}) — penalty applied`
      } else if (r.metric == null) {
        reason = "run failed to produce a metric"
      } else if (r.severity === "critical") {
        reason = `metric ${r.metric_name}=${r.metric.toFixed(3)} far below target`
      }
      runners_up.push({ run_id: r.run_id, metric: r.metric, score: s, reason_not_winner: reason })
    }
  } else {
    why_winner.push("no run produced a completed metric — every sweep config failed or was cancelled")
  }

  log(args.auto_run_id, "winner_selection",
    winner
      ? `run ${winner.run_id} score=${winnerMetric?.toFixed(3)} (raw ${metricName}=${winner.metric?.toFixed(3)}, overfit=${isOverfit})`
      : "no completed runs",
    {
      winner_run_id: winner?.run_id ?? null,
      score: winnerMetric,
      is_overfit: isOverfit,
      confidence,
      reasoning: { why_winner, runners_up },
    })

  // Rule-effectiveness: credit the winner's rules with a produced_winner bump.
  if (winner?.run_id != null) {
    const winnerRules = runIdToRules.get(winner.run_id) ?? []
    if (winnerRules.length > 0) recordRulesProducedWinner(winnerRules, fingerprint)
  }

  // Step 5: final status + verdict
  let status: VerdictStatus
  const nextSteps: string[] = []
  // Cancellation (external abort that is NOT the budget timer) takes precedence
  // over everything else — the caller explicitly asked us to stop.
  if (ac.signal.aborted && !isBudgetExpired()) {
    status = "cancelled"
    nextSteps.push("auto_train was cancelled before completing — re-run to continue")
  } else if (isBudgetExpired()) {
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

    // Calibrate confidence via temperature scaling when the task is classification
    // AND we have a val split — otherwise the tool is a no-op.
    if (!isRegression) {
      try {
        const calib = await calibrateHandler({ run_id: winner.run_id } as Parameters<typeof calibrateHandler>[0]) as {
          ok: boolean; temperature?: number; ece_before?: number; ece_after?: number; reason?: string
        }
        if (calib.ok) {
          log(args.auto_run_id, "calibrate",
            `T=${calib.temperature?.toFixed(3)}, ECE ${calib.ece_before?.toFixed(4)} → ${calib.ece_after?.toFixed(4)}`,
            { temperature: calib.temperature, ece_before: calib.ece_before, ece_after: calib.ece_after })
        } else {
          log(args.auto_run_id, "calibrate_skipped", calib.reason ?? "no reason")
        }
      } catch (e) {
        log(args.auto_run_id, "calibrate_failed", String(e))
      }
    }

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
        : status === "cancelled"
          ? `cancelled by operator after ${wavesDone} wave(s), ${allRunIds.length} run(s)`
          : status === "no_improvement"
            ? `best ${metricName}=${winnerMetric?.toFixed(3) ?? "n/a"} < target ${args.accuracy_target}`
            : "no completed runs",
  }

  // Reap any child runs still marked as running in the DB. This covers two cases:
  //   1. Cancelled mid-wave — sub-agents that were spawning/in-flight never wrote a terminal status.
  //   2. Budget timer fired mid-wave — same problem.
  // Safe to call on every exit path because forceCancelRun no-ops on already-terminal rows.
  if (status === "cancelled" || status === "budget_exceeded" || status === "failed") {
    const reapedIds: number[] = []
    for (const childId of registryEntry.childRunIds) {
      if (forceCancelRun(childId, "cancelled")) reapedIds.push(childId)
    }
    if (reapedIds.length > 0) {
      log(args.auto_run_id, "cancel_reaped", `reaped ${reapedIds.length} in-flight run(s)`, { run_ids: reapedIds })
    }
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
