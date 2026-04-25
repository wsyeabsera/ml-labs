import { Cpu, Layers, Workflow, FileSearch } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"

export function RsTensorInternals() {
  return (
    <div>
      <PageHeader
        eyebrow="The Rust math layer"
        accent="orange"
        title={<><span className="gradient-text">rs-tensor</span> internals.</>}
        lede="Neuron is the orchestration layer; rs-tensor does the math. It's a separate Rust crate with its own MCP server, spawned as a child process by neuron-mcp. This page is a high-level tour for anyone curious about what's under the hood."
      />

      <Section eyebrow="What rs-tensor is" title="A small Rust tensor library + MCP server.">
        <p>
          Roughly 5k lines of Rust. Implements: f32 tensors, basic ops (matmul, add, mul, etc.),
          autograd, MLP forward/backward, GGUF reader for LLaMA inference, attention. Exposes
          everything as MCP tools (init_mlp, train_mlp, evaluate_mlp, llama_load, llama_generate,
          plus low-level tensor ops).
        </p>
        <p>
          Separation of concerns: rs-tensor knows nothing about samples, runs, or registries.
          Neuron knows nothing about how a tensor is laid out in memory. They talk over MCP.
        </p>
      </Section>

      <Section eyebrow="Architecture" title="What's in the Rust source.">
        <Table
          columns={[
            { key: "module", header: "Module",        mono: true, accent: "orange", width: "200px" },
            { key: "what",   header: "What's in it" },
          ]}
          rows={[
            { module: "core/tensor.rs",       what: "Tensor type. Storage = Vec<f32>; shape = Vec<usize>. Stride-aware (so reshape / transpose can be cheap)." },
            { module: "core/autograd.rs",    what: "Reverse-mode autograd. Each tensor optionally has a Node tracking the op that produced it; backward() walks the graph." },
            { module: "ops/matmul.rs",        what: "Matrix multiplication. Naive triple loop fallback; SIMD path for 2D × 2D when shapes align." },
            { module: "ops/conv2d.rs",        what: "2D convolution forward + backward. Used for the CNN tools (currently underused — auto_train doesn't pick CNN architectures)." },
            { module: "ops/attention.rs",     what: "Scaled dot-product attention + GQA. Used by llama_generate." },
            { module: "mlp/mod.rs",            what: "MLP-specific: init_mlp (random init by Xavier/Kaiming), train_mlp (the loop), evaluate_mlp." },
            { module: "llama/mod.rs",          what: "LLaMA model loader + forward pass. Reads GGUF, allocates kv-cache, runs decoder layers." },
            { module: "gguf/reader.rs",       what: "GGUF format parser. Memory-maps the file, decodes tensor headers, lazy-decompresses on demand." },
            { module: "mcp/server.rs",        what: "MCP server entry. Tool registry, request dispatch. Stdio + HTTP (for remote rs-tensor)." },
          ]}
        />
      </Section>

      <Section eyebrow="Tensors" title="Storage + shape + strides.">
        <p>
          A tensor is just three things: a contiguous <code>Vec&lt;f32&gt;</code> of data, a shape
          (e.g. [3, 224, 224]), and strides (how many elements to skip per dim).
        </p>
        <CodeBlock
          lang="rust"
          title="The Tensor struct (simplified)"
          code={`pub struct Tensor {
    pub data: Vec<f32>,
    pub shape: Vec<usize>,
    pub strides: Vec<usize>,    // for stride-aware ops (transpose without copy)
    pub grad_node: Option<NodeRef>,   // autograd hook
}`}
        />
        <Callout kind="learn" title="Why strides matter">
          <code>transpose</code> a 1000×1000 tensor. With strides, it's free — just swap the stride
          values, no data movement. Without strides, you'd copy a million floats. Same trick for
          slicing, reshaping (when contiguity is preserved), and broadcasting.
        </Callout>
      </Section>

      <Section eyebrow="Autograd" title="Reverse-mode automatic differentiation.">
        <p>
          When you do a forward op (matmul, add, ...), each output tensor gets a Node attached
          recording: which inputs it came from, what op produced it, what the gradient with respect
          to each input is. <code>backward()</code> on the loss tensor walks this graph in reverse.
        </p>
        <CodeBlock
          lang="rust"
          title="Node and backward (simplified)"
          code={`pub enum Op {
    MatMul,
    Add,
    Relu,
    SoftmaxCrossEntropy { labels: Vec<usize> },
    // ... ~20 ops
}

pub struct Node {
    pub inputs: Vec<NodeRef>,
    pub op: Op,
}

impl Tensor {
    pub fn backward(&self) -> HashMap<NodeId, Tensor> {
        // Topological sort the graph
        let order = topo_sort(self.grad_node.as_ref().unwrap());

        // dL/dself = ones (loss is scalar, gradient is 1)
        let mut grads = HashMap::new();
        grads.insert(self.id(), Tensor::ones(&self.shape));

        // Walk in reverse — chain rule
        for node in order.iter().rev() {
            let grad_out = grads.remove(&node.id).unwrap();
            for (input, partial) in node.op.backward(grad_out, &node.inputs) {
                grads.entry(input.id()).or_insert_with(|| Tensor::zeros(&input.shape))
                    .add_(&partial);   // accumulate
            }
        }
        grads
    }
}`}
        />
        <Callout kind="learn" title="Why this works">
          The gradient chain rule says <code>dL/dx = (dL/dy) * (dy/dx)</code>. Each Op knows its
          own local gradient (dy/dx); backward() multiplies and accumulates them through the graph.
          PyTorch's autograd works the same way (more efficiently); rs-tensor's is a teaching-quality
          implementation that's good enough for the workloads ML-Labs targets.
        </Callout>
      </Section>

      <Section eyebrow="MLP training" title="Where most of the time goes.">
        <p>
          <code>train_mlp</code> is the busy function. Its hot loop is essentially:
        </p>
        <CodeBlock
          lang="rust"
          title="train_mlp inner loop (essence)"
          code={`for epoch in 0..epochs {
    let mut total_loss = 0.0;

    // Mini-batch shuffling (skipped for full-batch)
    let order = if let Some(bs) = batch_size {
        shuffled_indices_with_seed(&rng, n_samples)
    } else {
        (0..n_samples).collect()
    };

    for batch in order.chunks(batch_size.unwrap_or(n_samples)) {
        // Forward: input → hidden (with activation) → logits
        let hidden = inputs.gather(batch).matmul(&W1).add(&b1).activation(act);
        let logits = hidden.matmul(&W2).add(&b2);

        // Loss
        let loss = match loss_kind {
            CrossEntropy => softmax_ce(&logits, &targets.gather(batch)),
            Mse => mse_loss(&logits, &targets.gather(batch)),
        };

        // Backward
        let grads = loss.backward();

        // Optimizer step (SGD / Adam / AdamW)
        optimizer.step(&mut [&mut W1, &mut b1, &mut W2, &mut b2], &grads, lr);

        total_loss += loss.scalar();
    }

    callback(epoch, total_loss / batches.len() as f32);
}`}
        />
        <Callout kind="warn" title="Single-threaded by default">
          rs-tensor doesn't auto-parallelise the training loop. For our workloads (CPU MLPs of
          ~100k weights), the overhead of threading would exceed the speedup. Larger workloads
          would benefit but they're past ML-Labs's intended scale.
        </Callout>
      </Section>

      <Section eyebrow="GGUF + LLaMA inference" title="Loading quantized weights.">
        <p>
          GGUF is a binary format produced by llama.cpp. It stores per-tensor headers (name, dtype,
          shape, offset) followed by the raw bytes. rs-tensor's loader memory-maps the file and
          lazily decodes tensors as the forward pass touches them.
        </p>
        <CodeBlock
          lang="rust"
          title="The lazy-load path"
          code={`pub struct GgufFile {
    pub mmap: Mmap,
    pub tensors: HashMap<String, TensorHeader>,
}

impl GgufFile {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let mmap = unsafe { MmapOptions::new().map(&file)? };
        let tensors = parse_headers(&mmap);
        Ok(Self { mmap, tensors })
    }

    pub fn load_tensor(&self, name: &str) -> Tensor {
        let h = &self.tensors[name];
        match h.dtype {
            Dtype::F32 => decode_f32(&self.mmap[h.offset..], h.shape.clone()),
            Dtype::F16 => decode_f16(&self.mmap[h.offset..], h.shape.clone()),
            Dtype::Q4_K => decode_q4_k(&self.mmap[h.offset..], h.shape.clone()),
            Dtype::Q8_0 => decode_q8_0(&self.mmap[h.offset..], h.shape.clone()),
            // ...
        }
    }
}`}
        />
        <p>
          For a 1B Q4_K_M model (~700MB), only ~30-50MB of tensors are decoded for a single forward
          pass at any moment. The KV cache adds more (proportional to context length).
        </p>
      </Section>

      <Section eyebrow="The MCP layer" title="How neuron talks to rs-tensor.">
        <p>
          rs-tensor is its own MCP server. Neuron spawns it as a child process (stdio) by default,
          or talks to it over HTTP (when <code>RS_TENSOR_MCP_URL</code> is set).
        </p>
        <CodeBlock
          lang="ts"
          title="From neuron's perspective"
          code={`// neuron/src/core/mcp_client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const transport = new StdioClientTransport({
  command: process.env.RS_TENSOR_BIN ?? "rs-tensor",
  args: ["mcp"],
})
const client = new Client({ name: "neuron", version: "1.10" }, {})
await client.connect(transport)

// Now you can call rs-tensor tools
const result = await client.callTool({
  name: "init_mlp",
  arguments: { layers: [4, 32, 3], name: "iris" },
})`}
        />
        <Callout kind="learn" title="Why MCP and not FFI">
          We could call into Rust via napi or wasm. Reasons to pick MCP instead: (1) one mental
          model — same protocol Claude uses to talk to neuron; (2) processes are isolated — a
          rs-tensor crash doesn't take neuron with it; (3) remote rs-tensor is free (just point
          RS_TENSOR_MCP_URL at a remote box). Cost: serialization overhead per call. Significant
          for tiny tensors; negligible for training loops.
        </Callout>
      </Section>

      <Section eyebrow="Building" title="When you need to rebuild.">
        <CodeBlock
          lang="bash"
          code={`# Rebuild the rs-tensor binary after editing Rust source
cd ~/.ml-labs/rs-tensor
cargo build --release --bin mcp

# Or use ml-labs build (does the same thing)
ml-labs build

# ml-labs update also rebuilds rs-tensor when the binary is older
# than the source. Critical: many Phase 9+ neuron features rely on
# train_mlp args (weight_decay, swa, label_smoothing) that older
# rs-tensor binaries reject.`}
        />
      </Section>

      <Section eyebrow="Reading the source" title="Where to start.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Workflow} title="If you want to grok autograd" accent="cyan">
            Read <code>core/autograd.rs</code> followed by <code>ops/matmul.rs::backward</code>.
            Then look at <code>ops/softmax.rs::backward</code> for the cross-entropy shortcut.
          </InfoCard>
          <InfoCard icon={Layers} title="If you want to grok MLP training" accent="purple">
            Read <code>mlp/train.rs</code>. Then trace one epoch through autograd. Then look at
            the optimiser modules (<code>optim/sgd.rs</code>, <code>optim/adam.rs</code>).
          </InfoCard>
          <InfoCard icon={Cpu} title="If you want to grok GGUF" accent="green">
            Read <code>gguf/reader.rs</code>. Then look at one quantization decoder
            (<code>quant/q4_k.rs</code>) — it's where the bit-packing meets the f32 reconstruction.
          </InfoCard>
          <InfoCard icon={FileSearch} title="If you want to grok the MCP layer" accent="orange">
            Read <code>mcp/server.rs</code> and <code>mcp/tools.rs</code>. The patterns mirror neuron's
            tool registration (it's how the protocol is supposed to work — both sides look the same).
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
