import { PageHeader } from "../components/PageHeader"
import { motion } from "framer-motion"

interface Release {
  version: string
  date: string
  tag?: string
  tagColor?: string
  tagline?: string
  items: { label: string; desc: string }[]
}

/**
 * Canonical source of truth: /CHANGELOG.md at the repo root.
 * Keep the two in sync when cutting a release.
 */
const releases: Release[] = [
  {
    version: "1.10.1",
    date: "2026-04-24",
    tag: "latest",
    tagColor: "chip-green",
    tagline: "Docs refresh — 10 new pages, 3 new components, every stale claim replaced.",
    items: [
      { label: "10 new pages", desc: "Memory Budget, Auto-Train Deep Dive, Sweep Modes, Validation & Reliability, LLM / GGUF, HTTP Dashboard, TUI, Training Config, Events & Observability, Benchmarks." },
      { label: "Every existing page refreshed", desc: "Home (43 tools / 8 superpowers), Install (new CLI commands), QuickStart (9 skills), Architecture (full current DB schema), TrainingFlow (9-step flow), SweepsAuto (no longer lies about sub-agent defaults), RegistryLearning (bundle round-trip + auto_collect), CliReference (6 commands)." },
      { label: "Tool Reference rewritten", desc: "43 tools, 10 previously uncovered (cv_train, calibrate, drift_check, data_audit, auto_preflight, cancel_auto_train, log_auto_note, llm_load, llm_generate, llm_inspect). 3 new categories: Validation, Monitoring, LLM." },
      { label: "Changelog — 6 → 33 entries", desc: "Caught up from v0.2.1 through v1.10.1 with plain-English taglines per release." },
      { label: "3 new shared components", desc: "Table, Callout (note/warn/tip/success/learn), AsciiDiagram — used across every new page." },
      { label: "Two new sidebar sections", desc: "Deep Dives (6 entries) and Surfaces (3 entries)." },
      { label: "Non-changes", desc: "No runtime / MCP / training behavior changed. Docs-only release." },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-04-21",
    tagline: "auto_train lifecycle bug hunt.",
    items: [
      { label: "Bug A — val accuracy now populated on sub-agent sweeps", desc: "The MCP train path never ran held-out evaluation, so sub-agent runs came back with val_accuracy=null and winner selection fell back to training accuracy. Factored a shared evalValAccuracy helper; both paths now populate identically." },
      { label: "Bug B — orphan children reaped on coordinator exit", desc: "When the budget timer aborted a sweep mid-wave, child runs that already inserted DB rows were left stuck in status='running'. Added listRunningRunsForTaskSince DB scan + union with the in-process registry." },
      { label: "Bug C — honest configs_tried in verdict", desc: "Previous counter only included runs whose result reached the orchestrator. A 'budget exceeded after 0 configs' message when 2 configs had actually spawned was a common complaint. Now uses max(completed_results, db_count)." },
      { label: "Bug D (debunked) — accuracy=1.0 with loss≈0.5 is fine", desc: "Label smoothing with α=0.1 on 10 classes has entropy floor ≈0.5003. The model reached perfect top-1 argmax while hitting minimum possible cross-entropy. Not a bug; just math." },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-04-22",
    tagline: "Dry-run preview + live ETA.",
    items: [
      { label: "auto_train({ dry_run: true })", desc: "Returns the plan (budget level, seed configs, sweep mode, wall-clock estimate) WITHOUT starting training. Used by Claude to confirm heavy workloads before committing." },
      { label: "Live ETA on dashboard", desc: "ActiveRunCard + RunDetail show elapsed / ~eta and ms/epoch. Computed from the run's actual per-epoch cost." },
      { label: "Skill updates", desc: "neuron-auto and neuron-ui skills refreshed to use the new dry_run flow." },
    ],
  },
  {
    version: "1.8.2",
    date: "2026-04-22",
    tagline: "Fixed a pathological seed architecture on Fashion-MNIST.",
    items: [
      { label: "Hidden layer capped at min(128, max(D, 32))", desc: "Previous seed arch [784, 784, 10] had 622k weights — 14s/epoch. New cap [784, 128, 10] has 101k — 3s/epoch, same final accuracy." },
      { label: "Also fixed a cosine schedule bug that left lr at 0 for the tail", desc: "min_lr clamp was off-by-one; now respects min_lr even at the final epoch." },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-04-22",
    tagline: "Sweeps got 3× faster on small data.",
    items: [
      { label: "Adaptive sweep mode", desc: "auto_train now picks sub-agents for safe/advisory workloads and sequential for heavy/refuse. Combines v1.7.0's safety with v1.6.x's parallelism where it's safe." },
      { label: "Slimmed seed wave", desc: "First wave now 3 configs instead of the previous 5 — fewer sub-agents to boot, faster to first metric." },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-04-22",
    tagline: "Memory budget guardrail.",
    items: [
      { label: "core/memory_budget.ts", desc: "Estimator that tags every workload as safe / advisory / heavy / refuse by N × D. load_csv, inspect_data, and data_audit return a training_budget field." },
      { label: "auto_train refuse + force", desc: "Refuse-level workloads block auto_train unless force: true is passed. Prevents 8GB-laptop crashes." },
      { label: "auto_train({ dry_run: true }) groundwork", desc: "Preview plumbed through; polished to the public API in v1.9.0." },
    ],
  },
  {
    version: "1.7.2",
    date: "2026-04-21",
    tagline: "Terminal log visibility.",
    items: [
      { label: "Training start banner", desc: "'Training started: N epochs × D samples' now printed so the MCP terminal log stays alive during long trainings." },
      { label: "10%-or-30s periodic epoch log", desc: "A heartbeat line in the MCP log every 10% of epochs or 30s, whichever first. Users watching the terminal stop worrying the process has stalled." },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-04-21",
    tagline: "Fashion-MNIST OOM fix.",
    items: [
      { label: "Streaming sample ingestion", desc: "trainHead used to materialize three full [N][D] array copies in JS. On 60k × 784, peak heap hit ~3GB. New path fills ONE flat array and normalizes in place — ~380MB for the same dataset." },
      { label: "streamSamplesByTaskAndSplit", desc: "bun:sqlite .iterate() cursor. Used by trainBg and tools/train.ts for val eval — no full materialization of the test set either." },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-04-21",
    tagline: "Sweep default flipped to in-process sequential.",
    items: [
      { label: "runSweepSequential as the default", desc: "Before this release, run_sweep always spawned Agent SDK sub-agents. For heavy workloads, 3 sub-agents × ~1GB each = 8GB-laptop OOM. New default runs configs one-at-a-time in the same process." },
      { label: "NEURON_SWEEP_MODE env var", desc: "Set to 'sub_agents' to restore the old parallel behavior where you know you have headroom." },
    ],
  },
  {
    version: "1.6.3",
    date: "2026-04-21",
    tagline: "load_csv crash on large files.",
    items: [
      { label: "Batched inserts", desc: "load_csv previously built one giant INSERT with 130k+ parameters — SQLite choked. Now chunks into 500-row batches inside a transaction." },
      { label: "max_bytes and csv_load_* events", desc: "500MB default cap, override with max_bytes. Progress events for the dashboard." },
    ],
  },
  {
    version: "1.6.2",
    date: "2026-04-21",
    tagline: "publish_model / export_model round-trip.",
    items: [
      { label: "export_model({ bundle_path })", desc: "Writes a directory (meta.json + weights.json + adapter.hash) matching publish_model's format. import_model({ bundle_path }) consumes it." },
      { label: "Interop with a remote registry", desc: "Bundle format is now stable and self-describing; safe to tar and ship between machines." },
    ],
  },
  {
    version: "1.6.1",
    date: "2026-04-21",
    tagline: "Real-project bug sweep.",
    items: [
      { label: "cv_train(autoRegister=false)", desc: "Per-fold runs no longer clobber the actual winner. register_model now returns train_accuracy and val_accuracy separately with accuracy_source." },
      { label: "suggest_samples normalization fix", desc: "Was feeding unnormalized features to the predictor when the task had normalize=true, producing wrong uncertainty scores." },
      { label: "predict now logs each call", desc: "Every predict/batch_predict writes to the predictions table for drift_check to use later." },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-04-21",
    tagline: "Planner prompts stopped lying.",
    items: [
      { label: "suggest_hyperparams surface modernized", desc: "Now returns optimizer, activation, lr_schedule, loss, batch_size, weight_decay, early_stop_patience, label_smoothing, SWA with reasoning — caught up with what train actually accepts." },
      { label: "rule_explanations on planner output", desc: "Each rule that fires attaches { name, title, why, evidence[] } so the dashboard can render 'this is why we chose this config' without re-running the planner." },
      { label: "Loss curve passed to diagnoser", desc: "Diagnoser sub-agent now sees the actual loss history, not just final accuracy. Catches plateaus and overfitting spikes." },
    ],
  },
  {
    version: "1.5.1",
    date: "2026-04-21",
    tagline: "Skill + CLAUDE.md refresh.",
    items: [
      { label: "neuron skills updated", desc: "All 9 slash commands (neuron-auto, neuron-ask, neuron-diagnose, neuron-import, neuron-train, neuron-tui, neuron-ui, neuron-inspect, neuron-load) refreshed to current tools." },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-04-21",
    tagline: "LLM playground + in-browser labeling.",
    items: [
      { label: "llm_load / llm_generate / llm_inspect", desc: "CPU-only LLaMA inference via rs-tensor GGUF loader. One model at a time, ~5-10 tok/s on a 1B." },
      { label: "/label dashboard route", desc: "In-browser labeler for raw/uncertain samples. Surfaces suggest_samples output and lets you fix labels without the command line." },
      { label: "/playground dashboard route", desc: "LLM playground UI — paste GGUF path, type prompt, watch tokens stream." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-04-21",
    tagline: "Batch prediction live status + Ask Claude.",
    items: [
      { label: "batch_predict live status", desc: "Predictions write to the batch_predict_* event stream — dashboard shows live row-by-row progress." },
      { label: "AskClaude widget", desc: "Dashboard side panel that lets you ask Claude about the current task without leaving the UI." },
    ],
  },
  {
    version: "1.3.x",
    date: "2026-04-21",
    tagline: "Dashboard polish + compare_runs.",
    items: [
      { label: "compare_runs tool", desc: "Side-by-side hyperparams + metrics for any N run ids." },
      { label: "RunDetail confusion matrix renderer", desc: "Dashboard shows the matrix with labels and per-cell counts instead of a flat JSON blob." },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-04-21",
    tagline: "data_audit + auto_preflight.",
    items: [
      { label: "data_audit tool", desc: "One call that combines inspect_data + preflight_check. Shortens the usual 2-3 tool chain at session start." },
      { label: "auto_preflight tool", desc: "data_audit + suggest_hyperparams wrapped. Returns suggestions only when the data is ready." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-04-21",
    tagline: "Shadow mode + auto-retrain banner.",
    items: [
      { label: "Shadow models", desc: "attach_shadow runs a second model in parallel with the active one on every predict. shadow_promoted event fires when it outperforms. Lets you A/B new models with zero downtime." },
      { label: "Auto-retrain banner", desc: "Dashboard surfaces a 'drift detected — consider retraining' banner when drift_check verdicts go severe." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-04-21",
    tagline: "The &ldquo;production story&rdquo; release.",
    items: [
      { label: "Phase 8 — production readiness", desc: "calibrate, drift_check, shadow models, predictions table, cross-process reapers. The full reliability toolkit." },
      { label: "predictions table", desc: "Every predict/batch_predict writes here. Source of truth for drift_check and for auditing what the model did in production." },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-04-21",
    tagline: "Phase 7.5 — dashboard UX pass.",
    items: [
      { label: "Phase 7.5 dashboard polish", desc: "Cleaner navigation, live event feed, better empty states, mobile-friendly layouts." },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-04-21",
    tagline: "Phase 7A — active-learning backend.",
    items: [
      { label: "auto_collect in auto_train", desc: "Post-training active-learning loop: suggest_samples → collect() callback → re-train. Opt-in via auto_collect: true." },
      { label: "suggest_samples respects normalize", desc: "Fixed in v1.6.1; first shipped here." },
    ],
  },
  {
    version: "0.12.x",
    date: "2026-04-21",
    tagline: "Phase 6 — smarter AutoML.",
    items: [
      { label: "Pattern memory", desc: "auto_patterns table: task_fingerprint → best_config. Warm-start the next auto_train on a similar dataset from a prior winner." },
      { label: "TPE planner", desc: "Tree-structured Parzen Estimator for wave 2+ once enough observations exist. Purely TS, no LLM." },
      { label: "Tournament mode", desc: "auto_train({ tournament: true }) spawns 3 parallel planners (aggressive/conservative/exploratory) per wave and merges proposals." },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-04-21",
    tagline: "Phase 5 — progress streaming + timeout hygiene.",
    items: [
      { label: "auto_wave_started / auto_wave_completed events", desc: "Live partial verdicts after each wave. Dashboards subscribe for real-time progress." },
      { label: "Budget AbortController in controller", desc: "Hard timeout enforcement (budget_s × 1.1). auto_train can no longer run past budget indefinitely." },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-04-21",
    tagline: "Phase 4 — calibration & small-model wins.",
    items: [
      { label: "calibrate tool", desc: "Temperature scaling on held-out val. Reports ECE before/after. Stored on runs.calibration_temperature." },
      { label: "Small-model wins", desc: "Baselines improved across all 5 benchmarks after more careful hyperparameter defaults." },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-04-21",
    tagline: "Phase 3 — modern training loop.",
    items: [
      { label: "AdamW / Adam / SGD in train_mlp", desc: "Full modern optimizer family. Pair with weight_decay for decoupled L2 regularization." },
      { label: "cosine + linear_warmup schedules", desc: "lr_schedule arg exposed in train + suggest_hyperparams. Cosine decay pays off on longer trainings." },
      { label: "Early stopping", desc: "early_stop_patience arg — training exits early when loss plateaus." },
      { label: "Label smoothing + SWA", desc: "Classification regularizers. suggest_hyperparams recommends them for harder tasks." },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-04-21",
    tagline: "Phase 2 — training pipeline fundamentals.",
    items: [
      { label: "cross_entropy loss", desc: "Replaced the MSE-on-one-hot path for classification. Numerically stable and the modern default." },
      { label: "ReLU / GELU / leaky_relu activations", desc: "activation arg on train. Auto init-strategy selection (Xavier for tanh, Kaiming for ReLU family)." },
      { label: "grad_clip", desc: "L2 gradient norm clip. Stabilizes high-lr training." },
      { label: "Mini-batch SGD", desc: "batch_size arg — proper mini-batch training with shuffle per epoch." },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-04-21",
    tagline: "Phase 1 — test & benchmark foundation.",
    items: [
      { label: "5-dataset benchmark suite", desc: "iris, wine, breast-cancer, housing, digits. Deterministic mode (seed+planner=rules+sequential). Blessed baseline.json catches silent regressions." },
      { label: "bun run bench / bench:fast / bench:bless", desc: "package.json scripts for running, running a subset, and blessing a new baseline." },
    ],
  },
  {
    version: "0.6.x",
    date: "2026-04-20",
    tagline: "auto_train Tier 3.",
    items: [
      { label: "Tournament mode (Tier 3)", desc: "Multi-strategy parallel planners. First-pass implementation; polished in v0.12.x." },
      { label: "Opt-in active-learning loop (Phase 7 prep)", desc: "auto_collect plumbing added. User callbacks wired in v0.13.0." },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-04-20",
    tagline: "Major internal rewrite — Claude coordinator → TS controller.",
    items: [
      { label: "runController in core/auto/controller.ts", desc: "Deterministic TS state machine owns orchestration (budget, DB writes, winner selection). Claude called only for planning (planner.ts) and diagnosis (diagnoser.ts)." },
      { label: "Structured verdict JSON", desc: "StructuredVerdict schema (status / winner / attempted / data_issues / next_steps) replaces the ad-hoc string verdicts. Stored in auto_runs.verdict_json." },
    ],
  },
  {
    version: "0.4.x",
    date: "2026-04-20",
    tagline: "auto_train Tier 2 — structural.",
    items: [
      { label: "collectSignals()", desc: "Single source of truth for what planners see. Structured SignalBundle replaces raw DB row digging." },
      { label: "Cross-task pattern memory", desc: "auto_patterns table + taskFingerprint() — warm-start from prior winners." },
      { label: "Reflection via decision_log read-back", desc: "Planners see the last ~6 decision log entries and can reason about what's been tried." },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-04-20",
    tagline: "auto_train Tier 1 — tactical fixes.",
    items: [
      { label: "Expanded coordinator tool allowlist", desc: "get_training_curves, inspect_data, compare_runs, model_stats added so the coordinator can actually see what's happening mid-run." },
      { label: "Structured refinement grid", desc: "Wave 2 configs chosen by explicit signal-driven rules (if still_improving → more epochs, if overfit_gap → smaller arch) instead of free-form planner output." },
      { label: "Overfit-aware winner selection", desc: "scoreClassification applies a penalty when train-val gap > 0.15. Prevents memorizers from winning." },
      { label: "Regression-aware procedure", desc: "auto_train now treats regression tasks on their own terms — R² target, no class_weights, no suggest_samples." },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-04-20",
    tagline: "Splits, normalization, regression, and a health check.",
    items: [
      { label: "Train/test split", desc: "load_csv gains test_size (0–0.5) for stratified splits. train only uses the train split; evaluate reports both accuracies." },
      { label: "Z-score normalization", desc: "create_task normalize=true. Stats computed from training data, stored per run, applied transparently at predict time." },
      { label: "Regression tasks", desc: 'kind="regression": single K=1 output, min-max scaled targets, MAE/RMSE/R² metrics, value returned from predict.' },
      { label: "Class weights", desc: 'train class_weights="balanced" oversamples minority classes to equal the majority count.' },
      { label: "inspect_data, get_training_curves, model_stats", desc: "First observability pass. Data health checks, loss-curve signals, confidence histograms." },
      { label: "batch_predict", desc: "Run inference over a CSV file with optional accuracy scoring when a label column is provided." },
      { label: "Bundled examples", desc: "ml-labs init copies iris.csv (150 rows) and housing.csv (71 rows, regression) into new projects." },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-04-20",
    tagline: "The CLI + install story.",
    items: [
      { label: "ml-labs CLI", desc: "init, update, docs commands. curl | bash installer writes a shell wrapper to ~/.local/bin/ml-labs." },
      { label: "install.sh", desc: "One-liner installer: clones ~/.ml-labs, installs deps, builds docs, patches PATH." },
      { label: "Docs site", desc: "This site. React + Vite." },
      { label: "Cross-session predict", desc: "Weights restore lazily from SQLite into rs-tensor on first predict after server restart." },
      { label: "suggest_samples", desc: "Active learning: batch-evaluate all samples, surface uncertain/misclassified rows, emit data-collection recommendations." },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-04-19",
    tagline: "auto_train is born.",
    items: [
      { label: "auto_train (Claude-coordinator version)", desc: "Coordinator sub-agent (40 turns, 11-tool allowlist): preflight → suggest → sweep → evaluate → diagnose → promote. Replaced by the TS controller in v0.5.0." },
      { label: "get_auto_status", desc: "Live decision log cross-process via SQLite WAL." },
      { label: "wave sweeps", desc: "run_sweep gains wave_size — stages configs into sequential batches." },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-04-19",
    tagline: "Parallel sweeps + the registry.",
    items: [
      { label: "run_sweep", desc: "Parallel hyperparam grid search via Agent SDK sub-agents. concurrency + promote_winner." },
      { label: "Model registry", desc: "publish_model, import_model, load_model, list_registry. URI: neuron://local/<name>@<version>." },
      { label: "Claude Code skills", desc: "8 slash commands + SKILL.md under .claude/." },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-04-19",
    tagline: "TUI + batch loaders.",
    items: [
      { label: "Ink TUI", desc: "5-screen terminal dashboard: Dashboard, Dataset, Train, Runs, Predict." },
      { label: "Batch loaders", desc: "load_csv, load_json, load_images." },
      { label: "get_run_status", desc: "Live training progress cross-process via DB." },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-04-19",
    tagline: "First MCP server.",
    items: [
      { label: "16-tool MCP server", desc: "SQLite persistence, adapter pattern (neuron.config.ts), rs-tensor integration." },
      { label: "XOR verified", desc: "100% accuracy on XOR problem." },
    ],
  },
]

const tagColors: Record<string, string> = {
  "chip-green": "bg-green-neon/10 text-green-neon border border-green-neon/30",
  "chip-cyan":  "bg-cyan-neon/10 text-cyan-neon border border-cyan-neon/30",
}

export function Changelog() {
  return (
    <div>
      <PageHeader
        eyebrow="Version history"
        accent="pink"
        title={<>What's <span className="gradient-text">changed.</span></>}
        lede="ML-Labs ships fast. Every release adds tools, fixes bugs, or makes the install story better. Latest is always at the top. Full source of truth: CHANGELOG.md at the repo root."
      />

      <div className="space-y-8">
        {releases.map((r, i) => (
          <motion.div
            key={r.version + r.date}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.02, 0.15) }}
            className="lab-panel p-6 md:p-7"
          >
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <h2 className="text-xl font-bold font-mono text-lab-heading">v{r.version}</h2>
              {r.tag && (
                <span className={`text-xs font-mono px-2 py-0.5 rounded-md ${tagColors[r.tagColor ?? "chip-green"]}`}>
                  {r.tag}
                </span>
              )}
              <span className="text-sm text-lab-muted ml-auto font-mono">{r.date}</span>
            </div>
            {r.tagline && <div className="text-sm text-lab-text/70 italic mb-4">{r.tagline}</div>}
            <ul className="space-y-3">
              {r.items.map((item) => (
                <li key={item.label} className="flex gap-3 text-sm">
                  <span className="shrink-0 mt-[7px] w-1.5 h-1.5 rounded-full bg-cyan-neon/60" />
                  <span>
                    <strong className="text-lab-heading">{item.label}</strong>
                    {" — "}
                    <span className="text-lab-text/75">{item.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
