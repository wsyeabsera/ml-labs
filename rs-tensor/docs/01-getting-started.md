# Chapter 1 — Getting started

## What this book is

This book explains the **rs-tensor** project: we’re building ML infrastructure from scratch in Rust to understand how it works. The goal isn’t to ship a library — it’s to learn by building. Each chapter ties one idea (ownership, iterators, etc.) to the code.

The overall path is defined in **[ml-rust-project.md](ml-rust-project.md)** (the roadmap). We’re currently in **Phase 1 — Tensor from scratch**: a strided n-dimensional array with basic ops and correct memory layout. Later phases cover autograd, a tiny inference engine, and optional deep dives (SIMD, CUDA, quantization).

## How to run the project

From the project root (`rs-tensor`):

```bash
cargo build    # compile
cargo run      # compile and run
```

You should see something like:

```
Hello, world!
t3: Tensor { data: [5.0, 7.0, 9.0], shape: [3] }
```

## How to build the API docs

The API docs are generated from the `///` and `//!` comments in the source:

```bash
cargo doc --open
```

Use the API docs for “what does this function take and return?” Use this book for “why do we do it this way?”

## How to read this book

- **Chapters are short.** Each one covers one theme and points to the relevant code.
- **The roadmap is the source of truth.** [ml-rust-project.md](ml-rust-project.md) has the phase checklists, readings, and notes.
- **Keep the code open.** The book references `src/main.rs` and `src/tensor.rs`; read those as you go.

Next: [Chapter 2 — The big picture](02-the-big-picture.md)
