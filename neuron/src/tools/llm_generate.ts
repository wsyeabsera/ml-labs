import { z } from "zod"
import { rsTensor } from "../core/mcp_client"
import { recordEvent } from "../core/db/events"

export const name = "llm_generate"
export const description =
  "Generate text from the loaded LLaMA model. Provide either a text prompt (naive " +
  "whitespace tokenization — unknown words silently skipped; for production use pre-tokenize " +
  "via token_ids) or raw token_ids. Returns generated text + raw tokens + timing. " +
  "CPU-only inference; expect 5-10 tok/s on a 1B model."

export const schema = {
  prompt: z.string().optional().describe("Prompt text. Whitespace-tokenized against the model's vocab."),
  token_ids: z.array(z.number().int().nonnegative()).optional().describe("Pre-tokenized prompt IDs. Use this if you have a real tokenizer."),
  max_tokens: z.number().int().min(1).max(2048).default(64).describe("Max new tokens to generate (default 64)."),
  temperature: z.number().min(0).max(2).default(0.8).describe("Sampling temperature. 0 = greedy (argmax)."),
}

export const outputSchema = {
  text: z.string(),
  token_ids: z.array(z.number().int()),
  prompt_tokens: z.array(z.number().int()),
  num_generated: z.number().int(),
  elapsed_ms: z.number(),
  tokens_per_sec: z.string(),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  if (args.prompt === undefined && args.token_ids === undefined) {
    throw new Error("Provide either prompt or token_ids")
  }
  const res = await rsTensor.llamaGenerate({
    prompt: args.prompt,
    token_ids: args.token_ids,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
  })
  recordEvent({
    source: "mcp",
    kind: "llm_generated",
    payload: {
      num_generated: res.num_generated,
      elapsed_ms: res.elapsed_ms,
      tokens_per_sec: res.tokens_per_sec,
    },
  })
  return res
}
