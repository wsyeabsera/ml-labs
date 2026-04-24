import type { ToolEntry } from "../components/ToolCard"

/**
 * Canonical list of MCP tools exposed by the Neuron server.
 * Source of truth: neuron/src/tools/index.ts. Keep both in sync.
 *
 * Category conventions:
 *   Task        — create/manage/reset the task schema
 *   Data        — ingest samples (CSV, JSON, images, one-at-a-time)
 *   Training    — train a single run (everything except sweeps)
 *   Auto        — auto_train + its status/cancel/note helpers
 *   Inspection  — read-side tools: curves, stats, eval, compare, list
 *   Validation  — cross-validation, calibration
 *   Monitoring  — drift detection
 *   Model       — registry / publish / export / import / load
 *   Inference   — predict, batch_predict
 *   LLM         — LLaMA GGUF inference
 */
export const tools: ToolEntry[] = [
  // ── Task management ─────────────────────────────────────────────────
  {
    category: "Task",
    name: "create_task",
    signature: "{ id, kind, feature_shape, sample_shape?, normalize? }",
    desc: "Create or reset a task. Defines the schema: id, kind (classification/regression), input feature shape, and optional Z-score normalization applied at training time.",
  },
  {
    category: "Task",
    name: "reset_task",
    signature: "{ task_id, confirm, delete_task? }",
    desc: "Clear all samples and runs, or delete the task entirely. Requires explicit confirm: true so Claude can't do it accidentally.",
  },
  {
    category: "Task",
    name: "list_tasks",
    signature: "{}",
    desc: "List every task with sample counts, current accuracy, and the active run id.",
  },

  // ── Data ingestion ──────────────────────────────────────────────────
  {
    category: "Data",
    name: "collect",
    signature: "{ task_id, label, features?, raw? }",
    desc: "Add one sample. Accepts either raw bytes (featurized via neuron.config.ts) or pre-featurized arrays.",
  },
  {
    category: "Data",
    name: "load_csv",
    signature: "{ task_id, path, label_column, feature_columns?, has_header?, test_size?, stratify?, seed?, max_bytes? }",
    desc: "Batch-import a CSV file. test_size reserves a stratified held-out split; stratify='auto' picks the right behaviour by task kind; max_bytes overrides the 500MB default file-size cap.",
  },
  {
    category: "Data",
    name: "load_json",
    signature: "{ task_id, path }",
    desc: "Batch-import a JSON array of { features, label } objects.",
  },
  {
    category: "Data",
    name: "load_images",
    signature: "{ task_id, dir }",
    desc: "Walk a directory shaped dir/{label}/*.{jpg,png}, decode, and collect each image as a sample.",
  },
  {
    category: "Data",
    name: "list_samples",
    signature: "{ task_id, limit?, offset? }",
    desc: "Paginated sample list with per-class counts.",
  },
  {
    category: "Data",
    name: "delete_sample",
    signature: "{ sample_id }",
    desc: "Remove a single sample by id.",
  },
  {
    category: "Data",
    name: "inspect_data",
    signature: "{ task_id }",
    desc: "Dataset health check: per-feature stats (mean/std/min/max), class distribution, imbalance ratio, split counts, warnings for constant features / scale issues, and a training_budget estimate.",
  },
  {
    category: "Data",
    name: "data_audit",
    signature: "{ task_id }",
    desc: "One-call combined audit: inspect_data + preflight_check + summary. Replaces the 2-3 tool chain Claude usually runs at session start.",
  },
  {
    category: "Data",
    name: "suggest_samples",
    signature: "{ task_id, n_suggestions?, confidence_threshold? }",
    desc: "Active learning: batch-evaluate all samples, surface uncertain/misclassified examples, return per-class stats + recommendations for what to collect next.",
  },

  // ── Training ────────────────────────────────────────────────────────
  {
    category: "Training",
    name: "preflight_check",
    signature: "{ task_id }",
    desc: "Validate readiness before training — min sample count, class balance, feature consistency. Returns ready / warning / not_ready.",
  },
  {
    category: "Training",
    name: "suggest_hyperparams",
    signature: "{ task_id, data_health? }",
    desc: "Claude-sampled hyperparameter recommendation. Covers lr, epochs, head_arch, optimizer, activation, lr_schedule, loss, batch_size, weight_decay, early_stop_patience, label_smoothing, SWA. Falls back to heuristics if Sampling is unavailable.",
  },
  {
    category: "Training",
    name: "train",
    signature: "{ task_id, lr?, epochs?, head_arch?, class_weights?, weight_decay?, optimizer?, activation?, lr_schedule?, loss?, batch_size?, grad_clip?, early_stop_patience?, label_smoothing?, swa?, seed?, run_id?, auto_register? }",
    desc: "Train one run. Supports SGD/Adam/AdamW, cosine/warmup schedules, MSE/cross-entropy, tanh/ReLU/GELU/leaky_relu, SWA, label smoothing. Trains only on the train split when a test split exists; populates val_accuracy.",
  },
  {
    category: "Training",
    name: "cancel_training",
    signature: "{ task_id, force? }",
    desc: "Abort the in-flight run for this task. force=true also cancels background runs owned by other processes (used by the dashboard).",
  },
  {
    category: "Training",
    name: "run_sweep",
    signature: "{ task_id, configs? | search?, concurrency?, promote_winner?, wave_size? }",
    desc: "Grid sweep. As of v1.7.0 the default is in-process sequential execution; NEURON_SWEEP_MODE=sub_agents restores the old parallel Agent SDK behaviour. auto_train adapts between modes by memory budget.",
  },

  // ── Validation ──────────────────────────────────────────────────────
  {
    category: "Validation",
    name: "cv_train",
    signature: "{ task_id, k?, lr?, epochs?, head_arch?, class_weights?, weight_decay?, early_stop_patience?, seed?, stratify? }",
    desc: "K-fold cross-validation. Trains k runs on rotating folds, reports mean ± std of the primary metric. Each fold run is linked to a parent row via cv_parent_id so you can see them together in list_runs.",
  },
  {
    category: "Validation",
    name: "calibrate",
    signature: "{ run_id }",
    desc: "Post-hoc confidence calibration via temperature scaling. Fits T on the held-out split, stores it on the run; predict/batch_predict divide logits by T before softmax. Classification-only. Reports ECE before/after.",
  },

  // ── Auto-train ──────────────────────────────────────────────────────
  {
    category: "Auto",
    name: "auto_train",
    signature: "{ task_id, accuracy_target?, max_waves?, budget_s?, promote?, publish_name?, publish_version?, tournament?, seed?, auto_collect?, max_collect_rounds?, force?, dry_run? }",
    desc: "Full pipeline: preflight → budget check → seed wave → refine waves → diagnose → promote → (optional) publish. dry_run returns a preview instead of starting. force overrides the memory guardrail. tournament runs 3 parallel planner sub-agents per wave.",
  },
  {
    category: "Auto",
    name: "auto_preflight",
    signature: "{ task_id }",
    desc: "Pre-training audit: data_audit + suggest_hyperparams in one call. Returns hyperparameter recommendations only when the data is ready.",
  },
  {
    category: "Auto",
    name: "get_auto_status",
    signature: "{ auto_run_id? | task_id? }",
    desc: "Live decision log for an ongoing or completed auto_train invocation. Read during a run to watch the controller narrate its reasoning.",
  },
  {
    category: "Auto",
    name: "cancel_auto_train",
    signature: "{ task_id? | auto_run_id? }",
    desc: "Cancel a running coordinator. Aborts the in-process controller (stops spawning planners), marks the auto_run and any in-flight child runs as cancelled.",
  },
  {
    category: "Auto",
    name: "log_auto_note",
    signature: "{ auto_run_id, stage, note, payload? }",
    desc: "Internal — append a decision-log entry to an auto_run. Used by planners and sub-agents to narrate; rarely called directly.",
  },

  // ── Inspection ──────────────────────────────────────────────────────
  {
    category: "Inspection",
    name: "list_runs",
    signature: "{ task_id, limit?, offset? }",
    desc: "Run history with hyperparams, accuracy, val_accuracy, loss trajectory, cv_parent_id, calibration temperature.",
  },
  {
    category: "Inspection",
    name: "get_run_status",
    signature: "{ run_id }",
    desc: "Live progress during training — cross-process safe via DB fallback. Returns stage, progress, loss history, ETA.",
  },
  {
    category: "Inspection",
    name: "get_training_curves",
    signature: "{ run_id }",
    desc: "Loss history with derived signals: convergence epoch, still_improving, overfit_gap (train vs val), MAE/RMSE/R² for regression.",
  },
  {
    category: "Inspection",
    name: "evaluate",
    signature: "{ run_id }",
    desc: "Full metrics: confusion matrix, per-class accuracy, loss history.",
  },
  {
    category: "Inspection",
    name: "diagnose",
    signature: "{ run_id }",
    desc: "Structured diagnostic with severity (minor / moderate / critical) and concrete recommendations. Claude-sampled; falls back to rules.",
  },
  {
    category: "Inspection",
    name: "compare_runs",
    signature: "{ run_ids }",
    desc: "Side-by-side accuracy, val_accuracy, and hyperparams comparison for N runs.",
  },
  {
    category: "Inspection",
    name: "model_stats",
    signature: "{ task_id, split?, confidence_threshold? }",
    desc: "Run predict on all/train/test samples. Returns confidence histogram (10 bins), per-class accuracy + mean confidence, low_confidence_count.",
  },

  // ── Monitoring ──────────────────────────────────────────────────────
  {
    category: "Monitoring",
    name: "drift_check",
    signature: "{ task_id, current_window? }",
    desc: "Compare the training distribution against recent served predictions. Per-feature PSI + KS p-value + verdict (stable / drifting / severe / insufficient_data). Run post-deployment to catch distribution shift.",
  },

  // ── Model management ────────────────────────────────────────────────
  {
    category: "Model",
    name: "register_model",
    signature: "{ task_id, run_id }",
    desc: "Promote a run to the active model for a task. Returns previous_run_id (rollback hint) + train_accuracy / val_accuracy / accuracy_source.",
  },
  {
    category: "Model",
    name: "export_model",
    signature: "{ task_id, bundle_path? }",
    desc: "Export weights. Without bundle_path, returns unified JSON inline. With bundle_path, writes a directory (meta.json + weights.json + adapter.hash) matching publish_model's format — round-trip compatible with import_model.",
  },
  {
    category: "Model",
    name: "publish_model",
    signature: "{ run_id, name, version? }",
    desc: "Push a run to the cross-project registry at ~/.neuron/registry/. URI shape: neuron://local/<name>@<version>.",
  },
  {
    category: "Model",
    name: "import_model",
    signature: "{ uri? | bundle_path?, task_id?, force? }",
    desc: "Pull from the registry (uri) or a local bundle (bundle_path). Creates task + synthetic run with status='imported'. Adapter-hash mismatch blocks the import unless force=true.",
  },
  {
    category: "Model",
    name: "load_model",
    signature: "{ task_id, uri, force? }",
    desc: "Load registry weights into an existing task without creating a new run. Useful for inference-only projects.",
  },
  {
    category: "Model",
    name: "list_registry",
    signature: "{ kind?, tag? }",
    desc: "List models in ~/.neuron/registry.db — filterable by kind or tag.",
  },

  // ── Inference ───────────────────────────────────────────────────────
  {
    category: "Inference",
    name: "predict",
    signature: "{ task_id, features }",
    desc: "Single-sample prediction. Classification: label + confidence + scores (calibrated if a temperature is set). Regression: value + raw_output. Applies normalization and cross-session weight restore automatically.",
  },
  {
    category: "Inference",
    name: "batch_predict",
    signature: "{ task_id, path, feature_columns?, label_column? }",
    desc: "Run inference over a CSV file. Returns per-row predictions and optional accuracy if label_column is provided. Results are recorded into the predictions table for later drift_check use.",
  },

  // ── LLM / GGUF inference ────────────────────────────────────────────
  {
    category: "LLM",
    name: "llm_load",
    signature: "{ path }",
    desc: "Load a small LLaMA model from a GGUF file. CPU-only; only one model loaded at a time — subsequent calls replace the previous.",
  },
  {
    category: "LLM",
    name: "llm_generate",
    signature: "{ prompt? | token_ids?, max_tokens?, temperature? }",
    desc: "Generate text from the loaded model. Whitespace-tokenized prompt is best-effort only; prefer token_ids for real use. Returns text + tokens + timing. Expect ~5-10 tok/s on a 1B model.",
  },
  {
    category: "LLM",
    name: "llm_inspect",
    signature: "{}",
    desc: "Inspect the loaded model: config (dim / n_layers / n_heads / vocab_size / ffn_dim), total parameters, vocab sample.",
  },
]
