import { db } from "../db/schema"
import type { SweepConfig } from "../sweep/configs"
import type { DataHealth } from "./signals"

export interface AutoPattern {
  id: number
  task_fingerprint: string
  task_id: string
  dataset_shape: { n: number; k: number; d: number; imbalance_bucket: string; size_bucket: string }
  best_config: SweepConfig
  best_metric: number
  metric_name: "accuracy" | "r2"
  created_at: number
}

/**
 * Compact task fingerprint: tasks with the same fingerprint are "similar enough"
 * that a prior winner is a useful warm-start seed.
 */
export function taskFingerprint(kind: "classification" | "regression", data: DataHealth): string {
  const sizeBucket = data.n < 50 ? "xs" : data.n < 200 ? "s" : data.n < 1000 ? "m" : "l"
  const imbalanceBucket = data.imbalance_ratio == null
    ? "bal"
    : data.imbalance_ratio < 2 ? "bal"
    : data.imbalance_ratio < 5 ? "mild"
    : "severe"
  const dBucket = data.d < 5 ? "d_xs" : data.d < 20 ? "d_s" : data.d < 100 ? "d_m" : "d_l"
  return `${kind}|k${data.k}|${dBucket}|${sizeBucket}|${imbalanceBucket}`
}

export function sizeBucket(n: number): string {
  return n < 50 ? "xs" : n < 200 ? "s" : n < 1000 ? "m" : "l"
}

export function imbalanceBucket(r: number | null): string {
  if (r == null) return "bal"
  return r < 2 ? "bal" : r < 5 ? "mild" : "severe"
}

export function lookupBestPattern(fingerprint: string): AutoPattern | null {
  const row = db.query(
    `SELECT * FROM auto_patterns WHERE task_fingerprint = ? ORDER BY best_metric DESC LIMIT 1`,
  ).get(fingerprint) as {
    id: number; task_fingerprint: string; task_id: string; dataset_shape: string;
    best_config: string; best_metric: number; metric_name: string; created_at: number;
  } | null
  if (!row) return null
  return {
    id: row.id,
    task_fingerprint: row.task_fingerprint,
    task_id: row.task_id,
    dataset_shape: JSON.parse(row.dataset_shape),
    best_config: JSON.parse(row.best_config) as SweepConfig,
    best_metric: row.best_metric,
    metric_name: row.metric_name as "accuracy" | "r2",
    created_at: row.created_at,
  }
}

export function savePattern(opts: {
  task_fingerprint: string
  task_id: string
  data: DataHealth
  best_config: SweepConfig
  best_metric: number
  metric_name: "accuracy" | "r2"
}): void {
  const dataset_shape = {
    n: opts.data.n,
    k: opts.data.k,
    d: opts.data.d,
    imbalance_bucket: imbalanceBucket(opts.data.imbalance_ratio),
    size_bucket: sizeBucket(opts.data.n),
  }
  db.exec(
    `INSERT INTO auto_patterns (task_fingerprint, task_id, dataset_shape, best_config, best_metric, metric_name) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.task_fingerprint,
      opts.task_id,
      JSON.stringify(dataset_shape),
      JSON.stringify(opts.best_config),
      opts.best_metric,
      opts.metric_name,
    ],
  )
}
