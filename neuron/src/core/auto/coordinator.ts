import { query } from "@anthropic-ai/claude-agent-sdk"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { buildCoordinatorPrompt, type CoordinatorPromptArgs } from "./prompt"
import { updateAutoRun } from "../db/auto"

const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../server.ts")

export interface CoordinatorResult {
  status: "completed" | "data_issue" | "failed"
  run_id: number | null
  accuracy: number | null
  waves_used: number
  verdict: string
  published_uri?: string
  session_id: string
  wall_clock_s: number
}

const COORDINATOR_ALLOWED_TOOLS = [
  "mcp__neuron__preflight_check",
  "mcp__neuron__suggest_hyperparams",
  "mcp__neuron__run_sweep",
  "mcp__neuron__evaluate",
  "mcp__neuron__diagnose",
  "mcp__neuron__suggest_samples",
  "mcp__neuron__list_runs",
  "mcp__neuron__get_run_status",
  "mcp__neuron__register_model",
  "mcp__neuron__publish_model",
  "mcp__neuron__log_auto_note",
]

export async function runCoordinator(
  promptArgs: CoordinatorPromptArgs,
  signal?: AbortSignal,
): Promise<CoordinatorResult> {
  const t0 = Date.now()
  const ac = new AbortController()
  if (signal) signal.addEventListener("abort", () => ac.abort())

  const prompt = buildCoordinatorPrompt(promptArgs)
  let sessionId = ""
  let resultText = ""

  try {
    const q = query({
      prompt,
      options: {
        abortController: ac,
        tools: [],
        allowedTools: COORDINATOR_ALLOWED_TOOLS,
        disallowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
        maxTurns: 40,
        persistSession: false,
        mcpServers: {
          neuron: {
            type: "stdio" as const,
            command: "bun",
            args: ["run", SERVER_PATH],
            env: Object.fromEntries(
              Object.entries(process.env).filter(([, v]) => v !== undefined),
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
  } catch (e) {
    const wallS = Math.round((Date.now() - t0) / 1000)
    updateAutoRun(promptArgs.auto_run_id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      verdict: String(e),
    })
    return {
      status: "failed",
      run_id: null,
      accuracy: null,
      waves_used: 0,
      verdict: `Coordinator crashed: ${e}`,
      session_id: sessionId,
      wall_clock_s: wallS,
    }
  }

  // Parse JSON verdict from result — look for the last {...} block
  const match = resultText.match(/\{[^{}]*"status"\s*:\s*"[^"]+[^{}]*\}/s)
  let parsed: Partial<CoordinatorResult> = {}
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as Partial<CoordinatorResult>
    } catch {
      // leave empty, fall through to failed
    }
  }

  const wallS = Math.round((Date.now() - t0) / 1000)
  const status = (parsed.status as CoordinatorResult["status"]) ?? "failed"

  updateAutoRun(promptArgs.auto_run_id, {
    status,
    finished_at: new Date().toISOString(),
    winner_run_id: parsed.run_id ?? undefined,
    final_accuracy: parsed.accuracy ?? undefined,
    waves_used: parsed.waves_used ?? 0,
    verdict: parsed.verdict ?? "no verdict",
  })

  return {
    status,
    run_id: parsed.run_id ?? null,
    accuracy: parsed.accuracy ?? null,
    waves_used: parsed.waves_used ?? 0,
    verdict: parsed.verdict ?? "no verdict returned by coordinator",
    session_id: sessionId,
    wall_clock_s: wallS,
  }
}
