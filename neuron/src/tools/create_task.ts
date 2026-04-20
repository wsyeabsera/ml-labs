import { z } from "zod"
import { createTask } from "../core/db/tasks"

export const name = "create_task"
export const description = "Register a new ML task. Call this once per project before collecting samples."

export const schema = {
  id: z.string().min(1).describe("Unique task identifier (e.g. 'emotion-classifier')"),
  kind: z.enum(["classification", "regression"]).default("classification").describe("Task type"),
  labels: z.array(z.string()).optional().describe("Class labels for classification tasks"),
  feature_shape: z.array(z.number().int().positive()).describe("Shape of each feature vector, e.g. [64]"),
  sample_shape: z.array(z.number().int().positive()).optional().describe("Shape of raw input (pre-featurize), e.g. [49, 64]"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const task = createTask({
    id: args.id,
    kind: args.kind ?? "classification",
    labels: args.labels ?? null,
    featureShape: args.feature_shape,
    sampleShape: args.sample_shape ?? args.feature_shape,
  })
  return { ok: true, task }
}
