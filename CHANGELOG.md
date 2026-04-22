# Changelog

All notable changes to ML-Labs are documented here.

---

## v1.8.1 — 2026-04-22

**Fixes auto_train being way slower than it needs to be on small-to-medium datasets.** A user running an 8k-row auto_train pointed out it was taking forever. Investigation turned up two compounding issues, both on me:

### What was slow and why

1. **v1.7.0 made every sweep sequential**, including on datasets that would never have crashed anything. That was a memory-safety tradeoff for Fashion-MNIST-scale workloads, but it silently 3×'d the wall-clock on Pima-sized tasks that had no memory problem to begin with. The v1.7.0 CHANGELOG claim of *"same or ~20-30% faster"* was only true for heavy workloads.
2. **The seed wave always had 3 configs** — two SGD+tanh full-batch variants (at 0.5× and 1× LR) plus the modern AdamW+ReLU+cosine+CE variant. In every Phase-3+ benchmark, modern wins cleanly on N≥500. The half-LR SGD baseline was pure legacy preservation, costing ~minutes per wave for zero actual value.

### Fixed

- **Adaptive sweep mode.** The controller now reads the Phase 11.7 memory budget and picks:
  - `safe` / `advisory` → concurrent sweep (3 Claude sub-agents, real parallelism, ~300MB each). Safe for small data; real parallelism means 3 configs finish together, not sequentially.
  - `heavy` / `refuse` → in-process sequential (current behavior). Protects 8GB machines on Fashion-MNIST-scale data.
  - `NEURON_SWEEP_MODE` env var still overrides (`sub_agents` force concurrent, `sequential` / `in_process` force sequential).
  - New decision-log entry `sweep_wave_N_exec` now shows both mode AND budget level.
- **Slimmer seed wave for N≥500.** Drops the half-LR SGD variant. Keeps 1 SGD baseline (at 1× LR) + 1 modern variant. For N<500 the 2 SGD variants stay because individual-run variance matters more on small data. Rule explanations updated to reflect the new composition.

### Impact on your 8k run

- Wave runs 3 configs in parallel (was 1 at a time) → rough 3× wall-clock improvement for the wave.
- Wave has 2 configs instead of 3 → another ~33% reduction.
- Combined: ~4-5× faster overall on small-to-medium datasets.

Fashion-MNIST (level=heavy) keeps running sequential — unchanged from v1.7.x.

### Bench

- Full 5-dataset suite passes. Tiny shift on digits: 0.990 → 0.986 (within the 0.02 accuracy tolerance). The drop is because we removed one of the SGD variants that occasionally won the winner-selection tie-break; the modern variant is still the dominant winner.
- iris, wine: unchanged (N<500, still 3 configs).
- breast-cancer, digits: now 2 seed configs; finish faster.

### Non-changes

- No MCP surface changes. No rs-tensor changes.
- Memory guardrails from v1.8.0 still active — heavy/refuse workloads still go sequential.
- Tournament mode (`tournament: true`) unchanged — always spawns 3 planner sub-agents regardless of budget.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.8.1
```

---

## v1.8.0 — 2026-04-22

**Phase 11.7 — Platform-aware guardrails.** User made the (correct) observation that ml-labs shouldn't just *fix* crashes reactively — it should *prevent* them. This release adds the prevention layer: every data tool now returns a memory-budget estimate, `auto_train` refuses workloads above a calibrated threshold without explicit `force: true`, and the Claude skill tells Claude to surface warnings to the user *before* starting a training that will hurt.

### Added

- **`core/memory_budget.ts`** — estimator: given `{N, D, K, kind}` returns:
  ```ts
  {
    inputCells, peak_mb,
    wall_clock_estimate_s: [low, high],
    level: "safe" | "advisory" | "heavy" | "refuse",
    headline,
    advice[]
  }
  ```
  Thresholds (calibrated from v1.7.1 smoke-test numbers):
  | Level | Input cells | Peak MB | Notes |
  |---|---|---|---|
  | safe | < 5M | < 150 | Pima, iris, wine, small tabular |
  | advisory | 5-20M | 150-500 | ~1-4 min per wave; CPU fine |
  | heavy | 20-60M | 500-1500 | Fashion-MNIST range; real CPU time |
  | refuse | > 60M | > 1500 | Likely crashes on 8GB; explicit opt-in required |

- **`load_csv`, `inspect_data`, `data_audit`** now include `training_budget` in their responses. Non-blocking.

- **`auto_train` preflight guardrail**:
  - `level === "refuse"` + no `force` → throws with a clear error listing the workload shape, estimated peak memory, wall-clock, and actionable options.
  - `level === "heavy"` → logs a warning, emits `auto_heavy_workload` event, proceeds.
  - Otherwise proceeds silently.

- **New `force: boolean` arg on `auto_train`** — override the guardrail. Default `false`.

### Skill updates

- **`neuron/SKILL.md`** has a new prominent section: "Before calling `auto_train`: check the memory budget." Tells Claude to read `training_budget` from `load_csv` / `inspect_data` / `data_audit` and warn the user when `level ∈ {"heavy", "refuse"}`.
- **`cli/templates/CLAUDE.md`** gets a matching "Before heavy training" section + a `"Refusing to start auto_train"` entry in "When things go wrong."

### Example

```
❯ mcp__neuron__auto_train({task_id: "cifar-10"})  # 50k × 3072
Error: Refusing to start auto_train: workload is too large for the CPU-only MLP backend.

  Very heavy workload (153,600,000 input cells, ~4389MB peak, ~10-30min per wave) — likely to crash on <16GB machines

Options:
  • For iteration speed, subset the dataset: e.g. keep the first 10-20k rows in a new task and load_csv again.
  • Feature dimension D=3072 is high. Consider a featurize() callback in neuron.config.ts that downsamples…
  • Expect minutes per wave on CPU. Run overnight or during a break. Cancel with cancel_auto_train if it gets stuck.
  • To override, pass force: true to auto_train. But know that this workload has crashed 8GB machines in testing.

If you're confident your machine has the memory, pass force: true.
```

### Non-changes

- No rs-tensor changes. No new MCP tools.
- Bench Δ=+0.000 (all bench datasets are `safe`).
- Training path, controller, sweep, calibration, drift — all unchanged.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.8.0
```

After update, existing projects need to sync their skills:
```bash
cp -r ~/.ml-labs/.claude/skills/* /your/project/.claude/skills/
cp ~/.ml-labs/cli/templates/CLAUDE.md /your/project/CLAUDE.md
```

---

## v1.7.2 — 2026-04-21

**Terminal now shows training progress on long runs.** User ran Fashion-MNIST auto_train after v1.7.1's memory fix, training worked, but the terminal was silent after `Creating training tensors [59990 × 784]…` for minutes. Per-epoch progress was always being emitted to the dashboard events bus — just not echoed to the MCP server's terminal. Fine for a 500ms Pima run; awful for a 10-minute Fashion-MNIST run.

### Added

- **Periodic terminal log during training.** Every 10% of epochs (or every 30 seconds, whichever first), the MCP server logs:
  ```
  Training: epoch 40/400 (127s elapsed, ~380s left) — loss 0.317
  ```
  Reveals that the training is alive and roughly how much longer to wait. Doesn't spam — for a 400-epoch run you get ~10 lines.
- **Tensor-upload log when slow.** If the `createTensor` calls for inputs + targets take ≥5 seconds (which they do for 60k × 784), logs `Tensors uploaded to rs-tensor in Xs (N × D input, M target values)`. For small datasets the line is suppressed.
- **Explicit "Training started" log** at the top of every run with epochs × N + LR + optimizer + batch_size context, so you know what's actually running.

### Non-changes

- No algorithmic changes. Training path and output unchanged.
- Dashboard progress path unchanged — was already getting per-epoch events.
- Bench Δ=+0.000 (short trainings don't trigger the periodic log — neither 10% threshold nor 30s threshold crosses).

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.7.2
```

---

## v1.7.1 — 2026-04-21

**Fixes Fashion-MNIST (60k × 784) OOM during training.** User's machine crashed when `auto_train` hit a wave that tried to materialize 60k × 784 feature arrays as nested JS objects, then copied them for normalization, then flattened them. Peak ~3GB JS heap, easy crash on 8GB laptops.

### Fixed

- **`core/train.ts` ingestion rewritten** to a single-pass stream into a pre-allocated flat array. Old path held three parallel representations (nested raw arrays → nested normalized arrays → flat). New path: one flat `N*D` array filled row-by-row with raw values, stats accumulated on the fly, then normalized **in place**. Peak memory for the Fashion-MNIST shape dropped from ~3GB to ~400MB (smoke-tested with 60k × 784 synthetic — heap stayed at 360MB through fill+normalize).
- **`trainBg.ts` stopped loading samples twice.** Previously did `getSamplesByTask` just to count, then `getSamplesByTaskAndSplit` to partition. Now uses a cheap `countSamplesByTaskAndSplit` first, materializes only the split we actually need.
- **Val-split evaluation also stream-based.** The post-train held-out eval was doing the same `map(raw).map(applyNorm).flat()` triple-copy as training. Now streams test samples straight into a pre-allocated flat array with normalization applied in the fill loop.
- **New DB helpers**: `streamSamplesByTaskAndSplit(taskId, split)` (bun:sqlite `.iterate()` generator) and `countSamplesByTaskAndSplit(taskId, split)`.

### Smoke-tested

60k × 784 synthetic dataset (Fashion-MNIST shape), stream-fill-normalize end-to-end:

- heap before train: 195 MB
- heap peak during fill: 554 MB
- heap after normalize: 360 MB
- RSS peak: 1.25 GB (includes Node/Bun runtime + SQLite cache)

On the old path this shape was ~3GB heap / OOM territory. Now it's within safe margins on 8GB laptops.

### Unchanged

- Tournament sub-agents, sweep execution mode (still in-process sequential from v1.7.0), training algorithm, tensor math — all untouched.
- Bench Δ=+0.000 on all 5 datasets.
- MCP surface unchanged.
- Class-weights=balanced path still materializes (it needs the [N][D] matrix to resample per class). Low-priority follow-up; doesn't trigger on balanced datasets like Fashion-MNIST or the bench suite.

### Known remaining memory cost

- The flat `inputs` array is still a plain `number[]`. Each entry is a boxed double (~8 bytes + overhead). For 60k × 784 that's ~380 MB. A follow-up could use `Float32Array` for a ~50% further reduction, but requires changing the rs-tensor transport.
- `JSON.stringify(inputs)` during `createTensor` over MCP stdio is still a transient ~200MB string allocation. Unavoidable without a new transport.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.7.1
```

---

## v1.7.0 — 2026-04-21

**Fixes the "auto_train crashed my PC" bug.** User loaded a large CSV (v1.6.3 fix worked), then ran `auto_train` and the machine hung. Same class of resource issue as v1.6.3, different layer — this time in the sweep execution path.

### The bug

Production `auto_train` defaulted to `runSweep(concurrency: 3)`, which spawns **3 concurrent full Claude Agent SDK sessions** per wave. Each sub-agent spawns its **own neuron MCP server child process** (`bun run src/server.ts`, ~200MB RSS each), which spawns its **own rs-tensor child process**. Per wave that's:

- Parent: neuron + rs-tensor (~250MB)
- 3 sub-agents × (Claude session + neuron bun + rs-tensor) ≈ **700-900MB of process overhead**
- Plus each sub-process independently loads all samples from SQLite to build its own training tensors

On a laptop with a 130MB dataset already resident, this was easily the difference between "swap-pressured" and "hard crash."

### Worse: the Claude sub-agents weren't doing anything intelligent

Each sub-agent's job was literally "call `mcp__neuron__train` with these exact hyperparams from the config." No reasoning. No decision-making. Just middleware. And because rs-tensor serializes all operations through a single connection, the "3 concurrent trainings" didn't even truly parallelize — they just created memory pressure and IPC overhead for no throughput gain. (This was flagged in the v1.6.0 gap analysis as "Gap 12 — architectural oddity, defer." It's now the user-crashing bug.)

### Fix: default sweep mode is now in-process sequential

- **Default**: `runSweepSequential` — calls `startTrainBackground` directly in the main process, one config at a time. Zero extra processes. No Claude API calls per training. Memory bounded to the parent process.
- **Opt-in legacy path**: set `NEURON_SWEEP_MODE=sub_agents` to restore the old concurrent-sub-agent behavior. Kept available because someone might want the process isolation for sandboxing reasons — but nobody should *need* it for speed.
- Env var semantics inverted: previously `NEURON_SWEEP_MODE=sequential` meant in-process, anything else meant sub-agents. Now anything **other than** `sub_agents` means in-process (so existing callers setting `=sequential` continue to work without change).

### Observability

New decision-log entry `sweep_wave_N_exec` fires at wave start with `{mode: "in_process" | "sub_agents", configs}` — you can see which path auto_train is using on the `/auto/:id` timeline.

### Performance

- **Wall-clock**: roughly the same or *faster* on CPU-only tabular workloads. rs-tensor serializes anyway; the old "parallelism" was adding IPC cost without throughput. For a 4-config wave, expect ~20-30% lower wall-clock from eliminating the Claude round-trips.
- **Memory**: dropped from ~1GB peak to ~300MB peak during a sweep wave on the Pima-sized datasets used for testing.
- **Bench Δ=+0.000** on all 5 datasets — the benchmark harness already set `NEURON_SWEEP_MODE=sequential`, which now falls through to the new default path.

### Unchanged

- Tournament mode (3 concurrent Claude *planners*, not workers) still spawns sub-agents — that's real parallelism on a genuinely intelligence-heavy task. Out of scope for this fix.
- `auto_train` behavior, MCP surface, and decision-log shape are all unchanged.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.7.0
```

If you specifically want the old sub-agent behavior:
```bash
NEURON_SWEEP_MODE=sub_agents ml-labs dashboard
# or set in your .mcp.json env block
```

---

## v1.6.3 — 2026-04-21

**`load_csv` was PC-crash dangerous on large files.** A user tried loading a 130MB CSV and their machine hung. Three compounding issues:

1. **Per-row inserts without a transaction wrapper.** Each row was its own SQLite commit → hundreds of thousands of WAL fsyncs → disk saturation.
2. **`updateTaskLabels` called inside the insert loop** whenever a novel class appeared — redundant JSON writes.
3. **No file-size guard.** A 5GB mistake would try to buffer the whole thing in memory.

### Fixed

- **Batched inserts.** `load_csv` now uses `insertSamplesBatch` in chunks of 5000 rows, each chunk wrapped in a single SQLite transaction. A synthetic 200k-row × 12-feature (~17.5MB) load now completes in **1.4 seconds** (~138k rows/sec). Previously this pattern would fsync ~200k times and take minutes, or stall the machine on a 130MB file.
- **Labels pre-collected** into a Set from the parsed rows, `updateTaskLabels` called **once** at the end of the load instead of once per novel class during the loop.
- **File-size guard.** Default cap is **500MB** (well above any normal tabular-ML use). Files beyond the cap raise a clear error pointing the user at the new `max_bytes` override. Loads between 100MB and the cap log a warning. This protects against accidental 5GB drops without blocking legitimate large-but-bounded datasets.
- **Progress events.** `csv_load_started`, `csv_load_progress` (per batch), `csv_load_completed` fire on the event bus so the dashboard + get_auto_status type flows see forward motion during a long load.

### New schema field

- `load_csv({max_bytes?: number})` — override the 500MB default. Use when you actually need to load a larger file and know your machine can handle it.

### Non-changes

- Parsing still goes through `readFileSync` + `csv-parse/sync` (not streamed). Memory pressure during parse is unchanged; what changed is the insert path. If you hit the memory ceiling at ~1GB+, that's the next thing to fix — open an issue.
- No schema migration, no rs-tensor rebuild, bench Δ=+0.000.
- Existing callers are unaffected — the fix is purely internal.

### Verification

- Typecheck clean, bench Δ=+0.000.
- Smoke test: 200k-row synthetic CSV loads in 1.4s without touching swap.
- Existing unit tests on `load_csv` pass unchanged (no behavioral diff on small files).

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.6.3
```

---

## v1.6.2 — 2026-04-21

**Fixes a real interop gap: `publish_model` and `export_model` used incompatible artifact formats.** `publish_model` writes a bundle directory (`meta.json` + `weights.json` + `adapter.hash`); `export_model` returned an inline unified JSON with everything merged. The two didn't round-trip — a published model couldn't be loaded from an `export_model` JSON, and vice versa. Reported after observing the inconsistency in a real workflow.

### Fixed

- **`export_model` now supports both formats.**
  - `export_model({task_id})` — unchanged inline unified JSON (back-compat; good for chat hand-off, commits).
  - `export_model({task_id, bundle_path: "/path/to/out"})` — writes the **same bundle format** `publish_model` produces to any filesystem path (no registry registration). Returns `{ok, format: "bundle", bundle_path, bytes, accuracy, val_accuracy, adapter_hash, run_id}`.

- **`import_model` now accepts filesystem bundles.** Previously only accepted registry URIs.
  - `import_model({uri})` — unchanged registry path.
  - `import_model({bundle_path: "/path/to/bundle"})` — reads a bundle directory directly. Round-trips with `export_model({bundle_path})`.
  - Must provide exactly one of `uri` / `bundle_path`.

- **New helpers in `core/registry/bundle.ts`**: `writeBundleDir(dir, bundle)` and `readBundleDir(dir)` — the path-based primitives. `writeBundle(uri)` / `readBundle(uri)` are now thin wrappers over them. Same on-disk layout whether the bundle lives in `~/.neuron/registry/` or anywhere else.

### Now round-trippable

```
# Publish → filesystem → re-import (any of these combinations work):
publish_model({run_id, name, version})        → bundle in registry
export_model({task_id, bundle_path: "/tmp/m"}) → bundle at /tmp/m
import_model({uri: "neuron://local/..."})     ← from registry
import_model({bundle_path: "/tmp/m"})         ← from filesystem
```

### Non-changes

- No schema migration. No rs-tensor rebuild. Bench Δ=+0.000.
- `publish_model` behavior unchanged.
- `export_model()` without `bundle_path` behavior unchanged — same inline JSON response.

### Verification

- Typecheck clean, bench Δ=+0.000.
- Round-trip smoke test: `writeBundleDir → readBundleDir` produces byte-identical meta + weights.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.6.2
```

---

## v1.6.1 — 2026-04-21

**5 confirmed bug fixes.** A user running a real project (Pima diabetes) surfaced a batch of issues, then prompted a source audit. Every bug below was verifiable in the code; all fixes are small and scoped.

### Fixed

- **`cv_train` was clobbering the task's registered model.** `startTrainBackground` in `trainBg.ts` unconditionally called `registerModel()` at the end of every training, with no `autoRegister` flag. Every `cv_train` fold overwrote the task's active model — last fold always won. Fix: added `autoRegister?: boolean` to `StartTrainArgs` (default `true` for backward compat). `cv_train` now passes `autoRegister: false` so per-fold diagnostic runs don't touch the real winner.
- **`suggest_samples` was feeding unnormalized features to a normalized model.** `predict.ts` and `model_stats.ts` both apply `run.normStats` to features before inference. `suggest_samples.ts` did not. For any task with normalization enabled (the default for CSV tabular data), this meant per-class accuracy and the uncertainty ranking were computed from garbage predictions — a trained model's class-0 accuracy would show as 0% while `model_stats` showed 78% on the same run. Fix: apply `applyNorm()` to every sample before building the input tensor.
- **Single predictions weren't logged for drift detection.** `tools/predict.ts` and `api.ts#handlePredict` skipped the `logPrediction()` call — only the bundle-serving endpoints (`/api/registry/:name@:version/predict`) and `batch_predict` were writing to the `predictions` table. Users driving `mcp__neuron__predict` from Claude saw `drift_check` report "no data" because their predictions weren't stored. Fix: `tools/predict.ts` now logs every prediction via `logPrediction()`. Respects `NEURON_PREDICTION_SAMPLE_RATE` env var.
- **`load_csv` had no default `test_size`.** The MCP tool schema was `test_size: z.number().optional()` with no default, while the HTTP endpoint defaulted to 0.2. So uploading via `mcp__neuron__load_csv` without specifying put all rows in `train`, no test split existed, `val_accuracy` stayed null, and the controller fell back to reporting training accuracy as the winner metric — dishonest but structurally consistent. Fix: default `test_size=0.2` on the MCP tool to match the HTTP behavior.
- **`register_model` returned training accuracy as the headline number.** When a run has a `val_accuracy` (from a held-out split), that's the honest generalization metric; `run.accuracy` is measured over the training set. Fix: `register_model` response now returns both as separate fields (`train_accuracy`, `val_accuracy`) plus a headline `accuracy` that prefers `val_accuracy` when present, with `accuracy_source: "val_split" | "train_set"` so the caller can tell.

### Not a bug

- `diagnose` falling back to heuristics: MCP Sampling isn't supported by Claude Code's current CLI client. The tool says so in its response payload (`sampling_note`). Documented as an environment limitation; not fixable on our side.

### Non-changes

- Bench Δ=+0.000. No rs-tensor rebuild. No schema migration.
- No API surface changes except the additive response fields in `register_model`.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.6.1
```

---

## v1.6.0 — 2026-04-21

**Phase 11.5 — intelligence fixes.** A gap analysis of how Neuron uses Claude surfaced that `suggest_hyperparams` was still telling Claude "SGD only, tanh only, no Adam, no mini-batches" — constraints that have been untrue since Phase 3 (v0.9.0, six phases ago). Claude was picking hyperparameters blindfolded. Four more gaps (planner emitting one-line rationale, no system prompts on sub-agents, no hardware context, no loss curve to diagnoser) were small individually but compounded into weaker intelligence than the platform deserved. This release fixes all five.

### Fixed — prompt accuracy

- **`suggest_hyperparams` rewritten.** Prompt now documents the full post-Phase-3 lever set: AdamW/Adam/SGD, all four activations (tanh/relu/gelu/leaky_relu), three LR schedules (constant/cosine/linear_warmup), loss (cross_entropy/mse), batch_size, weight_decay, grad_clip, early_stop_patience, label_smoothing, SWA. Output schema expanded from `{lr, epochs, head_arch, class_weights}` to include all of the above with a `reasoning` field. Deterministic fallback modernized: tiny datasets (N<50) still get SGD+tanh for variance reasons, everything else gets the modern default (AdamW + ReLU + cosine + cross-entropy + weight_decay=0.01 + SWA when epochs≥200).

### Fixed — planner reasoning fidelity

- **Planner emits structured `rule_explanations[]`.** Previously the Claude planner produced a single-line `rationale` which we wrapped in a placeholder `RuleExplanation` titled "Claude planner (balanced)". Now the prompt requests `rule_explanations: [{name, title, why, evidence[]}]` matching the Phase 10A schema. The parser accepts the structured form when well-formed and falls back to the placeholder wrapper when Claude returns the old shape — no regression risk.

### Added — better context

- **System prompts on every Agent SDK sub-agent.** `planner.ts` and `diagnoser.ts` now pass `systemPrompt` to `query()`. Each system prompt documents the exact output contract, relevant hardware context, and reasoning hints. Tighter outputs at zero architectural cost.
- **Hardware/perf context** in planner + diagnoser system prompts: "CPU-only. Avoid epochs × N > 10M. batch_size 8-128 typical. Keep models under ~1M params." Claude no longer gets to suggest 10k epochs on a 100k-sample dataset without knowing we'll rebel.
- **Loss curve passed to diagnoser.** `runDiagnoser` now receives the best run's `lossHistory`, downsamples to ~50 points via stride, and includes it in the prompt. The diagnoser's system prompt explains how to read curve shape (smooth convergence / plateau / spike / oscillation / divergence) and map each to a likely cause (`lr_too_high`, `lr_too_low`, etc.). Added `lr_too_high`, `lr_too_low`, and `optimizer_mismatch` to the diagnosis cause vocabulary.

### Non-changes

- No new MCP tools. No training-path changes. No rs-tensor rebuild.
- Bench Δ=+0.000 — the rules-only benchmark path bypasses all Claude calls via `NEURON_PLANNER=rules` and is unaffected.
- `auto_train` orchestration, `cancel_auto_train`, shadow, drift, calibrate, LLM tools all unchanged.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.6.0
```

---

## v1.5.1 — 2026-04-21

**Skills refresh.** The Claude skill files (`neuron`, `neuron-ui`) and the per-project `CLAUDE.md` template hadn't been updated since v0.9-era. We'd shipped ~12 new MCP tools (`calibrate`, `drift_check`, `cv_train`, `data_audit`, `auto_preflight`, `inspect_data`, `get_training_curves`, `model_stats`, `log_auto_note`, `cancel_auto_train`, `llm_load`, `llm_generate`, `llm_inspect`) and changed behavior on many more — but Claude in a freshly `ml-labs init`'d project would still read a 30-tool description missing half of them.

### Updated

- **`.claude/skills/neuron/SKILL.md`** — rewritten from scratch.
  - Accurate 42-tool inventory organized by purpose (task+data, auto-train, training, inspection, active learning, inference, calibration, production, LLM).
  - Documents new `train` parameters (optimizer, lr_schedule, weight_decay, grad_clip, swa, label_smoothing, activation, loss).
  - Documents new `auto_train` flags (tournament, auto_collect, seed) and the rich decision_log output.
  - Documents new signature workflows: active-learning labeling loop, shadow-model validation, cancellation path.
  - Adds honest scope limits for LLM tools (CPU-only, naive whitespace tokenizer, one model at a time).
  - New "Hard-earned rules" section distilling the cross-cutting guidance.
- **`.claude/skills/neuron-ui/SKILL.md`** — route map brought current.
  - Adds `/playground`, `/tasks/:id/label`, `/auto`, `/auto/:id`, `/drift`, `/activity`.
  - Per-route verification snippets (drift banner, shadow card, batch live card, labeling queue, LLM load state, auto-run why-cards).
- **`cli/templates/CLAUDE.md`** — the per-project CLAUDE.md that `ml-labs init` drops in.
  - Current tool table with the Phase 6–11A additions.
  - Signature "when things go wrong" section (cancel_auto_train, zombie runs, drift, miscalibration).
  - Dashboard routes worth knowing list.

### Why this matters

Skills ship with `ml-labs init`. Projects created before this release have stale skill files; they'll still work but Claude won't know about the newer tools. For existing projects, re-run `ml-labs init` in the project dir (it only overwrites `.claude/` / `CLAUDE.md` if you opt in, or manually copy the updated files from `~/.ml-labs/.claude/skills/` and `~/.ml-labs/cli/templates/CLAUDE.md`).

### Non-changes

- No code changes — typecheck clean, bench Δ=+0.000, no rs-tensor rebuild.
- No MCP surface changes from v1.5.0.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.5.1
```

---

## v1.5.0 — 2026-04-21

**Phase 11A — small-LLM inference surface + Labeling UI.** Exposes the dormant LLaMA/GGUF inference code in rs-tensor (`llama.rs` + `gguf.rs` — ~1000 lines that were never surfaced at the Neuron layer) as MCP tools and a dashboard Playground. Also lands the long-deferred labeling UI that closes the active-learning visual loop from Phase 7A.

### Added — LLM inference

- **3 new MCP tools**: `llm_load(path)`, `llm_generate({prompt, token_ids?, max_tokens, temperature})`, `llm_inspect()`. Thin wrappers over rs-tensor's existing rmcp tools; Claude can now load a GGUF and generate text inline.
- **HTTP wrappers**: `GET /api/llm/status`, `POST /api/llm/load`, `POST /api/llm/generate`.
- **Dashboard `/playground` route** — load a GGUF by path, see the loaded config (dim / layers / heads / vocab / params in human-readable form), generate text with max_tokens + temperature sliders, view generated text + elapsed_ms + tok/s.
- **`callText` variant in `mcp_client`** — tolerates non-JSON text responses (`llama_load` returns a plain info string, not JSON).
- **Events**: `llm_loaded`, `llm_generated` with timing in payload.

### Added — Labeling UI

- **New `/tasks/:id/label` route** — one uncertain sample at a time. Shows features (first 12 dims), the model's current prediction + confidence, a button per class label with digit-key shortcuts, "Use prediction" (Enter), "Skip" (S), "Refresh queue" (R). Retrain banner appears after 10 labels.
- **New API endpoints**:
  - `GET /api/tasks/:id/label-queue?n=10` — reuses `suggest_samples` with a high confidence threshold to surface the model's most uncertain samples.
  - `POST /api/tasks/:id/samples` — adds a labeled sample with validation.
- **"Label" button added to TaskDetail header** (classification tasks only).
- **Event**: `sample_labeled` with task + label in payload.

### Honest scope limits

- **No `llm_embed`** in this phase. rs-tensor's LLaMA doesn't expose hidden states and its tokenizer is naive whitespace-split (unknown words are silently skipped), so "text classification via embeddings" needs a proper BPE/SentencePiece tokenizer + a hidden-state export. That's Phase 11B.
- **No fine-tuning, no streaming generation, only one model loaded at a time** — rs-tensor constraints.
- **CPU-only inference** — expect 5-10 tok/s on a 1B model.

### Non-changes

- No training-path changes — bench Δ=+0.000.
- No rs-tensor rebuild — the Rust tools were already there; this release just wires them into the Neuron MCP surface and the dashboard.
- No schema migration.

### Upgrade

```bash
ml-labs update
ml-labs --version   # prints 1.5.0
```

---

## v1.4.0 — 2026-04-21

**Phase 10.6 — cancellable `auto_train` + zombie reaper.** Fixes a real pain point where cancelling an `auto_train` tool call on the client left the server churning — coordinator kept making Claude API calls, child runs stranded at `status="running"` forever, no way to stop short of killing the whole MCP server.

### Added

- **New MCP tool `cancel_auto_train`** — takes `task_id` OR `auto_run_id`, aborts the in-process coordinator (stops spawning new sub-agents, halts planner/tournament), force-transitions the auto_run row and any in-flight child runs to `cancelled`. Returns `{ok, auto_run_id, was_active, child_runs_cancelled, message}`.
- **In-process coordinator registry** (`core/auto/registry.ts`): `runController` now registers itself on entry and deregisters on exit. External callers can look up active coordinators by `auto_run_id` or `task_id`.
- **`cancel_training` gained a `force` flag** — when `run_id` is provided and the DB row is `running` but no in-process worker is tracking it (zombie), `force: true` transitions the row to `cancelled`. Default behavior unchanged.
- **Startup zombie reaper** (`core/auto/reaper.ts`) — both `server.ts` and `api.ts` now run on boot. Marks `runs` stuck in `running`/`pending` older than 30 minutes as `failed`, and `auto_runs` owned by dead PIDs (or older than 30 min) as `failed`. Emits `run_reaped` / `auto_reaped` events.
- **Child run tracking** — coordinator tracks every sub-agent-spawned run id so cancellation can reap them atomically (they never wrote a terminal status because the sub-agent was aborted before calling `mcp__neuron__train`'s finalize path).
- **`VerdictStatus` + `AutoRun.status` extended with `"cancelled"`** — gets its own verdict summary ("cancelled by operator after N wave(s), M run(s)").

### Fixed

- Cancellation precedence in the controller: external abort (`!budgetExpired`) now takes precedence over "failed" when the abort happens before any wave completes, so a pre-wave cancel no longer shows as `failed`.
- The final cancel-reap loop calls `forceCancelRun` on every tracked child, covering both mid-wave cancel and budget timeout.

### Dropped from scope (explicit)

- **MCP request-level cancellation** (Esc on the client triggering the handler's abort automatically) — needs SDK hook validation. The new `cancel_auto_train` tool covers the workflow; auto-propagation from the MCP request can land in a follow-up.
- **Worker-level fast abort** (killing rs-tensor mid-epoch) — our training loop doesn't check a cancel signal per epoch. A mid-run cancel still lets the current epoch window finish before tearing down; budget enforcement at wave boundaries is still the policy.
- **Coordinator restart recovery** (resuming a cancelled auto_run) — out of scope.

### Verification

- Dashboard `tsc -b && vite build` clean, neuron `tsc --noEmit` clean, bench Δ=+0.000.
- `ml-labs --version` now prints `1.4.0` (see v1.3.1 note).

### Upgrade

```bash
ml-labs update
```

---

## v1.3.1 — 2026-04-21

**Fixes `ml-labs --version` reporting 1.0.0.**

Every phase since v1.0.0 bumped `neuron/package.json` + the API's in-code `VERSION` constant, but the CLI reads its version from the *root* `package.json` (`~/.ml-labs/package.json`) via `getVersion()` in `cli/index.ts`. Root had been stuck at `1.0.0` since the v1.0.0 release, so `ml-labs --version` showed `1.0.0` even on fully-updated installs.

No functional changes — if you already did `ml-labs update` for v1.3.0, your actual code was up to date. This release just fixes the version string.

### Fixed

- Bumped `package.json` (root), `cli/package.json`, and `neuron/package.json` to `1.3.1`. From now on every release bumps all three in the same commit.

### Upgrade

```bash
ml-labs update
ml-labs --version   # now prints 1.3.1
```

---

## v1.3.0 — 2026-04-21

**Phase 10.5 — Batch prediction observability.** Training runs have been first-class objects for a long time (DB row, background worker, SSE progress, history, detail view). Batch predictions were not — they ran inline on a blocking HTTP handler, capped at 200 rows, with zero persistence and no progress. This release brings batch predict up to parity.

### Added

- **`batch_predict_runs` table** — every batch is now a persisted object with id, task_id, run_id (model used), total, processed, correct, accuracy, status, started_at, finished_at, latency_ms_avg, errors[], has_labels flag, label_column.
- **Background worker** (`api/batchPredictBg.ts`) — the POST handler no longer blocks. It creates the batch row, returns `{ok, batchId, total, truncated}` immediately, and an async worker iterates rows in the background.
- **Individual prediction logging** — each row the batch processes is now also written to the existing `predictions` table (with `model_uri = neuron://local/run/<id>#batch/<batchId>`), so batch traffic feeds drift detection and the prediction audit log the same way single-shot predicts do.
- **Progress events** — `batch_predict_started`, `batch_predict_progress` (every 50 rows), `batch_predict_completed`, `batch_predict_failed`. Payloads include processed / total / accuracy / latency / throughput.
- **MAX_ROWS raised** from 200 → 5000 (safe now that we're off the HTTP thread).
- **New endpoints**:
  - `GET /api/tasks/:id/batch_predict` — list recent batches for a task (newest first).
  - `GET /api/batch_predict/:id` — single-batch detail.
- **Live dashboard card** — `Predict.tsx` BatchPredict panel now shows a streaming `BatchPredictLiveCard` instead of a blocking spinner: progress bar, rows processed / total, running accuracy (when labels present), throughput (rows/s), average latency, ETA, warnings.
- **BatchPredictHistory on TaskDetail** — new table listing recent batches per task with status, rows, accuracy, latency, duration, age. Polls fast when a batch is running, slow otherwise.
- **ActivityFeed** — icons, colors, labels, query invalidation, and live-only toasts for the 4 new event kinds.

### Non-changes

- No training-path changes — bench Δ=+0.000 on all metrics.
- No rs-tensor rebuild.
- MCP `batch_predict` tool surface unchanged.

### Upgrade

```bash
ml-labs update
```

---

## v1.2.0 — 2026-04-21

**Phase 10A — surface the reasoning we already produce.** The coordinator / rules engine / diagnoser were always generating *why* signals at every decision point, but by the time they reached the dashboard they'd been compressed into one-liners like `"B1:overfit→shorter + shallower"`. You saw *what* happened, not *why*. This release plumbs the reasoning through as structured data and renders it in a learnable UI.

Nothing new to compute — the "why" was already there.

### Added

- **`RuleExplanation` type** (`core/auto/rules.ts`):
  ```ts
  { name: string; title: string; why: string; evidence: string[] }
  ```
  Emitted alongside the legacy `rules_fired: string[]` (kept for stats/fingerprint compat). Every rule match now carries a plain-language headline, a 1-2 sentence explanation, and the concrete numeric facts that triggered it on this specific wave.
- **Rule explanations for every source**:
  - All rules in `refineFromSignals` (seed / seed_modern / seed_balanced, rules A–E, fallback).
  - Warm-start path in `controller.ts` — explains why the prior-task winner was tried.
  - Claude planner — carries the planner's rationale as a single explanation.
  - Tournament mode — merges explanations from all three strategies.
  - TPE adapter — explains what TPE is and cites the observation count.
- **Structured winner reasoning** (`winner_selection` decision log entry):
  - `reasoning.why_winner: string[]` — plain-language points on why this run was picked.
  - `reasoning.runners_up: Array<{run_id, metric, score, reason_not_winner}>` — every other run, sorted by score, with a specific reason it lost (lower score, overfitting, failed, etc.).
  - `confidence: "high" | "low"` based on val split + overfit status.
- **Diagnose entries** already carried `evidence[]` + `recommendations[]` in their payload from Phase 6.5 — now they actually render in the UI instead of sitting in raw JSON.
- **Dashboard: expandable "why" cards** in `/auto/:id` timeline:
  - Every decision_log entry with structured reasoning gets an inline `why` toggle.
  - `winner_selection` auto-expands (it's the most important decision).
  - Rule explanations render as: title (bold) + why (body) + evidence (monospace bullets).
  - Winner reasoning renders as: "Why this run won" list + runners-up with reason.
  - Diagnose renders as: primary cause + evidence + recommendations.
  - Entries with no structured payload keep the existing raw-JSON `payload` expander as an escape hatch.

### Non-changes

- No schema migration — decision_log payload is JSON, additive.
- No training-path changes — bench accuracy Δ=+0.000.
- No new MCP tools, no rs-tensor rebuild.

### Upgrade

```bash
ml-labs update
```

---

## v1.1.1 — 2026-04-21

**Fixes the "every refresh replays every notification" bug.**

### Fixed

- **Backend SSE snapshot was returning the *oldest* events, not the newest.** `listEvents({ limit: 50 })` orders by id ASC, so on every dashboard refresh the server sent the first 50 events ever recorded as the snapshot, then immediately streamed every event id > 50 as if it were *live* — firing a toast for every historical `run_completed`, `sweep_completed`, `calibrated`, `drift_detected`, and `model_registered` since the DB was created. Added a `newest: true` option to `listEvents` and switched `handleEventsStream` to use it.
- **Client watermark** — belt for the suspenders. `ActivityFeedProvider` now tracks a `liveAfterId` watermark set from the max id in the snapshot. Events with `id ≤ liveAfterId` (the initial snapshot plus any reconnect replay) update the activity feed and invalidate React Query caches but never fire toasts. Each event id can toast at most once per session.
- **Snapshot dedupe** — snapshot events are now merged by id, so reconnects don't duplicate rows in the activity feed.

No user-facing API changes; upgrade is drop-in.

### Upgrade

```bash
ml-labs update
```

---

## v1.1.0 — 2026-04-21

**Production story follow-through.** Phase 8 shipped the v1.0 production MVP (serving + logging + drift detection). Three items were explicitly deferred; this release lands the two that close real user loops and drops the two that had no concrete consumer.

### Added — Phase 8.5 (shadow mode + auto-retrain banner)

- **Shadow model mode** — run a second model alongside the primary on every prediction without affecting user-visible output.
  - New `shadow_models` table (one shadow per task) and `shadow_comparisons` log table.
  - `POST /api/tasks/:id/shadow {run_id}` — attach a completed run as the task's shadow.
  - `DELETE /api/tasks/:id/shadow` — detach.
  - `GET /api/tasks/:id/shadow` — returns shadow run details + agreement rate over the last 500 comparisons.
  - `POST /api/tasks/:id/shadow/promote` — atomic `registerModel` + detach; replaces the primary with the shadow.
  - **Prediction path**: when a shadow is attached, `POST /api/tasks/:id/predict` runs both models sequentially, logs the comparison (classification: labels match? regression: `|delta| / max(|primary|, 1) < 0.05`?), returns the primary output unchanged. Shadow failures are non-fatal.
  - Refactored `tools/predict.ts` to expose a reusable `runInference(run, task, features)` helper.
- **Auto-retrain banner** — closes the drift-detection loop shipped in v1.0.0.
  - `drift_check` now records a `drift_detected` event when overall verdict ∈ {drifting, severe}. Idempotent: skips same-verdict emissions within 5 minutes per task.
  - New `GET /api/tasks/:id/drift-status` returns the latest drift event within 24h (or null).
  - New dashboard `DriftBanner` component — dismissable per `(taskId, eventId)`, shows on both Overview (compact, per-task) and TaskDetail.
  - Banner's "Retrain now" button links to `/train?task=<id>`.
- **ShadowCard on TaskDetail** — agreement rate bar, primary vs shadow accuracy, "Promote shadow" button (gated behind ≥10 comparisons), detach.

### Tests

- **New integration test** `test/integration/drift-sim.ts` — seeds a synthetic task with N(0, 1) training features, logs 500 stable predictions (verifies no false-positive), shifts feature[0] mean by +2σ, logs 100 more, asserts drift_check flags the shift. Passes in <2s.
- Dashboard `tsc -b && vite build` clean.
- Neuron `tsc --noEmit` clean.
- Bench Δ=+0.000 — shadow only triggers when attached, and no bench attaches one.

### Dropped from Phase 8 deferred list (permanently)

- **Canary weighted routing** — shadow mode (observer, weight=0 semantics) covers the validate-before-promote use case without inference-path randomness. True canary revisits if a multi-model serving story emerges.
- **ONNX export** — no named consumer. Big rs-tensor Rust lift with no pull signal; skipped.
- **HTTP P99 latency test** — serving path is ~10 ms with no measured pain.

### Upgrade

```bash
ml-labs update
```

---

## v1.0.1 — 2026-04-21

**Dashboard detail pass.** Phases 2–8 shipped rich backend state (run_context, dataset_hash, calibration temperature, all Phase 3 hyperparams, auto-run decision_log + verdict_json, drift reports) — but the dashboard was largely v0.7-era. This release surfaces what was already stored.

### Added — Phase 7.6 (dashboard detail pass)

- **Live training details in `ActiveRunCard`**:
  - Inline SVG loss sparkline streams from `runProgress.lossHistory`.
  - ETA computed from epochs done × elapsed / remaining (falls back to `i/n` stage progress).
  - Per-epoch LR-schedule chip (shows `sched cosine`, `sched linear_warmup`, etc. when set).
  - Removed the stale "Rust — opaque" note now that rs-tensor emits progress.
- **Enriched `RunDetail`**:
  - New **Training config** card — all hyperparams grouped by domain (core / optimizer / LR schedule / regularization / activation·loss / SWA·early-stop / other).
  - New **Run context** card — neuron version, git SHA, rs-tensor SHA, hostname, rng seed, dataset hash (click to copy full value), cv_fold / cv_parent links, calibration temperature.
  - **Val-loss overlay** on the loss curve when `valLossHistory` is present (dashed amber line).
- **New Auto-run pages**:
  - `/auto` — list of all auto_train invocations (newest first) with status, target vs final accuracy, waves used, wall-clock.
  - `/auto/:id` — detail page with decision_log timeline (stage-grouped icons: preflight / seed / wave_N / diagnose / promote), structured `verdict_json` breakdown (data issues, suggested next steps, attempted stats, winner card with overfit + confidence flags).
  - Sidebar "Auto-runs" entry between Sweep and Upload.
- **Predict calibration badge** — `calibrated` chip shown next to predicted label when temperature scaling was applied.
- **ActivityFeed event coverage** — new handlers + icons + labels for `calibrated`, `drift_detected`, `sweep_wave_started`, `sweep_wave_completed`, `auto_collect_start`, `auto_collect_added`. Auto-train events deep-link to `/auto/:id`.

### API

- `GET /api/auto` — list auto_runs (params: `task`, `limit`, `offset`).
- `GET /api/auto/:id` — auto_run detail with full `decision_log`.
- `GET /api/runs/:id` — response extended with `valLossHistory` and `calibrationTemperature`.

### Tests

- Dashboard `tsc -b && vite build` clean.
- Neuron `tsc --noEmit` clean.
- Bench Δ=+0.000 on metrics (iris=1.000, wine=1.000 match baseline). Additions are purely surfacing — no training-path changes.

### Deferred

- Sweep wave markers — would require new API plumbing for limited payoff; wave-source concept lives in auto_train and is now surfaced on `/auto/:id`.
- HP-importance chart, run tags/notes/search, prediction-log history view, Registry/serving UI, TaskDetail cross-task pattern match.

### Upgrade

```bash
ml-labs update
```

---

## v1.0.0 — 2026-04-21 🎉

**The 1.0 milestone.** ml-labs is now a production platform: train → publish → serve over HTTP → monitor for drift → retrain. Eight ROADMAP phases shipped in sequence; this release closes Phase 8 (production story MVP).

### Added — Phase 8 (production story)

- **Bundle-serving HTTP endpoints** — published models are now servable.
  - `POST /api/registry/:name@:version/predict` — single-sample inference against a registry bundle. Returns `{label, confidence, scores, calibrated, model_uri, latency_ms}`.
  - `POST /api/registry/:name@:version/batch_predict` — batch inference (up to 10,000 rows).
  - Respects Phase 4 **calibration temperature** — confidence scores match what `predict` / `batch_predict` tools return.
  - Respects bundle-stored `normStats` when present.
- **Bearer-token auth** — optional via `NEURON_SERVE_TOKEN` env var. When set, requests without `Authorization: Bearer <token>` return 401. When unset, endpoints are open (single-user default).
- **Prediction logging** — new `predictions` SQL table: `(id, task_id, run_id, model_uri, features JSON, output JSON, ts, latency_ms)`. Every call through the bundle-serving endpoints gets logged. Sampling rate via `NEURON_PREDICTION_SAMPLE_RATE` env var (default `1.0` = 100%, `0` disables).
- **Drift detection** (`core/drift.ts`):
  - PSI (Population Stability Index) with 10-decile reference binning.
  - Two-sample Kolmogorov-Smirnov with Smirnov p-value approximation.
  - Per-feature verdict: `stable` (PSI < 0.1), `drifting` (0.1 ≤ PSI < 0.25), `severe` (PSI ≥ 0.25 or KS p < 0.01), `insufficient_data` (< 30 samples either side).
- **`drift_check` MCP tool** — runs the detection end-to-end: training samples vs last N predictions. Returns structured per-feature report.
- **`/api/tasks/:id/drift` HTTP endpoint** — wraps `drift_check` for dashboard use.
- **`/drift` dashboard route** — per-task drift cards; click to expand and see per-feature PSI / KS p / verdict. Color-coded (green / amber / red).

### Tests

- **181 unit tests** including 15 new for drift (PSI sanity on identical / shifted Gaussians, KS p-value correctness, verdict thresholds, end-to-end report).
- Bench Δ=+0.000 across all 5 datasets — serving infra is purely additive.

### Deferred to Phase 8.5 (future)

- **Shadow / canary routing** — `active_models.weight` column, weighted routing, `shadow_comparisons` table.
- **Auto-retrain banner** — `drift_detected` event → dashboard banner with one-click `/neuron-auto`.
- **ONNX export** — for interoperability with non-rs-tensor runtimes.
- **Integration tests** — HTTP serving latency P99, drift simulation end-to-end.

### The ROADMAP phases

| Phase | Release | Theme |
|---|---|---|
| 1 | v0.7.0 | Test & benchmark foundation |
| 2 | v0.8.0 | Training pipeline fundamentals (CV, stratification, reproducibility) |
| 3 | v0.9.0 | Modern training loop (Adam, LR schedules, mini-batch, activations, CE loss) |
| 4 | v0.10.0 | Calibration & small-model wins (temperature scaling, SWA, label smoothing) |
| 5 | v0.11.0 | Progress streaming + timeout hygiene |
| 6 | v0.12.0 | Smarter AutoML (TPE + meta-tools + rule-effectiveness) |
| 6.5 | v0.12.1 | Diagnoser + rule stats in prompt + typed outputs |
| 7A | v0.13.0 | Active-learning backend (hybrid uncertainty+diversity, auto_collect loop) |
| 7.5 | v0.14.0 | Dashboard UX (multi-run compare, confusion drill-through) |
| **8** | **v1.0.0** | **Production story: serving + logging + drift** |

### Upgrade

```bash
ml-labs update
```

TS/TSX-only; no rs-tensor rebuild. The `predictions` table is auto-migrated via the existing `ensureColumns` pattern.

---

## v0.14.0 — 2026-04-21

### Added — Phase 7.5 (dashboard UX pass)

The dashboard catches up to the backend's intelligence. Three focused UX upgrades shipping in one phase.

- **Multi-run comparison** (`CompareRuns.tsx`): the route now accepts `?runs=1,2,3,4,5,6` — up to **6 runs** overlaid at once. Loss curves share one chart with distinct colors per run; per-class accuracy bars stack; metrics table auto-generates columns. Winner is marked with a ★. Backward compatible with the legacy `?a=X&b=Y` query.
- **Compare checkboxes on Runs** (`RunsAll.tsx`): per-row checkbox, floating "Compare (N)" button appears when ≥ 2 selected. Cap at 6. Clicking compare navigates to `/tasks/:id/compare?runs=…`. Same-task constraint enforced (cross-task selections show an alert).
- **Confusion matrix drill-through** (`RunDetail.tsx` + new API endpoint): every non-zero cell in the confusion matrix is now clickable. Opens a right-side drawer showing the samples where `true=X AND predicted=Y`, sorted by model confidence, with per-class probability breakdown. Uses a new endpoint `GET /api/runs/:id/confusions?true=X&pred=Y` that re-predicts on the fly (respecting calibration temperature from Phase 4) and returns feature vectors + scores.

### New API endpoint

- `GET /api/runs/:id/confusions?true=<label>&pred=<label>` — returns matching samples with features, confidence, and per-class scores.

### Build

- Dashboard still builds cleanly (recharts already was a dep; no new packages).

### Deferred (to a future dashboard polish phase)

- Labeling UI (active-learning visual loop)
- HP-importance chart on sweep results
- Run tags + notes + search
- Training-curves overlay smoothing slider (compare already shows curves; smoothing is a polish pass)

### Upgrade

```bash
ml-labs update
```

TS/TSX-only. No rs-tensor rebuild. `ml-labs dashboard` will rebuild the dashboard `dist/` on next launch thanks to the update-cache-clear logic from v0.4.x.

---

## v0.13.0 — 2026-04-21

### Added — Phase 7A (active-learning backend)

Phase 7 in the ROADMAP bundled active learning (backend) + dashboard UX. Shipping the backend half here; dashboard UX spun out to Phase 7.5 / Phase 8 with explicit retro notes.

- **Hybrid uncertainty + diversity sampling** in `suggest_samples`:
  - New `core/auto/coreset.ts`: `kCenterGreedy(points, k)` (greedy max-min Euclidean distance) + `hybridUncertaintyDiversity(features, uncertainty, k, mult=3)`.
  - `suggest_samples` pipeline: top-3×K by entropy → k-center coreset → top-K ranked output. Avoids picking near-duplicates when many uncertain samples cluster in feature space.
  - Fully backward compatible: existing callers see the same tool surface and sample shape; just smarter picks.
- **`auto_train({ auto_collect: true })`**: opt-in active-learning loop.
  - New `auto_train` params: `auto_collect: boolean` (default `false`) and `max_collect_rounds: number` (default `2`, max `5`).
  - New `neuron.config.ts` extension point: optional `collect(input) => Promise<Sample[]>` where `input = { uncertain_samples, recommendations, per_class }`.
  - Controller flow when enabled: after the main wave loop, if target not hit and `config.collect` exists, up to `max_collect_rounds` iterations of `suggest → collect() → insertSamplesBatch → one extra wave`.
  - No-op when `auto_collect=false` (default) OR no `collect` callback — zero behavior change for existing callers.
- **Typed active-learning types** in `adapter/types.ts`: `CollectRecommendation`, `CollectedSample`.

### Integration test

- `neuron/test/integration/active-learning.ts` — writes a temporary `neuron.config.ts` with a synthetic `collect()` that injects minority-class samples; runs `auto_train` with `auto_collect=true` and `accuracy_target=1.01` (unreachable, forces the loop to iterate).
- Result: 40 samples added across 2 rounds on a 90%-minority-dropped iris.

### Tests

- +11 unit tests (coreset + hybrid): 166 total, ~150 ms.
- Bench Δ=+0.000 across all 5 datasets.

### Deferred (all dashboard work from original Phase 7)

- Dashboard training-curves overlay → Phase 7.5 or folded into the dashboard pass.
- Labeling UI → Phase 7.5.
- Confusion matrix drill-through → Phase 7.5.
- HP-importance chart → Phase 7.5.
- Run tags / notes / search → Phase 7.5.
- **MC-dropout** in rs-tensor → Phase 7.5. Softmax entropy on calibrated outputs is sufficient for our use case without the 2+ hours of Rust backward-pass work.

### Upgrade

```bash
ml-labs update
```

TS-only; no rs-tensor rebuild.

---

## v0.12.1 — 2026-04-21

### Added — Phase 6.5 (Phase 6 deferred items)

- **Diagnoser sub-agent** (`core/auto/diagnoser.ts`): short Claude query (maxTurns 2, strict JSON out), invoked conditionally when a wave completes with `severity=critical` OR `overfit_gap > 0.2`. Output: `{ primary_cause, evidence[], recommendations[], confidence: "high" | "low" }`. Pure-TS rules fallback when Claude unavailable. Logged into `decision_log` with `stage="diagnose"`.
- **Rule stats in planner prompt**: `formatRuleStatsForPrompt(fingerprint, minTrials=5)` formats `rule_effectiveness` data as `"rule A: fires 18 × 9 wins (50%); …"`. Passed through `runPlanner` / `runTournament` and rendered in a "RULE HISTORY" section of the prompt when ≥ 5 trials have accumulated on the fingerprint. Lets the Claude planner learn which rules have paid off on this user's task types.
- **Typed `outputSchema` on 4 high-value tools**: `predict`, `batch_predict`, `evaluate`, `data_audit`. `ToolModule` interface extended; `listTools()` returns `outputSchema` JSON Schema when declared. Claude agents chaining these tools now get structured, validated return shapes.

### Tests

- 155 unit tests (+4 diagnoser tests); bench Δ=+0.000.
- Diagnoser fallback path validated: overfit → "overfitting"; critical underfit → "underfitting"; output shape invariants enforced.

### Deferred permanently

- **Critic-veto loop on TPE**: dropped. TPE numeric sanity checks are sufficient; no concrete failure to justify Claude latency.
- **Typed outputs on remaining 33 tools**: out of scope; a focused "MCP cleanliness" pass will batch them when it's worth doing.

### Upgrade

```bash
ml-labs update
```

TS-only. No rs-tensor rebuild. Fully backward compatible.

---

## v0.12.0 — 2026-04-21

### Added — Phase 6 (smarter AutoML)

Four pieces that take the planner from a "one-shot prompt" to a system with its own memory, search strategy, and ergonomic surface.

- **TPE (Tree-structured Parzen Estimator)** — `neuron/src/core/auto/tpe.ts`. Minimal self-contained implementation: splits observations into top-γ "good" set, samples from it with perturbation (jitter), handles log_uniform / int_uniform / uniform / categorical params. Deterministic with seed. Used by the controller starting at wave 3+ when rules+planner have had their pass.
- **Hybrid controller handoff** — waves 1-2 keep rules + Claude planner. Wave 3+ calls TPE with all prior `RunSignals` as observations. Inherits non-TPE fields (head_arch, activation, loss, …) from the best prior run so modern-variant wins don't get lost.
- **Meta-tools** — `data_audit` (inspect_data + preflight_check, one call) and `auto_preflight` (data_audit + hyperparameter suggestion, with imbalance-aware suggestion). Halves typical Claude-agent tool chains at the start of a session.
- **Rule-effectiveness tracking** — new `rule_effectiveness` SQL table. After each wave, every rule that fired gets a `fired_count++`. After winner selection, the rules that produced the winner get a `produced_winner_count++`. Helpers: `recordRulesFired`, `recordRulesProducedWinner`, `getRuleStats`, `totalTrialsFor`. Fingerprint-scoped, so stats accumulate per (kind, K, D-bucket, N-bucket, imbalance-bucket) cell.

### Schema

- New `rule_effectiveness (rule_name, task_fingerprint, fired_count, produced_winner_count, updated_at)` — keyed by (rule_name, task_fingerprint).

### Tests

- 148 unit tests (+7 for rule-stats, +8 for TPE).
- TPE determinism verified; categorical + numeric perturbation tested.
- Rule-stats: atomic upsert + fingerprint isolation.

### Deferred (with rationale in ROADMAP retro)

- **Diagnoser sub-agent** — Phase 6.5. Separate Claude agent with JSON schema, conditionally invoked on `severity=critical` / `overfit_gap > 0.2`.
- **Typed `outputSchema` on MCP tools** — Phase 6.5. Every tool gets an output schema; wider refactor deserving its own pass.
- **Bayesian optimization beyond TPE (SMAC, BoHB)** — unchanged; defer until TPE proves or fails.

### Backward compat

- Existing benches (iris, wine, breast-cancer, housing, digits) hit target in wave 1 with the Phase 3 modern seed, so TPE doesn't activate and Δ=+0.000 across all datasets.

### Upgrade

```bash
ml-labs update
```

TS-only changes plus a new SQLite table (auto-migrated). No rs-tensor rebuild needed.

---

## v0.11.0 — 2026-04-21

### Added — Phase 5 (progress streaming + timeout hygiene)

Long trainings no longer need the 1-hour timeout band-aid. rs-tensor streams progress back during `train_mlp`, and the MCP client resets the per-call timeout each time a notification arrives — so a training that keeps reporting progress can run indefinitely.

**rs-tensor**:
- `train_mlp` handler reads the caller's `progressToken` from request meta and emits `notify_progress` per epoch with `{ progress, total, message = "epoch X/Y, loss=..., elapsed=..." }`.
- Throttled: max 1 notification per 200 ms wall clock. No-op when caller doesn't supply a token (backward compat — all prior callers work unchanged).
- Handler signature gained `meta: Meta, peer: Peer<RoleServer>` params (the rmcp `#[tool]` macro auto-injects these).

**Neuron**:
- `mcp_client.call()` refactored to take a `CallOpts { timeoutMs, signal, onProgress }` object. Passes `onprogress` + `resetTimeoutOnProgress: true` + `maxTotalTimeout` to the SDK.
- `rsTensor.trainMlp(...)` accepts an `onProgress` callback.
- `trainHead` threads it into rs-tensor; each epoch tick becomes a `TrainProgress{stage="train", i=epoch, n=total}`, and `trainBg`'s existing throttled forwarder writes `run_progress` events to the DB. **Dashboard gets live per-epoch training updates automatically** — no dashboard-side changes needed.

**Timeout strategy**:
- Default per-call timeout: 1 hour → **5 minutes**. That's the idle ceiling; any progress notification resets it.
- `maxTotalTimeout`: **4 hours** hard ceiling regardless of progress resets.
- New env var `RS_TENSOR_MAX_TIMEOUT_MS` overrides the total ceiling for truly long runs. `RS_TENSOR_TIMEOUT_MS` still overrides the per-call timeout.

### Integration test

- `neuron/test/integration/progress.ts`: 3000-epoch training on a 500×32 synthetic dataset with AdamW+ReLU. **Received 199 progress notifications in 41s**, reached epoch 2971/3000, completed without timeout. Proves the end-to-end pipeline.

### Deferred

- **Dashboard live loss sparkline** on ActiveRunCard → Phase 7 (dashboard UX). Events are flowing now; visualization is a small follow-up.
- **Live Claude commentary** (opt-in `auto_train({ live_commentary: true })`) → Phase 6. Planner sub-agent subscribes to progress events and emits notes.
- **Mid-wave cancellation** (NaN detection, fast-convergence early-out) → Phase 6.
- **MCP Tasks adoption (SEP-1686)** — experimental in TS SDK, absent from rmcp 0.16. Revisit when both ship stable support.

### Upgrade

```bash
ml-labs update
```

Rebuilds rs-tensor (new progress emission path). Existing calls without progress tokens produce identical results to v0.10.

---

## v0.10.0 — 2026-04-21

### Added — Phase 4 (calibration & small-model wins)
Goal: predictions you can trust. Accuracy stayed the same; confidence scores became honest.

- **`calibrate(run_id)` MCP tool** — post-hoc temperature scaling (Guo et al. 2017). Log-space grid search over T > 0 minimizing NLL on held-out val logits. Stores T on `runs.calibration_temperature`. Reports ECE before/after.
- **Auto-calibration in `auto_train`** — controller automatically calls `calibrate` on the winning classification run after register_model. Runs with no val split or on regression tasks are skipped with an explicit log line.
- **`predict` / `batch_predict` apply T** — divide logits by T before softmax when the registered model has a calibration temperature. Response includes `calibrated: true | false` so downstream consumers know whether to trust the confidence numbers.
- **SWA (Stochastic Weight Averaging)** in rs-tensor `train_mlp` — new `swa` + `swa_start_epoch` params (default off, start at last 25% of epochs). Maintains running weight average, swaps in at end. Low cost, modest regularization.
- **Label smoothing** in rs-tensor CE loss — new `label_smoothing: f32` param. Replaces one-hot target with `(1 - α) × onehot + α / K uniform`. Standard regularizer for CE training.
- **Rules upgrade** — the seed-wave modern variant enables `label_smoothing=0.1` (classification) and `swa=true` (when `epochs ≥ 200`). Legacy SGD+tanh variant unchanged.

### Tests
- +9 unit tests (`calibration.test.ts`, updated `rules.test.ts`)
- Total: 133 tests, ~115 ms
- Backward-compat bench: Δ=+0.000 on all 5 datasets (calibration doesn't affect argmax; SWA + label smoothing off by default)

### Baseline (v0.9 → v0.10)
No accuracy changes — v0.10 adds honesty to confidence scores, not accuracy. Every classification winner now has `calibration_temperature` populated (range observed: T ∈ [0.22, 0.26]).

### Upgrade

```bash
ml-labs update
```

Rebuilds rs-tensor (new SWA + label smoothing params). Existing calls without new flags produce identical results to v0.9.

---

## v0.9.0 — 2026-04-21

### Added — Phase 3 (modern training loop)
rs-tensor stops being a teaching toy. Every baseline accuracy improved.

**New `train_mlp` capabilities** (all additive; defaults match v0.8 exactly):
- **`optimizer`** — `"sgd"` (default), `"adam"`, or `"adamw"`. Adam/AdamW maintain per-weight first and second moment tensors.
- **`batch_size`** — mini-batch training with per-epoch Fisher-Yates shuffle (seeded).
- **`lr_schedule`** — `"constant"` (default), `"cosine"` (decays `lr → min_lr` over epochs), `"linear_warmup"` (ramps over `warmup_epochs`).
- **`grad_clip`** — clips global L2 norm of gradients.
- **`loss`** — `"mse"` (default) or `"cross_entropy"` (numerically stable softmax+CE for classification; output layer is linear under CE).

**New `init_mlp` capabilities**:
- **`activation`** — `"tanh"` (default), `"relu"`, `"gelu"`, `"leaky_relu"`. Stored per-MLP in a new `meta` map on the `TensorServer`; `train_mlp`, `evaluate_mlp`, `mlp_predict` all respect it.
- **`init`** — `"auto"` (default), `"xavier"`, `"kaiming"`. Auto picks Kaiming for ReLU/GELU/LeakyReLU, Xavier for tanh.

**Neuron plumbing**:
- `TrainHyperparams`, `train` tool schema, `SweepConfig`, `startTrainBackground`, and `runSweepSequential` all thread the new levers end-to-end. The sweep sub-agent prompt forwards them to `mcp__neuron__train`.
- `rsTensor.initMlp` / `.trainMlp` grew typed option bags.

**Rules upgrade**:
- Seed wave now produces `{2 legacy SGD+tanh variants + 1 modern AdamW+ReLU+cosine}` for classification (MSE for regression; CE for classification). The modern variant wins on every benchmark dataset.

**New benchmark**: digits (UCI optdigits, 3823 samples × 64 features × 10 classes). Validates that the modern loop handles realistic multi-class tabular.

### Baseline uplift (Phase 2 → Phase 3)

| Dataset | v0.8 | v0.9 | Δ |
|---|---|---|---|
| iris | 0.800 | **1.000** | +0.200 |
| wine | 1.000 | 1.000 | — |
| breast-cancer | 0.947 | **0.965** | +0.018 |
| housing (R²) | 0.890 | **0.970** | +0.080 |
| digits | — | **0.990** | new |

### Fixed
- `evaluate_mlp` and `mlp_predict` in rs-tensor previously hard-coded tanh activation. They now read from the per-MLP meta and dispatch correctly — otherwise a ReLU-trained MLP would get tanh-evaluated at predict time.

### Upgrade

```bash
ml-labs update
```

**This release rebuilds the rs-tensor binary** — the new levers require the new Rust code. The `update` command hard-exits if the rebuild fails. Existing calls with just `lr` + `epochs` continue to work unchanged.

---

## v0.8.0 — 2026-04-21

### Added — Phase 2 (training pipeline fundamentals)
- **Implicit run context** — every run now records `{neuron_version, git_sha, rs_tensor_sha, hostname, pid, start_ts, rng_seed}` in a new `run_context` JSON column on `runs`. MLflow-style zero-ceremony reproducibility. Surfaced on `GET /api/runs/:id`.
- **Dataset hash** — `dataset_hash` column stores a SHA-256 over `(sample_id, label, features)` triples for each run's training split. Identical data → identical hash, regardless of insertion order. Guards against accidental data drift.
- **K-fold cross-validation** — new `cv_train` MCP tool (tool #35). Runs k training passes with rotating folds (stratified for classification, random for regression), reports mean ± std of the primary metric. Each fold's run is a regular `runs` row linked to an umbrella parent via new `cv_parent_id` and `cv_fold_id` columns.
- **`stratify` param** on `load_csv` — `"auto"` (default) | `true` | `false`. Auto-stratifies for classification, random-splits for regression. Unchanged behavior when omitted; explicit control when needed.
- **`seed` param** on `cv_train` (like `auto_train` / `train` / `load_csv`) — full deterministic reproducibility.
- **Benchmark harness now tracks dataset_hash** — baseline entries include the hash; re-runs fail fast with a clear "dataset_hash drift" error if training data changes.

### Fixed
- **`val_accuracy` was always null** even when a train/test split existed. `startTrainBackground` (the path used by the dashboard, sweep, auto_train, and now cv_train) did not evaluate on held-out test samples. Every caller that looked at `valAccuracy` (overfit detection, winner selection, diagnose) was silently falling back to training accuracy. `trainBg` now runs a post-training evaluation on test samples and stores the real `val_accuracy`.
- **Baseline numbers dropped** as a result of the fix (iris: 0.967 → 0.800, breast-cancer: 0.969 → 0.947). Old numbers were training-set accuracy; new numbers are honest generalization. Baseline regenerated to v0.8.0.

### Refactors (no behavior change)
- `createRun` now takes a `CreateRunOpts` object (previously positional `ownerPid`). All in-tree callers updated.
- `Run.status` type gains `"cv_parent"`.
- `assignSplits` exported from `load_csv.ts` for testability.

### Tests
- +39 unit tests (hash, run-context, stratify, kfold). Total: **123 tests, < 150 ms**.
- Benchmark regenerated with v0.8.0 baselines; hash assertion validated.

---

## v0.7.0 — 2026-04-21

### Added — Phase 1 (test & benchmark foundation)
- **Seedable RNG** (`neuron/src/util/rng.ts`): mulberry32 with shuffle helper. When `load_csv` receives a `seed` param (or the `NEURON_SEED` env var is set), the stratified train/test split becomes fully reproducible. Fall-through to `Math.random` when unseeded.
- **`seed` param** on `load_csv`, `auto_train`, and `train` tools.
- **`NEURON_PLANNER=rules` env var**: forces the controller to skip the Claude planner and use only the deterministic `refineFromSignals` rules. Used by benchmarks and CI.
- **`NEURON_SWEEP_MODE=sequential` env var**: sweep runs via `startTrainBackground` sequentially, no Claude sub-agents. Combined with `NEURON_PLANNER=rules`, gives fully deterministic `auto_train` output.
- **Unit test suite** under `neuron/test/unit/` (85 tests, 2562 assertions, runs in < 40 ms):
  - `rng.test.ts` — determinism, shuffle invariants, seed resolution
  - `signals.test.ts` — convergence_epoch, still_improving, per_class_variance, severityForMetric
  - `rules.test.ts` — each refinement rule (A/B/C/D/E) + seed wave + fallback + regression branch
  - `patterns.test.ts` — fingerprint buckets, save→lookup round-trip, highest-metric wins
  - `verdict.test.ts` — scoreClassification with/without overfit penalty, scoreRegression, summary rendering
- **Benchmark harness** under `neuron/test/bench/`:
  - Datasets: iris, wine, breast-cancer, housing
  - `bun run bench` — full suite; `bun run bench:fast` — iris + wine only; `bun run bench:bless` — (re)write baseline
  - Deterministic: forces `NEURON_PLANNER=rules` + `NEURON_SWEEP_MODE=sequential` + seed=42
  - Regression guard: fails if accuracy drops > 2% (or R² drops > 0.03) vs committed `test/bench/results/baseline.json`
- **Package scripts**: `test`, `bench`, `bench:fast`, `bench:bless`, `ci` (typecheck + unit tests).
- **`bunfig.toml`** preload for unit tests — each worker gets a unique temp DB.

### Refactors (enable testability; no behavior change)
- `computeConvergenceEpoch`, `computeStillImproving`, `computePerClassVariance` are now exported from `signals.ts`.
- `scoreClassification` and `scoreRegression` moved from `controller.ts` → `verdict.ts`.
- `startTrainBackground` accepts `weightDecay` and `earlyStopPatience` params (plumb-through for deterministic benchmarks that want to exercise every lever).

---

## v0.6.2 — 2026-04-20

### Changed
- **rs-tensor MCP call timeout default raised from 30 min → 1 hour.** For the same reasons as v0.6.1 — Tier 3's `still_improving → 2× epochs` refinement on larger datasets regularly pushes into the 30–60 min range. Override via `RS_TENSOR_TIMEOUT_MS` env var.

---

## v0.6.1 — 2026-04-20

### Fixed
- **rs-tensor MCP call timeout raised from 10 min → 30 min.** Long trainings (large N, high epochs, or the Tier 3 "still_improving → 2× epochs" refinement) were being killed mid-loop by the MCP client's 600 s ceiling. Default is now 1 800 s (30 min), and a new `RS_TENSOR_TIMEOUT_MS` env var lets you override it for runs that need even longer (minimum 60 s). Applies to every rs-tensor call — `tensor_create`, `train_mlp`, `evaluate_mlp`, `tensor_inspect`.

---

## v0.6.0 — 2026-04-20

### Added (auto_train Tier 3 — capability expansion)
- **rs-tensor `train_mlp` gains two new optional args**: `weight_decay` (L2 regularizer, default 0) and `early_stop_patience` (stops training when loss has not improved for N consecutive epochs). The response now also carries `epochs_done` and `stopped_early` so the controller can surface whether the budget was fully used.
- **New hyperparameter levers in neuron**: `train` tool, `TrainHyperparams`, `SweepConfig`, and `RunSignals.config` all thread `weight_decay` and `early_stop_patience` end-to-end. The sweep orchestrator's sub-agent prompt forwards both to `mcp__neuron__train`.
- **Refinement rules use the new levers**:
  - Overfit rule (`overfit_gap > 0.15`) now also proposes a `weight_decay=0.01` variant in addition to the shallower-arch variant — proper regularization, not just capacity reduction.
  - "Still improving" rule now attaches `early_stop_patience ≈ 10% of epochs` to the 2× epoch variant as a safety net.
- **Multi-strategy tournament mode** (opt-in via `auto_train({ tournament: true })`): each wave runs 3 planners in parallel with different priors (`aggressive` / `conservative` / `exploratory`). Their configs are merged, deduplicated, and swept together. Trades cost for robustness on hard tasks. Default is single-planner (unchanged behavior).
- **Richer `auto_wave_*` events**: `auto_wave_started` now includes strategy and elapsed_s; `auto_wave_completed` adds `best_overall_run_id/metric`, `configs_tried`, `max_waves`, `elapsed_s`, `eta_s` (based on avg wave duration × remaining waves), `is_overfit`, and `target_reached`. Enables live progress + ETA in the dashboard without changing the SSE channel.

### Breaking
- **Users must run `ml-labs update`** (or `ml-labs build`) to rebuild the rs-tensor binary — older binaries will reject the new `weight_decay` and `early_stop_patience` parameters. The installer already runs `cargo build --release --bin mcp` via the `update` path.

---

## v0.5.0 — 2026-04-20

### Changed (major internal rewrite — public tool signature unchanged)
- **auto_train Tier 2: Controller + Planner architecture.** The monolithic 40-turn Claude coordinator (`core/auto/coordinator.ts`) is replaced by a deterministic TypeScript state machine (`core/auto/controller.ts`) that owns the budget, wave loop, winner selection, and all DB writes. Claude is now invoked only via a narrow per-wave **planner** (`core/auto/planner.ts`) whose single job is "given these signals, return JSON configs for the next wave."
  - Deterministic outcomes: two `auto_train` invocations on the same task now produce the same wave-2 grid when signals match.
  - Diagnosis, promotion, and publish are pure TS — no more prose-driven Claude reasoning about severity buckets.
  - Training is still parallel (reuses the existing `runSweep()` sub-agent orchestrator).

### Added
- **Signal aggregator** (`core/auto/signals.ts`): typed `SignalBundle` carrying data health, current-wave run signals (overfit_gap, still_improving, convergence_epoch, per_class_variance, severity), and target metric. Single source of truth for what the planner sees.
- **Pure-TS refinement rules** (`core/auto/rules.ts`): `refineFromSignals()` implements the Tier 1 rules (still_improving → 2× epochs, overfit_gap > 0.15 → shallower arch + fewer epochs, early convergence → finer lr, critical underfit → wider hidden, high per-class variance → class_weights=balanced). Used as the deterministic fallback when the planner is unavailable.
- **Claude planner** (`core/auto/planner.ts`): short `query()` call (maxTurns 2) with strict JSON output schema `{configs, rationale, rules_fired}`. On parse failure, falls through to rules.ts. Reads back recent decision_log entries for reflection.
- **Cross-task memory** (`core/auto/patterns.ts`, `auto_patterns` table): tasks are fingerprinted by `(kind, K, D-bucket, N-bucket, imbalance-bucket)`. Prior winning configs warm-start new runs for similar tasks.
- **Structured verdict** (`core/auto/verdict.ts`, new `auto_runs.verdict_json` column): `{status, winner: {run_id, metric_value, is_overfit, confidence, config}, attempted, data_issues, next_steps, summary}`. The one-line `verdict` string is kept for backward compat. `auto_train` return value now includes `verdict_json`.
- **New AutoRun status** `"no_improvement"`: distinct from `"failed"` and `"budget_exceeded"` — coordinator finished cleanly but didn't hit the target.
- **New events**: `auto_wave_started`, `auto_wave_completed` emit per wave for dashboard live updates.
- **class_weights threading through sweep**: `SweepConfig` now includes `class_weights`, and `runOneConfig()` forwards it to the `train` tool call.

### Removed
- `neuron/src/core/auto/coordinator.ts` and `neuron/src/core/auto/prompt.ts` — replaced by controller + planner. The `runCoordinator` export no longer exists; callers should use `runController` from `core/auto/controller.ts`.

---

## v0.4.2 — 2026-04-20

### Added
- **auto_train Tier 1 upgrade** — the coordinator is now signal-driven, regression-aware, overfit-aware, and budget-hard-capped. Same `auto_train` tool signature; richer decisions under the hood.
  - **Expanded tool allowlist** — coordinator now gets `inspect_data`, `get_training_curves`, `compare_runs`, `model_stats` in addition to the prior 11 tools.
  - **Structured refinement grid** — wave 2 is no longer a prose paragraph. Replaced with explicit signal-driven rules: `still_improving` → 2× epochs; `overfit_gap > 0.15` → fewer epochs + shallower arch; early convergence → finer LR; critical underfit → wider hidden layers; high per-class variance → add `class_weights="balanced"` variant. Reproducible across runs.
  - **Regression-aware procedure** — coordinator branches on `task.kind`. For regression, target is R² instead of accuracy, diagnosis uses R² buckets, classification-only tools (`suggest_samples`, class weighting) are skipped.
  - **Imbalance-aware suggest_hyperparams** — `suggest_hyperparams` accepts optional `data_health.imbalance_ratio`; when > 3, the sampling prompt and heuristic fallback flag `class_weights="balanced"`. Coordinator calls `inspect_data` first and threads the ratio in.
  - **Overfit-aware winner selection** — winner is chosen by val_accuracy when available; if `train - val > 0.15`, apply penalty `score = val_acc - 0.5 × (train - val)`. Prevents promoting overfit runs.
  - **Hard budget enforcement** — coordinator is now killed via `AbortSignal` at `budget_s × 1.1` seconds. New `AutoRun.status` value `"budget_exceeded"` recorded on overrun instead of silent overrun.

---

## v0.4.1 — 2026-04-20

### Fixed
- `imbalance_ratio` was computed in `inspect_data` but never included in the API response — now returned as `imbalance_ratio` (float, null for regression).
- `configPath` was hardcoded to `null` in `GET /api/config` even when a config was loaded — now returns the resolved filesystem path.
- `loadConfig()` global cache would serve stale config if the MCP server and HTTP API processes resolved different working directories — cache is now invalidated on cwd mismatch.
- `sweep_progress` events were never emitted during a sweep — each config completion now fires a `sweep_progress` event with `idx`, `total`, `accuracy`, and `status`.

### Added
- `POST /api/tasks/:id/suggest_samples` — HTTP endpoint wrapping the `suggest_samples` MCP tool so the dashboard can call active-learning analysis directly.
- `api.suggestSamples(taskId, opts?)` client helper in `dashboard/src/lib/api.ts`.

---

## v0.4.0 — 2026-04-20

### Added
- **rs-tensor stdio integration** — eliminates the Cloudflare tunnel and HTTP timeout issues. rs-tensor is now vendored as a git submodule (`rs-tensor/`) and built locally via `cargo build --release --bin mcp`. Neuron communicates with it over a long-lived stdio MCP connection (`StdioClientTransport`), avoiding all network overhead. `RS_TENSOR_MCP_URL` still works as an HTTP override for remote setups.
- **`ml-labs build`** command — manually rebuilds the rs-tensor binary after editing Rust source. `ml-labs update` now also runs an incremental cargo rebuild automatically.
- **Cargo prereq check** in `install.sh` — installer fails fast with a helpful message if `cargo` is not installed.
- **Dashboard server status** — sidebar "Servers" section now shows both `neuron` and `rs-tensor` pills. rs-tensor shows three states: `not built` (binary missing), `ready` (binary exists, idle), `online` (actively connected), plus `stdio`/`http` mode label.
- **Dashboard liveness (P0)** — the dashboard now shows live activity during training:
  - `ActivityFeed`: collapses consecutive `run_progress` rows by run ID, raises cap to 15 events, renders all event kinds with icons and colors.
  - `ActiveJobPill` in sidebar shows current stage + spinner during any training activity.
  - `ActiveRunCard` component: stage pill, featurize/eval progress bar, live elapsed ticker, hyperparams. Shown on Overview (LiveStrip) and TaskDetail (inline above runs table).
  - `RunsAll`: live elapsed ticker and pulsing "training…" dot for running runs.
  - `/activity` route: full paginated event log with kind/task/source filters.
- **Richer backend events**:
  - `run_stage` — unthrottled event on each stage transition (featurize → tensors → init → train → eval → weights).
  - `run_progress` — now includes `i`, `n` (sample count progress).
  - `run_completed` — now carries `numClasses`, `epochsDone`, `confusionMatrix` (≤10 classes).
  - `model_registered` — now emitted from both `register_model` tool and `trainBg` auto-promote.
  - `auto_started` / `auto_note` / `auto_completed` — full lifecycle events for `/neuron-auto` coordinator runs.
  - `tool_call` payloads enriched with `lr`, `epochs`, `accuracy_target`, `totalConfigs`, `path` for high-signal tools.

### Fixed
- `suggest_hyperparams` now loads `neuron.config.ts` and hard-pins `headArchitecture` — previously the user's custom architecture was silently ignored in both the sampling prompt and the heuristic fallback.
- Sweep orchestrator `maxTurns` raised from 8 → 20, preventing wave-2 sub-agent failures on tasks with many classes.
- Dashboard restart: port-free wait loop now always runs regardless of whether `lsof` found a PID, preventing a bind race on re-invoke.

---

## v0.3.0 — 2026-04-20

### Added
- **Terminal ↔ Dashboard bridge** — every MCP tool call and run lifecycle event is written to a shared `events` SQLite table, streamed to the browser via SSE (`GET /api/events`). Dashboard shows a live activity feed with click-through links and auto-refreshes React Query caches on `run_completed`/`sweep_completed`.
- **Toast notifications** — `run_completed`, `sweep_completed`, `model_registered` pop a 4s toast in the dashboard bottom-right corner.
- **`GET /api/config`** — exposes the project's `neuron.config.ts` (feature shape, default hyperparams, presence of `featurize`/`headArchitecture`/`decodeImage` functions). Dashboard shows a Config card on the Overview page.
- **Ask Claude channel** — floating "Ask Claude" button in the dashboard POSTs questions to `POST /api/requests`, writes to `data/requests.jsonl`. New `/neuron-ask` slash command reads the file and POST answers back via `POST /api/requests/:id/response`. Answers appear inline in the dashboard.
- **`/neuron-show` slash command** — navigates the browser to a task/run detail page, screenshots it, and describes what's visible (uses globally installed chrome-devtools MCP).
- **`neuron-ui` skill** — teaches Claude the dashboard route map and verification workflow.
- **`CLAUDE.md` template** — `ml-labs init` now writes `CLAUDE.md` to every new project with tool reference, slash command list, and dashboard conventions.
- **`events` DB table** — `id`, `ts`, `source` (mcp/api/tui/user), `kind`, `task_id`, `run_id`, `payload` JSON. Indexed by `ts DESC` and `(task_id, ts DESC)`.

### Fixed
- `NEURON_DB_PATH` and `NEURON_DB` env vars now both accepted in `schema.ts` — prevents MCP server and HTTP API pointing at different databases when launched by `ml-labs dashboard`.
- `bun run build` no longer fails due to `react-devtools-core` missing from ink's optional devtools shim (`--external react-devtools-core` added to build script).
- All e2e test files replaced hardcoded `/Users/yab/…` absolute paths with `import.meta.dir`-relative paths — tests now run from any install location.

---

## v0.2.0 — 2026-04-20

### Added
- **Cross-session predict** — weights restore lazily from SQLite into rs-tensor on first predict after server restart. No retraining needed.
- **`suggest_samples`** (tool #30) — active learning: batch-evaluates all samples in one rs-tensor call, returns per-class accuracy/confidence stats, surfaces uncertain and misclassified rows, emits data-collection recommendations.
- Coordinator prompt updated: if accuracy < target after all waves, coordinator calls `suggest_samples` and includes per-class recommendations in the verdict.
- `rsTensor.restoreMlp()` helper — calls `init_mlp`, then overwrites each weight tensor from the DB. Architecture inferred from weight shapes when not stored explicitly.
- Phase 5 e2e test: `neuron/test/e2e_phase5.ts` — kills and restarts the server between sessions to verify cross-session predict.

---

## v0.1.4 — 2026-04-19

### Added
- **`auto_train`** — spawns a Claude coordinator sub-agent (40 turns, 11-tool allowlist) that runs the full pipeline: preflight → suggest → sweep wave(s) → evaluate → diagnose → promote → optional publish. Returns verdict + decision log.
- **`get_auto_status`** — reads live decision log for an ongoing or completed auto_run, cross-process via SQLite WAL.
- **`log_auto_note`** (internal) — coordinator writes timestamped decision log entries to `auto_runs.decision_log`.
- `run_sweep` gains `wave_size` parameter — stages configs into sequential batches. Existing callers unaffected.
- `auto_runs` table — tracks coordinator invocations with decision_log (JSON array), status, waves_used, winner_run_id, verdict.
- `/neuron-auto <task_id>` slash command.
- Tool count: 28 (27 user-facing + 1 internal).

---

## v0.1.3 — 2026-04-19

### Added
- **`run_sweep`** — parallel hyperparam grid search via Claude Agent SDK sub-agents. `concurrency` controls parallelism; `promote_winner` auto-promotes the best run.
- **`publish_model`** — writes bundle to `~/.neuron/registry/` (weights + metadata + adapter hash).
- **`import_model`** — pulls from registry, creates task + synthetic run with `status='imported'`.
- **`list_registry`** — lists `~/.neuron/registry.db` entries, filterable by kind/tag.
- **`load_model`** — loads registry weights into an existing task without retraining.
- Claude Code skills and slash commands under `.claude/` (8 commands + SKILL.md).
- DB: WAL mode, `runs.run_progress`, `runs.owner_pid`, `runs.source_uri`.
- Tool count: 25.

---

## v0.1.2 — 2026-04-19

### Added
- **Ink TUI** — 5-screen terminal dashboard: Dashboard, Dataset, Train, Runs, Predict.
- **`load_csv`** / **`load_json`** / **`load_images`** — batch data loaders.
- **`get_run_status`** — live training progress, cross-process via DB.
- **`list_tasks`** — tasks with sample counts, accuracy, active run.
- Iris classifier demo verified at 98.7% accuracy.
- Tool count: 20.

---

## v0.1.1 — 2026-04-19

### Added
- 16-tool MCP server, SQLite persistence (tasks/samples/runs/models), adapter pattern (`neuron.config.ts`), rs-tensor integration.
- XOR verified at 100%.
- Tool count: 16.

---

## v0.1.0 — 2026-04-19

### Added
- Initial project scaffolding.
- rs-tensor MCP server wired via `.mcp.json`.
