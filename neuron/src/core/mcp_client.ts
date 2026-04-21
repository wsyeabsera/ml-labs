import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync } from "node:fs"

// When RS_TENSOR_MCP_URL is set, fall back to HTTP (remote/debug mode).
// Otherwise use the locally-built stdio binary.
const EXPLICIT_URL = process.env.RS_TENSOR_MCP_URL
const RS_TENSOR_BIN =
  process.env.RS_TENSOR_BIN ??
  join(homedir(), ".ml-labs", "rs-tensor", "target", "release", "mcp")

function makeTransport() {
  if (EXPLICIT_URL) {
    return new StreamableHTTPClientTransport(new URL(EXPLICIT_URL))
  }
  if (!existsSync(RS_TENSOR_BIN)) {
    throw new Error(
      `rs-tensor binary not found at ${RS_TENSOR_BIN}. ` +
      `Run \`ml-labs update\` to build it (or set RS_TENSOR_MCP_URL to use a remote server).`,
    )
  }
  return new StdioClientTransport({ command: RS_TENSOR_BIN, args: [], stderr: "ignore" })
}

let clientPromise: Promise<Client> | null = null

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = makeTransport()
      transport.onclose = () => { clientPromise = null }
      transport.onerror = () => { clientPromise = null }
      const c = new Client({ name: "neuron-mcp", version: "0.1.0" })
      await c.connect(transport)
      return c
    })().catch((err) => { clientPromise = null; throw err })
  }
  return clientPromise
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes("streamable http") ||
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("socket") ||
    m.includes("epipe") ||
    m.includes("spawn") ||
    m.includes("expect initialize")
}

// Per-call timeout — 5 minutes by default. Training calls emit progress
// notifications (Phase 5), and `resetTimeoutOnProgress: true` means any
// incoming progress event resets this timer. So a training that keeps
// reporting progress can run for up to `MAX_TOTAL_TIMEOUT_MS` total.
const DEFAULT_TIMEOUT_MS = process.env.RS_TENSOR_TIMEOUT_MS
  ? Math.max(60_000, parseInt(process.env.RS_TENSOR_TIMEOUT_MS))
  : 300_000

// Hard ceiling for any single MCP call — 4 hours. Applies regardless of
// progress resets. For longer trainings, raise via RS_TENSOR_MAX_TIMEOUT_MS.
const MAX_TOTAL_TIMEOUT_MS = process.env.RS_TENSOR_MAX_TIMEOUT_MS
  ? Math.max(60_000, parseInt(process.env.RS_TENSOR_MAX_TIMEOUT_MS))
  : 14_400_000

export interface CallOpts {
  timeoutMs?: number
  signal?: AbortSignal
  onProgress?: (p: { progress: number; total?: number; message?: string }) => void
}

export async function call<T = unknown>(
  tool: string,
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<T> {
  return callRaw(tool, args, opts, true) as Promise<T>
}

/**
 * Like `call` but tolerates non-JSON text responses. Returns parsed JSON when
 * the payload is valid JSON, otherwise returns `{ text }` with the raw string.
 * Used for rs-tensor tools that return human-readable strings (e.g. llama_load).
 */
export async function callText(
  tool: string,
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<{ text: string } & Record<string, unknown>> {
  return callRaw(tool, args, opts, false) as Promise<{ text: string } & Record<string, unknown>>
}

async function callRaw(
  tool: string,
  args: Record<string, unknown>,
  opts: CallOpts,
  strictJson: boolean,
): Promise<unknown> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await getClient()
      const result = await c.callTool(
        { name: tool, arguments: args },
        undefined,
        {
          timeout,
          maxTotalTimeout: MAX_TOTAL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          signal: opts.signal,
          onprogress: opts.onProgress
            ? (n) => opts.onProgress!({ progress: n.progress, total: n.total, message: n.message })
            : undefined,
        },
      )
      const content = Array.isArray(result.content) ? result.content[0] : null
      if (!content || content.type !== "text") throw new Error(`Unexpected response from "${tool}"`)
      if (strictJson) return JSON.parse(content.text)
      try {
        const parsed = JSON.parse(content.text)
        if (parsed && typeof parsed === "object") return parsed
        return { text: String(parsed) }
      } catch {
        return { text: content.text }
      }
    } catch (err) {
      lastErr = err
      if (attempt === 0 && isConnectionError(err)) {
        clientPromise = null
        await new Promise<void>((r) => setTimeout(r, 500))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export function resetClient() { clientPromise = null }

export function clientStatus(): { ok: boolean; mode: "stdio" | "http" | "missing"; connected: boolean } {
  const connected = clientPromise !== null
  if (EXPLICIT_URL) return { ok: true, mode: "http", connected }
  if (existsSync(RS_TENSOR_BIN)) return { ok: true, mode: "stdio", connected }
  return { ok: false, mode: "missing", connected: false }
}

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

  initMlp: (
    architecture: number[],
    name = "mlp",
    opts?: { activation?: string; init?: string },
  ) =>
    call<{ weight_names: string[]; activation?: string; init?: string }>("init_mlp", {
      architecture, name,
      ...(opts?.activation !== undefined ? { activation: opts.activation } : {}),
      ...(opts?.init !== undefined ? { init: opts.init } : {}),
    }),

  trainMlp: (
    mlp: string,
    inputs: string,
    targets: string,
    lr: number,
    epochs: number,
    opts?: {
      weight_decay?: number
      early_stop_patience?: number
      optimizer?: string
      batch_size?: number
      lr_schedule?: string
      warmup_epochs?: number
      min_lr?: number
      grad_clip?: number
      loss?: string
      rng_seed?: number
      swa?: boolean
      swa_start_epoch?: number
      label_smoothing?: number
      onProgress?: (p: { progress: number; total?: number; message?: string }) => void
    },
  ) =>
    call<{
      loss_history_sampled?: number[]; final_loss?: number
      epochs_done?: number; stopped_early?: boolean
      optimizer?: string; batch_size?: number; lr_schedule?: string
      loss?: string; activation?: string
    }>(
      "train_mlp",
      {
        mlp, inputs, targets, lr, epochs,
        ...(opts?.weight_decay !== undefined ? { weight_decay: opts.weight_decay } : {}),
        ...(opts?.early_stop_patience !== undefined ? { early_stop_patience: opts.early_stop_patience } : {}),
        ...(opts?.optimizer !== undefined ? { optimizer: opts.optimizer } : {}),
        ...(opts?.batch_size !== undefined ? { batch_size: opts.batch_size } : {}),
        ...(opts?.lr_schedule !== undefined ? { lr_schedule: opts.lr_schedule } : {}),
        ...(opts?.warmup_epochs !== undefined ? { warmup_epochs: opts.warmup_epochs } : {}),
        ...(opts?.min_lr !== undefined ? { min_lr: opts.min_lr } : {}),
        ...(opts?.grad_clip !== undefined ? { grad_clip: opts.grad_clip } : {}),
        ...(opts?.loss !== undefined ? { loss: opts.loss } : {}),
        ...(opts?.rng_seed !== undefined ? { rng_seed: opts.rng_seed } : {}),
        ...(opts?.swa !== undefined ? { swa: opts.swa } : {}),
        ...(opts?.swa_start_epoch !== undefined ? { swa_start_epoch: opts.swa_start_epoch } : {}),
        ...(opts?.label_smoothing !== undefined ? { label_smoothing: opts.label_smoothing } : {}),
      },
      { onProgress: opts?.onProgress },
    ),

  evaluateMlp: (mlp: string, inputs: string, targets?: string) =>
    call<{ predictions?: { data: number[]; shape: number[] }; accuracy?: number }>(
      "evaluate_mlp", { mlp, inputs, ...(targets ? { targets } : {}) }
    ),

  tensorInspect: (name: string) =>
    call<{ data: number[]; shape: number[] }>("tensor_inspect", { name }),

  attentionForward: (flatQ: number[], flatK: number[], flatV: number[], seqLen: number, dK: number) =>
    call<Record<string, unknown>>("attention_forward", { q_data: flatQ, k_data: flatK, v_data: flatV, seq_len: seqLen, d_k: dK }),

  // ── Phase 11A: small-LLM inference (rmcp surface already exists in rs-tensor) ──

  llamaLoad: (path: string) =>
    // rs-tensor's llama_load returns a human-readable string, not JSON — use the
    // tolerant variant so we don't blow up on `JSON.parse`.
    callText("llama_load", { path }, { timeoutMs: 600_000 }),

  llamaInspect: () =>
    call<{
      config?: {
        dim: number; n_layers: number; n_heads: number; n_kv_heads: number;
        vocab_size: number; ffn_dim: number; head_dim: number; rms_eps: number;
      };
      vocab_size?: number;
      vocab_sample?: string[];
      total_weight_tensors?: number;
    }>("llama_inspect", {}),

  llamaGenerate: (args: {
    prompt?: string
    token_ids?: number[]
    max_tokens: number
    temperature: number
  }) =>
    call<{
      text: string
      token_ids: number[]
      prompt_tokens: number[]
      num_generated: number
      elapsed_ms: number
      tokens_per_sec: string
    }>("llama_generate", {
      ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
      ...(args.token_ids !== undefined ? { token_ids: args.token_ids } : {}),
      max_tokens: args.max_tokens,
      temperature: args.temperature,
    }, { timeoutMs: 600_000 }),

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
