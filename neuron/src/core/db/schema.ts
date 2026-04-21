import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

// Anchor data dir to neuron project root (4 levels up from src/core/db/schema.ts)
// so the DB path is stable regardless of the shell's cwd when the server starts.
const NEURON_ROOT = resolve(import.meta.dir, "../../../..")
const DB_PATH = process.env.NEURON_DB_PATH ?? process.env.NEURON_DB ?? resolve(NEURON_ROOT, "data/neuron.db")
mkdirSync(resolve(DB_PATH, ".."), { recursive: true })

export const db = new Database(DB_PATH, { create: true })

// WAL mode enables concurrent readers + one writer without blocking
db.exec("PRAGMA journal_mode=WAL")

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL DEFAULT 'classification',
    labels       TEXT,
    feature_shape TEXT NOT NULL DEFAULT '[1]',
    sample_shape  TEXT NOT NULL DEFAULT '[1]',
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS samples (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    label      TEXT NOT NULL,
    features   TEXT NOT NULL,
    raw        TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_samples_task ON samples(task_id);
  CREATE INDEX IF NOT EXISTS idx_samples_label ON samples(task_id, label);

  CREATE TABLE IF NOT EXISTS runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          TEXT NOT NULL,
    hyperparams      TEXT NOT NULL DEFAULT '{}',
    accuracy         REAL,
    per_class_accuracy TEXT,
    confusion_matrix TEXT,
    loss_history     TEXT,
    sample_counts    TEXT,
    weights          TEXT,
    checkpoint       TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    started_at       INTEGER,
    finished_at      INTEGER,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);

  CREATE TABLE IF NOT EXISTS models (
    task_id      TEXT PRIMARY KEY,
    run_id       INTEGER NOT NULL,
    promoted_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(run_id)  REFERENCES runs(id)  ON DELETE CASCADE
  );
`)

// Auto-migrate: add new columns to existing tables without data loss
function ensureColumns(table: string, cols: string[]) {
  const existing = new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
  )
  for (const col of cols) {
    const name = col.split(" ")[0]!
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`)
  }
}

ensureColumns("runs", [
  "checkpoint TEXT",
  "run_progress TEXT",
  "owner_pid INTEGER",
  "source_uri TEXT",
  "val_accuracy REAL",
  "val_loss_history TEXT",
  "norm_stats TEXT",
  "mae REAL",
  "rmse REAL",
  "r2 REAL",
  "run_context TEXT",
  "dataset_hash TEXT",
  "cv_fold_id INTEGER",
  "cv_parent_id INTEGER",
])
ensureColumns("samples", ["raw TEXT", "split TEXT DEFAULT 'train'"])
ensureColumns("tasks", ["normalize INTEGER DEFAULT 0", "feature_names TEXT"])

// Global event bus — shared by MCP server and HTTP API via SQLite WAL
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
    source     TEXT NOT NULL,
    kind       TEXT NOT NULL,
    task_id    TEXT,
    run_id     INTEGER,
    payload    TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, ts DESC);
`)

// auto_runs tracks coordinator-driven auto_train invocations
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running',
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    accuracy_target  REAL,
    budget_s         INTEGER,
    max_waves        INTEGER,
    waves_used       INTEGER NOT NULL DEFAULT 0,
    winner_run_id    INTEGER,
    final_accuracy   REAL,
    decision_log     TEXT NOT NULL DEFAULT '[]',
    verdict          TEXT,
    coordinator_pid  INTEGER,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_auto_runs_task ON auto_runs(task_id, started_at DESC);
`)

ensureColumns("auto_runs", ["verdict_json TEXT"])

// auto_patterns — cross-task memory: what worked for similar tasks
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_patterns (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_fingerprint  TEXT NOT NULL,
    task_id           TEXT NOT NULL,
    dataset_shape     TEXT NOT NULL,
    best_config       TEXT NOT NULL,
    best_metric       REAL NOT NULL,
    metric_name       TEXT NOT NULL,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_auto_patterns_fp ON auto_patterns(task_fingerprint, best_metric DESC);
`)
