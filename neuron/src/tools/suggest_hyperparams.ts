import { z } from "zod"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { getTask } from "../core/db/tasks"
import { sampleCounts } from "../core/db/samples"
import { requestSampling, SamplingNotSupportedError } from "../core/sampling"
import { loadConfig } from "../adapter/loader"

export const name = "suggest_hyperparams"
export const description =
  "Ask Claude (via MCP Sampling) to recommend hyperparameters for a task. " +
  "Post-Phase-3: optimizer/activation/lr_schedule/loss/batch_size/weight_decay/" +
  "early_stop_patience/label_smoothing are all recommendable. Falls back to " +
  "sensible heuristics when Sampling is unavailable."

export const schema = {
  task_id: z.string().describe("Task ID"),
  data_health: z
    .object({
      imbalance_ratio: z.number().optional().describe("max_class_count / min_class_count — if > 3, flag class_weights=\"balanced\""),
      warnings: z.array(z.string()).optional().describe("Pre-computed data-health warnings (e.g. constant features, scale issues)"),
    })
    .optional()
    .describe("Optional data-health signals from inspect_data. Improves suggestion quality when provided."),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>, ctx: { server: Server }) {
  const task = getTask(args.task_id)
  if (!task) throw new Error(`Task "${args.task_id}" not found`)

  const counts = sampleCounts(args.task_id)
  const N = Object.values(counts).reduce((a, b) => a + b, 0)
  const K = Object.keys(counts).length
  const D = task.featureShape[0] ?? 1
  const isRegression = task.kind === "regression"

  const config = await loadConfig()
  const configArch: number[] | null = config?.headArchitecture ? config.headArchitecture(K, D) : null

  const imbalance = args.data_health?.imbalance_ratio
  const healthWarnings = args.data_health?.warnings ?? []
  const isImbalanced = imbalance != null && imbalance > 3
  const dataHealthSection = args.data_health
    ? `Data health:
- imbalance_ratio: ${imbalance ?? "n/a"}${isImbalanced ? " (SEVERE — recommend class_weights=\"balanced\")" : ""}
- warnings: ${healthWarnings.length ? healthWarnings.join("; ") : "none"}
`
    : ""

  const prompt = `You are an ML engineering assistant. Recommend hyperparameters for this task.

Task: "${args.task_id}" (${task.kind})
${isRegression ? "Output dim: 1 (regression — single scalar target)" : `Classes (K): ${K}`}
Total samples (N): ${N}
Feature dim (D): ${D}
${isRegression ? "" : `Counts: ${JSON.stringify(counts)}`}
${dataHealthSection}${configArch ? `neuron.config.ts headArchitecture: [${configArch.join(", ")}] — use this exact architecture.` : ""}

Backend: rs-tensor MLP trainer (post-Phase-3). All of these levers are available:

OPTIMIZER: "sgd" | "adam" | "adamw"
  - adamw recommended for classification + most regression (good default)
  - sgd OK for tiny datasets (N < 50) or when deterministic simplicity matters
ACTIVATION: "tanh" | "relu" | "gelu" | "leaky_relu"
  - relu default for modern deep nets; gelu for slightly better generalization
  - tanh only for small/shallow networks
LR_SCHEDULE: "constant" | "cosine" | "linear_warmup"
  - cosine is the strong default when epochs >= 200
  - linear_warmup with warmup_epochs≈5% helps large LRs
LOSS (classification): "cross_entropy" | "mse"
  - cross_entropy is almost always correct for classification (use this)
  - mse only if you have a specific reason
BATCH_SIZE: 8-128 typical, or omit for full-batch (use omit when N < 50)
WEIGHT_DECAY: 0.0-0.1 (AdamW standard: 0.01; SGD standard: 0 or 5e-4)
GRAD_CLIP: 1.0 typical for RNN-style; usually skip for plain MLP
EARLY_STOP_PATIENCE: 20-50 epochs (skip if epochs < 200)
LABEL_SMOOTHING (classification only): 0.0-0.2 (0.1 is standard with cross_entropy)
SWA: boolean (Stochastic Weight Averaging — enable when epochs >= 200)
CLASS_WEIGHTS (classification): "balanced" | null (use "balanced" if imbalance_ratio > 3)

LR range: 0.001-0.1. Epochs range: 50-3000.
Typical starting points for a new task:
  - Modern default: AdamW + ReLU + cosine + cross_entropy + weight_decay=0.01 + label_smoothing=0.1
  - Small N (< 50): SGD + tanh + MSE (simpler, less variance)

Respond as STRICT JSON and nothing else:
{
  "lr": <number 0.001-0.1>,
  "epochs": <number 50-3000>,
  "head_arch": ${configArch ? JSON.stringify(configArch) : "[D, ...hidden..., K]"},
  "optimizer": <"sgd" | "adam" | "adamw">,
  "activation": <"tanh" | "relu" | "gelu" | "leaky_relu">,
  "lr_schedule": <"constant" | "cosine" | "linear_warmup">,
  "loss": <"cross_entropy" | "mse">,
  "batch_size": <number | null — null = full-batch>,
  "weight_decay": <number 0.0-0.1>,
  "early_stop_patience": <number | null>,
  "label_smoothing": <number 0.0-0.2 | null — null for regression>,
  "swa": <boolean>,
  "class_weights": <"balanced" | null>,
  "reasoning": "<2-3 sentence explanation of the key choices>"
}`

  let parsed: Record<string, unknown>
  try {
    const result = await requestSampling(ctx.server, {
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens: 512,
    })
    try { parsed = JSON.parse(result.text) as Record<string, unknown> }
    catch {
      // Try to extract the JSON block from surrounding prose
      const match = result.text.match(/\{[\s\S]*"lr"[\s\S]*?\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) as Record<string, unknown> }
        catch { parsed = { reasoning: result.text } }
      } else {
        parsed = { reasoning: result.text }
      }
    }
    if (configArch) parsed.head_arch = configArch
  } catch (e) {
    if (e instanceof SamplingNotSupportedError) {
      parsed = modernHeuristicFallback(N, K, D, isRegression, isImbalanced, imbalance, configArch)
    } else throw e
  }

  // Defaults for any fields Claude omitted — keeps downstream callers safe.
  const defaults = modernHeuristicFallback(N, K, D, isRegression, isImbalanced, imbalance, configArch)
  return { ok: true, n: N, k: K, d: D, ...defaults, ...parsed }
}

/**
 * Post-Phase-3 heuristic fallback. Picks a modern config for any dataset
 * with N ≥ 50 (AdamW + ReLU + cosine + cross_entropy for classification;
 * AdamW + ReLU + MSE for regression). Tiny datasets fall back to the
 * proven-safe SGD + tanh baseline.
 */
function modernHeuristicFallback(
  N: number,
  K: number,
  D: number,
  isRegression: boolean,
  isImbalanced: boolean,
  imbalanceRatio: number | undefined,
  configArch: number[] | null,
): Record<string, unknown> {
  const tiny = N < 50
  const lr = tiny ? 0.05 : N < 200 ? 0.01 : 0.005
  const epochs = tiny ? 1000 : N < 200 ? 600 : 400
  const head_arch = configArch ?? [D, Math.max(D, 32), isRegression ? 1 : K]
  const modernBatch = tiny ? null : Math.max(8, Math.min(64, Math.floor(N / 8)))

  const choice = tiny
    ? {
        optimizer: "sgd" as const,
        activation: "tanh" as const,
        lr_schedule: "constant" as const,
        loss: (isRegression ? "mse" : "cross_entropy") as "mse" | "cross_entropy",
        batch_size: null,
        weight_decay: 0,
        early_stop_patience: null,
        label_smoothing: null,
        swa: false,
      }
    : {
        optimizer: "adamw" as const,
        activation: "relu" as const,
        lr_schedule: "cosine" as const,
        loss: (isRegression ? "mse" : "cross_entropy") as "mse" | "cross_entropy",
        batch_size: modernBatch,
        weight_decay: 0.01,
        early_stop_patience: epochs >= 200 ? Math.max(20, Math.round(epochs * 0.1)) : null,
        label_smoothing: isRegression ? null : 0.1,
        swa: epochs >= 200,
      }

  const class_weights = !isRegression && isImbalanced ? "balanced" : null

  return {
    lr,
    epochs,
    head_arch,
    class_weights,
    ...choice,
    reasoning: tiny
      ? `Small dataset (N=${N}) — using proven-safe SGD+tanh baseline to reduce variance. Higher LR + more epochs compensate for full-batch gradient.`
      : `Modern defaults: AdamW (L2=0.01) + ReLU + cosine LR${isRegression ? " + MSE" : " + cross-entropy"} + mini-batch=${modernBatch}${epochs >= 200 ? " + SWA" : ""}${isImbalanced ? ` + class_weights=balanced (imbalance=${imbalanceRatio?.toFixed(1)}×)` : ""}. Best generalization for N≥50 tabular.`,
    ...(imbalanceRatio != null ? { imbalance_ratio: imbalanceRatio } : {}),
  }
}
