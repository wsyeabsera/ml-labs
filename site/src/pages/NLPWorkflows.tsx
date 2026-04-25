import { MessageSquare, Layers, Brain, Zap } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function NLPWorkflows() {
  return (
    <div>
      <PageHeader
        eyebrow="LLM-powered featurization"
        accent="purple"
        title={<><span className="gradient-text">NLP</span> with ML-Labs.</>}
        lede="ML-Labs trains MLPs, not transformers. But when you turn text into a fixed-size embedding vector — via an LLM, a sentence-transformer, or even a hand-crafted tf-idf — the rest of the NLP problem becomes a tabular ML problem. This is the LLM-as-featurizer pattern."
      />

      <Section eyebrow="The pattern" title="Text → embedding → MLP.">
        <AsciiDiagram title="LLM-as-featurizer pipeline" accent="purple">
{`     raw text                    embedding vector             classifier
   "this product             ┌─────────────────┐            ┌──────────┐
    sucks, returning"  ───►  │  embedText()     │ ───►  ───►│ ML-Labs  │ ───► label
                              │  (BGE / OpenAI / │             │  MLP     │       (positive /
                              │   llm_generate)  │             │          │        neutral /
                              └─────────────────┘             └──────────┘        negative)
                                      │
                                      ▼
                                Float32Array
                                  length 768
                                  (or 384, 1024, ...)`}
        </AsciiDiagram>
        <Callout kind="learn" title="Why this works">
          Modern embedding models compress text into a high-dimensional space where semantically
          similar inputs are close. An MLP can learn linear and mildly-nonlinear decision
          boundaries in that space — fast, with little data. You don't need to fine-tune the LLM;
          you just use it as a feature extractor.
        </Callout>
      </Section>

      <Section eyebrow="Step 1" title="Pick an embedding source.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Brain} title="Anthropic API" accent="purple">
            Claude has embedding endpoints (or use the conversation API + read out hidden states).
            High quality, hosted, costs $$. Fine for prototyping.
          </InfoCard>
          <InfoCard icon={Zap} title="OpenAI text-embedding-3-small" accent="cyan">
            $0.02 / 1M tokens, dim=1536. Cheap, fast, good quality. Industry default.
          </InfoCard>
          <InfoCard icon={MessageSquare} title="ML-Labs's llm_generate" accent="green">
            Local, slow, free. Use for offline workflows where data can't leave the machine.
            Quality lower than the cloud options.
          </InfoCard>
          <InfoCard icon={Layers} title="sentence-transformers (Python)" accent="orange">
            BGE, MiniLM, mpnet — open-source models, run locally with Python. Good middle ground:
            local, free, decent quality. Call from a Python sidecar, not Bun directly.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Step 2" title="Wire it into featurize.">
        <CodeBlock
          lang="ts"
          title="neuron.config.ts — OpenAI embeddings"
          code={`import OpenAI from "openai"
import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

const openai = new OpenAI()

function defineNeuronConfig<R = unknown>(c: NeuronConfig<R>): NeuronConfig<R> {
  return { headArchitecture: (K, D) => [D, 256, 64, K], ...c }
}

export default defineNeuronConfig({
  taskId: "sentiment",
  featureShape: [1536],   // OpenAI text-embedding-3-small dim

  featurize: async (text: string) => {
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    })
    return Array.from(resp.data[0].embedding)
  },
})`}
        />

        <CodeBlock
          lang="ts"
          title="neuron.config.ts — local sentence-transformers via Python sidecar"
          code={`import { spawn } from "node:child_process"

// Start a tiny Python service that loads BGE and serves embeddings.
// In a separate file: scripts/embed_server.py
//   from sentence_transformers import SentenceTransformer
//   m = SentenceTransformer("BAAI/bge-small-en-v1.5")
//   ...listens on stdin for text, returns embedding JSON

let pythonProc: ReturnType<typeof spawn> | null = null
async function embed(text: string): Promise<number[]> {
  if (!pythonProc) {
    pythonProc = spawn("python", ["scripts/embed_server.py"], {
      stdio: ["pipe", "pipe", "inherit"],
    })
  }
  return new Promise((resolve) => {
    pythonProc!.stdin!.write(text + "\\n")
    pythonProc!.stdout!.once("data", (buf) => {
      resolve(JSON.parse(buf.toString()))
    })
  })
}

export default {
  taskId: "sentiment",
  featureShape: [384],   // BGE-small dim
  featurize: embed,
}`}
        />
      </Section>

      <Section eyebrow="Step 3" title="Load the data.">
        <p>
          Either CSV with text + label columns (use load_csv with featurize automatically called
          row by row), or via collect for one-at-a-time:
        </p>
        <CodeBlock
          lang="ts"
          title="From a CSV"
          code={`// reviews.csv — text,label
//   "this product sucks","negative"
//   "loved it","positive"
//   ...

mcp__neuron__create_task({
  id: "sentiment",
  kind: "classification",
  feature_shape: [1536],
  normalize: false,    // embeddings are already normalised
})

// load_csv calls featurize for each row when raw is the text
// Note: this runs your embedding API once per row at load time
mcp__neuron__load_csv({
  task_id: "sentiment",
  path: "./reviews.csv",
  label_column: "label",
  feature_columns: ["text"],   // featurize(text) → 1536-dim vector
})`}
        />
        <Callout kind="warn" title="Embedding cost at load time">
          Featurize runs once per row during load. If you have 10k reviews, that's 10k API calls.
          Test with a subset first. For OpenAI's text-embedding-3-small, 10k short reviews ≈ $0.10.
        </Callout>
      </Section>

      <Section eyebrow="Step 4" title="Train + evaluate.">
        <CodeBlock
          lang="ts"
          code={`mcp__neuron__auto_train({
  task_id: "sentiment",
  accuracy_target: 0.85,
})

// Typical results for sentiment with OpenAI embeddings:
//   3-class (positive/neutral/negative): ~88-92% val_accuracy
//   2-class (positive/negative): ~93-96% val_accuracy
// 200-2000 samples is enough to be useful.`}
        />
      </Section>

      <Section eyebrow="Step 5" title="Predict.">
        <CodeBlock
          lang="ts"
          code={`// At predict time, run the same featurize first
const vec = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "this product is fantastic",
})

mcp__neuron__predict({
  task_id: "sentiment",
  features: Array.from(vec.data[0].embedding),
})
// → { label: "positive", confidence: 0.94 }`}
        />
      </Section>

      <Section eyebrow="Use cases" title="Where this pays off.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={MessageSquare} title="Sentiment / category classification" accent="cyan">
            Reviews, support tickets, news topics. The classic. Fast to train, easy to deploy.
          </InfoCard>
          <InfoCard icon={Layers} title="Intent detection" accent="purple">
            Chatbot routing — &ldquo;billing&rdquo; vs &ldquo;tech support&rdquo; vs &ldquo;general
            inquiry.&rdquo; ML-Labs makes the per-class confidence callable from any other tool.
          </InfoCard>
          <InfoCard icon={Brain} title="Spam / abuse / quality scoring" accent="green">
            Train on labelled examples; threshold confidence for human review. calibrate makes the
            threshold meaningful.
          </InfoCard>
          <InfoCard icon={Zap} title="Search relevance reranking" accent="orange">
            Embed query + candidates, train ML-Labs to predict relevance. Plug into a retrieval
            pipeline as the final reranker.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="When to bail" title="When the LLM-as-featurizer pattern fails.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Need to <em>generate</em> text — that's not a classifier problem; use Claude / GPT directly</li>
          <li>Need fine-grained reasoning (multi-step inference) — embeddings can't preserve that</li>
          <li>Domain-specific jargon the embedding model doesn't know — fine-tune a sentence transformer first</li>
          <li>Latency-sensitive — every predict is now an embedding API call. Cache results.</li>
        </ul>
        <Callout kind="tip" title="Caching tip">
          Memoise <code>featurize</code> by text hash. Most production NLP datasets have repeated
          inputs; cache hits make predict latency ~0.
        </Callout>
      </Section>
    </div>
  )
}
