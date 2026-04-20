# Overview — what this MCP server is

## Purpose

The **rs-tensor MCP server** exposes tensor operations, tiny ML workflows, GGUF/LLaMA hooks, and learning docs through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Any MCP-capable client can call tools over the network **without** a local checkout — only an **`https://…/mcp`** URL (and optionally auth headers).

Think of it as a **hosted tensor service**: your agent sends JSON tool calls; computation and RAM live on whoever runs the server.

## Remote client vs server (important)

| | **Your other PC (URL only)** | **Machine running the MCP binary** |
|--|------------------------------|-------------------------------------|
| Needs clone / Rust? | **No** | Yes (to build), or a deployed binary |
| Needs MCP source? | **No** | Yes if you change code |
| Holds tensors / LLaMA weights? | No | **Yes** — all tool state is here |
| `read_file`, `cargo_exec`, GGUF paths? | N/A locally | Resolved on **this** filesystem |

Implementation details for contributors live under `rs-tensor/src/mcp/` in this repo; **you do not need to open those files** to use agents against a URL.

## Capabilities (protocol level)

- **Tools** — tensors, training, CNN, GGUF, LLaMA, etc.
- **Resources** — `docs://…` chapters, `tensor://{name}` JSON, `source://tensor.rs` from the **server’s** tree
- **Prompts** — `explain_tensor_op`, `debug_shape_mismatch`, `learning_guide`

## Mental model: named handles

MCP calls are **stateless JSON**. The server keeps **`name → Tensor`**. Your agent should track names (`result_name`, dataset tensors, MLP prefixes). **Restarting the server** clears all tensors and unloads LLaMA.

Optional: **at most one** loaded LLaMA model (`llama_load`).

## When to use which surface

| Goal | Prefer |
|------|--------|
| Tensor math / training / CNN | Tools (from client via URL) |
| Learning text | Resources `docs://…` (served from server) |
| Inspect tensors as JSON | `tensor_inspect` or `tensor://{name}` |
| Build Rust crate on **server** | `cargo_exec` (runs on server) |
| LLaMA | `llama_load` paths must exist **on the server** |

## Security

`read_file` and `cargo_exec` execute against the **server’s** project tree and shell environment. `read_file` paths are relative to the server’s `rs-tensor` crate root. If you expose the URL publicly, set **`MCP_API_KEY`** on the server and matching **`headers`** on the client ([01-running-and-configuration.md](01-running-and-configuration.md)).

---

*Next: [01-running-and-configuration.md](01-running-and-configuration.md).*
