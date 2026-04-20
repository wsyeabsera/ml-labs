import type { Server } from "@modelcontextprotocol/sdk/server/index.js"

export interface SamplingMessage {
  role: "user" | "assistant"
  content: { type: "text"; text: string }
}

export interface SamplingRequest {
  messages: SamplingMessage[]
  systemPrompt?: string
  maxTokens?: number
  modelHints?: string[]
}

export interface SamplingResult {
  text: string
  model?: string
}

export async function requestSampling(server: Server, req: SamplingRequest): Promise<SamplingResult> {
  try {
    const result = await server.createMessage({
      messages: req.messages.map((m) => ({
        role: m.role,
        content: { type: "text" as const, text: m.content.text },
      })),
      maxTokens: req.maxTokens ?? 1024,
      ...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
      modelPreferences: req.modelHints?.length
        ? { hints: req.modelHints.map((name) => ({ name })) }
        : { hints: [{ name: "claude-sonnet-4-6" }] },
    })
    const text = result.content.type === "text" ? result.content.text : ""
    return { text, model: result.model }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // MCP client doesn't support sampling (e.g. Claude Code pre-sampling)
    throw new SamplingNotSupportedError(msg)
  }
}

export class SamplingNotSupportedError extends Error {
  constructor(reason: string) {
    super(`MCP Sampling not supported by this client: ${reason}`)
    this.name = "SamplingNotSupportedError"
  }
}
