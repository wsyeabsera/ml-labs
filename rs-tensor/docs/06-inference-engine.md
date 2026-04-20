# Chapter 6 — Inference Engine (Phase 3 + 3.5)

We built a complete LLaMA inference pipeline from scratch: feedforward networks, attention, GGUF model loading, and full autoregressive generation with KV caching.

---

## What We Built

### Phase 3 — Core Components

#### MLP (`src/mlp.rs`)
- `Layer` struct: `tanh(x @ w + b)` using tensor-level autograd (`TensorValue`)
- `MLP` struct: chains layers, collects parameters
- Forward + backward through arbitrary depth networks
- Lesson: uniform weights cause tanh saturation → zero gradients. Varied initialization matters.

#### Scaled Dot-Product Attention (`src/attention.rs`)
- `softmax(Q @ K^T / sqrt(d_k)) @ V` with full autograd backward
- Required adding `TensorOp::Transpose` and `TensorOp::Softmax` to `TensorValue`
- Key bug: `Tensor::add` doesn't respect strides → transpose backward must materialize to contiguous via `reshape` before accumulating gradients
- Key insight: softmax backward is correctly zero when downstream gradients are uniform per row (shifting all logits by a constant doesn't change the distribution)

#### GGUF Parser (`src/gguf.rs`)
- Full binary format parser: magic bytes, metadata KV pairs, tensor info, aligned tensor data
- Supports GGUF v1 (u32 counts/strings), v2, v3
- F16 → F32 conversion via IEEE 754 bit manipulation
- Shapes stored column-major in GGUF, reversed to row-major on load
- `GgufFile::parse()`, `load_tensor()`, `summary()`, `list_tensors()`, `find_tensor()`

### Phase 3.5 — LLaMA Inference

#### New Tensor Ops (`src/tensor.rs`)
| Op | What it does |
|---|---|
| `rms_norm(weight, eps)` | `(x / sqrt(mean(x²) + eps)) * weight` — simpler than LayerNorm, no mean subtraction |
| `silu()` | `x * sigmoid(x)` — activation for SwiGLU FFN |
| `rope(pos, head_dim)` | Rotary position embedding — rotates pairs by position-dependent angles |
| `row(i)` | Extract row from 2D tensor as 1D |
| `matvec(vec)` | Matrix-vector multiply `[M,N] @ [N] -> [M]` — more efficient than full matmul for single-token inference |
| `softmax()` | Row-wise with max-subtraction trick for numerical stability |

#### LLaMA Model (`src/llama.rs`)

**Structs:**
```
LlamaConfig   — dim, n_layers, n_heads, n_kv_heads, vocab_size, ffn_dim, head_dim, rms_eps
TransformerBlock — attn_{q,k,v,output,norm}, ffn_{gate,down,up,norm}
LlamaModel   — config, token_embd, output, output_norm, blocks
```

**Forward pass (single token):**
1. Token embedding lookup
2. For each transformer block:
   - RMSNorm → Q/K/V projections → RoPE on Q,K → KV cache store → multi-head attention (with GQA) → output projection + residual
   - RMSNorm → SwiGLU FFN: `down(silu(gate(x)) * up(x))` + residual
3. Final RMSNorm → output projection → logits

**Key concepts:**
- **KV Cache**: Stores key/value vectors for all past positions. Without it, generating N tokens is O(N³) — with it, O(N²). This is the single biggest inference optimization.
- **GQA (Grouped Query Attention)**: Multiple Q heads share KV heads. `kv_group_size = n_heads / n_kv_heads`. Reduces memory bandwidth at scale.
- **RoPE**: `freq = 1/10000^(2i/dim)`. Encodes position as rotation — relative position information emerges naturally from dot products of rotated vectors.
- **SwiGLU**: Gated activation `silu(gate(x)) * up(x)` — the gate controls information flow, outperforms plain ReLU FFN.
- **Greedy vs temperature sampling**: `temperature=0` → argmax. `temperature>0` → softmax(logits/T) then sample. Higher T = more random.

#### Generation binary (`src/bin/generate.rs`)
- Loads GGUF model, extracts vocab, generates 50 tokens from BOS
- 115.8 tok/s on release build with TinyStories 15M

---

## MCP Tools

### Phase 3 Tools
| Tool | What it does |
|---|---|
| `mlp_forward` | Multi-layer perceptron forward+backward with custom layer definitions |
| `attention_forward` | Scaled dot-product attention with Q, K, V matrices and gradient computation |
| `gguf_inspect` | Inspect GGUF file: metadata, tensor list, model architecture |
| `gguf_load_tensor` | Load a specific tensor from GGUF into the server tensor store |

### Phase 3.5 Tools
| Tool | What it does |
|---|---|
| `llama_load` | Load a LLaMA model from GGUF into server state (with vocabulary) |
| `llama_inspect` | Show loaded model config, weight shapes per layer, parameter count, vocab samples |
| `llama_generate` | Generate text with configurable max_tokens and temperature. Returns text + token IDs + timing |

---

## Test Model

**TinyStories 15M** (`model-files/stories15M-f32.gguf`, 94MB)
- 6 layers, 6 heads, dim=288, ffn=768, vocab=32000
- 24.4M parameters (F32)
- Trained on children's stories — generates coherent narratives
- Source: `klosax/tinyllamas-stories-gguf` on HuggingFace

---

## File Map

```
src/
  tensor.rs        — Core tensor type + new ops (rms_norm, silu, rope, matvec, softmax, row)
  tensor_value.rs  — Tensor autograd (added Transpose, Softmax ops)
  mlp.rs           — Layer + MLP structs with forward/backward
  attention.rs     — scaled_dot_product_attention with autograd
  gguf.rs          — Full GGUF binary format parser (v1/v2/v3)
  llama.rs         — LlamaModel: load from GGUF, forward pass, generate
  lib.rs           — Module declarations
  bin/generate.rs  — CLI binary for text generation
  mcp/
    mod.rs         — TensorServer (now with model + vocab state)
    tools/
      mod.rs       — All tool implementations
      tensor_ops.rs
      autograd_ops.rs
      gguf_ops.rs    — GgufInspectArgs, GgufLoadTensorArgs
      llama_ops.rs   — LlamaLoadArgs, LlamaGenerateArgs
      project.rs
```

---

## Bugs We Hit & What They Taught Us

| Bug | Root cause | Lesson |
|---|---|---|
| 3-layer MLP all-zero gradients | Uniform weights → tanh saturation | Weight initialization matters — even in toy models |
| Attention backward: zero Q gradients | Transpose created as disconnected leaf | Operations must be tracked in the computation graph for gradients to flow |
| Transpose backward wrong values | `Tensor::add` ignores strides | Non-contiguous tensors must be materialized before element-wise ops |
| Softmax backward "zero" gradients | Uniform V → uniform downstream gradients | Mathematically correct — softmax is shift-invariant. Changed the test, not the code |
| GGUF magic bytes wrong | Endianness of "GGUF" as u32 | Always check byte order for binary formats |
| GGUF v1 parse failure | v1 uses u32 (not u64) for counts | File format versions exist for a reason — handle them |
| Vocab size 288 instead of 32000 | Read shape before reversal | GGUF stores column-major shapes; must reverse first |

---

## What's Next (Phase 4 — Follow Curiosity)

- [ ] SIMD intrinsics for matmul
- [ ] CUDA kernels
- [ ] Quantization (INT8, INT4)
- [ ] Kernel fusion
- [ ] Update docs chapters for Phase 3/3.5
- [ ] React site visualization of transformer blocks
