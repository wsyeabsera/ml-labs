# Chapter 2 — The big picture

## What we’re building

A **tensor** is a multi-dimensional array of numbers. In this project we use 32-bit floats (`f32`). You can think of it like a NumPy array or a PyTorch tensor, but in Rust.

## Two parts: data and shape

Our tensor has two pieces:

1. **Data** — A flat list of numbers in memory. One `Vec<f32>` holds all the elements.
2. **Shape** — The dimensions. For example:
   - `[3]` → a vector of length 3 (one dimension).
   - `[2, 3]` → a 2×3 matrix (two dimensions).

We store everything in a single `Vec` and use `shape` to interpret it. So a 2×3 tensor has 6 elements in `data`, and `shape` is `[2, 3]`. That’s the same idea as row-major layout in NumPy or C.

## Where you see it in the code

In `src/tensor.rs`:

```rust
pub struct Tensor {
    pub data: Vec<f32>,
    pub shape: Vec<usize>,
}
```

`data` is the buffer; `shape` tells you how many dimensions and how long each one is. Right now we only use 1D shapes like `[3]`, but the type is ready for more.

Next: [Chapter 3 — Phase 1 checklist and next steps](03-codebase-and-next-steps.md)
