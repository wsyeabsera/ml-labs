import { z } from "zod"
import { listEntries } from "../core/db/registry"

export const name = "list_registry"
export const description =
  "List models in the local registry (~/.neuron/registry/). Filter by kind or tag."

export const schema = {
  kind: z.string().optional().describe("Filter by task kind, e.g. 'classification'"),
  tag: z.string().optional().describe("Filter by tag"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const entries = listEntries({ kind: args.kind, tag: args.tag })
  return {
    total: entries.length,
    entries: entries.map((e) => ({
      uri: e.uri,
      name: e.name,
      version: e.version,
      description: e.description,
      tags: e.tags,
      kind: e.taskKind,
      feature_shape: e.featureShape,
      accuracy: e.accuracy,
      adapter_hash: e.adapterHash,
      created_at: e.createdAt,
    })),
  }
}
