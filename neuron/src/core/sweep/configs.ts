export interface SweepConfig {
  lr?: number
  epochs?: number
  head_arch?: number[]
  class_weights?: "balanced"
  weight_decay?: number
  early_stop_patience?: number
  optimizer?: "sgd" | "adam" | "adamw"
  batch_size?: number
  lr_schedule?: "constant" | "cosine" | "linear_warmup"
  loss?: "mse" | "cross_entropy"
  activation?: "tanh" | "relu" | "gelu" | "leaky_relu"
  swa?: boolean
  label_smoothing?: number
}

export interface SearchSpec {
  lr?: number[]
  epochs?: number[]
  head_arch?: number[][]
}

export function expandGrid(search: SearchSpec, explicit: SweepConfig[]): SweepConfig[] {
  const lrs = search.lr ?? [undefined]
  const epochsList = search.epochs ?? [undefined]
  const archs = search.head_arch ?? [undefined]

  const gridConfigs: SweepConfig[] = []
  for (const lr of lrs) {
    for (const epochs of epochsList) {
      for (const arch of archs) {
        const cfg: SweepConfig = {}
        if (lr !== undefined) cfg.lr = lr
        if (epochs !== undefined) cfg.epochs = epochs
        if (arch !== undefined) cfg.head_arch = arch
        gridConfigs.push(cfg)
      }
    }
  }

  // Merge grid + explicit, de-dup by JSON key
  const all = [...gridConfigs, ...explicit]
  const seen = new Set<string>()
  return all.filter((c) => {
    const key = JSON.stringify(c)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
