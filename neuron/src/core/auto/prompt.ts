export interface CoordinatorPromptArgs {
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

export function buildCoordinatorPrompt(args: CoordinatorPromptArgs): string {
  const isRegression = args.task_kind === "regression"
  const metricName = isRegression ? "R²" : "accuracy"
  const metricField = isRegression ? "r2" : "accuracy"

  const publishSection = args.publish_name
    ? `\n- If promote succeeded AND a publish_name was provided ("${args.publish_name}"), ` +
      `call mcp__neuron__publish_model with run_id=<winner_run_id>, name="${args.publish_name}"` +
      (args.publish_version ? `, version="${args.publish_version}"` : "") + `.`
    : ""

  return `You are the Neuron auto-trainer coordinator for task "${args.task_id}" (kind=${args.task_kind}, auto_run_id=${args.auto_run_id}).

BUDGET: ${args.budget_s} seconds wall clock (hard abort at ${Math.round(args.budget_s * 1.1)}s).
WAVES: at most ${args.max_waves} sweep waves.
GOAL: achieve ${metricName} ≥ ${args.accuracy_target} OR exhaust the budget/wave allowance.

TOOLS AVAILABLE:
- mcp__neuron__preflight_check, mcp__neuron__inspect_data
- mcp__neuron__suggest_hyperparams
- mcp__neuron__run_sweep, mcp__neuron__evaluate, mcp__neuron__diagnose
- mcp__neuron__get_training_curves  ← use this to detect overfitting, plateau, early convergence
- mcp__neuron__compare_runs, mcp__neuron__model_stats
${isRegression ? "" : "- mcp__neuron__suggest_samples  ← active learning: classification only, call when accuracy is below target after max waves\n"}- mcp__neuron__list_runs, mcp__neuron__get_run_status
- mcp__neuron__register_model, mcp__neuron__publish_model
- mcp__neuron__log_auto_note  ← call this after every significant decision

PROCEDURE:

1. Call mcp__neuron__preflight_check({task_id: "${args.task_id}"}).
   - If verdict is "not_ready": call log_auto_note with stage="preflight_fail", then STOP.
   - If verdict is "warning": log it, continue — include warning in final verdict.

2. Call mcp__neuron__inspect_data({task_id: "${args.task_id}"}) to capture data health signals.
   - Read back: imbalance_ratio, warnings, class_distribution, feature count.
   - Log with stage="inspect" and include {imbalance_ratio, n_warnings} in payload.

3. Call mcp__neuron__suggest_hyperparams({task_id: "${args.task_id}"${isRegression ? "" : ', data_health: {imbalance_ratio: <from step 2>}'}}).
   - Log suggestion with stage="suggest".

4. Run first sweep wave: call mcp__neuron__run_sweep with task_id="${args.task_id}",
   concurrency=3, promote_winner=false, and a configs array of 3–4 variants around the suggestion:
   - Vary lr: suggestion.lr × [0.5, 1.0, 2.0] clamped to [0.001, 0.1].
   - Keep epochs and head_arch from suggestion.
${isRegression ? "" : `   - If inspect_data.imbalance_ratio > 3, ADD one config with class_weights="balanced" at suggestion.lr.\n`}   Log with stage="sweep_wave_1", include configs in payload.

5. Find the wave_1 best run (highest ${metricName}). Call BOTH:
   - mcp__neuron__evaluate({run_id: <best>})
   - mcp__neuron__get_training_curves({run_id: <best>})
   - mcp__neuron__diagnose({run_id: <best>})
   Log with stage="evaluate_wave_1", include {${metricField}, ${isRegression ? "" : "val_accuracy, "}overfit_gap, still_improving, convergence_epoch, severity} in payload.

6. Decide on wave 2. If (diagnose.severity !== "minor" OR ${metricField} < ${args.accuracy_target})
   AND waves_used < ${args.max_waves} AND elapsed < ${args.budget_s}s, build a refinement grid
   by applying THESE SIGNAL-DRIVEN RULES (apply all that match, up to 4 configs):

   Base config = wave_1_best.hyperparams.
   Rule A — still_improving == true:
     → Add config {lr: base.lr, epochs: base.epochs × 2, head_arch: base.head_arch}
   Rule B — overfit_gap > 0.15:
     → Add config {lr: base.lr, epochs: round(base.epochs × 0.7), head_arch: shallower(base.head_arch)}
       where shallower = remove middle hidden layer if ≥ 2 hidden, else halve hidden size.
   Rule C — convergence_epoch < epochs × 0.3 (converged too fast, LR likely too big OR easy problem):
     → Add config {lr: base.lr × 0.3, epochs: base.epochs, head_arch: base.head_arch}
   Rule D — severity == "critical" AND overfit_gap ≤ 0.1 (underfitting):
     → Add config {lr: base.lr, epochs: base.epochs, head_arch: widen(base.head_arch)}
       where widen = double each hidden layer size.
${isRegression ? "" : `   Rule E — per-class accuracy variance > 0.3 (some classes much weaker) AND class_weights not yet tried:
     → Add config {lr: base.lr, epochs: base.epochs, head_arch: base.head_arch, class_weights: "balanced"}
`}
   If NO rule matches, fall back to: vary lr by ±25% around base.lr (2 configs).

   Run wave 2 with the chosen configs. Log with stage="sweep_wave_2", include the list of
   rules that fired AND the resulting configs in payload. Re-evaluate the new best
   (same 3 tools as step 5). Log with stage="evaluate_wave_2".

${isRegression ? "" : `7. If ${metricField} is still below ${args.accuracy_target} after all waves:
   - Call mcp__neuron__suggest_samples({task_id: "${args.task_id}"}) to identify data gaps.
   - Log with stage="suggest_samples". Include per_class stats and recommendations in the verdict.

`}${isRegression ? "7" : "8"}. Select overall winner using this rule (apply in order):
   - Candidate set = ALL runs across all waves with status="completed".
   ${isRegression
      ? `- For regression, use R² as the score. Prefer the highest R² that also has mae ≤ 1.2 × min_mae across candidates (avoid pathological runs).`
      : `- For classification: let score(run) = run.valAccuracy if it exists, else run.accuracy.
     If both train and val exist AND (train_acc - val_acc) > 0.15, penalize:
     score(run) = val_acc - 0.5 × (train_acc - val_acc). Prefer the highest score.`}
   - Log the chosen winner_run_id and its score with stage="winner_selection".
${args.promote ? `   - Call mcp__neuron__register_model({task_id: "${args.task_id}", run_id: <winner_run_id>}).` : "   - (promote=false, skip register_model)"}${publishSection}
   - Log with stage="promote".

${isRegression ? "8" : "9"}. Output EXACTLY the following JSON block as your final message (nothing after it):
{"status":"completed","run_id":<winner_run_id or null>,"accuracy":<winner_score or null>,"waves_used":<n>,"verdict":"<one sentence summary mentioning metric=${metricName}, winner_score, overfit if detected>"}

If you hit a data issue at step 1, output:
{"status":"data_issue","run_id":null,"accuracy":null,"waves_used":0,"verdict":"<preflight failure reason>"}

If an unrecoverable error occurs, output:
{"status":"failed","run_id":null,"accuracy":null,"waves_used":0,"verdict":"<error description>"}

Always call mcp__neuron__log_auto_note after each major decision so progress is visible cross-process.
mcp__neuron__log_auto_note takes: {auto_run_id: ${args.auto_run_id}, stage: "<stage>", note: "<note>", payload?: <object>}`
}
