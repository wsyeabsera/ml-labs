import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { motion } from "framer-motion"
import { PageHeader } from "../components/PageHeader"

interface Term {
  term: string
  short: string
  full: string
  see_also?: string[]
}

const terms: Term[] = [
  // ── A ──────────────────────────────────────────────────────────────
  {
    term: "AbortController",
    short: "JS API for cancelling in-flight async work.",
    full: "Standard browser/Node API. The auto_train controller passes its AbortSignal to runSweep, the planner, and the trainer; cancelling triggers a clean stop everywhere. The budget timer also fires through this — `setTimeout(budget_s × 1.1, () => ac.abort())`.",
    see_also: ["budget_s", "cancel_auto_train"],
  },
  {
    term: "accuracy",
    short: "Fraction of correct predictions on a dataset.",
    full: "For classification: count(correct) / count(total). What `evaluate` returns. Different from val_accuracy (which is computed on the held-out split) — a memoriser can have train accuracy = 1.0 with terrible val_accuracy.",
    see_also: ["val_accuracy", "ECE", "overfitting"],
  },
  {
    term: "accuracy_target",
    short: "auto_train's stop condition.",
    full: "If any wave produces a model whose metric ≥ accuracy_target, auto_train stops early and promotes the winner. Default 0.9. For regression, this is interpreted as R² ≥ accuracy_target.",
  },
  {
    term: "active learning",
    short: "Iteratively labelling the data points the model is most unsure about.",
    full: "ML-Labs implements this via `suggest_samples` (which finds uncertain rows) and the optional `auto_collect` loop in auto_train (which feeds them to your collect() callback for labelling/synthesis, then retrains).",
    see_also: ["suggest_samples", "auto_collect"],
  },
  {
    term: "adapter (neuron.config.ts)",
    short: "Per-project featurize/collect callbacks.",
    full: "Every project's neuron.config.ts file. Defines `featurize(raw)` (raw data → number[]), optional `collect()` (active-learning callback), and optional `headArchitecture(K, D)`. Its sha256 hash travels with published models so import refuses on mismatch.",
    see_also: ["featurize", "publish_model", "import_model"],
  },
  {
    term: "Adam / AdamW",
    short: "Adaptive optimizers for neural net training.",
    full: "Adam: per-parameter learning rates from first + second moment estimates. AdamW: Adam + decoupled weight decay (regularisation not mixed into the gradient). AdamW is the modern default for hard problems. Pass via `train({ optimizer: 'adamw' })`.",
    see_also: ["SGD", "weight_decay"],
  },
  {
    term: "ADR (Architecture Decision Record)",
    short: "Documented rationale for a design choice.",
    full: "Why-we-did-it record. ML-Labs has ADRs for the TS-controller pivot (v0.5), sequential-by-default (v1.7), CPU-only stance, and MCP-everywhere. See the ADRs page.",
  },
  {
    term: "auto_collect",
    short: "Optional active-learning loop in auto_train.",
    full: "auto_train({ auto_collect: true }) — after target is missed at max_waves, calls suggest_samples → user's collect() callback → inserts new samples → runs one more refinement wave. Up to max_collect_rounds rounds.",
  },
  {
    term: "auto_patterns",
    short: "Cross-task warm-start memory.",
    full: "SQLite table mapping task_fingerprint → best_config seen for that fingerprint. auto_train queries this on entry; if a similar past task exists, wave 1 seeds with its winner. Builds up over time.",
    see_also: ["task_fingerprint", "warm-start"],
  },
  {
    term: "auto_runs",
    short: "SQLite table tracking auto_train invocations.",
    full: "One row per auto_train call. Stores task_id, status, decision_log JSON (append-only narration), winner_run_id, verdict_json, started_at, finished_at.",
  },

  // ── B ──────────────────────────────────────────────────────────────
  {
    term: "batch_size",
    short: "Number of samples per gradient update.",
    full: "Pass to train(). Omit (or set to N) for full-batch — stable, slow, fine on tiny data. 32-128 typical. Smaller batches add stochastic regularisation.",
  },
  {
    term: "Bias-variance tradeoff",
    short: "Underfit (high bias) vs overfit (high variance).",
    full: "High bias = model too simple, misses patterns (low train + low val accuracy). High variance = model too complex, memorises (high train + low val accuracy). The sweet spot is what you're chasing.",
    see_also: ["overfitting", "underfit"],
  },
  {
    term: "budget_s",
    short: "Wall-clock cap on auto_train, in seconds.",
    full: "Default 180. Hard-enforced via setTimeout(budget_s × 1.1) → AbortController. If the timer fires mid-wave, status='budget_exceeded' and orphan child runs are reaped.",
  },
  {
    term: "bundle_path",
    short: "Filesystem path for export/import_model.",
    full: "v1.6.2+. export_model({ bundle_path }) writes meta.json + weights.json + adapter.hash to that directory. import_model({ bundle_path }) reads it back. Round-trip-compatible with publish_model's registry format.",
  },

  // ── C ──────────────────────────────────────────────────────────────
  {
    term: "calibrate / calibration",
    short: "Making confidence scores match empirical accuracy.",
    full: "MCP tool calibrate(run_id) fits a temperature T on held-out logits via NLL minimisation. Stored on runs.calibration_temperature; predict divides logits by T before softmax. Doesn't change top-1 accuracy.",
    see_also: ["temperature scaling", "ECE"],
  },
  {
    term: "class_weights",
    short: "Oversampling for imbalanced classes.",
    full: "train({ class_weights: 'balanced' }) oversamples minority classes so every class contributes equally to the loss. Triggered automatically by the rules planner when imbalance_ratio > 3.",
    see_also: ["imbalance_ratio"],
  },
  {
    term: "Claude Code",
    short: "The CLI / desktop / IDE plugin where you talk to Claude.",
    full: "Reads .mcp.json on project open and loads ML-Labs tools automatically. Where slash commands live.",
  },
  {
    term: "concurrency",
    short: "How many sub-agents run in parallel during a sweep.",
    full: "run_sweep({ concurrency: 3 }) — only meaningful in sub-agents mode. Higher = more parallelism, more memory.",
  },
  {
    term: "confusion matrix",
    short: "K × K grid of (true class, predicted class) counts.",
    full: "Returned by evaluate. Diagonal = correct predictions; off-diagonal = mistakes. Reading it tells you which classes the model confuses with which.",
  },
  {
    term: "convergence_epoch",
    short: "Epoch at which loss flattened out.",
    full: "Computed by get_training_curves. If convergence_epoch ≪ epochs, you wasted time — drop epochs. If still_improving, you stopped early — add epochs.",
  },
  {
    term: "cross-entropy loss",
    short: "Loss function for classification.",
    full: "−Σ y_true · log(softmax(logits)). Numerically stable, matches the maximum-likelihood interpretation. Modern default for classification (replacing MSE-on-one-hot).",
    see_also: ["MSE loss"],
  },
  {
    term: "cross-validation (cv_train)",
    short: "Train k models on rotating folds, report mean ± std.",
    full: "MCP tool cv_train({ k: 5 }). Each fold uses a different held-out partition; reports mean + std so you can tell if your single-split accuracy was lucky.",
  },
  {
    term: "cv_fold_id / cv_parent_id",
    short: "Run-row columns linking fold runs to a parent.",
    full: "cv_train inserts one parent row + k fold rows; each fold row has cv_parent_id = parent.id. Lets list_runs and the dashboard group them.",
  },

  // ── D ──────────────────────────────────────────────────────────────
  {
    term: "data_audit",
    short: "One-call combined data health check.",
    full: "data_audit({ task_id }) = inspect_data + preflight_check + summary. Returns verdict (ready/warning/not_ready), class distribution, imbalance_ratio, warnings, and the training_budget.",
  },
  {
    term: "decision_log",
    short: "Append-only narration of an auto_run's reasoning.",
    full: "JSON array on auto_runs. Every stage (preflight, warm_start, sweep_wave_N_plan, diagnose, winner_selection, promote) writes one entry. get_auto_status returns the full array; the dashboard renders it as a timeline.",
  },
  {
    term: "diagnose",
    short: "MCP tool that explains why a run is bad.",
    full: "diagnose(run_id) returns severity (minor/moderate/critical) and concrete recommendations. Claude-sampled with full loss curve + confusion matrix; falls back to rules. Used by auto_train when wave best is below target + critical.",
  },
  {
    term: "drift_check",
    short: "Compare training distribution to served predictions.",
    full: "drift_check({ task_id, current_window }). PSI + KS test per feature; verdict stable/drifting/severe/insufficient_data. Reads from the predictions table.",
    see_also: ["PSI", "KS test"],
  },
  {
    term: "dry_run",
    short: "auto_train preview without training.",
    full: "auto_train({ dry_run: true }) returns budget level + seed configs + sweep mode + ETA, then exits. Used by Claude to confirm heavy workloads before committing.",
  },

  // ── E ──────────────────────────────────────────────────────────────
  {
    term: "ECE (Expected Calibration Error)",
    short: "Average gap between predicted confidence and empirical accuracy.",
    full: "Bucket predictions into 10 confidence bins. ECE = weighted average of |bin_mean_confidence − bin_accuracy|. ECE = 0 means perfectly calibrated; 0.05 means confidences are off by ~5pp on average. calibrate reports before/after.",
  },
  {
    term: "early_stop_patience",
    short: "Stop training after N epochs without improvement.",
    full: "train({ early_stop_patience: 50 }) — track best loss; stop when 50 consecutive epochs fail to improve it. Saves time without changing final quality.",
  },
  {
    term: "epoch",
    short: "One full pass over the training set.",
    full: "train({ epochs: 500 }) → 500 passes. Loss usually plateaus well before the cap; pair with early_stop_patience or cosine schedule to handle that gracefully.",
  },
  {
    term: "events table",
    short: "Append-only state-change log.",
    full: "Every interesting state change writes one row: run_started, sweep_wave_completed, model_registered, csv_load_progress, llm_generated, drift_detected, etc. Dashboard SSE stream reads new rows live.",
    see_also: ["SSE"],
  },
  {
    term: "evaluate_mlp / train_mlp / init_mlp",
    short: "rs-tensor's three core MLP entrypoints.",
    full: "init_mlp(arch, name) creates a tensor named MLP. train_mlp(name, inputs, targets, lr, epochs, opts) runs the training loop. evaluate_mlp(name, inputs[, targets]) does forward pass + optional metrics.",
  },

  // ── F ──────────────────────────────────────────────────────────────
  {
    term: "featurize",
    short: "raw → number[] callback in neuron.config.ts.",
    full: "User-supplied function: takes raw data (CSV row, image bytes, text, …), returns a fixed-length number[]. The seam between your data and ML-Labs's tensor world. Default for tabular = identity.",
  },
  {
    term: "feature_shape",
    short: "Per-task tensor shape declaration.",
    full: "create_task({ feature_shape: [4] }) — single dimension D=4 (tabular). For images it might be [28, 28]. Drives downstream tensor shapes.",
  },
  {
    term: "force",
    short: "Override the memory_budget guardrail.",
    full: "auto_train({ force: true }) — required for refuse-level workloads. Without it, refuse-level workloads block. Should only pass when you know your machine has headroom.",
  },

  // ── G ──────────────────────────────────────────────────────────────
  {
    term: "GGUF",
    short: "Quantized weight format used by llama.cpp.",
    full: "File format containing quantized model weights (Q4_K_M, Q8_0, F16, F32). Memory-mapped, lazy-decoded. ML-Labs's llm_load reads GGUF for CPU inference.",
  },
  {
    term: "GELU / ReLU / leaky_relu / tanh",
    short: "Activation function options.",
    full: "Activation = the non-linearity between hidden layers. relu (modern default), gelu (transformer-flavoured smoother relu), leaky_relu (relu that doesn't fully zero negatives), tanh (legacy default, smooth and saturating). Pair with init='kaiming' for relu family, 'xavier' for tanh.",
  },
  {
    term: "grad_clip",
    short: "Cap on gradient L2 norm.",
    full: "train({ grad_clip: 1.0 }) — if gradients exceed the cap, scale them down. Stabilises high-lr training, especially with linear_warmup.",
  },
  {
    term: "gradient descent",
    short: "Move weights opposite the gradient of loss.",
    full: "Compute ∂loss/∂w, step w ← w − lr · ∂loss/∂w. Repeat. With Adam/AdamW the per-parameter step is adaptive; with SGD it's the raw rule.",
  },

  // ── H ──────────────────────────────────────────────────────────────
  {
    term: "head_arch",
    short: "List of MLP layer widths.",
    full: "[D, hidden, K] — D = feature_shape, K = num_classes. Each middle entry adds a hidden layer of that width. v1.8.2 caps the auto-suggested hidden at min(128, max(D, 32)) to prevent giant overparameterised seeds.",
  },
  {
    term: "hyperparameters",
    short: "Knobs you set before training (lr, epochs, etc).",
    full: "As opposed to weights, which are learned. lr, epochs, head_arch, optimizer, activation, batch_size, weight_decay, label_smoothing, swa, class_weights — all hyperparameters.",
  },

  // ── I ──────────────────────────────────────────────────────────────
  {
    term: "imbalance_ratio",
    short: "max_class_count / min_class_count.",
    full: "1.0 = perfect balance. >3 = mild imbalance, planner picks class_weights='balanced'. >5 = severe, often warrants collecting more minority data.",
  },
  {
    term: "import_model",
    short: "Pull from registry or bundle_path.",
    full: "import_model({ uri }) or ({ bundle_path }) → creates task + synthetic run with status='imported', registers as active model. Adapter hash mismatch blocks unless force=true.",
  },
  {
    term: "init (Xavier / Kaiming / auto)",
    short: "Weight initialisation strategy.",
    full: "Auto picks Xavier for tanh, Kaiming for relu/gelu/leaky_relu — paired with the right activation, training stays well-conditioned. Wrong init can cause stuck loss or vanishing gradients.",
  },
  {
    term: "Ink",
    short: "React-for-terminals.",
    full: "neuron-tui is built with Ink. Components render as ANSI text. Same React mental model as the web dashboard.",
  },
  {
    term: "input_cells",
    short: "N × D — the workload size metric.",
    full: "Used by memory_budget to bucket workloads safe/advisory/heavy/refuse. Iris = 600 cells, Fashion-MNIST = 47M cells.",
  },
  {
    term: "inspect_data",
    short: "Per-task data health audit.",
    full: "Returns per-feature stats, class distribution, imbalance_ratio, warnings, training_budget. data_audit wraps this + preflight_check.",
  },

  // ── K ──────────────────────────────────────────────────────────────
  {
    term: "k-fold cross-validation",
    short: "Train k models on rotating splits.",
    full: "Each of the N samples is assigned to one of k folds. Train k models, each holding out a different fold; report mean ± std of the metric. cv_train does this.",
  },
  {
    term: "Kaiming init",
    short: "Weight init paired with relu-family activations.",
    full: "Initial weights ~ N(0, 2/fan_in). Designed for ReLU's half-zero gradient. Auto-selected when activation is relu/gelu/leaky_relu.",
  },
  {
    term: "kind (task)",
    short: "'classification' | 'regression'.",
    full: "Set on create_task. Drives loss function (cross_entropy vs mse), output shape (K classes vs 1 scalar), metrics (accuracy vs R²/MAE/RMSE), and target normalisation.",
  },
  {
    term: "KS test",
    short: "Two-sample distribution comparison.",
    full: "Kolmogorov-Smirnov: max absolute difference between two empirical CDFs. drift_check uses it per-feature. p-value <0.05 = distributions significantly differ.",
  },

  // ── L ──────────────────────────────────────────────────────────────
  {
    term: "label_smoothing",
    short: "Soften one-hot targets.",
    full: "Replace [0,0,1,0] with [α/K, α/K, 1-α+α/K, α/K]. Prevents over-confidence. With α=0.1 on 10 classes, min cross-entropy is ≈0.5 — that's the entropy floor, not a bug.",
  },
  {
    term: "logits",
    short: "Pre-softmax raw scores.",
    full: "What the MLP outputs. softmax(logits) = probabilities. argmax(logits) = predicted class. Calibration divides logits by T before softmax.",
  },
  {
    term: "lr (learning rate)",
    short: "Gradient step size.",
    full: "Too high → loss explodes/oscillates. Too low → trains forever. SGD typical 0.001-0.1; Adam typical 0.0003-0.003. Pair with lr_schedule for decay.",
  },
  {
    term: "lr_schedule",
    short: "How lr changes over training.",
    full: "constant (default), cosine (decay to min_lr along half-cosine), linear_warmup (ramp 0→lr over warmup_epochs, then constant). Cosine pays off on long trainings.",
  },

  // ── M ──────────────────────────────────────────────────────────────
  {
    term: "MAE / MSE / RMSE / R²",
    short: "Regression metrics.",
    full: "MAE = mean absolute error. MSE = mean squared error. RMSE = sqrt(MSE). R² = 1 − (residual variance / total variance), 1.0 = perfect, 0 = same as predicting the mean. ML-Labs's regression runs report all four.",
  },
  {
    term: "max_waves",
    short: "auto_train iteration cap.",
    full: "Default 2. The controller may stop early if it plateaus, but never goes past max_waves.",
  },
  {
    term: "MCP (Model Context Protocol)",
    short: "Anthropic's protocol for tool / context servers.",
    full: "JSON-RPC over stdio (or HTTP). Defines tools, resources, prompts, sampling. ML-Labs's neuron is an MCP server; rs-tensor is an MCP server it calls; Claude Code is an MCP client.",
  },
  {
    term: "memory_budget",
    short: "Pre-training memory estimator.",
    full: "core/memory_budget.ts. Maps (N, D, K, kind) to a band: safe / advisory / heavy / refuse. auto_train uses it to gate refuse-level workloads (require force:true) and to pick sweep mode.",
  },
  {
    term: "min_lr",
    short: "Floor for cosine decay.",
    full: "lr_schedule='cosine' decays from lr down to min_lr (not 0 by default). Prevents the very last epochs from making zero progress.",
  },
  {
    term: "MLP (Multi-Layer Perceptron)",
    short: "Stack of fully-connected layers + activations.",
    full: "ML-Labs's only model architecture. head_arch describes it: [D, hidden..., K]. Trained via SGD/Adam, evaluated via softmax-then-argmax (classification) or scaled output (regression).",
  },
  {
    term: "MSE loss",
    short: "Mean-squared-error.",
    full: "Default for regression. Was also the legacy classification default before v1.6 modernised the path; cross_entropy is now preferred for classification.",
  },

  // ── N ──────────────────────────────────────────────────────────────
  {
    term: "neuron-mcp / neuron-tui",
    short: "ML-Labs's two binary entry points.",
    full: "neuron-mcp = the MCP server (called by Claude Code). neuron-tui = the Ink terminal UI. Both ship from the same package.",
  },
  {
    term: "NEURON_DB",
    short: "SQLite path env var.",
    full: "Defaults to data/neuron.db relative to the project. Override to put the DB elsewhere or share across projects.",
  },
  {
    term: "NEURON_PLANNER",
    short: "Force the planner type.",
    full: "Set to 'rules' to skip Claude planner sub-agents — used by benchmarks for determinism. Otherwise the controller picks rules / Claude / TPE / tournament adaptively.",
  },
  {
    term: "NEURON_SEED",
    short: "Default seed for stochastic ops.",
    full: "Overrides any unspecified seed: in train shuffle, kfold assign, run context. Per-call seed argument always wins.",
  },
  {
    term: "NEURON_SWEEP_MODE",
    short: "Force sweep execution mode.",
    full: "'sub_agents' = always parallel; 'sequential' = always in-process; unset = adaptive by memory budget (default since v1.8.1).",
  },
  {
    term: "normalize",
    short: "Z-score normalisation of features.",
    full: "create_task({ normalize: true }) — at training time, compute mean/std per feature on the train split, store on runs.norm_stats, apply to inputs. predict uses the stored stats automatically.",
  },

  // ── O ──────────────────────────────────────────────────────────────
  {
    term: "one-hot encoding",
    short: "Class label k as the K-vector with a 1 at index k.",
    full: "What ML-Labs converts string labels to before training. Example: K=3, label='setosa' → [1, 0, 0]. Required by MSE-on-one-hot; cross-entropy uses integer labels directly.",
  },
  {
    term: "optimizer",
    short: "SGD / Adam / AdamW.",
    full: "How gradients become weight updates. SGD: simple, good for already-fine cases. Adam: per-parameter adaptive step. AdamW: Adam + decoupled weight decay (modern default for hard problems).",
  },
  {
    term: "overfitting",
    short: "Train accuracy >> val accuracy.",
    full: "Model memorised the training set. Symptoms: train_acc 1.0, val_acc much lower; loss curve looks fine but generalisation tanks. Fix with weight_decay, smaller arch, label_smoothing, more data, early stopping.",
  },
  {
    term: "overfit_gap",
    short: "train_acc − val_acc.",
    full: "Computed by get_training_curves. If >0.15, scoreClassification applies a penalty so memoriser runs don't win the auto_train selection.",
  },

  // ── P ──────────────────────────────────────────────────────────────
  {
    term: "pattern memory",
    short: "auto_train's cross-task warm-start.",
    full: "On entry, hash (kind, K, D bucket, N bucket, imbalance bucket) into a fingerprint. Look up auto_patterns for the best config previously seen. Seed wave 1 with it + lr variants. Save winner config back at end.",
  },
  {
    term: "PSI (Population Stability Index)",
    short: "Drift metric — weighted relative-frequency difference.",
    full: "Bucket reference + current samples into 10 bins; PSI = Σ (cur_pct − ref_pct) · ln(cur_pct / ref_pct). <0.1 stable, 0.1-0.25 drifting, >0.25 severe (industry defaults).",
  },
  {
    term: "predict",
    short: "Single-sample inference.",
    full: "predict({ task_id, features }) → label + confidence + scores (classification) or value + raw_output (regression). Applies normalisation + temperature if set. Lazy-restores weights from DB if MLP isn't in rs-tensor memory.",
  },
  {
    term: "predictions table",
    short: "Log of every predict / batch_predict call.",
    full: "Stores ts, task_id, run_id, features, label, confidence. Source of truth for drift_check. Survives server restart.",
  },
  {
    term: "preflight_check",
    short: "Early-out check before training.",
    full: "Returns ready / warning / not_ready. Min sample count, K ≥ 2, feature consistency, no constant features. Skipped only if you really know what you're doing.",
  },
  {
    term: "publish_model",
    short: "Push a run to ~/.neuron/registry/.",
    full: "publish_model({ run_id, name, version }) → URI neuron://local/<name>@<version>. Bundle = meta.json + weights.json + adapter.hash. import_model from any other project.",
  },

  // ── R ──────────────────────────────────────────────────────────────
  {
    term: "R²",
    short: "Coefficient of determination.",
    full: "Regression metric. 1 = perfect; 0 = no better than predicting the mean; negative = worse than mean. auto_train uses R² ≥ accuracy_target as the regression stop condition.",
  },
  {
    term: "ReLU",
    short: "max(0, x). The default modern activation.",
    full: "Piecewise linear, fast, non-saturating on positive side. Pair with Kaiming init.",
  },
  {
    term: "reaper",
    short: "Force-cancels orphan running runs.",
    full: "Two reapers: startup (clears stale rows from a previous process) and end-of-auto_train (v1.10.0 — clears children left running when the controller exits). Both call forceCancelRun.",
  },
  {
    term: "register_model",
    short: "Promote a run to the active model.",
    full: "register_model({ task_id, run_id }) — write to models table. From now on, predict uses this run. Returns previous_run_id for rollback.",
  },
  {
    term: "regression",
    short: "Predicting a continuous value.",
    full: "create_task({ kind: 'regression' }). Single output (K=1), MSE loss, target min-max normalised, returned as raw value at predict. Metrics: MAE, RMSE, R².",
  },
  {
    term: "RMSNorm",
    short: "Layer norm replacement used by LLaMA.",
    full: "Like LayerNorm but only normalises by RMS (no mean subtraction). Cheaper, used in LLaMA-architecture models for stability.",
  },
  {
    term: "RoPE (Rotary Position Embeddings)",
    short: "How transformers encode token position.",
    full: "Rotate query/key vectors by a position-dependent angle. Used by LLaMA. ML-Labs's llm_* tools rely on rs-tensor's RoPE implementation.",
  },
  {
    term: "rs-tensor",
    short: "ML-Labs's Rust math backend.",
    full: "Separate MCP server. Implements MLP train/eval, GGUF inference, autograd, attention, conv2d. Spawned as a child process by neuron-mcp.",
  },
  {
    term: "rule_explanations",
    short: "Structured 'why this rule fired' from the planner.",
    full: "Each rule_explanation is { name, title, why, evidence[] }. Surfaced in the dashboard's auto-run timeline so users can see what the planner was thinking, in language.",
  },
  {
    term: "run_progress (column)",
    short: "Live progress JSON on a runs row.",
    full: "Updated each epoch during training. Cross-process readable — get_run_status pulls from here. Cleared on completion.",
  },
  {
    term: "run_sweep",
    short: "Hyperparameter grid search.",
    full: "MCP tool. Either explicit configs[] or a search grid. concurrency for parallelism, wave_size for batching. v1.7.0 default flipped to in-process sequential; sub-agents on opt-in.",
  },

  // ── S ──────────────────────────────────────────────────────────────
  {
    term: "sampling (MCP)",
    short: "MCP feature for tools to ask the host LLM.",
    full: "ML-Labs uses MCP Sampling in suggest_hyperparams, diagnose, and the auto_train Claude planner. Falls back to deterministic heuristics when Sampling is unavailable (no API key, no host LLM).",
  },
  {
    term: "scoreClassification",
    short: "auto_train's winner-selection metric.",
    full: "val_accuracy if available, with a 0.5x penalty when train-val gap >0.15. So an honest run with smaller gap can beat a big-but-overfit run.",
  },
  {
    term: "SGD",
    short: "Stochastic Gradient Descent.",
    full: "w ← w − lr × grad. Simplest optimizer. Default in train. Combine with mini-batches for SGD; full-batch for plain GD.",
  },
  {
    term: "shadow models",
    short: "A/B testing for a new candidate model.",
    full: "attach_shadow runs a second model in parallel on every predict, computes agreement rate. shadow_promoted event fires when it's clearly better.",
  },
  {
    term: "softmax",
    short: "Convert logits to probabilities.",
    full: "softmax(z)_i = exp(z_i) / Σ exp(z_j). Sums to 1, all positive. ML-Labs applies it (with optional /T calibration) at predict time.",
  },
  {
    term: "split (train / test)",
    short: "Per-sample data partition.",
    full: "samples.split = 'train' | 'test'. load_csv test_size=0.2 stratifies into 80/20. train fits on 'train'; evaluate / val_accuracy / drift_check / calibrate read 'test'.",
  },
  {
    term: "SSE (Server-Sent Events)",
    short: "Server pushes events over an HTTP stream.",
    full: "/api/events. Dashboard subscribes; every events-table row fires once. Live progress, no polling.",
  },
  {
    term: "still_improving",
    short: "Did loss flatten or is it still trending down?",
    full: "Boolean from get_training_curves. If still_improving = true, the rules planner adds epochs in the next wave.",
  },
  {
    term: "stratify",
    short: "Preserve class proportions across splits/folds.",
    full: "load_csv({ stratify: 'auto' }) (default for classification) keeps test_size's class ratio matching the training set's. cv_train also stratifies by default.",
  },
  {
    term: "suggest_hyperparams",
    short: "Claude-sampled (or rule-based) recommended config.",
    full: "Returns a full modern hyperparameter set keyed off task shape + data_health. Auto-called by auto_train; you can call it directly for a starting point.",
  },
  {
    term: "suggest_samples",
    short: "Active-learning recommendation.",
    full: "Batch-evaluates all samples; surfaces uncertain or misclassified rows + per-class stats + recommendations. Pair with auto_collect or call yourself.",
  },
  {
    term: "SWA (Stochastic Weight Averaging)",
    short: "Average weights across the last 25% of epochs.",
    full: "train({ swa: true }). Cheap regularisation: tends to find flatter minima with better generalisation. Final saved weights are the running average, not the last-epoch weights.",
  },

  // ── T ──────────────────────────────────────────────────────────────
  {
    term: "task_fingerprint",
    short: "Hash that buckets similar tasks together.",
    full: "f(kind, K, D bucket, N bucket, imbalance bucket). Different buckets for D (xs/s/m/l), N (xs/s/m/l), imbalance (bal/mild/severe). Pattern memory is keyed by fingerprint.",
  },
  {
    term: "tasks (table)",
    short: "One row per ML task.",
    full: "id, kind, feature_shape, labels, normalize, feature_names. Owns samples + runs + (active model via models table).",
  },
  {
    term: "temperature scaling",
    short: "Divide logits by T before softmax.",
    full: "T < 1 sharpens, T > 1 tempers. Calibrate fits T on held-out logits via NLL grid search. Doesn't change argmax (so accuracy is unchanged), but softmax confidences match empirical accuracy after.",
  },
  {
    term: "tensor",
    short: "N-dimensional array of numbers.",
    full: "Scalar = 0d, vector = 1d, matrix = 2d, image batch = 4d. ML-Labs/rs-tensor stores f32 tensors named in a global map; ops take/return names.",
  },
  {
    term: "test_size",
    short: "Held-out fraction at load_csv time.",
    full: "0.2 reserves 20% as a stratified test split. 0 puts everything in train (auto_train then reports training accuracy as the winner metric, which is not honest).",
  },
  {
    term: "tournament",
    short: "auto_train's multi-strategy planner mode.",
    full: "auto_train({ tournament: true }) → 3 parallel Claude planners per wave (aggressive / conservative / exploratory). Proposals merged. Costs 3x but escapes local optima on hard tasks.",
  },
  {
    term: "TPE (Tree-structured Parzen Estimator)",
    short: "Bayesian HPO via density estimation.",
    full: "Builds two density models — 'good' configs and 'bad' ones — from past runs. Samples from candidates that maximise good/bad density ratio. Used by auto_train at wave 2+ once enough observations exist.",
  },
  {
    term: "training_budget",
    short: "Memory + wall-clock estimate.",
    full: "{ N, D, K, inputCells, peak_mb, wall_clock_estimate_s, level, headline, advice }. Returned by load_csv, inspect_data, data_audit, and auto_train's dry_run.",
  },

  // ── U ──────────────────────────────────────────────────────────────
  {
    term: "underfit",
    short: "Model too simple — both train and val low.",
    full: "Symptom: train_acc 0.7 and val_acc 0.7. Fix with bigger arch, more epochs, more capacity. Opposite of overfit.",
  },
  {
    term: "URI (registry)",
    short: "neuron://local/<name>@<version>.",
    full: "ML-Labs registry URI scheme. local is the only namespace today; future: remote pulls from a shared registry. import_model({ uri }) uses this.",
  },

  // ── V ──────────────────────────────────────────────────────────────
  {
    term: "val_accuracy",
    short: "Accuracy on the held-out test split.",
    full: "Computed post-training by evalValAccuracy. The honest generalisation signal — distinct from train accuracy. v1.10.0 fixed both train paths (HTTP + sub-agent) to populate it consistently.",
  },
  {
    term: "verdict (auto_train)",
    short: "Structured outcome of an auto_run.",
    full: "{ status, winner, attempted, data_issues, next_steps, summary }. Status: completed / data_issue / budget_exceeded / no_improvement / failed / cancelled. Persisted on auto_runs.verdict_json.",
  },

  // ── W ──────────────────────────────────────────────────────────────
  {
    term: "WAL (Write-Ahead Log)",
    short: "SQLite mode for concurrent reads/writes.",
    full: "PRAGMA journal_mode=WAL. Lets multiple processes read while one writes. Critical for ML-Labs because sub-agents + dashboard + MCP server all hit the same DB simultaneously.",
  },
  {
    term: "warm-start",
    short: "Begin from a known-good config instead of scratch.",
    full: "auto_train consults auto_patterns on entry. If a similar past task exists, wave 1 seeds with its winning config + lr variants. Built up across runs over time.",
  },
  {
    term: "weights",
    short: "Learned numbers in the model.",
    full: "Stored as JSON on runs.weights — { name → { data: number[], shape: number[] } } per tensor. Diffable, grep-able, copy-able.",
  },
  {
    term: "weight_decay",
    short: "L2 regularisation.",
    full: "Adds λ · ||w||² to the loss → shrinks weights toward zero → fights overfitting. Modern usage decouples it from the gradient (AdamW). Typical: 1e-5 to 1e-2.",
  },

  // ── X ──────────────────────────────────────────────────────────────
  {
    term: "Xavier init",
    short: "Weight init paired with tanh.",
    full: "Initial weights ~ U(−sqrt(6/fan_in+fan_out), +sqrt(...)). Designed for symmetric activations. Auto-selected when activation='tanh'.",
  },
]

export function Glossary() {
  const [q, setQ] = useState("")
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return terms
    return terms.filter(
      (t) =>
        t.term.toLowerCase().includes(query) ||
        t.short.toLowerCase().includes(query) ||
        t.full.toLowerCase().includes(query),
    )
  }, [q])

  const grouped = useMemo(() => {
    const map = new Map<string, Term[]>()
    for (const t of filtered) {
      const letter = t.term[0]!.toUpperCase()
      if (!map.has(letter)) map.set(letter, [])
      map.get(letter)!.push(t)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <div>
      <PageHeader
        eyebrow="Every term in one place"
        accent="cyan"
        title={<><span className="gradient-text">Glossary</span>.</>}
        lede="Cmd+F destination. Every ML, MCP, and ML-Labs term used across the docs, with a one-line summary and a fuller explanation. If something is unfamiliar in another page, look it up here."
      />

      <div className="lab-panel p-4 mb-8 sticky top-4 z-10 backdrop-blur-md">
        <div className="relative">
          <Search className="w-4 h-4 text-lab-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search terms..."
            className="w-full pl-10 pr-4 py-2.5 bg-lab-bg border border-lab-border rounded-lg text-sm text-lab-heading placeholder:text-lab-muted focus:outline-none focus:border-cyan-neon/60 focus:ring-1 focus:ring-cyan-neon/30"
          />
        </div>
        <div className="text-xs text-lab-muted mt-3">
          Showing <span className="text-lab-heading font-semibold">{filtered.length}</span> of {terms.length} terms
        </div>
      </div>

      <div className="space-y-10">
        {grouped.map(([letter, group]) => (
          <motion.section
            key={letter}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25 }}
          >
            <div className="text-3xl font-bold text-cyan-neon font-mono mb-4">{letter}</div>
            <div className="space-y-4">
              {group.map((t) => (
                <div key={t.term} className="lab-panel p-5">
                  <div className="flex items-baseline gap-3 flex-wrap mb-1.5">
                    <code className="text-purple-neon text-base font-mono font-semibold">{t.term}</code>
                    <span className="text-sm text-lab-text/85">{t.short}</span>
                  </div>
                  <p className="text-sm text-lab-text/70 leading-relaxed">{t.full}</p>
                  {t.see_also && t.see_also.length > 0 && (
                    <div className="text-xs text-lab-muted mt-2">
                      see also:{" "}
                      {t.see_also.map((s, i) => (
                        <span key={s}>
                          <code className="text-cyan-neon">{s}</code>
                          {i < t.see_also!.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.section>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="lab-panel p-8 text-center text-lab-muted text-sm">
          No terms match. Try a different search.
        </div>
      )}
    </div>
  )
}
