import { query } from "@anthropic-ai/claude-agent-sdk"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { SweepConfig } from "./configs"

const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../server.ts")

export interface AgentRunResult {
  config: SweepConfig
  run_id: number | null
  accuracy: number | null
  status: "completed" | "failed"
  session_id: string
  error?: string
}

export async function runOneConfig(
  taskId: string,
  config: SweepConfig,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const configDesc = Object.entries(config)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${(v as number[]).join(",")}]` : v}`)
    .join(", ")

  const prompt =
    `Train task "${taskId}" with these exact hyperparams: ${configDesc}. ` +
    `Call mcp__neuron__train with task_id="${taskId}"` +
    (config.lr !== undefined ? `, lr=${config.lr}` : "") +
    (config.epochs !== undefined ? `, epochs=${config.epochs}` : "") +
    (config.head_arch !== undefined ? `, head_arch=${JSON.stringify(config.head_arch)}` : "") +
    (config.class_weights !== undefined ? `, class_weights="${config.class_weights}"` : "") +
    `, auto_register=false. ` +
    `After training completes, output ONLY a single JSON line: {"run_id":<id>,"accuracy":<val>}`

  const ac = new AbortController()
  if (signal) {
    signal.addEventListener("abort", () => ac.abort())
  }

  let sessionId = ""
  let resultText = ""

  try {
    const q = query({
      prompt,
      options: {
        abortController: ac,
        tools: [],
        allowedTools: ["mcp__neuron__train"],
        disallowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
        maxTurns: 20,
        persistSession: false,
        mcpServers: {
          neuron: {
            type: "stdio" as const,
            command: "bun",
            args: ["run", SERVER_PATH],
            env: Object.fromEntries(
              Object.entries(process.env).filter(([, v]) => v !== undefined)
            ) as Record<string, string>,
          },
        },
      },
    })

    for await (const msg of q) {
      if (!sessionId && "session_id" in msg) sessionId = msg.session_id as string
      if (msg.type === "result" && msg.subtype === "success") {
        resultText = msg.result
      }
    }

    // Parse run_id + accuracy from last JSON object in output
    const match = resultText.match(/\{"run_id"\s*:\s*(\d+)\s*,\s*"accuracy"\s*:\s*([\d.]+)\}/)
    if (match) {
      return {
        config,
        run_id: parseInt(match[1]!),
        accuracy: parseFloat(match[2]!),
        status: "completed",
        session_id: sessionId,
      }
    }

    return { config, run_id: null, accuracy: null, status: "failed", session_id: sessionId, error: "no result JSON in output" }
  } catch (e) {
    return { config, run_id: null, accuracy: null, status: "failed", session_id: sessionId, error: String(e) }
  }
}

export async function runSweep(
  taskId: string,
  configs: SweepConfig[],
  concurrency = 4,
  signal?: AbortSignal,
  waveSize?: number,
): Promise<AgentRunResult[]> {
  if (!waveSize || waveSize >= configs.length) {
    // Original single-pool behavior
    const results: AgentRunResult[] = []
    const queue = [...configs]
    async function worker() {
      while (queue.length > 0 && !signal?.aborted) {
        const config = queue.shift()
        if (!config) break
        results.push(await runOneConfig(taskId, config, signal))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, configs.length) }, worker))
    return results
  }

  // Wave mode: drain configs in chunks of waveSize, sequential between waves
  const results: AgentRunResult[] = []
  for (let i = 0; i < configs.length && !signal?.aborted; i += waveSize) {
    const wave = configs.slice(i, i + waveSize)
    const waveQueue = [...wave]
    const waveResults: AgentRunResult[] = []
    async function waveWorker() {
      while (waveQueue.length > 0 && !signal?.aborted) {
        const config = waveQueue.shift()
        if (!config) break
        waveResults.push(await runOneConfig(taskId, config, signal))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, wave.length) }, waveWorker))
    results.push(...waveResults)
  }
  return results
}
