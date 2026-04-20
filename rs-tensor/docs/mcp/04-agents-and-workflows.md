# Agents and workflows

This document assumes you connect to MCP with a **`url`** (HTTPS) from a **second machine without this repository** — the common case for **Cursor + Cloudflare tunnel + agents**.

---

## Setup on the other PC

1. Put the MCP endpoint in your client config (same shape as repo [`.mcp.json`](../../../.mcp.json)):  
   `"url": "https://<your-host>/mcp"`  
   plus **`headers`** if the server uses **`MCP_API_KEY`**.
2. Confirm **`GET https://<your-host>/health`** → `ok`.
3. No `cargo`, no clone, no MCP source required **on that machine**.

Full detail: [01-running-and-configuration.md](01-running-and-configuration.md).

---

## Design principles

1. **Names are handles** — Use `tensor_create` / `result_name`; track names in the agent (symbol table).
2. **Order matters** — Datasets before `train_mlp`; weights before `evaluate_mlp`.
3. **Server paths** — `read_file`, `cargo_exec`, `gguf_*`, `llama_load` use the **server** disk. Skip them in prompts if the agent only does pure tensor work over the wire.
4. **Inspect often** — `tensor_inspect` / `tensor_list` after tricky ops.

---

## Suggested system prompt (remote agent)

Adapt for a “tensor lab” subagent:

> You use the rs-tensor MCP over **HTTPS**. Tensor state lives **only on the server**. Create tensors with `tensor_create` or use each op’s `result_name` before referencing a name. Prefer `tensor_inspect` after matmul/reshape. **`read_file` and `cargo_exec` run on the server’s filesystem** — do not assume paths exist unless you know the deployment. **`llama_load` needs a GGUF path on the server.** For LLaMA text generation, call `llama_load` first with a valid server path, then `llama_generate`. On errors, adjust shapes or names; never invent tensor names that were not created.

---

## Workflow recipes

All steps are **MCP tool calls** to the remote server — no local code.

### A. Tensor math

`tensor_create` → `tensor_add` / `tensor_matmul` / … → `tensor_inspect`.

### B. Learning + examples

`resources/read` `docs://big-picture` → optional prompts → numeric tensors.

### C. XOR toy classifier

`create_dataset` (xor) → `init_mlp` → `train_mlp` → `evaluate_mlp` / `mlp_predict`.

### D. CNN

`init_cnn` → `tensor_create` (NCHW input) → `cnn_forward`.

### E. GGUF / LLaMA (server paths required)

`gguf_inspect` with a path valid **on the server** → `gguf_load_tensor` or `llama_load` → `llama_generate` as appropriate.

---

## Testing

- **Your case:** Cursor (or similar) with **URL** MCP config — exercise tools against the live server.
- **Optional:** Someone with a local checkout can also use **stdio** MCP (`cargo run --bin mcp`) for offline dev; **not** required for URL-only users.

---

## Naming conventions

- Prefix experiments: `exp1_X`, …
- Use **`lower_snake_case`** for tensor names (works cleanly in `tensor://` URIs).

---

*Next: [05-limitations-and-troubleshooting.md](05-limitations-and-troubleshooting.md).*
