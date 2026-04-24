import { FileText, MessageSquare, Scan, Sparkles, Zap, AlertTriangle } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function LLM() {
  return (
    <div>
      <PageHeader
        eyebrow="CPU-only LLaMA inference"
        accent="purple"
        title={<>LLM / <span className="gradient-text">GGUF</span> tools.</>}
        lede="Neuron can load a quantized LLaMA model from a GGUF file and generate text — all locally, all CPU. It's not a production inference server, but it's enough to experiment, fine-tune, and wire tiny LLMs into Claude-driven workflows from the same MCP surface you use for MLPs."
      />

      <Section eyebrow="What this is (and isn't)" title="Three tools, one loaded model.">
        <p>
          These three tools wrap the rs-tensor <code>llama_*</code> family. Under the hood, rs-tensor
          reads GGUF quantized weights, runs a CPU-only forward pass, and returns token IDs. Neuron
          adds a consistent MCP interface and event logging on top. Only one model can be loaded at a
          time per Neuron process; subsequent <code>llm_load</code> calls replace the previous.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={FileText} title="llm_load" accent="cyan">
            Load a GGUF file from disk. One model at a time.
          </InfoCard>
          <InfoCard icon={MessageSquare} title="llm_generate" accent="purple">
            Generate text. Accepts a prompt string (best-effort whitespace tokenization) or raw token
            IDs (recommended).
          </InfoCard>
          <InfoCard icon={Scan} title="llm_inspect" accent="green">
            Dump the current model's config, dimensions, and parameter count.
          </InfoCard>
        </div>
        <Callout kind="warn" title="This is experimental">
          CPU-only LLM inference is slow (expect 5-10 tok/s on a 1B-parameter model). Good for
          prototyping, pipelines, or very targeted use. Not a production chat API. If you want fast
          LLM inference, use Anthropic's API or a GPU-backed server.
        </Callout>
      </Section>

      <Section eyebrow="Step 1 — llm_load" title="Point at a GGUF file.">
        <p>
          GGUF is the quantized weight format used by llama.cpp and friends. Supported quantizations
          in rs-tensor include Q4, Q8, F16, and F32. You can get GGUFs from{" "}
          <a className="text-cyan-neon hover:underline" href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer">HuggingFace</a>{" "}
          — anything marked &ldquo;GGUF&rdquo; for a small LLaMA-architecture model (TinyLlama, Phi-2
          quantized, etc.) will work.
        </p>
        <CodeBlock
          lang="ts"
          title="llm_load — minimal example"
          code={`llm_load({
  path: "/Users/you/models/tinyllama-1.1b-q4_k_m.gguf"
})
// → { ok: true, info: "Loaded TinyLLaMA-1.1B-chat-v1.0, 32 layers, 2048 context, Q4_K_M, 669MB" }`}
        />
        <Callout kind="learn" title="Why GGUF">
          Original LLM weights are f32 or f16 — a 7B model is ~14GB of f16. GGUF files come
          pre-quantized (Q4_K_M shrinks a 7B to ~4GB) and memory-map cleanly. rs-tensor loads them
          lazily and only decompresses the tensors it needs to touch, which is why a 1B model fits in a
          few hundred MB of resident memory.
        </Callout>
      </Section>

      <Section eyebrow="Step 2 — llm_inspect" title="Confirm what you loaded.">
        <CodeBlock
          lang="json"
          title="llm_inspect() — sample output"
          code={`{
  "config": {
    "dim": 2048,
    "n_layers": 22,
    "n_heads": 32,
    "n_kv_heads": 4,
    "vocab_size": 32000,
    "ffn_dim": 5632,
    "head_dim": 64,
    "rms_eps": 1e-05
  },
  "vocab_size": 32000,
  "total_parameters": 1100048384,
  "total_parameters_human": "1.10B"
}`}
        />
        <Table
          caption="Config fields"
          columns={[
            { key: "field",   header: "Field",      accent: "purple", mono: true },
            { key: "meaning", header: "Meaning" },
          ]}
          rows={[
            { field: "dim",          meaning: "Hidden size. Every token becomes a dim-vector." },
            { field: "n_layers",     meaning: "Number of transformer blocks (attention + FFN + norms)." },
            { field: "n_heads",      meaning: "Attention heads in the query projection." },
            { field: "n_kv_heads",   meaning: "Key/value heads. Grouped-Query Attention if n_kv_heads < n_heads — shares KV across groups of queries to save memory." },
            { field: "vocab_size",   meaning: "Number of tokens the model can emit. Bigger = more granular but more memory in the output head." },
            { field: "ffn_dim",      meaning: "Feed-forward hidden size, usually ~2.7x dim for LLaMA-style." },
            { field: "head_dim",     meaning: "Per-head dimension = dim / n_heads." },
            { field: "rms_eps",      meaning: "RMSNorm epsilon. Numeric stability knob for the layernorm replacement. 1e-5 or 1e-6 typical." },
          ]}
        />
      </Section>

      <Section eyebrow="Step 3 — llm_generate" title="Generate text.">
        <p>
          Two ways to feed a prompt: a text string (convenient, unreliable) or raw token IDs (verbose,
          correct). Use the second for anything that matters.
        </p>

        <AsciiDiagram title="Prompt → tokens → logits → next token" accent="purple">
{`   prompt   ──► tokenizer ──► token_ids
   "hello    "                 [1, 15043, 2787]
    world"                          │
                                    ▼
                           ┌────────────────┐
                           │ llama_forward  │  (rs-tensor, CPU)
                           └────────────────┘
                                    │
                                    ▼
                              logits [vocab_size]
                                    │
                         temperature > 0 ? sample : argmax
                                    │
                                    ▼
                               next_token_id
                                    │
                                    ▼
                          detokenize → text
                                    │
                       ┌────────────┴────────────┐
                       │   repeat max_tokens     │
                       └─────────────────────────┘`}
        </AsciiDiagram>

        <CodeBlock
          lang="ts"
          title="llm_generate — text prompt"
          code={`llm_generate({
  prompt: "Hello world",
  max_tokens: 32,
  temperature: 0.8,
})
// →
// {
//   text: " and welcome to our world tutorial...",
//   token_ids: [29900, 304, 15623, ...],
//   prompt_tokens: [15043, 3186],
//   num_generated: 32,
//   elapsed_ms: 3440,
//   tokens_per_sec: "9.30"
// }`}
        />

        <Callout kind="warn" title="Text prompt caveat">
          The text prompt path does <strong>naive whitespace tokenization</strong> — it splits on
          spaces and maps each word to a vocab ID if there's a direct match. Words that don't appear
          in the vocab are silently dropped. This is fine for demos; it's wrong for real use because
          LLMs use BPE/SentencePiece tokenizers that split sub-words. For anything real, tokenize with
          the matching tokenizer library and pass <code>token_ids</code> directly.
        </Callout>

        <CodeBlock
          lang="ts"
          title="llm_generate — token IDs (recommended)"
          code={`llm_generate({
  token_ids: [1, 15043, 3186, 29892, 1724, 263, 2294, 2462, 29991],
  max_tokens: 64,
  temperature: 0.6,
})`}
        />
      </Section>

      <Section eyebrow="Sampling parameters" title="temperature and max_tokens.">
        <Table
          columns={[
            { key: "param",   header: "Param",      mono: true },
            { key: "range",   header: "Range" },
            { key: "meaning", header: "Meaning" },
            { key: "default", header: "Default" },
          ]}
          rows={[
            {
              param:   "temperature",
              range:   "0 – 2",
              meaning: <>0 = greedy argmax (always pick the most likely next token). 0.1-0.3 = very focused. 0.7-1.0 = balanced creativity. 1.5-2.0 = wild / diverse. Over 1 can produce nonsense on small models.</>,
              default: "0.8",
            },
            {
              param:   "max_tokens",
              range:   "1 – 2048",
              meaning: <>How many new tokens to generate. Generation stops at this cap; if you need end-of-sequence handling do it downstream. On a 1B model, 64 tokens takes roughly 6-10 seconds.</>,
              default: "64",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Performance" title="What to expect on CPU.">
        <Table
          caption="Order-of-magnitude rates on an M-series Mac (2023+)"
          columns={[
            { key: "model",    header: "Model" },
            { key: "quant",    header: "Quantization" },
            { key: "tps",      header: "Tokens/sec", mono: true, accent: "green" },
            { key: "ram",      header: "Peak RAM",   mono: true },
          ]}
          rows={[
            { model: "TinyLlama 1.1B",   quant: "Q4_K_M", tps: "8–12",  ram: "~700 MB" },
            { model: "Phi-2 2.7B",       quant: "Q4_K_M", tps: "4–6",   ram: "~1.8 GB" },
            { model: "Mistral 7B",       quant: "Q4_K_M", tps: "1.5–3", ram: "~4.5 GB" },
          ]}
        />
        <Callout kind="note">
          These are ballpark numbers from CPU-only inference. Apple Silicon's unified memory makes big
          models more viable than on Intel laptops. Still — if you're doing anything interactive, stay
          under 3B parameters.
        </Callout>
      </Section>

      <Section eyebrow="Sample use cases" title="What these are actually for.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Zap} title="Pipeline micro-steps" accent="cyan">
            You're processing a CSV row-by-row, and one column needs a summary/classification. A 1B
            model at 10 tok/s for a 50-token output is 5s/row — slow for interactive but fine for
            batch.
          </InfoCard>
          <InfoCard icon={Sparkles} title="Privacy-sensitive flows" accent="purple">
            You want a simple LLM step but can't send data off-machine. Q4-quantized local models
            solve the compliance question at the cost of quality.
          </InfoCard>
          <InfoCard icon={FileText} title="Featurization for MLPs" accent="green">
            Generate a short text summary of each row with the LLM, pass the text to an
            <code> embed()</code> featurizer (or byte-level), train a classical MLP on the embeddings.
            Everything stays in-process.
          </InfoCard>
          <InfoCard icon={AlertTriangle} title="Not: production chat" accent="orange">
            10 tokens/sec is fine for scripts; it's miserable for anyone waiting for a chat response.
            Use Anthropic's API or a GPU inference server instead.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "40%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "tools/llm_load.ts",     what: "Loads a GGUF file into rs-tensor. One-at-a-time." },
            { file: "tools/llm_generate.ts", what: "Calls rs-tensor's llama_generate with your prompt/tokens, returns text + tokens + timing." },
            { file: "tools/llm_inspect.ts",  what: "Queries rs-tensor for the currently-loaded model's config." },
            { file: "rs-tensor (Rust)",      what: "The actual inference implementation. GGUF reader, RMSNorm, RoPE, GQA, KV cache." },
          ]}
        />
      </Section>
    </div>
  )
}
