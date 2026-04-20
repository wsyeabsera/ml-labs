# Running and configuration

## Client vs server

- **Client (your other PC, agents, Cursor):** configure MCP with a **`url`** — **no** git clone, **no** Rust toolchain, **no** MCP source required.
- **Server:** the process that runs the `mcp` binary (your tunnel points here). Build/run instructions below are **only for whoever hosts that process**.

---

## 1. Client configuration — URL only (recommended for remote work)

Paste this shape into your IDE / MCP settings (example host — yours may differ):

```json
{
  "mcpServers": {
    "rs-tensor": {
      "url": "https://openings-trivia-thereafter-reed.trycloudflare.com/mcp",
      "headers": {}
    }
  }
}
```

The canonical example in this repo is [`.mcp.json`](../../../.mcp.json) at the monorepo root (useful as a template; **copy the `url` to any machine** — you don’t need to clone the repo on that machine).

### Check connectivity

- **`GET https://<host>/health`** should return the plain text **`ok`** (no MCP payload — just confirms the process and tunnel).
- The MCP endpoint is **`https://<host>/mcp`** (path required).

### Authentication

If the server sets **`MCP_API_KEY`**, add the same secret on the client:

```json
"headers": {
  "x-api-key": "your-secret"
}
```

Alternatively: `Authorization: Bearer your-secret`**

If the env var is unset or empty, the server does **not** require a key.

### Tunnel hostname changes

**Cloudflare quick tunnels** (`trycloudflare.com`) often get a **new hostname** when `cloudflared` restarts. Update the **`url`** in your client config when that happens.

---

## 2. What runs where (summary)

| Component | Runs on client | Runs on server |
|-----------|----------------|----------------|
| MCP tools (`tensor_create`, `train_mlp`, …) | *Requested* from client | **Executed** here |
| Tensor RAM / MLP / CNN state | | Yes |
| `read_file` / `cargo_exec` | | Yes — **server paths** |
| `docs://` / `tensor://` resources | | Yes — read from server |

---

## 3. Server-side: build and run the binary

*Skip this section if you only connect via URL and someone else hosts the server.*

All commands below assume a checkout with **`rs-tensor/`** containing `Cargo.toml` for the MCP binary.

### Build

```bash
cd rs-tensor
cargo build --release --bin mcp
```

Binary: `target/release/mcp` (or `debug` without `--release`).

### HTTP mode (for tunnels and LAN)

Set bind address so the process listens on TCP:

```bash
MCP_HTTP_BIND=127.0.0.1:4001 ./target/release/mcp
# or
./target/release/mcp --http 127.0.0.1:4001
```

- **MCP:** `http://<bind>/mcp`
- **Health:** `GET /health` → `ok`

Point **Cloudflared** (or nginx, etc.) at that port for HTTPS on the public URL.

### Environment variables (server)

| Variable | Effect |
|----------|--------|
| `MCP_HTTP_BIND` | Non-empty → HTTP mode; same as `--http <addr>`. |
| `MCP_API_KEY` | Non-empty → require key on `/mcp` (see above). |

### stdio mode (optional — local dev with a checkout only)

If **`MCP_HTTP_BIND`** is unset and no **`--http`** argument, the binary speaks MCP on **stdin/stdout**. Some editors spawn `cargo run --bin mcp` with `cwd` set to `rs-tensor/` — useful **only** when you have the repo and want zero tunnel. This is **not** required for URL-only clients.

---

## 4. Server working directory

- **`read_file`** resolves paths relative to the **`rs-tensor/`** crate root **on the server**.
- **`learning_guide`** prompt reads `docs/ml-rust-project.md` relative to the server process **cwd** (should be `rs-tensor/` for a full roadmap).
- **GGUF / LLaMA** paths in tool arguments are opened **on the server**; use paths valid there.

---

## 5. Process lifecycle

- One server process = one tensor store + one optional LLaMA model.
- Restart clears all in-memory state.
- HTTP mode uses stateless streamable config in code; still treat memory as **fresh per process**.

---

*Next: [02-tools-reference.md](02-tools-reference.md).*
