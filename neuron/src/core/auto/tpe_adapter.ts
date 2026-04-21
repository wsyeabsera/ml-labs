import type { SweepConfig } from "../sweep/configs"
import type { RunSignals } from "./signals"
import { suggestTpeBatch, type TpeObservation, type TpeParamSpec } from "./tpe"
import type { PlannerPlan } from "./planner"

const TPE_SPACE: TpeParamSpec = {
  lr: { kind: "log_uniform", min: 0.001, max: 0.1 },
  epochs: { kind: "int_uniform", min: 100, max: 2000 },
  optimizer: { kind: "categorical", choices: ["sgd", "adam", "adamw"] as const },
}

/**
 * Feed the controller's accumulated RunSignals to TPE as observations.
 * Score = the primary metric (val_accuracy for classification, r² for regression).
 */
function runsToObservations(runs: RunSignals[]): TpeObservation[] {
  const obs: TpeObservation[] = []
  for (const r of runs) {
    if (r.metric == null) continue
    const config: Record<string, number | string> = {}
    if (r.config.lr !== undefined) config.lr = r.config.lr
    if (r.config.epochs !== undefined) config.epochs = r.config.epochs
    if (r.config.optimizer !== undefined) config.optimizer = r.config.optimizer
    if (Object.keys(config).length > 0) {
      obs.push({ config, score: r.metric })
    }
  }
  return obs
}

/**
 * Produce a TPE-driven wave of configs. Non-varied fields (head_arch, loss,
 * activation, class_weights, weight_decay, etc.) are copied from the best
 * historical run so we don't lose the wins from the modern seed.
 */
export function tpePlan(
  history: RunSignals[],
  n: number,
  seed: number | undefined,
): PlannerPlan {
  const observations = runsToObservations(history)

  // Pick the best prior run to inherit non-TPE fields (activation, loss, etc.).
  const bestPrior = history.reduce<RunSignals | null>(
    (acc, r) => (acc == null || (r.metric ?? -Infinity) > (acc.metric ?? -Infinity) ? r : acc),
    null,
  )
  const baseConfig: SweepConfig = {
    head_arch: bestPrior?.config.head_arch,
    activation: bestPrior?.config.activation,
    loss: bestPrior?.config.loss,
    class_weights: bestPrior?.config.class_weights,
    weight_decay: bestPrior?.config.weight_decay,
    lr_schedule: bestPrior?.config.lr_schedule,
    early_stop_patience: bestPrior?.config.early_stop_patience,
  }

  const raw = suggestTpeBatch(TPE_SPACE, observations, n, { seed })
  const configs: SweepConfig[] = raw.map((c) => ({
    ...baseConfig,
    lr: c.lr as number,
    epochs: c.epochs as number,
    optimizer: c.optimizer as "sgd" | "adam" | "adamw",
  }))

  return {
    configs,
    rationale: `TPE with ${observations.length} prior observations; inheriting arch/activation/loss from best historical run`,
    rules_fired: ["tpe"],
    rule_explanations: [
      {
        name: "tpe",
        title: "Tree-structured Parzen Estimator (TPE)",
        why: "TPE is a Bayesian optimizer that models the distributions of good vs bad hyperparameter values from past runs, then samples new configs that are more likely to be good. It takes over once we have enough history for its model to be meaningful.",
        evidence: [
          `${observations.length} prior observations feeding the model`,
          bestPrior
            ? `inheriting arch/activation/loss from prior best (${bestPrior.metric_name}=${bestPrior.metric?.toFixed(3) ?? "?"})`
            : "no prior best — starting cold",
        ],
      },
    ],
    source: "tpe",
  }
}
