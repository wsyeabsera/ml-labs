import { query } from "@anthropic-ai/claude-agent-sdk"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { SweepConfig } from "../sweep/configs"
import type { SignalBundle } from "./signals"
import type { AutoLogEntry } from "../db/auto"
import { refineFromSignals, type RefinementPlan } from "./rules"

const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../server.ts")

export type PlannerStrategy = "balanced" | "aggressive" | "conservative" | "exploratory"

const STRATEGY_INSTRUCTIONS: Record<PlannerStrategy, string> = {
  balanced: "Use balanced judgment — weigh signals evenly, match the rule-based proposal closely unless you see a clear reason to deviate.",
  aggressive: "Prefer exploration — try higher LR (up to the 0.1 cap), wider architectures, more epochs. Accept higher variance for potential breakthrough.",
  conservative: "Prefer small, safe steps — LR variations within ±25%, regularize aggressively (weight_decay 0.01+, smaller arch, fewer epochs, early stopping). Avoid overfitting.",
  exploratory: "Prefer diversity — include atypical configs: unusual LR, mixed depths, class_weights even when imbalance is mild, deliberately different epoch counts. Cover more of the search space.",
}

export interface PlannerPlan {
  configs: SweepConfig[]
  rationale: string
  rules_fired: string[]
  source: "planner" | "rules" | "hybrid" | "tournament"
  strategy?: PlannerStrategy
}

function buildPlannerPrompt(
  bundle: SignalBundle,
  reflection: AutoLogEntry[],
  fallback: RefinementPlan,
  strategy: PlannerStrategy,
): string {
  const recent = reflection.slice(-6).map((e) => `  [${e.stage}] ${e.note}`).join("\n")
  return `You are the wave planner for the Neuron auto-trainer (strategy: ${strategy}). You only decide what hyperparameter configs to try next.

STRATEGY DIRECTIVE: ${STRATEGY_INSTRUCTIONS[strategy]}

TASK: "${bundle.task_id}" (kind=${bundle.task_kind})
TARGET: ${bundle.target.metric} ≥ ${bundle.target.value}
BUDGET: ${bundle.history.budget_used_s}s used of ${bundle.history.budget_s}s, wave ${bundle.history.waves_done + 1}

DATA HEALTH:
- N=${bundle.data.n}, K=${bundle.data.k}, D=${bundle.data.d}
- imbalance_ratio: ${bundle.data.imbalance_ratio ?? "n/a"}
- warnings: ${bundle.data.warnings.join("; ") || "none"}
- has_val_split: ${bundle.data.has_val_split}

PRIOR BEST (across tasks with same fingerprint): ${
    bundle.history.prior_best_metric != null
      ? `${bundle.history.prior_best_metric} with ${JSON.stringify(bundle.history.prior_best_config)}`
      : "no prior winners for this task fingerprint"
  }

CURRENT WAVE RESULTS (${bundle.current_wave.length} runs):
${bundle.current_wave.map((r) => `- run ${r.run_id}: ${r.metric_name}=${r.metric?.toFixed(3) ?? "null"}, overfit_gap=${r.overfit_gap ?? "n/a"}, still_improving=${r.still_improving}, converge_epoch=${r.convergence_epoch ?? "n/a"}/${r.epochs_requested ?? "?"}, severity=${r.severity}, config=${JSON.stringify(r.config)}`).join("\n") || "(no runs yet — this is the first wave)"}

RECENT DECISION LOG:
${recent || "(empty)"}

DETERMINISTIC RULE-BASED PROPOSAL (use as lower bound for quality):
${JSON.stringify(fallback.configs, null, 2)}
rules fired: ${fallback.rules_fired.join(", ")}

YOUR JOB: propose 2–4 hyperparameter configs for the next wave.

CONSTRAINTS:
- Each config is a JSON object with optional: lr (0.001–0.1), epochs (100–3000), head_arch (number[] starting with D=${bundle.data.d} and ending with K=${bundle.data.k}), class_weights ("balanced" — classification only), weight_decay (0.0–0.1, L2 regularizer), early_stop_patience (int, epochs to wait for improvement before stopping)
- You MUST return STRICTLY this JSON and nothing else:
  {"configs":[...],"rationale":"<one short sentence>","rules_fired":["name1","name2"]}
- Prefer building on the rule-based proposal if the signals are clear-cut. Deviate when the decision log suggests a pattern worth exploring.
- Max 4 configs.
`
}

export async function runPlanner(opts: {
  bundle: SignalBundle
  reflection: AutoLogEntry[]
  fallback: RefinementPlan
  strategy?: PlannerStrategy
  signal?: AbortSignal
}): Promise<PlannerPlan> {
  const strategy = opts.strategy ?? "balanced"
  const prompt = buildPlannerPrompt(opts.bundle, opts.reflection, opts.fallback, strategy)
  const ac = new AbortController()
  if (opts.signal) opts.signal.addEventListener("abort", () => ac.abort())

  let resultText = ""
  try {
    const q = query({
      prompt,
      options: {
        abortController: ac,
        tools: [],
        allowedTools: [],
        disallowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
        maxTurns: 2,
        persistSession: false,
        mcpServers: {
          neuron: {
            type: "stdio" as const,
            command: "bun",
            args: ["run", SERVER_PATH],
            env: Object.fromEntries(
              Object.entries(process.env).filter(([, v]) => v !== undefined),
            ) as Record<string, string>,
          },
        },
      },
    })
    for await (const msg of q) {
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = msg.result
      }
    }
  } catch {
    return { ...opts.fallback, source: "rules" }
  }

  const match = resultText.match(/\{[\s\S]*"configs"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/)
  if (!match) return { ...opts.fallback, source: "rules" }

  try {
    const parsed = JSON.parse(match[0]) as { configs: SweepConfig[]; rationale?: string; rules_fired?: string[] }
    const configs = (parsed.configs ?? []).slice(0, 4).filter((c): c is SweepConfig => typeof c === "object" && c !== null)
    if (configs.length === 0) return { ...opts.fallback, source: "rules" }
    // Clamp lr into safe range
    const safe = configs.map((c) => ({
      ...c,
      lr: c.lr !== undefined ? Math.max(0.001, Math.min(0.1, c.lr)) : undefined,
      epochs: c.epochs !== undefined ? Math.max(50, Math.min(3000, Math.round(c.epochs))) : undefined,
    }))
    return {
      configs: safe,
      rationale: parsed.rationale ?? "(planner)",
      rules_fired: parsed.rules_fired ?? [],
      source: "planner",
      strategy,
    }
  } catch {
    return { ...opts.fallback, source: "rules" }
  }
}

/**
 * Tournament mode: run three planners in parallel with different strategies,
 * merge and dedupe configs, return combined plan. Trades cost for robustness.
 */
export async function runTournament(opts: {
  bundle: SignalBundle
  reflection: AutoLogEntry[]
  fallback: RefinementPlan
  signal?: AbortSignal
}): Promise<PlannerPlan> {
  const strategies: PlannerStrategy[] = ["aggressive", "conservative", "exploratory"]
  const plans = await Promise.all(
    strategies.map((strategy) => runPlanner({ ...opts, strategy })),
  )

  // Merge configs, dedupe by JSON key, cap at 6 total
  const seen = new Set<string>()
  const merged: SweepConfig[] = []
  const firedAll: string[] = []
  const rationaleParts: string[] = []
  for (const p of plans) {
    rationaleParts.push(`[${p.strategy ?? "?"}] ${p.rationale}`)
    firedAll.push(...p.rules_fired.map((r) => `${p.strategy ?? "?"}:${r}`))
    for (const c of p.configs) {
      const key = JSON.stringify(c)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(c)
        if (merged.length >= 6) break
      }
    }
    if (merged.length >= 6) break
  }

  // If all planners failed, fall back to rules
  if (merged.length === 0) return { ...opts.fallback, source: "rules" }

  return {
    configs: merged,
    rationale: rationaleParts.join(" | "),
    rules_fired: firedAll,
    source: "tournament",
  }
}

/**
 * Wave 0 seed: no prior wave to reflect on → deterministic rules produce the first configs.
 */
export function seedPlan(bundle: SignalBundle): PlannerPlan {
  const rules = refineFromSignals(bundle)
  return { ...rules, source: "rules" }
}
