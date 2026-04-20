# Chapter 3 — Phase 1 checklist and next steps

This chapter ties the **book** to the **roadmap**. The full learning arc and checklists live in **[ml-rust-project.md](ml-rust-project.md)**. Here we focus on Phase 1 and what to do next.

---

## Phase 1 — Tensor from scratch

Build a strided n-dimensional array with basic ops and correct memory layout.

| Task | Status |
|------|--------|
| `Tensor` struct: `Vec<f32>` + shape + strides | Done |
| `new` constructor with invariant assertions | Partially done (we have `new`; we could add assertions that `data.len() == product(shape)`) |
| `get` for 2D (row-major index formula) | Done — `get_2d(row, col)` returns `Option<f32>` |
| Generalize `get` to N dimensions → derive strides | Done — `get(&[usize])` using strides |
| Basic ops: add, mul (elementwise) | Done |
| Reshape | Done — new shape, same data (materializes if non-contiguous) |
| Transpose | Done — swaps shape and strides (zero-copy) |

**Phase 1 is complete!** We have a strided N-dimensional tensor with basic ops, indexing, reshape, and transpose.

Next up is **Phase 2 — Autograd Engine**: build a scalar autograd engine (micrograd-style), then extend to tensors. See [ml-rust-project.md](ml-rust-project.md) for the checklist.

---

## File layout

| File | Role |
|------|------|
| `src/bin/main.rs` | Entry point: creates tensors, calls ops, prints. |
| `src/bin/mcp.rs` | MCP server binary: wires `TensorServer` to stdio transport. |
| `src/tensor.rs` | `Tensor` struct and methods (`new`, `add`, `mul`, `get_2d`, `get`, `reshape`, `transpose`). |
| `src/autograd.rs` | Scalar autograd engine: `Value`, `Op`, operator overloads, `backward()`. |
| `src/lib.rs` | Library root: re-exports `tensor`, `autograd`, and `mcp` modules. |
| `src/mcp/mod.rs` | MCP server: tool implementations and `ServerHandler`. |
| `src/mcp/tools/` | Argument structs for MCP tools. |
| `docs/README.md` | This book’s table of contents and link to the roadmap. |
| `docs/01-getting-started.md` … `05-autograd.md` | Learning book chapters. |
| `docs/ml-rust-project.md` | **The roadmap**: phases, checklists, readings, notes. |

---

## Phase 1 reading

From the roadmap: **[Matrix Calculus You Need for Deep Learning](https://arxiv.org/abs/1802.01528)**. Useful when we do gradients and autograd later, and for intuition about shapes and layout.

---

*Back to [Table of contents](README.md#table-of-contents). For the full arc and later phases, see [ml-rust-project.md](ml-rust-project.md).*
