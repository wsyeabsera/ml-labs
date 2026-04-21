import { z } from "zod"
import { rsTensor } from "../core/mcp_client"
import { recordEvent } from "../core/db/events"

export const name = "llm_load"
export const description =
  "Load a small LLaMA model from a GGUF file for inference. Only one model can be " +
  "loaded at a time; subsequent calls replace the previous. Returns the model info string. " +
  "Use llm_inspect afterwards for structured config."

export const schema = {
  path: z.string().describe("Absolute path to a GGUF model file (Q4/Q8/F16/F32)"),
}

export const outputSchema = {
  ok: z.boolean(),
  info: z.string().describe("Human-readable load summary from rs-tensor"),
}

export async function handler(args: z.infer<z.ZodObject<typeof schema>>) {
  const res = await rsTensor.llamaLoad(args.path)
  recordEvent({ source: "mcp", kind: "llm_loaded", payload: { path: args.path, info: res.text } })
  return { ok: true, info: res.text }
}
