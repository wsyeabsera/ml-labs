/**
 * Example neuron.config.ts for a PixelMind-style project.
 * Copy to your project root as `neuron.config.ts` and adapt to your featurize logic.
 */
// In your actual project: import { defineNeuronConfig } from "@neuron/mcp/adapter/types"
// For this example we define it inline:
type NeuronCfg = { taskId: string; dbPath?: string; featurize?: (raw: unknown) => Promise<number[]>; headArchitecture?: (K: number, D: number) => number[]; featureShape: number[]; sampleShape?: number[]; defaultHyperparams?: { lr?: number; epochs?: number } }
function defineNeuronConfig(c: NeuronCfg): NeuronCfg { return c }

export default defineNeuronConfig({
  taskId: "emotion-classifier",
  dbPath: "./data/neuron.db",

  // featurize: converts raw input → feature vector
  // Here: patches [49×64] → ViT CLS embedding [64]
  featurize: async (raw: unknown) => {
    // Replace with your actual featurize import
    // e.g. const { forwardPass } = await import("./src/transformer/pipeline")
    // const { cls } = await forwardPass(raw as number[][])
    // return cls
    throw new Error("Implement featurize for your project")
  },

  headArchitecture: (K, D) => [D, 64, K],  // [64, 64, K] for ViT

  featureShape: [64],       // CLS embedding dimension
  sampleShape: [49, 64],    // raw patch grid shape

  defaultHyperparams: {
    lr: 0.005,
    epochs: 800,
  },
})
