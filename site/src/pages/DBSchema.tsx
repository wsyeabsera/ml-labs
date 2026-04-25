import { Database, FileSearch, Layers, ShieldCheck } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Table } from "../components/Table"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function DBSchema() {
  return (
    <div>
      <PageHeader
        eyebrow="Every column, every table"
        accent="cyan"
        title={<>Database <span className="gradient-text">schema</span> reference.</>}
        lede="ML-Labs is built on one SQLite database in WAL mode. Eleven tables hold tasks, samples, runs, models, auto_runs, events, predictions, and a few specialty bits. This page documents every column — what it stores, what writes it, what reads it."
      />

      <Section eyebrow="Where it lives" title="Path conventions.">
        <Table
          columns={[
            { key: "what",  header: "What",       accent: "cyan" },
            { key: "where", header: "Where",      mono: true },
          ]}
          rows={[
            { what: "Per-project DB",       where: "./data/neuron.db (default; override via NEURON_DB)" },
            { what: "Cross-project registry", where: "~/.neuron/registry.db" },
            { what: "WAL files",             where: "neuron.db-wal, neuron.db-shm (don't delete; SQLite manages)" },
          ]}
        />
        <Callout kind="learn" title="Why WAL mode">
          PRAGMA journal_mode=WAL allows concurrent readers (dashboard, MCP server, sub-agents) plus
          one writer at any time without serialising. Critical for ML-Labs — at least 3 processes
          poll the DB simultaneously during a sweep.
        </Callout>
      </Section>

      <Section eyebrow="Core tables" title="The skeleton.">
        <p>
          These four tables are the irreducible nucleus. A task has many samples, a task has many
          runs, a task has one (active) model.
        </p>

        <Table
          caption="tasks — one row per ML problem"
          columns={[
            { key: "col",  header: "Column",       mono: true, accent: "cyan", width: "180px" },
            { key: "type", header: "Type",         mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",             type: "TEXT PK",  what: "Task identifier. Conventionally kebab-case. Matches neuron.config.ts taskId." },
            { col: "kind",           type: "TEXT",     what: "'classification' | 'regression'. Drives loss/metric/output choices." },
            { col: "labels",         type: "TEXT JSON", what: "Sorted list of label strings (classification only). Updated by train when new labels appear." },
            { col: "feature_shape",  type: "TEXT JSON", what: "Shape of one feature vector — typically [D]." },
            { col: "sample_shape",   type: "TEXT JSON", what: "Original sample shape (e.g. [28, 28] for images). Documentation; not enforced." },
            { col: "normalize",      type: "INTEGER",  what: "0 or 1. If 1, train computes per-feature Z-score stats and applies them on predict." },
            { col: "feature_names",  type: "TEXT JSON", what: "Optional column names from load_csv — used by drift_check / inspect_data for human-readable output." },
            { col: "created_at",     type: "INTEGER",  what: "Unix seconds of first create_task call." },
          ]}
        />

        <Table
          caption="samples — one row per training/test instance"
          columns={[
            { key: "col",  header: "Column",      mono: true, accent: "purple", width: "180px" },
            { key: "type", header: "Type",        mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",         type: "INTEGER PK", what: "Auto-increment. Returned by collect/load_*. Used by suggest_samples → collect callback." },
            { col: "task_id",    type: "TEXT FK",    what: "→ tasks.id. ON DELETE CASCADE." },
            { col: "label",      type: "TEXT",       what: "Class string (classification) or numeric string (regression)." },
            { col: "features",   type: "TEXT JSON",  what: "Pre-featurized number[]. If raw is set, this can also be empty initially and computed via featurize at training time." },
            { col: "raw",        type: "TEXT JSON",  what: "Optional pre-featurize representation (image path/buffer pointer, text, etc). Triggers featurize when present." },
            { col: "split",      type: "TEXT",       what: "'train' | 'test'. Default 'train'. Set by load_csv test_size during stratified split." },
            { col: "created_at", type: "INTEGER",    what: "Unix seconds of insertion." },
          ]}
        />

        <Table
          caption="runs — one row per training attempt"
          columns={[
            { key: "col",  header: "Column",          mono: true, accent: "orange", width: "210px" },
            { key: "type", header: "Type",            mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",               type: "INTEGER PK", what: "Auto-increment. Returned by train; referenced everywhere downstream." },
            { col: "task_id",          type: "TEXT FK",    what: "→ tasks.id." },
            { col: "hyperparams",      type: "TEXT JSON",  what: "Full snapshot of the args passed to train: lr, epochs, head_arch, optimizer, etc." },
            { col: "accuracy",         type: "REAL",       what: "Top-1 accuracy on the training data after final epoch." },
            { col: "val_accuracy",     type: "REAL",       what: "Accuracy on the held-out test split. v1.10.0+ populated by both train paths." },
            { col: "per_class_accuracy", type: "TEXT JSON", what: "{ label: accuracy }. Surfaces weak classes." },
            { col: "confusion_matrix", type: "TEXT JSON",  what: "K × K integer grid. Rows = true class, cols = predicted." },
            { col: "loss_history",     type: "TEXT JSON",  what: "Array of per-epoch loss values. Source for the dashboard's curves." },
            { col: "val_loss_history", type: "TEXT JSON",  what: "Optional — per-epoch val loss when available." },
            { col: "norm_stats",       type: "TEXT JSON",  what: "{ mean: number[], std: number[] } — saved when task.normalize=1 so predict can apply them." },
            { col: "weights",          type: "TEXT JSON",  what: "Tensor name → { data: number[], shape: number[] }. The trained MLP, dumped." },
            { col: "checkpoint",       type: "TEXT JSON",  what: "Resumable training state. Cleared on completion." },
            { col: "run_progress",     type: "TEXT JSON",  what: "Live progress { stage, i, n, message, lossHistory[], epochsDone }. Cleared on completion. Read by get_run_status cross-process." },
            { col: "status",           type: "TEXT",       what: "'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'imported' | 'cv_parent'." },
            { col: "started_at",       type: "INTEGER",    what: "Unix seconds." },
            { col: "finished_at",      type: "INTEGER",    what: "Unix seconds. Null while running." },
            { col: "owner_pid",        type: "INTEGER",    what: "Process that started the run. Reapers use this to identify zombies from dead processes." },
            { col: "source_uri",       type: "TEXT",       what: "If imported, the source URI (e.g. neuron://local/iris@2026-04). Null otherwise." },
            { col: "mae / rmse / r2",  type: "REAL",       what: "Regression metrics. Null for classification." },
            { col: "sample_counts",    type: "TEXT JSON",  what: "{ class: count } actually trained on (after balancing/oversampling)." },
            { col: "run_context",      type: "TEXT JSON",  what: "Reproducibility metadata: rng_seed, neuron_version, rs_tensor_version, etc." },
            { col: "dataset_hash",     type: "TEXT",       what: "SHA-256 of the training data. Detect when the same hyperparams ran on different data." },
            { col: "cv_fold_id / cv_parent_id", type: "INTEGER", what: "Set when the run is part of a cv_train. parent groups them." },
            { col: "calibration_temperature", type: "REAL", what: "Set by calibrate. predict divides logits by this before softmax." },
          ]}
        />

        <Table
          caption="models — pointer to the active run per task"
          columns={[
            { key: "col",  header: "Column",     mono: true, accent: "pink", width: "180px" },
            { key: "type", header: "Type",       mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "task_id",     type: "TEXT PK FK", what: "→ tasks.id." },
            { col: "run_id",      type: "INTEGER FK", what: "→ runs.id. THE active model for this task." },
            { col: "promoted_at", type: "INTEGER",    what: "Unix seconds. When register_model was last called." },
          ]}
        />
      </Section>

      <Section eyebrow="Auto-train tables" title="The orchestration layer.">
        <Table
          caption="auto_runs — one row per auto_train invocation"
          columns={[
            { key: "col",  header: "Column",       mono: true, accent: "purple", width: "180px" },
            { key: "type", header: "Type",         mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",              type: "INTEGER PK", what: "Auto-increment." },
            { col: "task_id",         type: "TEXT FK",    what: "→ tasks.id." },
            { col: "status",          type: "TEXT",       what: "running / completed / cancelled / budget_exceeded / no_improvement / data_issue / failed." },
            { col: "started_at",      type: "TEXT ISO",   what: "ISO 8601 timestamp (note: differs from runs.started_at which is unix seconds — historical reasons)." },
            { col: "finished_at",     type: "TEXT ISO",   what: "ISO 8601. Null while running." },
            { col: "accuracy_target", type: "REAL",       what: "Target metric value. R² for regression." },
            { col: "budget_s",        type: "INTEGER",    what: "Wall-clock budget passed in." },
            { col: "max_waves",       type: "INTEGER",    what: "Max iteration cap." },
            { col: "waves_used",      type: "INTEGER",    what: "Actual waves executed before stopping." },
            { col: "winner_run_id",   type: "INTEGER FK", what: "→ runs.id of the chosen winner. Null if no winner found." },
            { col: "final_accuracy",  type: "REAL",       what: "Score of the winner (val-aware, with overfit penalty)." },
            { col: "decision_log",    type: "TEXT JSON",  what: "Append-only array of AutoLogEntry { ts, stage, note, payload? }. The narrated reasoning." },
            { col: "verdict",         type: "TEXT",       what: "One-line summary." },
            { col: "verdict_json",    type: "TEXT JSON",  what: "StructuredVerdict — full structured outcome with next_steps, data_issues, confidence, etc." },
            { col: "coordinator_pid", type: "INTEGER",    what: "Process running the controller. Used by cancel_auto_train cross-process." },
          ]}
        />

        <Table
          caption="auto_patterns — cross-task warm-start memory"
          columns={[
            { key: "col",  header: "Column",         mono: true, accent: "purple", width: "180px" },
            { key: "type", header: "Type",           mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",                type: "INTEGER PK", what: "Auto-increment." },
            { col: "task_fingerprint",  type: "TEXT",       what: "Hash of (kind, K, D bucket, N bucket, imbalance bucket). Indexed for lookup." },
            { col: "task_id",           type: "TEXT",       what: "Source task this pattern came from. Documentation only — multiple tasks can share a fingerprint." },
            { col: "dataset_shape",     type: "TEXT JSON",  what: "{ n, k, d, imbalance_bucket, size_bucket }. Snapshot of the data when the pattern was saved." },
            { col: "best_config",       type: "TEXT JSON",  what: "The winning SweepConfig at save time." },
            { col: "best_metric",       type: "REAL",       what: "Score that earned it the win." },
            { col: "metric_name",       type: "TEXT",       what: "'accuracy' | 'r2'." },
            { col: "created_at",        type: "INTEGER",    what: "Unix seconds." },
          ]}
        />

        <Table
          caption="rule_effectiveness — which planner rules pay off"
          columns={[
            { key: "col",  header: "Column",                 mono: true, accent: "purple", width: "230px" },
            { key: "type", header: "Type",                   mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "rule_name",            type: "TEXT",    what: "Rule identifier (e.g. 'add_epochs_still_improving')." },
            { col: "task_fingerprint",     type: "TEXT",    what: "Same fingerprint scheme as auto_patterns." },
            { col: "fired_count",          type: "INTEGER", what: "Times this rule has fired on this fingerprint." },
            { col: "produced_winner_count", type: "INTEGER", what: "Times a run produced by this rule was the winner." },
            { col: "updated_at",           type: "INTEGER", what: "Unix seconds of last increment." },
          ]}
        />
      </Section>

      <Section eyebrow="Observability" title="What happened, and when.">
        <Table
          caption="events — append-only state-change log"
          columns={[
            { key: "col",  header: "Column",   mono: true, accent: "green", width: "150px" },
            { key: "type", header: "Type",     mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",      type: "INTEGER PK", what: "Auto-increment." },
            { col: "ts",      type: "INTEGER",    what: "Unix milliseconds (note: different unit from runs.started_at which is seconds)." },
            { col: "source",  type: "TEXT",       what: "'mcp' | 'api' | 'tui'. Where the event originated." },
            { col: "kind",    type: "TEXT",       what: "Event type — see the Observability page for the full list." },
            { col: "task_id", type: "TEXT",       what: "Optional. Indexed for per-task filtering." },
            { col: "run_id",  type: "INTEGER",    what: "Optional." },
            { col: "payload", type: "TEXT JSON",  what: "Event-specific data. Schema varies by kind." },
          ]}
        />

        <Table
          caption="predictions — every predict / batch_predict call"
          columns={[
            { key: "col",  header: "Column",     mono: true, accent: "green", width: "150px" },
            { key: "type", header: "Type",       mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",         type: "INTEGER PK", what: "Auto-increment." },
            { col: "task_id",    type: "TEXT",       what: "Task being predicted on." },
            { col: "run_id",     type: "INTEGER",    what: "Run that produced the prediction. May be null for imported models." },
            { col: "model_uri",  type: "TEXT",       what: "Set when predicting via an imported model." },
            { col: "features",   type: "TEXT JSON",  what: "Input vector. Source for drift_check." },
            { col: "output",     type: "TEXT JSON",  what: "Prediction result — { label, confidence, scores } or { value }." },
            { col: "ts",         type: "INTEGER",    what: "Unix milliseconds." },
            { col: "latency_ms", type: "INTEGER",    what: "Inference time. Useful for profiling." },
          ]}
        />
      </Section>

      <Section eyebrow="Specialty tables" title="Phase 8.5 + Phase 10.5 additions.">
        <Table
          caption="shadow_models — A/B comparison runs"
          columns={[
            { key: "col",  header: "Column",        mono: true, accent: "pink", width: "180px" },
            { key: "type", header: "Type",          mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "task_id",        type: "TEXT PK",   what: "→ tasks.id." },
            { col: "shadow_run_id",  type: "INTEGER FK", what: "Candidate model. Runs in parallel with the active model on every predict." },
            { col: "attached_at",    type: "INTEGER",   what: "Unix seconds." },
            { col: "agreement_rate", type: "REAL",      what: "Rolling fraction where shadow.predict matches active.predict. shadow_promoted fires when this passes a threshold and accuracy is higher." },
          ]}
        />

        <Table
          caption="batch_predict_runs — async batch inference jobs"
          columns={[
            { key: "col",  header: "Column",        mono: true, accent: "orange", width: "180px" },
            { key: "type", header: "Type",          mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "id",          type: "INTEGER PK", what: "Auto-increment." },
            { col: "task_id",     type: "TEXT FK",    what: "→ tasks.id." },
            { col: "path",        type: "TEXT",       what: "Source CSV path." },
            { col: "status",      type: "TEXT",       what: "queued / running / completed / failed." },
            { col: "total",       type: "INTEGER",    what: "Total rows." },
            { col: "completed",   type: "INTEGER",    what: "Rows processed so far." },
            { col: "accuracy",    type: "REAL",       what: "Set when label_column is provided." },
            { col: "started_at / finished_at", type: "INTEGER", what: "Unix seconds." },
          ]}
        />
      </Section>

      <Section eyebrow="The registry" title="A second, separate database.">
        <p>
          <code>~/.neuron/registry.db</code> is its own SQLite file. <code>publish_model</code>{" "}
          writes here; <code>list_registry</code> reads here; <code>import_model</code> reads here.
          Separate from the per-project DBs so models can be reused.
        </p>
        <Table
          caption="registry.db — models table"
          columns={[
            { key: "col",  header: "Column",        mono: true, accent: "cyan", width: "180px" },
            { key: "type", header: "Type",          mono: true },
            { key: "what", header: "What" },
          ]}
          rows={[
            { col: "uri",            type: "TEXT PK",   what: "neuron://local/<name>@<version>." },
            { col: "name",           type: "TEXT",      what: "Just the name part." },
            { col: "version",        type: "TEXT",      what: "Just the version part." },
            { col: "kind",           type: "TEXT",      what: "classification | regression." },
            { col: "feature_shape",  type: "TEXT JSON", what: "From the source task." },
            { col: "labels",         type: "TEXT JSON", what: "Sorted label list." },
            { col: "accuracy",       type: "REAL",      what: "Source-task val accuracy at publish time." },
            { col: "bundle_path",    type: "TEXT",      what: "Path to ~/.neuron/registry/bundles/<slug>/." },
            { col: "adapter_hash",   type: "TEXT",      what: "SHA-256 of the source neuron.config.ts." },
            { col: "tags",           type: "TEXT JSON", what: "Optional list of tags for filtering via list_registry." },
            { col: "created_at",     type: "INTEGER",   what: "Unix seconds." },
          ]}
        />
      </Section>

      <Section eyebrow="Common queries" title="Useful for poking around.">
        <CodeBlock
          lang="bash"
          title="Open the DB"
          code={`# Open with sqlite3
sqlite3 data/neuron.db

-- Force readonly so you don't accidentally mutate while exploring
.open --readonly data/neuron.db`}
        />

        <CodeBlock
          lang="sql"
          title="Useful queries"
          code={`-- All completed runs for a task with their val accuracy
SELECT id, accuracy, val_accuracy, finished_at
FROM runs
WHERE task_id = 'iris' AND status = 'completed'
ORDER BY id DESC;

-- The decision log of the latest auto_run
SELECT json_extract(decision_log, '$') AS log
FROM auto_runs
WHERE task_id = 'iris'
ORDER BY started_at DESC LIMIT 1;

-- Stale runs from dead processes (post-startup-reaper inspection)
SELECT id, task_id, status, owner_pid, started_at
FROM runs
WHERE status = 'running' AND started_at < unixepoch() - 3600;

-- Top patterns saved
SELECT task_fingerprint, best_metric, json_extract(best_config, '$.lr') AS lr
FROM auto_patterns
ORDER BY best_metric DESC LIMIT 10;

-- Recent prediction volume per task
SELECT task_id, COUNT(*) AS n, MIN(ts), MAX(ts)
FROM predictions
WHERE ts > (CAST(julianday('now', '-7 days') - 2440587.5) * 86400000)
GROUP BY task_id;`}
        />
      </Section>

      <Section eyebrow="Don't do this" title="Edits that will hurt.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={ShieldCheck} title="Don't UPDATE weights" accent="orange">
            They're consistent with what's in <code>rs-tensor</code>'s in-memory tensor map after
            lazy restore. Edit them and predict will silently produce garbage until the server
            restarts.
          </InfoCard>
          <InfoCard icon={Database} title="Don't DELETE runs that are 'running'" accent="pink">
            They have child processes. Use <code>cancel_training(force: true)</code> instead — it
            sets the status cleanly and lets the process clean up.
          </InfoCard>
          <InfoCard icon={Layers} title="Don't ALTER schema by hand" accent="cyan">
            <code>core/db/schema.ts</code>'s <code>ensureColumns</code> is idempotent — adds new
            columns automatically on next server start. Hand-rolling ALTER risks divergence from the
            checked-in migration logic.
          </InfoCard>
          <InfoCard icon={FileSearch} title="Don't read with locked DB" accent="purple">
            If a sweep is in flight, prefer reading from the dashboard's API or sqlite3{" "}
            <code>--readonly</code>. WAL means readers won't block, but accidental writes will.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File",                          mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/core/db/schema.ts",   what: "Source of truth for every CREATE TABLE + auto-migration." },
            { file: "neuron/src/core/db/tasks.ts",    what: "tasks-table CRUD." },
            { file: "neuron/src/core/db/samples.ts",  what: "samples-table CRUD + streaming iterator." },
            { file: "neuron/src/core/db/runs.ts",     what: "runs-table CRUD + reaper helpers." },
            { file: "neuron/src/core/db/auto.ts",     what: "auto_runs + decision_log appender." },
            { file: "neuron/src/core/db/events.ts",   what: "events-table writers + queries." },
            { file: "neuron/src/core/db/predictions.ts", what: "predictions-table writers + drift_check input." },
          ]}
        />
        <Callout kind="learn" title="It's just SQLite">
          Nothing exotic. <code>sqlite3</code> on the command line works. <code>jq</code> piped after
          <code>SELECT json_extract(...)</code> works. Any SQLite GUI works. Don't be afraid to poke.
        </Callout>
      </Section>
    </div>
  )
}
