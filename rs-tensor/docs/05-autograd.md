# Chapter 5 — The autograd engine

## What is autograd?

When training a neural network, you need gradients — "if I nudge this weight, how does the output change?" Computing these by hand for a long chain of operations would be brutal. Autograd does it automatically:

1. **Forward pass**: compute the output, recording every operation in a graph.
2. **Backward pass**: walk the graph in reverse, applying the chain rule at each node.

The result: every input value gets a `.grad` field telling you how the final output changes with respect to that value.

## The `Value` type

Our autograd engine works on **scalars** (single `f32` values), inspired by Karpathy's [micrograd](https://www.youtube.com/watch?v=VMj-3S1tku0). Each `Value` is a node in the computation graph:

```rust
struct ValueData {
    data: f32,       // the number
    grad: f32,       // gradient (filled by backward)
    op: Op,          // what operation created this value
    label: String,   // for debugging
}

pub struct Value(Rc<RefCell<ValueData>>);
```

### Why `Rc<RefCell<...>>`?

This is the key Rust design choice. A computation graph has **shared ownership** — the value `a` might be used in both `a + b` and `a * c`. In garbage-collected languages this is free; in Rust we need:

- **`Rc`** (reference counting): multiple `Value` handles can point to the same node. When the last handle is dropped, the node is freed.
- **`RefCell`**: we need to mutate `.grad` during backward, even though multiple handles exist. `RefCell` gives us runtime-checked mutable borrows.

The trade-off: `Rc` is single-threaded (not `Send`/`Sync`), so our autograd values can't be shared across threads. That's fine for learning — real frameworks use `Arc` and more sophisticated graph management.

## Supported operations

| Operation | Forward | Local gradient (backward) |
|-----------|---------|--------------------------|
| `a + b` | `a.data + b.data` | `da = 1`, `db = 1` |
| `a * b` | `a.data * b.data` | `da = b.data`, `db = a.data` |
| `tanh(a)` | `a.data.tanh()` | `da = 1 - tanh(a)²` |

Each operation is recorded as an `Op` enum variant that stores references to the input values.

## How backward works

When you call `output.backward()`:

1. **Build topological order** — depth-first traversal from the output, visiting each node once. This ensures we process a node only after all its consumers.
2. **Set output gradient to 1.0** — "how does the output change with respect to itself? By 1."
3. **Walk in reverse** — for each node, look at its `Op`, compute the local gradients, and **accumulate** them into the input nodes. Accumulation (using `+=`) is critical — a value used in multiple places gets gradient contributions from all of them.

### Example: gradient accumulation

```
a = 2.0, b = 3.0
c = a * b       → c = 6.0
d = c + a       → d = 8.0
```

When we call `d.backward()`:
- `d.grad = 1.0` (seed)
- `d = c + a`: both `c` and `a` get `+= 1.0`
- `c = a * b`: `a` gets `+= b * c.grad = 3.0 * 1.0 = 3.0`, `b` gets `+= a * c.grad = 2.0 * 1.0 = 2.0`
- Final: `a.grad = 1.0 + 3.0 = 4.0` (from both paths), `b.grad = 2.0`

This is the chain rule in action.

## A single neuron

The classic test: `out = tanh(x1*w1 + x2*w2 + b)`.

```rust
let x1 = Value::new(2.0, "x1");
let w1 = Value::new(-3.0, "w1");
let x2 = Value::new(0.0, "x2");
let w2 = Value::new(1.0, "w2");
let b = Value::new(6.8814, "b");

let out = (&(&(&x1 * &w1) + &(&x2 * &w2)) + &b).tanh();
out.backward();
```

After backward, each weight has a gradient telling you: "to increase the output, adjust this weight in this direction." That's the foundation of gradient descent.

## MCP tools

The autograd engine is exposed through three MCP tools:

### Scalar tools

| Tool | What it does |
|------|-------------|
| `autograd_neuron` | Run a single neuron (`tanh(sum(xi*wi) + bias)`) and return output + all gradients. |
| `autograd_expr` | Build a custom computation graph from named values and operations, run backward, return all gradients. |

### Tensor-level tools

| Tool | What it does |
|------|-------------|
| `autograd_neuron_tensor` | Run a full layer: `tanh(x @ w + b)` with tensor inputs. Returns output tensor and gradient tensors for x, w, and b. |

### Design choice: why not store `Value` in the server?

Unlike tensors, `Value` uses `Rc<RefCell<...>>` which isn't `Send` — it can't be held in a `tokio::Mutex` across `.await` points. So instead of persisting autograd state between tool calls, each tool builds the graph, runs forward + backward, and returns everything in one shot. This is actually cleaner: the computation graph is ephemeral by nature.

---

## Tensor-level autograd: `TensorValue`

The scalar engine works, but real neural networks operate on tensors (matrices of weights, batches of inputs). So we extended the same pattern to tensors.

`TensorValue` wraps a `Tensor` the same way `Value` wraps an `f32`:

```rust
pub struct TensorValue(Rc<RefCell<TensorValueData>>);

struct TensorValueData {
    data: Tensor,       // the tensor (forward result)
    grad: Tensor,       // gradient tensor (same shape, filled by backward)
    op: TensorOp,       // what produced this
    label: String,
}
```

### Supported tensor operations and their gradients

| Operation | Forward | Backward (gradient rules) |
|-----------|---------|--------------------------|
| `a.add(b)` | element-wise `a + b` | `a.grad += grad`, `b.grad += grad` |
| `a.mul(b)` | element-wise `a * b` | `a.grad += b.data * grad`, `b.grad += a.data * grad` |
| `a.matmul(b)` | matrix multiply `a @ b` | `a.grad += grad @ b^T`, `b.grad += a^T @ grad` |
| `a.tanh()` | element-wise tanh | `a.grad += (1 - out^2) * grad` |
| `a.sum()` | sum to scalar | `a.grad += broadcast(grad)` |

### The matmul gradient

The matmul gradient is the most interesting. If `c = a @ b` where `a` is `[M,K]` and `b` is `[K,N]`:
- To get `a`'s gradient: `grad @ b^T` — multiply the incoming gradient by `b` transposed
- To get `b`'s gradient: `a^T @ grad` — multiply `a` transposed by the incoming gradient

This is why we needed `transpose` and `matmul` on `Tensor` before building this.

### A neural network layer

With `TensorValue` you can build a real layer:

```rust
let x = TensorValue::new(Tensor::new(vec![1.0, 2.0], vec![1, 2]), "x");
let w = TensorValue::new(Tensor::new(vec![0.5, -0.5], vec![2, 1]), "w");
let b = TensorValue::new(Tensor::new(vec![0.1], vec![1, 1]), "b");

let out = x.matmul(&w).add(&b).tanh();
out.backward();
// w.grad() and b.grad() now tell you how to update the weights
```

## Where the code lives

| File | Role |
|------|------|
| `src/autograd.rs` | Scalar `Value`, `Op` enum, operator overloads, `backward()`, tests. |
| `src/tensor_value.rs` | Tensor-level `TensorValue`, `TensorOp`, backward with matmul gradients, tests. |
| `src/tensor.rs` | `Tensor` with `matmul`, `zeros`, `ones`, `sum`, `scale`. |
| `src/mcp/tools/autograd_ops.rs` | Argument structs for autograd MCP tools (`AutogradNeuronArgs`, `AutogradExprArgs`, `AutogradTensorLayerArgs`). |
| `src/mcp/tools/mod.rs` | Tool implementations (`autograd_neuron`, `autograd_expr`, `autograd_neuron_tensor`). |

## What's next

Phase 2 is complete. Next is **Phase 3 — Tiny Inference Engine**:

1. **Feedforward network inference** — stack multiple layers, run forward pass
2. **Attention mechanism from scratch** — the core of transformers
3. **GGUF model loading** — load a real model and run it

---

*Back to [Table of contents](README.md#table-of-contents). For the full arc, see [ml-rust-project.md](ml-rust-project.md).*
