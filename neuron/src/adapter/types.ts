/**
 * Shape of a single-sample recommendation returned by suggest_samples.
 * Users inspect this to decide how to synthesize/fetch new samples.
 */
export interface CollectRecommendation {
  sample_id: number
  true_label: string
  predicted_label: string
  confidence: number
  features: number[]
}

/** A newly-collected sample to feed back into the task. */
export interface CollectedSample {
  label: string
  features: number[]
  raw?: unknown
}

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
  /**
   * Optional active-learning callback (Phase 7). Invoked by auto_train when
   * auto_collect=true and the initial training didn't hit the target. Receives
   * the suggest_samples recommendations (uncertain + diverse samples) and the
   * free-form textual recommendations (e.g. "collect ~20 more of class X").
   * Must return new labeled samples to add to the task before retraining.
   *
   * Typical implementations: query a human-in-the-loop queue, call a weak
   * labeler API, sample from an augmentation pipeline, or synthesize.
   */
  collect?: (input: {
    uncertain_samples: CollectRecommendation[]
    recommendations: string[]
    per_class: Array<{ label: string; count: number; accuracy: number }>
  }) => Promise<CollectedSample[]>
}

export function defineNeuronConfig<Raw = unknown>(config: NeuronConfig<Raw>): NeuronConfig<Raw> {
  return {
    headArchitecture: (K, D) => [D, Math.max(D, 32), K],
    defaultHyperparams: { lr: 0.005, epochs: 500 },
    ...config,
  }
}
