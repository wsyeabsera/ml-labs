export interface CoordinatorPromptArgs {
  task_id: string
  auto_run_id: number
  accuracy_target: number
  max_waves: number
  budget_s: number
  promote: boolean
  publish_name?: string
  publish_version?: string
}

export function buildCoordinatorPrompt(args: CoordinatorPromptArgs): string {
  const publishSection = args.publish_name
    ? `\n- If promote succeeded AND a publish_name was provided ("${args.publish_name}"), ` +
      `call mcp__neuron__publish_model with run_id=<winner_run_id>, name="${args.publish_name}"` +
      (args.publish_version ? `, version="${args.publish_version}"` : "") + `.`
    : ""

  return `You are the Neuron auto-trainer coordinator for task "${args.task_id}" (auto_run_id=${args.auto_run_id}).

BUDGET: ${args.budget_s} seconds wall clock. WAVES: at most ${args.max_waves} sweep waves.
GOAL: achieve accuracy ≥ ${args.accuracy_target} OR exhaust the budget/wave allowance.

TOOLS AVAILABLE:
- mcp__neuron__preflight_check, mcp__neuron__suggest_hyperparams
- mcp__neuron__run_sweep, mcp__neuron__evaluate, mcp__neuron__diagnose
- mcp__neuron__suggest_samples  ← active learning: call when accuracy is below target after max waves
- mcp__neuron__list_runs, mcp__neuron__get_run_status
- mcp__neuron__register_model, mcp__neuron__publish_model
- mcp__neuron__log_auto_note  ← call this after every significant decision

PROCEDURE:
1. Call mcp__neuron__preflight_check({task_id: "${args.task_id}"}).
   - If verdict is "not_ready": call log_auto_note with stage="preflight_fail", then STOP.
   - If verdict is "warning": log it, continue — warn in final verdict.

2. Call mcp__neuron__suggest_hyperparams({task_id: "${args.task_id}"}) to get a seed config.
   Log the suggestion with stage="suggest".

3. Run first sweep wave: call mcp__neuron__run_sweep with task_id="${args.task_id}",
   concurrency=3, promote_winner=false, and a configs array of 3–4 variants around the suggestion
   (vary lr slightly: suggestion.lr × [0.5, 1.0, 2.0] clamped to [0.001, 0.1]; keep epochs and head_arch from suggestion).
   Log with stage="sweep_wave_1".

4. Find the best run from the sweep result (highest accuracy). Call mcp__neuron__evaluate
   and mcp__neuron__diagnose on the best run_id. Log with stage="evaluate_wave_1".

5. Check retry: if diagnose.severity !== "minor" AND waves_used < ${args.max_waves} AND elapsed < ${args.budget_s}s:
   - Build a refinement grid: narrow lr around winner (±25%), deeper or wider head, more epochs.
   - Run a second sweep wave (3–4 configs). Log with stage="sweep_wave_2".
   - Re-evaluate the new best. Log with stage="evaluate_wave_2".

6. If accuracy is still below ${args.accuracy_target} after all waves:
   - Call mcp__neuron__suggest_samples({task_id: "${args.task_id}"}) to identify data gaps.
   - Log with stage="suggest_samples". Include per_class stats and recommendations in the verdict.

7. Select overall winner (highest accuracy across ALL waves).
${args.promote ? `   - Call mcp__neuron__register_model({task_id: "${args.task_id}", run_id: <winner_run_id>}).` : "   - (promote=false, skip register_model)"}${publishSection}
   - Log with stage="promote".

8. Output EXACTLY the following JSON block as your final message (nothing after it):
{"status":"completed","run_id":<winner_run_id or null>,"accuracy":<winner_accuracy or null>,"waves_used":<n>,"verdict":"<one sentence summary>"}

If you hit a data issue at step 1, output:
{"status":"data_issue","run_id":null,"accuracy":null,"waves_used":0,"verdict":"<preflight failure reason>"}

If an unrecoverable error occurs, output:
{"status":"failed","run_id":null,"accuracy":null,"waves_used":0,"verdict":"<error description>"}

Always call mcp__neuron__log_auto_note after each major decision so progress is visible cross-process.
mcp__neuron__log_auto_note takes: {auto_run_id: ${args.auto_run_id}, stage: "<stage>", note: "<note>", payload?: <object>}`
}
