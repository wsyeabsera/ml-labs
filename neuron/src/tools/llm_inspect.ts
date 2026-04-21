import { z } from "zod"
import { rsTensor } from "../core/mcp_client"

export const name = "llm_inspect"
export const description =
  "Inspect the currently-loaded LLaMA model: config (dim / layers / heads / vocab size / ffn_dim), " +
  "per-block weight shapes, and a vocab sample. Errors if no model is loaded."

export const schema = {}

export const outputSchema = {
  config: z.object({
    dim: z.number(),
    n_layers: z.number(),
    n_heads: z.number(),
    n_kv_heads: z.number(),
    vocab_size: z.number(),
    ffn_dim: z.number(),
    head_dim: z.number(),
    rms_eps: z.number(),
  }).optional(),
  vocab_size: z.number().optional(),
  total_parameters: z.number().optional(),
  total_parameters_human: z.string().optional(),
}

export async function handler(_args: z.infer<z.ZodObject<typeof schema>>) {
  return rsTensor.llamaInspect()
}
