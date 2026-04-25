import { MessageSquare, Zap, Layers, Workflow } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function WhyMCP() {
  return (
    <div>
      <PageHeader
        eyebrow="The protocol that makes ML-Labs possible"
        accent="purple"
        title={<>Why <span className="gradient-text">MCP</span>.</>}
        lede="MCP — the Model Context Protocol — is Anthropic's spec for tools, resources, and prompts that an LLM host can talk to. ML-Labs is built on it top to bottom: rs-tensor is an MCP server, neuron is an MCP server that's also an MCP client (to rs-tensor). This page explains what MCP actually is and why it shapes ML-Labs the way it does."
      />

      <Section eyebrow="What MCP is" title="JSON-RPC for LLM tools.">
        <p>
          MCP is a wire protocol. Standardised JSON-RPC requests for: listing tools, calling tools,
          listing resources, reading resources, sampling (asking the host LLM to complete a prompt),
          and a few lifecycle messages. Two transports: stdio (most common) and HTTP. That's it.
        </p>
        <Callout kind="learn" title="Why Anthropic invented it">
          Before MCP, every LLM-tool integration was bespoke. OpenAI function calling, Anthropic
          tools, ChatGPT plugins — same idea, incompatible APIs. MCP standardises the surface so
          one server can serve any MCP host. Like LSP for editors.
        </Callout>
      </Section>

      <Section eyebrow="The shape" title="What an MCP message looks like.">
        <CodeBlock
          lang="json"
          title="A tool call (request)"
          code={`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "auto_train",
    "arguments": {
      "task_id": "iris",
      "accuracy_target": 0.95
    }
  }
}`}
        />
        <CodeBlock
          lang="json"
          title="The response"
          code={`{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\\"status\\": \\"completed\\", \\"run_id\\": 42, ...}"
    }]
  }
}`}
        />
        <p>
          That's the entire wire format. JSON-RPC over stdio (line-delimited) or HTTP. No
          authentication built in (host adds it if needed). Stateless per-request.
        </p>
      </Section>

      <Section eyebrow="Why it shapes ML-Labs" title="Three architectural consequences.">
        <div className="space-y-4">
          <InfoCard icon={MessageSquare} title="1. Tools as the public surface" accent="purple">
            <p>
              Every Neuron capability is exposed as an MCP tool. There's no &ldquo;use the Python
              API&rdquo; alternative. <code>create_task</code>, <code>train</code>, <code>predict</code>,
              <code>auto_train</code> — all tools. Internal helpers stay in TS; user-facing
              functionality is always a tool. Forces clear contracts.
            </p>
          </InfoCard>

          <InfoCard icon={Layers} title="2. rs-tensor → neuron uses the same protocol as Claude → neuron" accent="cyan">
            <p>
              When neuron needs to allocate a tensor, it sends an MCP <code>tools/call</code> to
              rs-tensor — the exact same protocol Claude uses to call neuron. One mental model, one
              debugging surface. Wireshark a stdio transport, and Claude→neuron and neuron→rs-tensor
              look identical.
            </p>
          </InfoCard>

          <InfoCard icon={Zap} title="3. Sampling enables tools to ask the LLM" accent="green">
            <p>
              MCP's <code>sampling</code> primitive lets a server tool ask the host to run a Claude
              completion. ML-Labs uses this in <code>suggest_hyperparams</code>,{" "}
              <code>diagnose</code>, and the auto_train Claude planner. Without Sampling, tools
              would either be hand-coded heuristics or require an out-of-band API key. With it,
              tools can leverage the same Claude that called them.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The four primitives" title="What MCP gives you.">
        <AsciiDiagram title="MCP capabilities" accent="purple">
{`     MCP host (Claude Code, Claude Desktop, etc)
                    │
                    │ JSON-RPC over stdio / HTTP
                    │
                    ▼
              MCP server (Neuron)
                    │
              ┌─────┴─────┬───────────┬──────────┐
              ▼           ▼           ▼          ▼
            TOOLS    RESOURCES    PROMPTS    SAMPLING
              │           │           │          │
   ─────────────────────────────────────────────────────
   tools/list           resources/list    prompts/list   sampling/createMessage
   tools/call           resources/read    prompts/get    (server → host)

   what they're for:

   TOOLS      = function calls. "do X with these args."
                  Most of ML-Labs is tools.

   RESOURCES  = read-only data sources. URIs the host can fetch.
                  ML-Labs uses these for: weights blobs, decision logs.

   PROMPTS    = templated message scaffolds the user can pick.
                  ML-Labs's slash commands are a host-side feature, not MCP prompts.

   SAMPLING   = "host, please run this completion."
                  Used in suggest_hyperparams, diagnose, planner.`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Stdio vs HTTP" title="Two transports, same protocol.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={MessageSquare} title="Stdio" accent="cyan">
            <p>
              Default transport. Server is spawned as a child process; stdin / stdout carry
              line-delimited JSON-RPC. Used by Claude Code → neuron, neuron → rs-tensor.
            </p>
            <p className="mt-2 text-xs text-lab-muted">
              Pros: zero networking, instant, no auth needed, isolated lifetime.<br />
              Cons: single host, no remote access.
            </p>
          </InfoCard>
          <InfoCard icon={Workflow} title="HTTP" accent="purple">
            <p>
              Long-running daemon serving JSON-RPC over HTTP POST. Used when{" "}
              <code>RS_TENSOR_MCP_URL</code> is set, or in the dashboard's <code>/api/*</code>{" "}
              endpoints.
            </p>
            <p className="mt-2 text-xs text-lab-muted">
              Pros: remote, multiple clients, persistent.<br />
              Cons: needs port management, optional auth, network hop.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Debugging" title="When the protocol misbehaves.">
        <CodeBlock
          lang="bash"
          title="Tail the stdio messages"
          code={`# When neuron-mcp is spawned by Claude Code, you can't see the stdio.
# To debug, run it manually with input redirection:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | bun run neuron/src/server.ts

# Or use the MCP inspector
npx @modelcontextprotocol/inspector bun run neuron/src/server.ts
# → opens a UI showing every MCP message both ways`}
        />
        <CodeBlock
          lang="bash"
          title="Check what tools are exposed"
          code={`# tools/list is the easiest sanity check
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"x","version":"1"}}}' \\
  | bun run neuron/src/server.ts

# follow up with tools/list
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | ...`}
        />
        <Callout kind="tip" title="The MCP inspector is your friend">
          The official inspector (<code>@modelcontextprotocol/inspector</code>) wraps any MCP
          server and shows every message in a UI. Use it to verify tool schemas, debug tool calls,
          and trace Sampling round-trips. Far easier than reading raw JSON-RPC.
        </Callout>
      </Section>

      <Section eyebrow="Building your own MCP server" title="In one paragraph.">
        <p>
          Pick a SDK — Anthropic ships{" "}
          <a href="https://github.com/modelcontextprotocol/typescript-sdk" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">@modelcontextprotocol/sdk</a>{" "}
          (TS), Python, Go, Rust, etc. Define tools (Zod schemas + handlers in TS). Connect via{" "}
          <code>StdioServerTransport</code>. That's the whole loop. ML-Labs's{" "}
          <code>neuron/src/server.ts</code> is a worked example — ~300 lines for the registration
          dance plus the 43 individual tool files.
        </p>
        <CodeBlock
          lang="ts"
          title="Minimal MCP server in TS"
          code={`import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const server = new Server({ name: "my-server", version: "0.1.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "say_hello",
    description: "Say hello",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "say_hello") {
    return { content: [{ type: "text", text: \`Hello, \${req.params.arguments.name}!\` }] }
  }
  throw new Error(\`Unknown tool: \${req.params.name}\`)
})

await server.connect(new StdioServerTransport())`}
        />
      </Section>

      <Section eyebrow="Reference" title="The spec + ecosystem.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <a href="https://modelcontextprotocol.io" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">modelcontextprotocol.io</a>{" "}
            — official spec, primer, tutorials.
          </li>
          <li>
            <a href="https://github.com/modelcontextprotocol/servers" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">modelcontextprotocol/servers</a>{" "}
            — reference servers (filesystem, git, postgres, slack, etc). Read these to grok the
            patterns.
          </li>
          <li>
            <a href="https://github.com/modelcontextprotocol/inspector" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">modelcontextprotocol/inspector</a>{" "}
            — the debugging UI.
          </li>
          <li>
            ML-Labs source: <code>neuron/src/server.ts</code> (server) and{" "}
            <code>neuron/src/core/mcp_client.ts</code> (client to rs-tensor).
          </li>
        </ul>
      </Section>
    </div>
  )
}
