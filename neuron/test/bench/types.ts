export interface BenchConfig {
  name: string                      // "iris", "wine", ...
  csv: string                       // path relative to data/
  kind: "classification" | "regression"
  label_column: string
  budget_s: number
  accuracy_target: number           // R² for regression, accuracy for classification
  max_waves: number
  test_size: number                 // held-out fraction, 0–0.5
}

export interface BenchResult {
  name: string
  kind: "classification" | "regression"
  metric_name: "accuracy" | "r2"
  metric_value: number | null
  waves_used: number
  configs_tried: number
  wall_clock_s: number
  status: string
  is_overfit: boolean
  seed: number
  dataset_hash: string | null
}

export interface BaselineEntry {
  metric_name: "accuracy" | "r2"
  metric_value: number
  waves_used: number
  configs_tried: number
  wall_clock_s: number
  dataset_hash?: string | null
  note?: string
}

export interface BaselineFile {
  generated_at: string
  neuron_version: string
  entries: Record<string, BaselineEntry>
}
