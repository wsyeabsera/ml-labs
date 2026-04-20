/**
 * neuron.config.ts — ML-Labs project configuration
 *
 * This file tells Neuron how to featurize your raw data before training.
 * For tabular/CSV data: featurize is not needed (features come in as numbers already).
 * For images or custom inputs: implement featurize below.
 */

import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

function defineNeuronConfig<Raw = unknown>(config: NeuronConfig<Raw>): NeuronConfig<Raw> {
  return { headArchitecture: (K, D) => [D, Math.max(D * 2, 64), K], ...config }
}

export default defineNeuronConfig({
  // ── Required ────────────────────────────────────────────────────────────────
  taskId: "my-classifier",        // matches the id you pass to create_task
  featureShape: [4],              // shape of one input sample, e.g. [4] for iris

  // ── Optional ────────────────────────────────────────────────────────────────
  dbPath: "./data/neuron.db",     // where the SQLite DB lives

  defaultHyperparams: {
    lr: 0.05,
    epochs: 800,
  },

  // ── featurize (only needed for raw/non-tabular inputs) ─────────────────────
  // For CSV data loaded via load_csv, leave this commented out.
  // Uncomment and implement when using load_images or collect() with raw buffers.
  //
  // featurize: async (raw: Buffer) => {
  //   // Example: resize an image to 28×28 grayscale and normalize to [0, 1]
  //   const { default: sharp } = await import("sharp")
  //   const { data } = await sharp(raw).resize(28, 28).grayscale().raw().toBuffer({ resolveWithObject: true })
  //   return Array.from(data).map((v) => v / 255)
  // },
  //
  // featureShape: [784],          // 28×28 = 784 for the above
  // sampleShape: [28, 28, 1],     // original input shape (optional)

  // ── Custom head architecture (optional) ────────────────────────────────────
  // headArchitecture: (K, D) => [D, 64, 32, K],
})
