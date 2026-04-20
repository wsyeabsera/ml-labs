import { readConfig, writeConfig } from "../lib/config"

const usage = `
ml-labs config <subcommand>

SUBCOMMANDS
  show                     Print current config
  set rs-tensor-url <url>  Set a remote rs-tensor URL override (sets RS_TENSOR_MCP_URL)
                           Normally not needed — ml-labs uses the built-in stdio binary.
                           Use this to point neuron at a remote rs-tensor server.

EXAMPLES
  ml-labs config show
  ml-labs config set rs-tensor-url http://homeserver:3000/mcp
`

export function config(args: string[]) {
  const [sub, key, value] = args

  if (!sub || sub === "show") {
    const cfg = readConfig()
    const envOverride = process.env.RS_TENSOR_MCP_URL
    console.log("\nML-Labs config (~/.ml-labs/config.json):\n")
    console.log(`  rs-tensor-url  ${cfg.rs_tensor_url}  (remote override; normally unused)`)
    if (envOverride) console.log(`  RS_TENSOR_MCP_URL  ${envOverride}  (env var active — overrides local binary)`)
    console.log("")
    return
  }

  if (sub === "set") {
    if (key === "rs-tensor-url") {
      if (!value) {
        console.error("Usage: ml-labs config set rs-tensor-url <url>")
        process.exit(1)
      }
      writeConfig({ rs_tensor_url: value })
      console.log(`  rs-tensor-url  → ${value}`)
      console.log("  saved to ~/.ml-labs/config.json")
      return
    }
    console.error(`Unknown config key: ${key}`)
    console.log(usage)
    process.exit(1)
  }

  console.log(usage)
  process.exit(sub === "--help" || sub === "-h" ? 0 : 1)
}
