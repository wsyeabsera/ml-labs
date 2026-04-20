# Tools reference (all 36)

For **authoring agents over a remote URL:** you only need the tool **names and JSON arguments**. No local Rust code.

Implementation lives in this repo on the **server** (`TensorServer` in `rs-tensor/src/mcp/tools/mod.rs`) — **not** on a URL-only client machine.

**Path tools (`read_file`, `cargo_exec`, `gguf_*`, `llama_load`)** use the **server’s** filesystem and working directory. Paths like `Cargo.toml` or `/models/foo.gguf` must exist **where the MCP binary runs**, not on your laptop.

Unless noted, successes return JSON text in the MCP result; failures return **error** content with a message string.

Convention: **2D matmul** uses row-major flat `data` with `shape [rows, cols]`.

---

## 1. Core tensor (10)

| Tool | Summary |
|------|---------|
| `tensor_create` | `name`, `data: f32[]`, `shape: usize[]` — validates `len(data) == product(shape)`. |
| `tensor_add` | `a`, `b`, `result_name` — same shape. |
| `tensor_mul` | Element-wise multiply; same shape. |
| `tensor_matmul` | 2D only: `[M,K] @ [K,N]`. |
| `tensor_get` | `name`, `indices` — N-D index using tensor layout. |
| `tensor_get_2d` | `name`, `row`, `col`. |
| `tensor_reshape` | `name`, `new_shape`, `result_name`. |
| `tensor_transpose` | `name`, `dim0`, `dim1`, `result_name`. |
| `tensor_inspect` | Full shape, strides, data. |
| `tensor_list` | Lists stored tensors (see [limitations](05-limitations-and-troubleshooting.md)). |

---

## 2. Project / build (2) — **server filesystem**

| Tool | Summary |
|------|---------|
| `read_file` | `path` relative to **`rs-tensor/`** crate root **on the server**. |
| `cargo_exec` | `command`: **`"build"`** or **`"run"`** — runs **`cargo`** on the **server**. |

Remote-only agents often skip these unless you intentionally automate the hosted checkout.

---

## 3. Datasets & MLP training (6)

| Tool | Summary |
|------|---------|
| `create_dataset` | `type`: `and` \| `or` \| `xor` \| `circle` (optional `n_samples` for circle). Produces `{type}_inputs` and `{type}_targets`. |
| `init_mlp` | `architecture: usize[]`, optional `name` prefix for weights. |
| `mse_loss` | `predicted`, `target` tensor names — same element count. |
| `train_mlp` | `mlp`, `inputs`, `targets`, `lr`, `epochs`. |
| `evaluate_mlp` | Forward only; optional `targets` for loss/accuracy. |
| `mlp_predict` | Single sample `input: f32[]`. |

---

## 4. Autograd & MLP forward (4)

| Tool | Summary |
|------|---------|
| `autograd_neuron` | Scalar neuron: `inputs`, `weights`, `bias` — `tanh` + backward. |
| `autograd_expr` | `values`, `ops` (`add`/`mul`/`tanh`), `backward_from`. |
| `autograd_neuron_tensor` | One layer `tanh(x @ w + b)` with explicit shapes. |
| `mlp_forward` | Multi-layer `tanh`; `layers[]` with `weights`, `bias`, `in_features`, `out_features`. |

---

## 5. Attention (1)

| Tool | Summary |
|------|---------|
| `attention_forward` | `q_data`, `k_data`, `v_data`, `seq_len`, `d_k`, optional `d_v`. |

---

## 6. GGUF (2) — **paths on server**

| Tool | Summary |
|------|---------|
| `gguf_inspect` | `path` — metadata + tensor list. |
| `gguf_load_tensor` | `path`, `tensor_name`, optional `store_as`. |

---

## 7. LLaMA (3) — **GGUF on server**

| Tool | Summary |
|------|---------|
| `llama_load` | Llama-compatible GGUF **path readable by the server**. |
| `llama_generate` | `prompt` / `token_ids`, `max_tokens`, `temperature`. |
| `llama_inspect` | Config / shapes — needs loaded model. |

---

## 8. CNN (8)

| Tool | Summary |
|------|---------|
| `conv2d_forward` | `input`, `kernel`, optional `bias`, `stride`, `padding`, `result_name` — NCHW. |
| `max_pool2d` | `input`, `kernel_size`, optional `stride`, `result_name`. |
| `avg_pool2d` | Same; mean window. |
| `batch_norm2d` | `input`, `gamma`, `beta`, optional `eps`, `result_name`. |
| `flatten_tensor` | 4D → 2D `[N, C*H*W]`. |
| `global_avg_pool` | NCHW → NC. |
| `init_cnn` | Layer spec list. |
| `cnn_forward` | `model` prefix, `input` tensor. |

---

## Typical call chains (agents)

**XOR MLP:** `create_dataset` (xor) → `init_mlp` → `train_mlp` → `evaluate_mlp` / `mlp_predict`.

**CNN:** `init_cnn` → `tensor_create` (input) → `cnn_forward` — or manual conv stack with `conv2d_forward`, pools, etc.

**LLaMA:** `llama_load` (server path) → `llama_generate`.

---

*See [05-limitations-and-troubleshooting.md](05-limitations-and-troubleshooting.md) for path and SSE notes.*

*Next: [03-resources-and-prompts.md](03-resources-and-prompts.md).*
