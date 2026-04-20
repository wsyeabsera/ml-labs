# Resources and prompts

Everything below is served by the **MCP server**. A **URL-only client** (no local repo) still gets full access via MCP `resources/list` and `resources/read` — content is read **from the server’s deployed tree**, not from your laptop.

---

## Resources (read-only)

Resources are listed and fetched by URI.

### Static documentation (`docs://`)

These map to markdown files **on the server** under its `rs-tensor/docs/` tree:

| URI | Typical content |
|-----|-----------------|
| `docs://readme` | Learning book TOC / intro |
| `docs://getting-started` | Chapter 1 |
| `docs://big-picture` | Chapter 2 |
| `docs://codebase-and-next-steps` | Chapter 3 |
| `docs://mcp-server` | Short MCP chapter |
| `docs://roadmap` | `ml-rust-project.md` |

**Template:** `docs://{slug}` — unknown slugs error at read time.

### Source (`source://`)

| URI | Content |
|-----|---------|
| `source://tensor.rs` | `tensor.rs` from the **server** checkout |

### Dynamic tensors (`tensor://`)

`tensor://{name}` returns JSON `{ name, shape, data }` for tensors in the server’s in-memory store.

---

## Prompts

| Prompt | Arguments | Purpose |
|--------|-----------|---------|
| `explain_tensor_op` | `operation` | Explains an op with a small example. |
| `debug_shape_mismatch` | `shape_a`, `shape_b`, `operation` | Debugging shapes. |
| `learning_guide` | (none) | Embeds the roadmap from **`docs/ml-rust-project.md` on the server**. If that file is missing or cwd is wrong **on the server**, you may see a stub message. |

**Remote client note:** You do **not** need `ml-rust-project.md` locally; the server reads it when the prompt runs.

---

## Agent tips

1. Onboarding: `docs://getting-started` + `docs://roadmap`.
2. Shapes: `debug_shape_mismatch` / `explain_tensor_op` prompts.
3. Live state: `tensor_list` and `tensor://{name}`.

---

*Next: [04-agents-and-workflows.md](04-agents-and-workflows.md).*
