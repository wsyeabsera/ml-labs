export interface NeuronConfig<Raw = unknown> {
  taskId: string
  dbPath?: string
  featurize?: (raw: Raw) => Promise<number[]>
  headArchitecture?: (K: number, D: number) => number[]
  featureShape: number[]
  sampleShape?: number[]
  defaultHyperparams?: {
    lr?: number
    epochs?: number
  }
  /** Optional: project-specific image → raw conversion for load_images. Default: sharp → normalized float array. */
  decodeImage?: (buffer: Buffer, meta: { path: string; width: number; height: number; channels: number }) => Promise<Raw>
}

export function defineNeuronConfig<Raw = unknown>(config: NeuronConfig<Raw>): NeuronConfig<Raw> {
  return {
    headArchitecture: (K, D) => [D, Math.max(D, 32), K],
    defaultHyperparams: { lr: 0.005, epochs: 500 },
    ...config,
  }
}
