# rs-tensor MCP — documentation index

Handbook for **`rs-tensor-mcp`**: tools, resources, prompts, and **how to connect from another machine using only a URL** (no local clone or Rust toolchain required on the client).

The shorter learning-book chapter is still [../04-mcp-server.md](../04-mcp-server.md). This folder is the **full** reference.

---

## If you only have another PC and an MCP URL

You **do not** need this repository, Cargo, or any MCP source code on that machine. Configure your IDE’s MCP settings with the **HTTPS endpoint** (see [01-running-and-configuration.md](01-running-and-configuration.md)). Tensor math, training tools, and bundled docs are served by the **remote server**.

Details that matter remotely: optional **`MCP_API_KEY`** headers, **`read_file` / `cargo_exec` / GGUF paths** refer to the **server’s** disk (see [02-tools-reference.md](02-tools-reference.md), [05-limitations-and-troubleshooting.md](05-limitations-and-troubleshooting.md)).

---

## Read order

| Doc | Audience | Contents |
|-----|----------|----------|
| [00-overview.md](00-overview.md) | Everyone | Capabilities, mental model, client vs server |
| [01-running-and-configuration.md](01-running-and-configuration.md) | **Clients (URL)** + **operators (server)** | `.mcp.json`, tunnel URL, API key, optional: build & run |
| [02-tools-reference.md](02-tools-reference.md) | Agent authors | All **36 tools**; paths = server |
| [03-resources-and-prompts.md](03-resources-and-prompts.md) | Agent + IDE | `docs://`, `tensor://`, prompts |
| [04-agents-and-workflows.md](04-agents-and-workflows.md) | Agent builders | Workflows, prompts, URL-only setup |
| [05-limitations-and-troubleshooting.md](05-limitations-and-troubleshooting.md) | Debugging | Paths on server, SSE noise, tunnels |

---

## Quick facts

- **Connect from anywhere:** paste **`url`** (+ optional **`headers`**) into Cursor / MCP client — example in repo root [`.mcp.json`](../../../.mcp.json):  
  `https://openings-trivia-thereafter-reed.trycloudflare.com/mcp`  
  (Quick tunnels may rotate hostnames when `cloudflared` restarts.)
- **Server name (MCP):** `rs-tensor-mcp`
- **Transports:** yours is almost certainly **HTTPS streamable HTTP**; **stdio** exists only if you spawn the binary locally from a checkout.
- **State:** tensors + optional LLaMA live **on the server process**, not on your laptop.

---

## Source code (optional — server / hacking only)

These paths exist **only in this repo**, on machines that develop or host the server:

| Path | Role |
|------|------|
| `rs-tensor/src/bin/mcp.rs` | Entry: stdio or HTTP |
| `rs-tensor/src/mcp/mod.rs` | `TensorServer` |
| `rs-tensor/src/mcp/tools/mod.rs` | Tool implementations |
| `rs-tensor/src/mcp/resources/mod.rs` | Resources |
| `rs-tensor/src/mcp/prompts/mod.rs` | Prompts |

---

*Learning arc: [../ml-rust-project.md](../ml-rust-project.md).*
