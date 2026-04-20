# Learning Rust with rs-tensor

A short book that walks through this codebase and explains **what we built and why**. The project follows a learning arc defined in **[ml-rust-project.md](ml-rust-project.md)** — build ML infrastructure from scratch to understand how it works (not to ship a library).

---

## Goal

Understand how ML systems actually work by building broken versions of them. The docs and code are aimed at someone with basic Rust and basic ML who wants to see how tensors, autograd, and inference fit together.

---

## The learning arc

The path we follow is in **[ml-rust-project.md](ml-rust-project.md)**. Summary:

| Phase | Focus | Status |
|-------|--------|--------|
| **1** | Tensor from scratch (strided n-dim array, layout, basic ops) | Done |
| **2** | Autograd engine (scalar then tensor) | In progress |
| **3** | Tiny inference engine (feedforward, attention, GGUF) | Planned |
| **4** | Follow curiosity (SIMD, CUDA, quantization, fusion) | Planned |

Use that file for checklists, readings, and notes. This book is the narrative that goes with the code.

---

## How to build the API docs

From the `rs-tensor` directory:

```bash
cargo doc --open
```

That generates the API docs from the `///` comments in the code.

---

## Table of contents

### Part I — Phase 1: Tensor from scratch

1. **[Getting started](01-getting-started.md)** — Run the project, use this book, where we are in the arc.
2. **[The big picture](02-the-big-picture.md)** — What a tensor is (data + shape).
3. **[Phase 1 checklist and next steps](03-codebase-and-next-steps.md)** — What’s done, what’s next (get, strides, mul, reshape, transpose), and the Phase 1 reading.
4. **[The MCP server](04-mcp-server.md)** — How we exposed the tensor library as MCP tools for interactive use from Claude Code.

### MCP handbook (agents & deployment)

Use this when building **Claude agents** or connecting **only via MCP URL** (no checkout on your machine):

- **[docs/mcp/README.md](mcp/README.md)** — Overview, **HTTPS client config**, all 36 tools, resources, workflows. Server operators who build from source also use **[docs/mcp/01-running-and-configuration.md](mcp/01-running-and-configuration.md)**.

### Part II — Phase 2: Autograd engine

5. **[The autograd engine](05-autograd.md)** — Scalar autograd: `Value` type, computation graph, backward pass, chain rule, and MCP tools.

### Part III — Phase 3: Tiny inference engine

*Chapters will be added as we add feedforward inference, attention, and GGUF loading. See [ml-rust-project.md](ml-rust-project.md).*

### Part IV — Phase 4: Follow curiosity

*Optional deep dives (SIMD, CUDA, quantization, fusion). See [ml-rust-project.md](ml-rust-project.md).*

---

*As you add code, add or update chapters so the book stays in sync with the project. Keep [ml-rust-project.md](ml-rust-project.md) as the single source of truth for the learning arc.*
