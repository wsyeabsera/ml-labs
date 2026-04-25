import { Image, MessageSquare, Layers, Settings2 } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { Callout } from "../components/Callout"

export function AdapterReference() {
  return (
    <div>
      <PageHeader
        eyebrow="The featurize seam"
        accent="purple"
        title={<>Adapter (<span className="gradient-text">neuron.config.ts</span>) reference.</>}
        lede="Every project has one neuron.config.ts. It declares the task id, feature shape, default hyperparameters, and three optional callbacks: featurize (raw → numbers), collect (active-learning hook), headArchitecture (custom MLP shape). This page covers every field, with worked examples for tabular, image, text, and audio inputs."
      />

      <Section eyebrow="The whole shape" title="What the type looks like.">
        <CodeBlock
          lang="ts"
          title="neuron/src/adapter/types.ts (excerpt)"
          code={`interface NeuronConfig<Raw = unknown> {
  // ── Required ────────────────────────────────────────────────
  taskId: string
  featureShape: number[]

  // ── Storage ─────────────────────────────────────────────────
  dbPath?: string

  // ── Hyperparameter defaults ────────────────────────────────
  defaultHyperparams?: {
    lr?: number
    epochs?: number
  }

  // ── Custom MLP shape ───────────────────────────────────────
  headArchitecture?: (K: number, D: number) => number[]

  // ── Raw-input pipeline ─────────────────────────────────────
  featurize?: (raw: Raw) => Promise<number[]>
  decodeImage?: (buffer: Buffer, meta: ImageMeta) => Promise<Raw>
  sampleShape?: number[]

  // ── Active-learning callback (optional, opt-in) ────────────
  collect?: (input: {
    uncertain_samples: CollectRecommendation[]
    recommendations: string[]
    per_class: Array<{ label: string; count: number; accuracy: number }>
  }) => Promise<CollectedSample[]>
}`}
        />
      </Section>

      <Section eyebrow="Required fields" title="taskId + featureShape.">
        <Table
          columns={[
            { key: "field", header: "Field",        mono: true, accent: "cyan", width: "180px" },
            { key: "type",  header: "Type",         mono: true },
            { key: "what",  header: "What it does" },
          ]}
          rows={[
            {
              field: "taskId",
              type:  "string",
              what:  "Must match the id you pass to create_task. Conventionally kebab-case. Used as the SQLite key.",
            },
            {
              field: "featureShape",
              type:  "number[]",
              what:  "Shape of ONE input vector after featurize. Tabular: [D] (e.g. [4] for iris). Flat image: [784]. The trainer will fail with a shape mismatch if your featurize returns the wrong length.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="defaultHyperparams" title="Project-wide knobs.">
        <p>
          Used by <code>suggest_hyperparams</code>, <code>train</code>, and <code>auto_train</code>{" "}
          when no per-call value is provided. Just lr and epochs are honoured here — for the full
          modern arg surface, see the{" "}
          <a href="/training-config" className="text-cyan-neon hover:underline">Training Config</a>{" "}
          page.
        </p>
        <CodeBlock
          lang="ts"
          title="neuron.config.ts"
          code={`defineNeuronConfig({
  taskId: "iris",
  featureShape: [4],
  defaultHyperparams: {
    lr: 0.005,
    epochs: 500,
  },
})`}
        />
      </Section>

      <Section eyebrow="headArchitecture" title="Custom MLP shape.">
        <p>
          A function from <code>(K, D)</code> → array of layer widths. The default is{" "}
          <code>(K, D) =&gt; [D, max(D, 32), K]</code>. Override for a deeper or differently-shaped
          network — but auto_train and suggest_hyperparams already pick reasonable shapes; only
          touch this if you have a specific reason.
        </p>
        <CodeBlock
          lang="ts"
          code={`defineNeuronConfig({
  taskId: "complex-tabular",
  featureShape: [50],
  headArchitecture: (K, D) => [D, 128, 64, 32, K],
  // → 5-layer MLP: 50 → 128 → 64 → 32 → K
})`}
        />
        <Callout kind="warn">
          The first element must equal D (your featureShape's first dim) and the last must equal K
          (number of classes for classification, or 1 for regression). The trainer asserts this.
        </Callout>
      </Section>

      <Section eyebrow="featurize" title="raw → number[].">
        <p>
          The big one. <code>featurize(raw)</code> takes whatever your samples actually look like —
          a CSV row, an image buffer, a text string, an audio waveform — and returns a fixed-length
          number array of length D. Default for CSV is identity (numbers already come in as numbers,
          so no transformation needed).
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Layers} title="Tabular (default)" accent="cyan">
            <CodeBlock
              lang="ts"
              code={`// No featurize needed.
// load_csv reads numbers from columns directly.
defineNeuronConfig({
  taskId: "iris",
  featureShape: [4],
})`}
            />
          </InfoCard>

          <InfoCard icon={Image} title="Image (28×28 grayscale)" accent="purple">
            <CodeBlock
              lang="ts"
              code={`import sharp from "sharp"

defineNeuronConfig({
  taskId: "fashion",
  featureShape: [784],   // 28×28 flat
  sampleShape: [28, 28],  // for documentation
  featurize: async (raw: Buffer) => {
    const { data } = await sharp(raw)
      .resize(28, 28)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return Array.from(data).map((v) => v / 255)
  },
})`}
            />
          </InfoCard>

          <InfoCard icon={MessageSquare} title="Text (LLM embedding)" accent="green">
            <CodeBlock
              lang="ts"
              code={`// Use llm_generate to get a 'last hidden state' style
// fixed-size vector — or any embedding API.
defineNeuronConfig({
  taskId: "sentiment",
  featureShape: [768],
  featurize: async (text: string) => {
    const emb = await embedText(text)  // your call
    return Array.from(emb)             // length 768
  },
})`}
            />
          </InfoCard>

          <InfoCard icon={Settings2} title="Audio (MFCC)" accent="orange">
            <CodeBlock
              lang="ts"
              code={`// Extract MFCCs (mel-frequency cepstral coefficients)
// from a waveform. Common audio classifier featurization.
defineNeuronConfig({
  taskId: "audio-class",
  featureShape: [40],
  featurize: async (raw: Float32Array) => {
    return computeMfccs(raw, { numCoeffs: 40 })
  },
})`}
            />
          </InfoCard>
        </div>

        <Callout kind="learn" title="When does featurize get called?">
          Only when <code>raw</code> is set on a sample (i.e. when you used <code>collect</code>{" "}
          or <code>load_images</code>). For CSV/JSON data already in numeric form, featurize is
          skipped and the columns become features directly. Effectively: featurize is the seam for
          non-tabular data.
        </Callout>
      </Section>

      <Section eyebrow="decodeImage" title="Image preprocessing override.">
        <p>
          When <code>load_images</code> walks a directory, it decodes each file via{" "}
          <code>sharp</code> by default. If you want a different decoder (different normalisation,
          colour space, augmentation), provide <code>decodeImage(buffer, meta)</code>. Returns the
          raw value passed to <code>featurize</code>.
        </p>
        <CodeBlock
          lang="ts"
          code={`defineNeuronConfig({
  taskId: "color-images",
  featureShape: [3072],   // 32×32×3
  decodeImage: async (buffer, meta) => {
    // RGB at 32×32, no grayscale, no normalisation here
    const { data } = await sharp(buffer)
      .resize(32, 32)
      .raw()
      .toBuffer({ resolveWithObject: true })
    return Array.from(data)  // raw pixel ints, will be passed to featurize
  },
  featurize: async (pixels: number[]) => {
    return pixels.map((v) => v / 255)   // normalise [0, 1]
  },
})`}
        />
      </Section>

      <Section eyebrow="collect" title="Active-learning callback.">
        <p>
          Optional. When you run <code>auto_train({"{"} auto_collect: true {"}"})</code> and the
          target isn't reached, the controller calls <code>collect()</code> with the uncertain
          samples and recommendations. You return new samples to insert; the controller runs one
          more refinement wave with them.
        </p>

        <CodeBlock
          lang="ts"
          title="Synthesise via an LLM"
          code={`defineNeuronConfig({
  taskId: "sentiment",
  featureShape: [768],
  featurize: embed,
  collect: async ({ uncertain_samples, recommendations }) => {
    // Ask an LLM to generate harder examples in the weak classes
    const newSamples = await Promise.all(
      uncertain_samples.map(async (s) => {
        const harderText = await callClaude(\`Generate a paraphrase of: \${s.true_label}\`)
        return {
          label: s.true_label,
          features: await embed(harderText),
          raw: { text: harderText },
        }
      }),
    )
    return newSamples
  },
})`}
        />

        <CodeBlock
          lang="ts"
          title="Pull from a labelling queue"
          code={`defineNeuronConfig({
  taskId: "tickets",
  featureShape: [128],
  collect: async ({ uncertain_samples }) => {
    // Send uncertain samples to a human-in-the-loop queue
    await postToLabelingService(uncertain_samples)
    // Block until labels come back (or a timeout)
    const labelled = await waitForLabels({ timeoutMs: 600_000 })
    return labelled.map((l) => ({
      label: l.label,
      features: l.features,
    }))
  },
})`}
        />

        <Callout kind="note">
          Without a <code>collect</code> callback, <code>auto_collect: true</code> is a no-op —
          ML-Labs won't fabricate data behind your back. You always own the data-acquisition step.
        </Callout>
      </Section>

      <Section eyebrow="The adapter hash" title="Why it matters at import time.">
        <p>
          When you <code>publish_model</code>, ML-Labs SHA-256s the bytes of your{" "}
          <code>neuron.config.ts</code> file and stores it in the bundle's <code>adapter.hash</code>.{" "}
          When another project tries to <code>import_model</code> that bundle, it computes its own
          file's hash and refuses on mismatch.
        </p>
        <Callout kind="warn" title="Why">
          If project A's <code>featurize</code> normalises pixels to [0, 1] and project B's
          normalises to [-1, 1], an imported model will give garbage predictions silently. The hash
          guard makes that fail loudly instead. Pass <code>force: true</code> to override only when
          you're certain the featurize functions match.
        </Callout>
      </Section>

      <Section eyebrow="Worked example: full Fashion-MNIST config" title="">
        <CodeBlock
          lang="ts"
          title="neuron.config.ts"
          code={`import sharp from "sharp"
import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

function defineNeuronConfig<Raw = unknown>(c: NeuronConfig<Raw>): NeuronConfig<Raw> {
  return { headArchitecture: (K, D) => [D, Math.max(D, 32), K], ...c }
}

export default defineNeuronConfig({
  taskId: "fashion-mnist",
  featureShape: [784],
  sampleShape: [28, 28],

  defaultHyperparams: { lr: 0.001, epochs: 800 },

  // Per the v1.8.2 fix: cap hidden so D=784 doesn't get a [784, 784, 10] head
  headArchitecture: (K, D) => [D, Math.min(128, Math.max(D, 32)), K],

  decodeImage: async (buffer) => {
    return await sharp(buffer)
      .resize(28, 28)
      .grayscale()
      .raw()
      .toBuffer()
  },

  featurize: async (buf: Buffer) => Array.from(buf).map((v) => v / 255),

  // Optional: ask an LLM to generate adversarial-style hard examples
  // when auto_collect kicks in.
  collect: async ({ uncertain_samples }) => {
    return synthesizeHardExamples(uncertain_samples)
  },
})`}
        />
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File",                       mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/adapter/types.ts",  what: "Source of truth — NeuronConfig + helper types." },
            { file: "neuron/src/adapter/loader.ts", what: "Resolves and loads neuron.config.ts at runtime. Computes the adapter hash." },
            { file: "cli/templates/neuron.config.ts", what: "What ml-labs init scaffolds. Copy this as a starting point." },
          ]}
        />
        <Callout kind="learn" title="Why we don't validate featurize inline">
          Rich runtime validation of return types is expensive (every sample's array gets type-checked).
          Instead, the trainer asserts shape on the first sample and trusts the rest. So if your
          featurize returns a wrong-length array, you get a clear shape-mismatch error from rs-tensor
          on the first batch — not silent corruption.
        </Callout>
      </Section>
    </div>
  )
}
