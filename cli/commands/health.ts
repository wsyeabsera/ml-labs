import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ML_LABS_DIR = join(homedir(), ".ml-labs")
const RS_TENSOR_BIN =
  process.env.RS_TENSOR_BIN ?? join(ML_LABS_DIR, "rs-tensor", "target", "release", "mcp")

// ── output helpers ─────────────────────────────────────────────────────────────

function ok(msg: string) { console.log(`  ✓  ${msg}`) }
function fail(msg: string) { console.log(`  ✗  ${msg}`) }
function warn(msg: string) { console.log(`  ⚠  ${msg}`) }
function section(title: string) { console.log(`\n${title}`) }

// ── SSE / HTTP MCP client ─────────────────────────────────────────────────────

interface McpSession { url: string; sessionId: string }

async function mcpHttpInit(url: string): Promise<McpSession> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ml-labs-health", version: "0.1" } },
      id: 1,
    }),
    signal: AbortSignal.timeout(5000),
  })

  const sessionId = res.headers.get("mcp-session-id") ?? ""
  if (!sessionId) throw new Error("No mcp-session-id in response headers")

  const text = await res.text()
  const dataLine = text.split("\n").find((l) => l.startsWith("data: {"))
  if (!dataLine) throw new Error("No data line in initialize response")
  const msg = JSON.parse(dataLine.slice(6)) as { result?: { serverInfo?: { name: string; version: string } } }
  const info = msg.result?.serverInfo ?? { name: "unknown", version: "?" }

  // Send notifications/initialized (fire-and-forget)
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  }).catch(() => {})

  ok(`MCP handshake  →  ${info.name} v${info.version}`)
  return { url, sessionId }
}

async function mcpHttpCall(session: McpSession, method: string, params: unknown, id: number): Promise<unknown> {
  const res = await fetch(session.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": session.sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
    signal: AbortSignal.timeout(8000),
  })
  const text = await res.text()
  const dataLine = text.split("\n").find((l) => l.startsWith("data: {"))
  if (!dataLine) throw new Error(`No data in response for ${method}`)
  const msg = JSON.parse(dataLine.slice(6)) as { result?: unknown; error?: { message: string } }
  if (msg.error) throw new Error(msg.error.message)
  return msg.result
}

// ── stdio MCP client ──────────────────────────────────────────────────────────

interface StdioMcpSession {
  proc: ReturnType<typeof Bun.spawn>
  pending: Map<number, (val: unknown) => void>
  _call: (method: string, params: unknown, id: number) => Promise<unknown>
}

async function mcpStdioInit(cmd: string[], cwd: string, env: Record<string, string>): Promise<StdioMcpSession> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env } as Record<string, string>,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  })

  const pending = new Map<number, (val: unknown) => void>()

  // Reader loop
  ;(async () => {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    const dec = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value)
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } }
          if (msg.id != null) {
            const cb = pending.get(msg.id)
            if (cb) { pending.delete(msg.id); cb(msg.error ? new Error(msg.error.message) : msg.result) }
          }
        } catch {}
      }
    }
  })()

  const stdin = proc.stdin as import("bun").FileSink
  const send = (obj: unknown) => { stdin.write(JSON.stringify(obj) + "\n"); stdin.flush() }

  const call = (method: string, params: unknown, id: number): Promise<unknown> =>
    new Promise((resolve) => {
      pending.set(id, (v) => resolve(v instanceof Error ? Promise.reject(v) : v))
      send({ jsonrpc: "2.0", method, params, id })
    })

  const result = await Promise.race([
    call("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "ml-labs-health", version: "0.1" },
    }, 1),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("initialize timed out after 8s")), 8000)),
  ]) as { serverInfo?: { name: string; version: string } }

  const info = result?.serverInfo ?? { name: "unknown", version: "?" }
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })

  ok(`MCP handshake  →  ${info.name} v${info.version}`)

  return { proc, pending, _call: call }
}

function stdioCall(session: StdioMcpSession, method: string, params: unknown, id: number): Promise<unknown> {
  return Promise.race([
    session._call(method, params, id),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${method} timed out`)), 8000)),
  ])
}

function stdioKill(session: StdioMcpSession) {
  try { session.proc.kill() } catch {}
}

// ── rs-tensor checks ──────────────────────────────────────────────────────────

async function checkRsTensor(): Promise<boolean> {
  const explicitUrl = process.env.RS_TENSOR_MCP_URL
  const useHttp = !!explicitUrl

  if (useHttp) {
    // Remote/debug mode: HTTP transport
    section(`rs-tensor  (HTTP: ${explicitUrl})`)
    let session: McpSession
    try {
      await fetch(explicitUrl, { method: "POST", headers: { "Content-Type": "application/json" },
        body: "{}", signal: AbortSignal.timeout(3000) })
      ok("reachable")
      session = await mcpHttpInit(explicitUrl)
    } catch (e) {
      fail(`unreachable or handshake failed: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
    try {
      const result = await mcpHttpCall(session, "tools/list", {}, 2) as { tools: unknown[] }
      ok(`tools/list  →  ${result.tools?.length ?? 0} tools`)
    } catch (e) {
      fail(`tools/list: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
    return true
  }

  // Default: stdio binary
  section(`rs-tensor  (stdio: ${RS_TENSOR_BIN})`)

  if (!existsSync(RS_TENSOR_BIN)) {
    fail(`binary not found — run: ml-labs update`)
    return false
  }
  ok("binary found")

  // Spawn + MCP handshake
  let session: StdioMcpSession
  try {
    process.stdout.write("  …  starting binary\r")
    session = await mcpStdioInit([RS_TENSOR_BIN], ML_LABS_DIR, {})
  } catch (e) {
    fail(`binary failed to start: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  // tools/list
  let pass = true
  try {
    const result = await stdioCall(session, "tools/list", {}, 2) as { tools: unknown[] }
    const count = result.tools?.length ?? 0
    ok(`tools/list  →  ${count} tools`)
  } catch (e) {
    fail(`tools/list: ${e instanceof Error ? e.message : String(e)}`)
    pass = false
  }

  // Lightweight tool call — create a 1x1 tensor
  try {
    const result = await stdioCall(session, "tools/call", {
      name: "tensor_create",
      arguments: { name: "health_check_tensor", data: [1.0], shape: [1, 1] },
    }, 3) as { content?: Array<{ text?: string }> }
    const text = result.content?.[0]?.text ?? ""
    ok(`tensor_create  →  ${text.length > 0 ? "responded" : "ok"}`)
  } catch (e) {
    warn(`tensor_create: ${e instanceof Error ? e.message : String(e)}`)
  }

  stdioKill(session)
  return pass
}

// ── neuron checks ─────────────────────────────────────────────────────────────

async function checkNeuron(): Promise<boolean> {
  const neuronDir = join(ML_LABS_DIR, "neuron")
  const serverTs = join(neuronDir, "src", "server.ts")

  // Detect DB path from current project
  let neuronDb = join(ML_LABS_DIR, "data", "neuron.db")
  const mcpPath = resolve(process.cwd(), ".mcp.json")
  if (existsSync(mcpPath)) {
    try {
      const db: unknown = JSON.parse(readFileSync(mcpPath, "utf-8"))?.mcpServers?.neuron?.env?.NEURON_DB
      if (typeof db === "string" && db) neuronDb = db
    } catch {}
  }

  section(`neuron  (stdio, db: ${neuronDb})`)

  if (!existsSync(serverTs)) {
    fail(`server not found at ${serverTs} — run: ml-labs update`)
    return false
  }
  ok("server.ts found")

  // Spawn + initialize
  let session: StdioMcpSession
  try {
    process.stdout.write("  …  starting server\r")
    session = await mcpStdioInit(["bun", "run", serverTs], neuronDir, { NEURON_DB: neuronDb })
  } catch (e) {
    fail(`server failed to start: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  // tools/list — verify count
  let pass = true
  try {
    const result = await stdioCall(session, "tools/list", {}, 2) as { tools: Array<{ name: string }> }
    const count = result.tools?.length ?? 0
    const expected = 34
    if (count === expected) {
      ok(`tools/list  →  ${count} tools  ✓`)
    } else {
      warn(`tools/list  →  ${count} tools (expected ${expected})`)
    }
  } catch (e) {
    fail(`tools/list: ${e instanceof Error ? e.message : String(e)}`)
    pass = false
  }

  // list_tasks — verify DB connectivity
  try {
    const result = await stdioCall(session, "tools/call", {
      name: "list_tasks", arguments: {},
    }, 3) as { content?: Array<{ text?: string }> }
    const text = result.content?.[0]?.text ?? "{}"
    const data = JSON.parse(text) as { count?: number; tasks?: unknown[] }
    const count = data.count ?? data.tasks?.length ?? 0
    ok(`list_tasks  →  ${count} task${count === 1 ? "" : "s"} in DB`)
  } catch (e) {
    fail(`list_tasks: ${e instanceof Error ? e.message : String(e)}`)
    pass = false
  }

  // preflight_check on first task (if any)
  try {
    const result = await stdioCall(session, "tools/call", { name: "list_tasks", arguments: {} }, 4) as
      { content?: Array<{ text?: string }> }
    const data = JSON.parse(result.content?.[0]?.text ?? "{}") as { tasks?: Array<{ id: string }> }
    const firstTask = data.tasks?.[0]
    if (firstTask) {
      const pr = await stdioCall(session, "tools/call", {
        name: "preflight_check", arguments: { task_id: firstTask.id },
      }, 5) as { content?: Array<{ text?: string }> }
      const prData = JSON.parse(pr.content?.[0]?.text ?? "{}") as { status?: string }
      ok(`preflight_check "${firstTask.id}"  →  ${prData.status ?? "ok"}`)
    }
  } catch {}

  stdioKill(session)
  return pass
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function health() {
  console.log("\nml-labs health check\n" + "─".repeat(40))

  const rsOk = await checkRsTensor()
  const neuronOk = await checkNeuron()

  console.log("\n" + "─".repeat(40))
  if (rsOk && neuronOk) {
    console.log("all checks passed\n")
  } else {
    console.log("some checks failed — see above\n")
    process.exit(1)
  }
}
