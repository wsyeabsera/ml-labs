import type { ToolEntry } from "../components/ToolCard"

export const tools: ToolEntry[] = [
  // Task management
  {
    category: "Task",
    name: "create_task",
    signature: "{ id, kind, feature_shape, sample_shape?, normalize? }",
    desc: "Create or reset a task. Defines the schema: id, kind (classification/regression), input feature shape, and optional Z-score normalization.",
  },
  {
    category: "Task",
    name: "reset_task",
    signature: "{ task_id, confirm, delete_task? }",
    desc: "Clear all samples and runs, or delete the task entirely. Requires explicit confirm: true.",
  },
  {
    category: "Task",
    name: "list_tasks",
    signature: "{}",
    desc: "List all tasks with sample counts, current accuracy, and the active run id.",
  },

  // Data ingestion
  {
    category: "Data",
    name: "collect",
    signature: "{ task_id, label, features?, raw? }",
    desc: "Add one sample. Accepts either raw bytes (featurized via neuron.config.ts) or pre-featurized arrays.",
  },
  {
    category: "Data",
    name: "load_csv",
    signature: "{ task_id, path, label_column, feature_columns?, test_size? }",
    desc: "Batch-import a CSV file. test_size (0–0.5) performs a stratified train/test split at load time.",
  },
  {
    category: "Data",
    name: "inspect_data",
    signature: "{ task_id }",
    desc: "Dataset health check: per-feature stats (mean/std/min/max), class distribution, imbalance ratio, train/test split counts, and warnings for constant features or large scale differences.",
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

  // Training
  {
    category: "Training",
    name: "preflight_check",
    signature: "{ task_id }",
    desc: "Validate readiness before training — min sample count, class balance, feature consistency. Returns ready / warning / not_ready.",
  },
  {
    category: "Training",
    name: "suggest_hyperparams",
    signature: "{ task_id }",
    desc: "Shape-aware + label-count-aware recommendation for lr, epochs, head_arch.",
  },
  {
    category: "Training",
    name: "train",
    signature: "{ task_id, lr?, epochs?, head_arch?, class_weights?, run_id?, auto_register? }",
    desc: "Train one run. class_weights=\"balanced\" oversamples minority classes. Trains only on the train split when a test split exists.",
  },
  {
    category: "Training",
    name: "cancel_training",
    signature: "{ task_id }",
    desc: "Abort the in-flight run for this task (same-process only — no cross-process cancel).",
  },
  {
    category: "Training",
    name: "run_sweep",
    signature: "{ task_id, configs? | search?, concurrency?, promote_winner?, wave_size? }",
    desc: "Parallel grid sweep via Agent SDK sub-agents. wave_size stages configs into sequential batches.",
  },

  // Auto-train
  {
    category: "Auto",
    name: "auto_train",
    signature: "{ task_id, accuracy_target?, max_waves?, budget_s?, promote?, publish_name? }",
    desc: "Full pipeline: coordinator sub-agent runs preflight → suggest → sweep waves → evaluate → active learning → promote.",
  },
  {
    category: "Auto",
    name: "get_auto_status",
    signature: "{ auto_run_id? | task_id? }",
    desc: "Live decision log for an ongoing or completed auto_train invocation.",
  },
  {
    category: "Auto",
    name: "suggest_samples",
    signature: "{ task_id, n_suggestions?, confidence_threshold? }",
    desc: "Active learning: batch-evaluate all samples, surface uncertain/misclassified examples, return per-class stats + recommendations.",
  },

  // Observability
  {
    category: "Inspection",
    name: "get_training_curves",
    signature: "{ run_id }",
    desc: "Loss history with derived signals: convergence epoch, still_improving flag, overfitting gap (train vs val accuracy). Includes MAE/RMSE/R² for regression runs.",
  },
  {
    category: "Inspection",
    name: "model_stats",
    signature: "{ task_id, split?, confidence_threshold? }",
    desc: "Run predict on all/train/test samples. Returns confidence histogram (10 bins), per-class accuracy + mean confidence, and low_confidence_count.",
  },

  // Run inspection
  {
    category: "Inspection",
    name: "list_runs",
    signature: "{ task_id, limit?, offset? }",
    desc: "Run history with hyperparams, accuracy, loss trajectory.",
  },
  {
    category: "Inspection",
    name: "get_run_status",
    signature: "{ run_id }",
    desc: "Live progress during training — cross-process safe via DB fallback.",
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
    desc: "Structured diagnostic with severity (minor / moderate / critical) and concrete recommendations.",
  },
  {
    category: "Inspection",
    name: "compare_runs",
    signature: "{ run_ids }",
    desc: "Side-by-side accuracy and hyperparams comparison for N runs.",
  },

  // Model management
  {
    category: "Model",
    name: "register_model",
    signature: "{ task_id, run_id }",
    desc: "Promote a run to the active model for a task. Returns previous_run_id for rollback.",
  },
  {
    category: "Model",
    name: "export_model",
    signature: "{ task_id }",
    desc: "Export weights as portable JSON for inspection or off-host storage.",
  },
  {
    category: "Model",
    name: "publish_model",
    signature: "{ run_id, name, version? }",
    desc: "Push a run to the cross-project registry at ~/.neuron/registry/. URI: neuron://local/<name>@<version>.",
  },
  {
    category: "Model",
    name: "import_model",
    signature: "{ uri, task_id? }",
    desc: "Pull from registry, create task + synthetic run with status='imported'. Adapter hash guards against mismatched featurize.",
  },
  {
    category: "Model",
    name: "load_model",
    signature: "{ task_id, uri, force? }",
    desc: "Load registry weights into an existing task without retraining.",
  },
  {
    category: "Model",
    name: "list_registry",
    signature: "{ kind?, tag? }",
    desc: "List models in ~/.neuron/registry.db — filterable by kind or tag.",
  },

  // Inference
  {
    category: "Inference",
    name: "predict",
    signature: "{ task_id, features }",
    desc: "Single-sample prediction. Classification: label + confidence + scores. Regression: value + raw_output. Applies normalization and cross-session weight restore automatically.",
  },
  {
    category: "Inference",
    name: "batch_predict",
    signature: "{ task_id, path, feature_columns?, label_column? }",
    desc: "Run inference over a CSV file. Returns per-row predictions (label/confidence or value/error) and optional accuracy if label_column is provided.",
  },
]
