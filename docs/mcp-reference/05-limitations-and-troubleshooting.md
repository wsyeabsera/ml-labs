# Limitations and troubleshooting

## You use only a URL (no repo on this machine)

That is fully supported. **All tool execution and tensor memory happen on the server.** You do **not** need `rs-tensor` source on the client.

Limitations that still apply:

- **`read_file` / `cargo_exec` / GGUF paths** — must make sense **on the server**, not on your laptop.
- **Restarting the server process** clears tensors and LLaMA.
- **Tunnel URL may change** when `cloudflared` restarts (quick tunnels).

---

## Tensor store

- **Ephemeral:** Server restart drops tensors and unloads LLaMA.
- **`tensor_list`:** In rare cases some result tensors may not appear in the list; `tensor_inspect` / `tensor://{name}` can still work.
- **Concurrency:** One server serializes tool calls via a mutex; heavy `train_mlp` blocks other ops on that instance.

## Paths (always the server)

- **`read_file`:** Relative to **`rs-tensor/`** **on the machine running MCP**, not your client PC.
- **GGUF / LLaMA:** Opened on the **server** — use absolute paths there or paths relative to the server’s cwd.

## `cargo_exec`

Runs on the **server** only. **`run`** may fail if multiple binaries exist and no `default-run` is set; **`build`** is safer.

## Datasets

Use **`and`**, **`or`**, **`xor`**, **`circle`** — `spiral` may not be implemented despite older descriptions.

## LLaMA / GGUF

- **`llama_load`** needs a full Llama-compatible GGUF **available to the server**.
- **`llama_generate`** needs a loaded model.

## CNN / `cnn_forward`

Layer geometry must match what the forward pass expects (see earlier chapters).

## HTTP / API key

- **`MCP_API_KEY`** on server → client **`headers`** must match.
- **`GET /health`** is unauthenticated — use for “is the server up?”

## Cursor / SSE / tunnel

Noisy **SSE reconnect** logs can happen while **tools still succeed** — transport vs RPC. See [01-running-and-configuration.md](01-running-and-configuration.md).

If you **only use a URL**, ignore stdio-based workarounds unless you later run the binary locally.

---

## Quick diagnostic checklist

| Symptom | Check |
|---------|--------|
| Cannot connect | `GET https://host/health` → `ok`? Tunnel → correct server port? |
| `401` on `/mcp` | `x-api-key` / `Bearer` matches `MCP_API_KEY` on server. |
| `Tensor 'foo' not found` | Create or produce `foo` first. |
| `read_file` missing | Path is on **server** under `rs-tensor/`. |
| LLaMA errors | GGUF path and format on **server**. |

---

*Back to [README.md](README.md).*
