import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const DEFAULT_URL = "https://openings-trivia-thereafter-reed.trycloudflare.com/mcp"
const MCP_URL = process.env.RS_TENSOR_MCP_URL ?? DEFAULT_URL

let clientPromise: Promise<Client> | null = null
let rateLimitUntil = 0

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL))
      transport.onclose = () => { clientPromise = null }
      transport.onerror = () => { clientPromise = null }
      const c = new Client({ name: "neuron-mcp", version: "0.1.0" })
      await c.connect(transport)
      return c
    })().catch((err) => { clientPromise = null; throw err })
  }
  return clientPromise
}

function isRateLimit(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes("429")
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return (m.includes("streamable http") && !isRateLimit(err)) ||
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("socket") ||
    m.includes("expect initialize")
}

export async function call<T = unknown>(tool: string, args: Record<string, unknown>, timeoutMs = 600_000): Promise<T> {
  const now = Date.now()
  if (rateLimitUntil > now) {
    await new Promise<void>((r) => setTimeout(r, rateLimitUntil - now))
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await getClient()
      const result = await c.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs })
      const content = Array.isArray(result.content) ? result.content[0] : null
      if (!content || content.type !== "text") throw new Error(`Unexpected response from "${tool}"`)
      return JSON.parse(content.text) as T
    } catch (err) {
      lastErr = err
      if (isRateLimit(err)) {
        rateLimitUntil = Date.now() + 5000
        await new Promise<void>((r) => setTimeout(r, 5000))
        continue
      }
      if (attempt === 0 && isConnectionError(err)) {
        clientPromise = null
        await new Promise<void>((r) => setTimeout(r, 1000))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export function resetClient() { clientPromise = null }

// Infer MLP architecture from stored weight shapes (e.g. [D,H1] + [H1,K] → [D,H1,K])
function inferArch(
  mlpName: string,
  weights: Record<string, { data: number[]; shape: number[] }>,
): number[] | null {
  const wKeys = Object.keys(weights)
    .filter((k) => k.startsWith(mlpName + "_w") && !k.startsWith("backbone_"))
    .sort()
  if (!wKeys.length) return null
  const arch: number[] = []
  for (let i = 0; i < wKeys.length; i++) {
    const shape = weights[wKeys[i]!]!.shape
    if (i === 0) arch.push(shape[0]!)
    arch.push(shape[1]!)
  }
  return arch
}

// Typed helpers for rs-tensor tools
export const rsTensor = {
  createTensor: (name: string, data: number[], shape: number[]) =>
    call("tensor_create", { name, data, shape }),

  initMlp: (architecture: number[], name = "mlp") =>
    call<{ weight_names: string[] }>("init_mlp", { architecture, name }),

  trainMlp: (mlp: string, inputs: string, targets: string, lr: number, epochs: number) =>
    call<{ loss_history_sampled?: number[]; final_loss?: number }>("train_mlp", { mlp, inputs, targets, lr, epochs }),

  evaluateMlp: (mlp: string, inputs: string, targets?: string) =>
    call<{ predictions?: { data: number[]; shape: number[] }; accuracy?: number }>(
      "evaluate_mlp", { mlp, inputs, ...(targets ? { targets } : {}) }
    ),

  tensorInspect: (name: string) =>
    call<{ data: number[]; shape: number[] }>("tensor_inspect", { name }),

  attentionForward: (flatQ: number[], flatK: number[], flatV: number[], seqLen: number, dK: number) =>
    call<Record<string, unknown>>("attention_forward", { q_data: flatQ, k_data: flatK, v_data: flatV, seq_len: seqLen, d_k: dK }),

  // Restore a trained MLP from stored weights into rs-tensor memory.
  // Call initMlp first (creates structure with random weights), then overwrite
  // each weight tensor with the stored values via createTensor.
  restoreMlp: async (
    mlpName: string,
    weights: Record<string, { data: number[]; shape: number[] }>,
    arch?: number[],
  ): Promise<void> => {
    const resolvedArch = arch ?? inferArch(mlpName, weights)
    if (!resolvedArch) throw new Error(`Cannot infer architecture for MLP "${mlpName}" — no weight tensors found`)
    await call("init_mlp", { architecture: resolvedArch, name: mlpName })
    const mlpKeys = Object.keys(weights).filter((k) => !k.startsWith("backbone_"))
    for (const name of mlpKeys) {
      const t = weights[name]!
      await call("tensor_create", { name, data: t.data, shape: t.shape })
    }
  },
}
