# Chapter 4 — The MCP server

## Why an MCP server?

We already have a tensor library we can call from Rust. But we also want to interact with it *conversationally* — create tensors, inspect them, run operations — without leaving the Claude Code session. That's what [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) gives us: a way to expose our library as a set of tools that an LLM client can call over stdio.

Think of it as a REPL for our tensor library, except the REPL is Claude.

## How it works

The MCP server is a separate binary (`src/bin/mcp.rs`) that:

1. Starts up and listens on **stdin/stdout** using the JSON-RPC-based MCP protocol.
2. Registers a set of **tools** — functions that a client can discover and call.
3. Keeps tensor state **in memory** (a `HashMap<String, Tensor>` behind an `Arc<Mutex<...>>`).

The client (Claude Code) discovers the tools via the MCP handshake, then calls them like any other function. Each tool receives JSON arguments, does its work, and returns a result.

```
Claude Code  ──stdin──▸  mcp binary  ──▸  TensorServer (tools + state)
             ◂─stdout──              ◂──
```

## What's exposed

### Tensor tools

| Tool | What it does |
|------|-------------|
| `tensor_create` | Create a named tensor from flat data + shape. Validates that `data.len() == product(shape)`. |
| `tensor_add` | Element-wise add two named tensors, store result under a new name. Checks shapes match. |
| `tensor_mul` | Element-wise multiply two named tensors, store result. Checks shapes match. |
| `tensor_get_2d` | Get a single element from a 2D tensor by (row, col). Returns the value or an error if out of bounds. |
| `tensor_get` | Get a single element by N-dimensional indices using strides. |
| `tensor_reshape` | Reshape a tensor to a new shape. Product must match element count. |
| `tensor_transpose` | Transpose by swapping two dimensions. Zero-copy: only swaps shape and strides. |
| `tensor_matmul` | Matrix multiply two 2D tensors: `[M,K] x [K,N] -> [M,N]`. Inner dimensions must match. |
| `tensor_inspect` | Return a tensor's shape, strides, data, and element count as JSON. |
| `tensor_list` | List all tensors currently in memory with their shapes. |

### Autograd tools — scalar

| Tool | What it does |
|------|-------------|
| `autograd_neuron` | Run a single neuron: `tanh(sum(xi*wi) + bias)`. Returns output and gradients for all inputs, weights, and bias. |
| `autograd_expr` | Build a custom computation graph from named values and operations (`add`, `mul`, `tanh`), run backward, return all values with gradients. |

### Autograd tools — tensor-level

| Tool | What it does |
|------|-------------|
| `autograd_neuron_tensor` | Run a tensor-level neural network layer: `out = tanh(x @ w + b)`. Takes input, weight, and bias tensors with shapes, runs forward + backward, returns output and all gradients. Uses `TensorValue` autograd with matrix operations. |

### Project tools

| Tool | What it does |
|------|-------------|
| `read_file` | Read a file from the project directory (source, logs, output). Path-restricted to the project root. |
| `cargo_exec` | Run `cargo build` or `cargo run` and return stdout/stderr. Only allows `build` and `run` subcommands. |

## Where the code lives

| File | Role |
|------|------|
| `src/bin/mcp.rs` | Entry point: wires `TensorServer` to stdio transport via `rmcp`. |
| `src/mcp/mod.rs` | `TensorServer` struct, constructor, and `ServerHandler` impl (hub). |
| `src/mcp/tools/mod.rs` | `#[tool_router]` impl block with all tool methods. |
| `src/mcp/tools/tensor_ops.rs` | Argument structs for tensor tools (`TensorCreateArgs`, etc.). |
| `src/mcp/tools/autograd_ops.rs` | Argument structs for autograd tools (`AutogradNeuronArgs`, etc.). |
| `src/mcp/tools/project.rs` | Argument structs for project tools (`ReadFileArgs`, `CargoExecArgs`). |
| `src/mcp/prompts/mod.rs` | `#[prompt_router]` impl block with prompt templates. |
| `src/mcp/resources/mod.rs` | Resource handlers for `docs://`, `source://`, and `tensor://` URIs. |
| `.mcp.json` (repo root) | Claude Code config — tells it how to spawn the server. |

## Key design choices

**Why named tensors?** MCP tools are stateless calls — they receive JSON and return JSON. We can't pass Rust references between calls, so we give tensors names and store them in a server-side map. The name is the handle.

**Why `Arc<Mutex<HashMap>>`?** The MCP framework is async (tokio). Multiple tool calls could theoretically arrive concurrently, so the tensor store needs interior mutability with thread safety. `Arc` for shared ownership, `Mutex` for exclusive access.

**Why a separate binary?** The MCP server is a long-running process that Claude Code spawns and talks to. It can't be a library function — it needs its own `main` that sets up the transport and blocks. Keeping it in `src/bin/mcp.rs` means `cargo build --bin mcp` builds just the server, while `cargo run` still runs the regular example binary.

## Running it

You don't normally run the MCP server directly — Claude Code spawns it automatically based on `.mcp.json`. But if you want to test it manually:

```bash
cargo build --bin mcp
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | ./target/debug/mcp
```

You should see a JSON response with `protocolVersion`, `capabilities`, and `serverInfo`.

## The pattern for adding new tools

Every new operation follows the same path:

1. Implement the operation in the library (`tensor.rs`, `tensor_value.rs`, etc.)
2. Add an args struct in `mcp/tools/tensor_ops.rs` or `mcp/tools/autograd_ops.rs`
3. Add a tool method in `mcp/tools/mod.rs`
4. Rebuild the binary: `cargo build --bin mcp`
5. Reconnect the MCP server in Claude Code

---

## Further reading (agent & operator handbook)

The **[docs/mcp/](mcp/README.md)** handbook covers tool lists, **`https://…/mcp` client setup without a local clone**, resources, prompts, and troubleshooting. **You can use the MCP server from another computer with only the public URL and optional API-key headers** — no Rust toolchain or this repo on that machine. Running `cargo` or editing source is only needed **on the machine that hosts** the binary (or for contributors).

---

*Back to [Table of contents](README.md#table-of-contents). For the full arc, see [ml-rust-project.md](ml-rust-project.md).*
