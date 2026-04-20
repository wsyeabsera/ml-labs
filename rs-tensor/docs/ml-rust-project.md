# ML Systems in Rust

A learning project: build ML infrastructure from scratch in Rust, in order to understand it.

## Goal
Not to ship a library. To understand how ML systems actually work by building broken versions of them.

---

## Background
- Strong backend + frontend experience
- Basic Rust
- Basic ML

---

## Learning Arc

### Phase 1 — Tensor from Scratch
Build a strided n-dimensional array with basic ops and correct memory layout.
- [x] `Tensor` struct: `Vec<f32>` + shape
- [x] `new` constructor (invariant assertions still partial)
- [x] Basic ops: add, mul (elementwise)
- [x] `get` for 2D (row-major index formula) — `get_2d(row, col) -> Option<f32>`
- [x] Strides field on Tensor — computed from shape, enables zero-copy transpose
- [x] Generalize `get` to N dimensions — `get(&[usize]) -> Option<f32>` using strides
- [x] Reshape — new shape, same data (materializes if non-contiguous)
- [x] Transpose — swaps shape and strides entries (zero-copy)
- [x] MCP server: expose tensor tools for interactive use from Claude Code

**Reading:** [Matrix Calculus You Need for Deep Learning](https://arxiv.org/abs/1802.01528)

---

### Phase 2 — Autograd Engine
Build a scalar autograd engine (micrograd-style), then extend to tensors.
- [x] Scalar `Value` with `+`, `*`, `tanh` — `Rc<RefCell<ValueData>>` for shared graph nodes
- [x] Backprop through a computation graph — topological sort + reverse walk with chain rule
- [x] MCP tools: `autograd_neuron` (single neuron forward+backward), `autograd_expr` (custom expressions)
- [x] Tensor-level autograd: `TensorValue` with add, mul, matmul, tanh, sum + backward
- [x] Matrix multiplication on `Tensor` (naive triple-loop, 2D only)
- [x] Helper ops: `zeros`, `ones`, `sum`, `scale` on `Tensor`
- [x] MCP tools: `tensor_matmul`, `autograd_neuron_tensor` (tensor-level forward+backward)

**Reading:** [Karpathy's micrograd video](https://www.youtube.com/watch?v=VMj-3S1tku0)

---

### Phase 3 — Tiny Inference Engine
Build a minimal inference engine, implement attention manually, load a real model.
- [ ] Feedforward network inference
- [ ] Attention mechanism from scratch
- [ ] GGUF model loading

**Reading:** [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/)

---

### Phase 4 — Follow Curiosity
- [ ] SIMD intrinsics for matmul
- [ ] CUDA kernels
- [ ] Quantization (INT8, INT4)
- [ ] Kernel fusion

---

## Hopes / Ideas / Rabbit Holes
> Dump things here when they come up mid-build. Revisit later.

- 

---

## Docs Generated
> Track markdown files created during the project.

- **`ml-rust-project.md`** — This file (roadmap, phases, checklists, readings, notes).
- **Learning book** — `docs/README.md` is the table of contents. Chapters `01-getting-started.md` through `04-mcp-server.md` cover Phase 1; `05-autograd.md` covers Phase 2. New chapters will be added as we build.

---

## Notes & Decisions
> Running log of "why we did it this way."

-
