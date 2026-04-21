import { query } from "@anthropic-ai/claude-agent-sdk"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { RunSignals, SignalBundle } from "./signals"
import type { AutoLogEntry } from "../db/auto"

const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../server.ts")

const DIAGNOSER_SYSTEM_PROMPT = `You are a root-cause diagnoser for ML training runs on the Neuron platform.

OUTPUT CONTRACT — strict JSON, nothing else:
{
  "primary_cause": "overfitting" | "underfitting" | "truncated_training" | "class_imbalance" | "label_noise" | "feature_issue" | "lr_too_high" | "lr_too_low" | "optimizer_mismatch" | "other",
  "evidence": ["<concrete numeric observation>", "..."],
  "recommendations": ["<specific next action>", "..."],
  "confidence": "high" | "low"
}

How to read the loss-curve sample (when provided):
- Smooth monotonic decrease → normal training, check if "still_improving" is true
- Plateau at moderate loss → likely lr_too_low or underfitting
- Spike or jump to inf/NaN mid-training → lr_too_high or grad_clip needed
- Sawtooth / oscillation → lr_too_high or batch_size too small
- Gap between early convergence and persistent final value → saddle point

HARDWARE CONTEXT:
- CPU-only rs-tensor backend. Avoid recommendations requiring > 1M params.
- LR range 0.001-0.1; epochs 50-3000.

Recommendations must be concrete and actionable (e.g. "try lr=0.003 with cosine schedule" beats "reduce learning rate").`

export interface Diagnosis {
  primary_cause: string
  evidence: string[]
  recommendations: string[]
  confidence: "high" | "low"
  source: "claude" | "rules"
}

/**
 * When a wave produces a bad or overfit run, invoke the diagnoser for a
 * structured root-cause analysis. Only called on `severity === "critical"`
 * OR `overfit_gap > 0.2` — healthy waves skip this entirely.
 */
export function shouldDiagnose(bestRun: RunSignals | null): boolean {
  if (!bestRun) return false
  if (bestRun.severity === "critical") return true
  if (bestRun.overfit_gap !== null && bestRun.overfit_gap > 0.2) return true
  return false
}

/** Top-N confused pairs from a confusion matrix: [(true_label, pred_label, count), ...]. */
function topConfusedPairs(
  matrix: number[][] | null,
  labels: string[] | null,
  n = 3,
): Array<{ true_label: string; pred_label: string; count: number }> {
  if (!matrix || !labels) return []
  const pairs: Array<{ true_label: string; pred_label: string; count: number }> = []
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      if (i === j) continue
      const count = matrix[i]![j]!
      if (count > 0) {
        pairs.push({ true_label: labels[i] ?? `#${i}`, pred_label: labels[j] ?? `#${j}`, count })
      }
    }
  }
  return pairs.sort((a, b) => b.count - a.count).slice(0, n)
}

function rulesFallback(bundle: SignalBundle, best: RunSignals): Diagnosis {
  // Pure-TS fallback when Claude is unavailable or parse fails.
  const ev: string[] = []
  const rec: string[] = []
  let primary = "unknown"

  if (best.overfit_gap !== null && best.overfit_gap > 0.2) {
    primary = "overfitting"
    ev.push(`train-val gap = ${best.overfit_gap.toFixed(3)}`)
    rec.push("reduce head capacity", "add weight_decay", "enable early stopping")
  } else if (best.severity === "critical" && (best.overfit_gap ?? 0) <= 0.1) {
    primary = "underfitting"
    ev.push(`val ${best.metric_name}=${best.metric?.toFixed(3) ?? "n/a"} is well below target ${bundle.target.value}`)
    rec.push("widen hidden layer", "increase epochs", "try a different activation")
  } else if (best.still_improving) {
    primary = "truncated_training"
    ev.push(`loss was still decreasing at epoch ${best.epochs_requested}`)
    rec.push("train for more epochs", "raise epochs × 2 for next wave")
  } else if (bundle.data.imbalance_ratio != null && bundle.data.imbalance_ratio > 3) {
    primary = "class_imbalance"
    ev.push(`imbalance_ratio=${bundle.data.imbalance_ratio}`)
    rec.push("enable class_weights=\"balanced\"", "collect more minority-class samples")
  }
  return { primary_cause: primary, evidence: ev, recommendations: rec, confidence: "low", source: "rules" }
}

/**
 * Downsample a loss history to ~50 points via simple stride. Full history can
 * be thousands of epochs; 50 points is enough for Claude to see the shape.
 */
function sampleLossHistory(history: number[] | null | undefined, target = 50): number[] {
  if (!history || history.length === 0) return []
  if (history.length <= target) return history.map((v) => +v.toFixed(5))
  const stride = Math.max(1, Math.floor(history.length / target))
  const out: number[] = []
  for (let i = 0; i < history.length; i += stride) {
    out.push(+history[i]!.toFixed(5))
  }
  // Always include the last point so the tail is visible
  const last = history[history.length - 1]!
  if (out[out.length - 1] !== +last.toFixed(5)) out.push(+last.toFixed(5))
  return out
}

function buildDiagnoserPrompt(
  bundle: SignalBundle,
  best: RunSignals,
  reflection: AutoLogEntry[],
  confusedPairs: Array<{ true_label: string; pred_label: string; count: number }>,
  lossCurve: number[],
): string {
  const recent = reflection.slice(-8).map((e) => `  [${e.stage}] ${e.note}`).join("\n")
  const pairs = confusedPairs.length
    ? confusedPairs.map((p) => `  true="${p.true_label}" → pred="${p.pred_label}" (${p.count} samples)`).join("\n")
    : "  (n/a)"

  const lossSection = lossCurve.length > 0
    ? `\nLOSS CURVE (sampled, ${lossCurve.length} points from epoch 0 → ${best.epochs_requested ?? "end"}):\n${JSON.stringify(lossCurve)}\n`
    : ""

  return `A wave just completed with a problem signal. Identify the root cause.

BEST RUN THIS WAVE:
- run_id: ${best.run_id}
- ${best.metric_name}: ${best.metric?.toFixed(3) ?? "null"}  (target: ${bundle.target.value})
- severity: ${best.severity}
- overfit_gap: ${best.overfit_gap ?? "n/a"}
- still_improving: ${best.still_improving}
- convergence_epoch: ${best.convergence_epoch ?? "n/a"} of ${best.epochs_requested ?? "?"}
- per_class_variance: ${best.per_class_variance ?? "n/a"}
- config: ${JSON.stringify(best.config)}

DATA HEALTH:
- N=${bundle.data.n}, K=${bundle.data.k}, D=${bundle.data.d}
- imbalance_ratio: ${bundle.data.imbalance_ratio ?? "n/a"}
- warnings: ${bundle.data.warnings.join("; ") || "none"}
${lossSection}
TOP CONFUSED CLASS PAIRS:
${pairs}

RECENT DECISION LOG:
${recent || "(empty)"}

Return the strict JSON contract from your system prompt.
`
}

export async function runDiagnoser(opts: {
  bundle: SignalBundle
  bestRun: RunSignals
  reflection: AutoLogEntry[]
  confusionMatrix?: number[][] | null
  labels?: string[] | null
  lossHistory?: number[] | null
  signal?: AbortSignal
}): Promise<Diagnosis> {
  // Bypass in benchmark/rules-only mode for determinism.
  if (process.env.NEURON_PLANNER === "rules") {
    return rulesFallback(opts.bundle, opts.bestRun)
  }

  const pairs = topConfusedPairs(opts.confusionMatrix ?? null, opts.labels ?? null, 3)
  const lossCurve = sampleLossHistory(opts.lossHistory, 50)
  const prompt = buildDiagnoserPrompt(opts.bundle, opts.bestRun, opts.reflection, pairs, lossCurve)

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
        systemPrompt: DIAGNOSER_SYSTEM_PROMPT,
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
    return rulesFallback(opts.bundle, opts.bestRun)
  }

  const match = resultText.match(/\{[\s\S]*"primary_cause"[\s\S]*?\}/)
  if (!match) return rulesFallback(opts.bundle, opts.bestRun)

  try {
    const parsed = JSON.parse(match[0]) as {
      primary_cause?: string
      evidence?: string[]
      recommendations?: string[]
      confidence?: "high" | "low"
    }
    if (!parsed.primary_cause || typeof parsed.primary_cause !== "string") {
      return rulesFallback(opts.bundle, opts.bestRun)
    }
    return {
      primary_cause: parsed.primary_cause,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      confidence: parsed.confidence === "high" ? "high" : "low",
      source: "claude",
    }
  } catch {
    return rulesFallback(opts.bundle, opts.bestRun)
  }
}
