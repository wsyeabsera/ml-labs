import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { boot } from "./core/boot"
import { log } from "./core/logger"
import { listTools, dispatchTool } from "./tools/index"

const server = new Server(
  { name: "neuron", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: listTools(),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  try {
    const result = await dispatchTool(name, (args ?? {}) as Record<string, unknown>, { server })
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log(`Tool "${name}" error: ${msg}`)
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
      isError: true,
    }
  }
})

async function main() {
  log("Neuron MCP server starting…")
  await boot()

  const transport = new StdioServerTransport()
  await server.connect(transport)
  log("Neuron MCP server ready")
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`)
  process.exit(1)
})
