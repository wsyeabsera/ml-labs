import { Image as ImageIcon, Layers, Cpu } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function ImageClassification() {
  return (
    <div>
      <PageHeader
        eyebrow="From folder of pictures to trained classifier"
        accent="purple"
        title={<>Image <span className="gradient-text">classification</span> walkthrough.</>}
        lede="ML-Labs is MLP-only — no convolutions, no fine-tuning a ResNet. But for small images, a plain MLP on flattened pixels is surprisingly capable. This page walks through a full pipeline: directory of labelled images → trained, calibrated classifier — using load_images and a featurize callback."
      />

      <Section eyebrow="What this is and isn't" title="Honest scope.">
        <Callout kind="warn" title="If you need a real CNN, use PyTorch">
          MLPs on flattened pixels work for small images (28×28 to 64×64) with ~10-100 classes. They
          do <em>not</em> work for 224×224 ImageNet-scale problems. ML-Labs is for the small,
          tabular-flavoured end of computer vision — Fashion-MNIST, sklearn's digits, custom small
          datasets where you can't be bothered to set up PyTorch.
        </Callout>
      </Section>

      <Section eyebrow="Step 1" title="Set up the directory.">
        <p>
          <code>load_images</code> walks a directory shaped like:
        </p>
        <CodeBlock
          lang="txt"
          code={`./images/
├── cat/
│   ├── 001.jpg
│   ├── 002.jpg
│   └── ...
├── dog/
│   ├── 001.jpg
│   ├── 002.jpg
│   └── ...
└── bird/
    ├── 001.jpg
    └── ...`}
        />
        <p>Each subdirectory's name becomes the label. Each image inside becomes one sample.</p>
      </Section>

      <Section eyebrow="Step 2" title="Configure the featurize callback.">
        <p>
          By default <code>load_images</code> uses sharp to decode + resize + grayscale + normalise.
          Override via <code>decodeImage</code> if you want different preprocessing.
        </p>
        <CodeBlock
          lang="ts"
          title="neuron.config.ts — 32×32 grayscale baseline"
          code={`import sharp from "sharp"
import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

function defineNeuronConfig<R = unknown>(c: NeuronConfig<R>): NeuronConfig<R> {
  return { headArchitecture: (K, D) => [D, Math.min(128, Math.max(D, 32)), K], ...c }
}

export default defineNeuronConfig({
  taskId: "small-images",
  featureShape: [1024],     // 32 × 32 = 1024 grayscale pixels
  sampleShape: [32, 32],    // documentation only

  decodeImage: async (buffer) => {
    return await sharp(buffer)
      .resize(32, 32, { fit: "cover" })
      .grayscale()
      .raw()
      .toBuffer()
  },

  featurize: async (buf: Buffer) => {
    return Array.from(buf).map((v) => v / 255)
  },
})`}
        />
      </Section>

      <Section eyebrow="Step 3" title="Load and audit.">
        <CodeBlock
          lang="ts"
          code={`mcp__neuron__create_task({
  id: "small-images",
  kind: "classification",
  feature_shape: [1024],
  normalize: true,
})

mcp__neuron__load_images({
  task_id: "small-images",
  dir: "./images",
})

// Then check
mcp__neuron__data_audit({ task_id: "small-images" })
// Watch for:
//   - low N per class (need ≥30 typically)
//   - imbalance — bird:cat:dog 100:200:50 ratio is workable, 10:1000:50 isn't
//   - training_budget level: 32×32 flat is ~1k features. With N=1k it's 1M cells = safe.`}
        />
      </Section>

      <Section eyebrow="Step 4" title="Train.">
        <CodeBlock
          lang="ts"
          code={`mcp__neuron__auto_train({
  task_id: "small-images",
  accuracy_target: 0.85,
})`}
        />
        <Callout kind="tip" title="Expect lower accuracy than tabular">
          A flat MLP on raw pixels won't match a CNN. For Fashion-MNIST, ML-Labs gets ~85-88%
          comfortably; a tuned CNN gets ~93%. If you need that last bit, this isn't the right tool.
        </Callout>
      </Section>

      <Section eyebrow="Step 5" title="Predict.">
        <CodeBlock
          lang="ts"
          code={`// Predict on a new image
import { readFile } from "node:fs/promises"
import sharp from "sharp"

const buf = await readFile("./test-cat.jpg")
const decoded = await sharp(buf).resize(32, 32).grayscale().raw().toBuffer()
const features = Array.from(decoded).map((v) => v / 255)

mcp__neuron__predict({
  task_id: "small-images",
  features,   // length 1024
})
// → { label: "cat", confidence: 0.81, scores: { cat: 0.81, dog: 0.12, bird: 0.07 } }`}
        />
      </Section>

      <Section eyebrow="Variations" title="Things to try when default isn't enough.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Layers} title="Higher resolution" accent="cyan">
            <code>resize(48, 48)</code> → featureShape <code>[2304]</code>. More detail; slower per
            epoch. Sweet spot for ML-Labs is 32–64 px square.
          </InfoCard>
          <InfoCard icon={ImageIcon} title="RGB instead of grayscale" accent="purple">
            Skip <code>.grayscale()</code>; featureShape becomes 32×32×3 = 3072. Triples the input
            cost for color information. Worth it for color-discriminative tasks (e.g. flowers).
          </InfoCard>
          <InfoCard icon={Cpu} title="Edge / HOG features" accent="green">
            Use sharp's <code>.normalise().linear()</code> + Sobel edges as features. Smaller D,
            often better signal for shape-based tasks. Replaces raw pixels in <code>featurize</code>.
          </InfoCard>
          <InfoCard icon={Layers} title="Hand-crafted summaries" accent="orange">
            Ditch pixels entirely. Extract handcrafted features: mean, std, edge density,
            colour histogram bins. Returns a 20-50 dim vector. Smaller D + more interpretable;
            worse for fine-grained discrimination.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="When to bail" title="Signs an MLP isn't enough.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>val accuracy stuck around chance — even with bigger arch / longer training</li>
          <li>need to discriminate fine-grained spatial features (e.g. types of birds)</li>
          <li>need transfer learning from ImageNet-pretrained weights</li>
          <li>images are bigger than ~100×100 pixels and you can't downsample without losing signal</li>
        </ul>
        <Callout kind="learn" title="The next step is PyTorch / fast.ai">
          For real computer vision, use PyTorch (or fast.ai for the friendly path). ML-Labs's
          adapter pattern lets you keep using ML-Labs as the orchestration / serving layer if you
          want — your <code>featurize</code> callback can call out to PyTorch for embedding, then
          ML-Labs trains an MLP on top. See the <a href="/nlp-workflows" className="text-purple-neon hover:underline">NLP page</a> for that pattern (same idea, different domain).
        </Callout>
      </Section>
    </div>
  )
}
