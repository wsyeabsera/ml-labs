import { Wrench, Sigma, Brain, Workflow } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function BuildTrainer() {
  return (
    <div>
      <PageHeader
        eyebrow="80 lines of TS, no dependencies"
        accent="cyan"
        title={<>Build the <span className="gradient-text">trainer</span> yourself.</>}
        lede="To really understand what auto_train is doing, implement an MLP from scratch. This page walks you through a complete training loop in TypeScript — random init, forward pass, backward pass, SGD step, evaluation. By the end you'll know what every line of rs-tensor's train_mlp is computing under the hood."
      />

      <Section eyebrow="The plan" title="An MLP that learns iris.">
        <p>
          We'll build a 2-layer MLP (4 input, 8 hidden, 3 output) that classifies iris flowers. No
          libraries, no rs-tensor. Pure TS. By the end you'll understand:
        </p>
        <ol className="list-disc list-inside space-y-1 text-sm">
          <li>How weights are stored and initialised</li>
          <li>What &ldquo;forward pass&rdquo; actually means in code</li>
          <li>How softmax + cross-entropy compose</li>
          <li>Why backpropagation is just chain rule</li>
          <li>What an SGD step does to weights</li>
          <li>Why the loss curve goes down</li>
        </ol>
      </Section>

      <Section eyebrow="Step 1" title="Random init + storage.">
        <CodeBlock
          lang="ts"
          title="Set up the model"
          code={`// MLP: 4 → 8 → 3
const D = 4   // input dim
const H = 8   // hidden dim
const K = 3   // output dim (3 classes)

// Weights and biases — random uniform in a small range
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min
}

// W1: 4×8 matrix (each input feature has 8 weights)
const W1 = Array.from({ length: D }, () =>
  Array.from({ length: H }, () => rand(-0.5, 0.5)),
)
const b1 = new Array(H).fill(0)

// W2: 8×3 matrix
const W2 = Array.from({ length: H }, () =>
  Array.from({ length: K }, () => rand(-0.5, 0.5)),
)
const b2 = new Array(K).fill(0)`}
        />
        <Callout kind="learn" title="Why small random values">
          If all weights were 0, every neuron would compute the same thing — &ldquo;symmetry breaking&rdquo;
          would never happen, learning would never start. Small random values give each neuron a
          different starting point. ML-Labs uses Xavier or Kaiming init (more sophisticated), but
          uniform random is fine for tiny problems.
        </Callout>
      </Section>

      <Section eyebrow="Step 2" title="Forward pass.">
        <p>
          The forward pass computes <code>output = softmax(W2 · ReLU(W1 · x + b1) + b2)</code>.
          Three operations:
        </p>
        <CodeBlock
          lang="ts"
          title="Forward: input → logits → probabilities"
          code={`function relu(x: number) { return Math.max(0, x) }

function softmax(z: number[]): number[] {
  const max = Math.max(...z)
  const exps = z.map((v) => Math.exp(v - max))   // subtract max for stability
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

function forward(x: number[]) {
  // Layer 1: hidden = ReLU(W1 · x + b1)
  const hidden = new Array(H).fill(0)
  for (let h = 0; h < H; h++) {
    let sum = b1[h]
    for (let d = 0; d < D; d++) sum += W1[d][h] * x[d]
    hidden[h] = relu(sum)
  }

  // Layer 2: logits = W2 · hidden + b2
  const logits = new Array(K).fill(0)
  for (let k = 0; k < K; k++) {
    let sum = b2[k]
    for (let h = 0; h < H; h++) sum += W2[h][k] * hidden[h]
    logits[k] = sum
  }

  // Softmax to get probabilities
  const probs = softmax(logits)
  return { hidden, logits, probs }
}`}
        />
      </Section>

      <Section eyebrow="Step 3" title="Cross-entropy loss.">
        <p>
          Cross-entropy says: how unhappy am I with the probability the model assigned to the correct
          class? Lower is better.
        </p>
        <CodeBlock
          lang="ts"
          code={`function crossEntropy(probs: number[], correctIdx: number): number {
  // -log(probability of the correct class)
  const eps = 1e-12   // numerical stability — avoid log(0)
  return -Math.log(Math.max(eps, probs[correctIdx]))
}

// Sanity check
crossEntropy([0.99, 0.005, 0.005], 0)  // → 0.01 (model is correct + confident: low loss)
crossEntropy([0.005, 0.99, 0.005], 0)  // → 5.30 (model is wrong + confident: high loss)
crossEntropy([0.33, 0.33, 0.34], 0)    // → 1.11 (model unsure: medium loss)`}
        />
      </Section>

      <Section eyebrow="Step 4" title="Backward pass — the gradient.">
        <p>
          The math here looks scary but the key insight is just <em>chain rule</em>: differentiating
          a composition. We want <code>∂loss/∂W1</code> and <code>∂loss/∂W2</code> — how the loss
          changes when we nudge each weight.
        </p>
        <Callout kind="learn" title="The shortcut for softmax + cross-entropy">
          A beautiful identity: when softmax is followed by cross-entropy with target index{" "}
          <code>y</code>, the gradient of loss w.r.t. logits is just{" "}
          <code>probs - one_hot(y)</code>. No exp, no log. Pure subtraction.
        </Callout>
        <CodeBlock
          lang="ts"
          title="Backward: gradients for every weight"
          code={`function backward(
  x: number[],
  forwardOut: { hidden: number[]; logits: number[]; probs: number[] },
  correctIdx: number,
) {
  const { hidden, probs } = forwardOut

  // dL/dlogits = probs - one_hot(correct)
  const dLogits = probs.slice()
  dLogits[correctIdx] -= 1

  // dL/dW2[h][k] = hidden[h] * dLogits[k]
  // dL/db2[k]    = dLogits[k]
  const dW2 = Array.from({ length: H }, (_, h) =>
    Array.from({ length: K }, (_, k) => hidden[h] * dLogits[k]),
  )
  const db2 = dLogits.slice()

  // dL/dhidden[h] = sum over k of W2[h][k] * dLogits[k]
  const dHidden = new Array(H).fill(0)
  for (let h = 0; h < H; h++) {
    for (let k = 0; k < K; k++) dHidden[h] += W2[h][k] * dLogits[k]
  }

  // ReLU's gradient: 1 if hidden[h] > 0 else 0
  const dPreReLU = dHidden.map((g, h) => (hidden[h] > 0 ? g : 0))

  // dL/dW1[d][h] = x[d] * dPreReLU[h]
  // dL/db1[h]    = dPreReLU[h]
  const dW1 = Array.from({ length: D }, (_, d) =>
    Array.from({ length: H }, (_, h) => x[d] * dPreReLU[h]),
  )
  const db1 = dPreReLU.slice()

  return { dW1, db1, dW2, db2 }
}`}
        />
      </Section>

      <Section eyebrow="Step 5" title="The SGD step.">
        <CodeBlock
          lang="ts"
          code={`function step(grads: ReturnType<typeof backward>, lr: number) {
  for (let d = 0; d < D; d++) {
    for (let h = 0; h < H; h++) W1[d][h] -= lr * grads.dW1[d][h]
  }
  for (let h = 0; h < H; h++) b1[h] -= lr * grads.db1[h]

  for (let h = 0; h < H; h++) {
    for (let k = 0; k < K; k++) W2[h][k] -= lr * grads.dW2[h][k]
  }
  for (let k = 0; k < K; k++) b2[k] -= lr * grads.db2[k]
}`}
        />
        <p>
          Each weight steps a tiny bit opposite its gradient. The size of that step is the{" "}
          <strong>learning rate</strong>. Too high, weights overshoot the minimum. Too low,
          progress is glacial.
        </p>
      </Section>

      <Section eyebrow="Step 6" title="The training loop.">
        <CodeBlock
          lang="ts"
          title="Putting it all together"
          code={`// Toy iris-like data — replace with the real iris.csv
const X = [
  [5.1, 3.5, 1.4, 0.2],   // setosa (class 0)
  [4.9, 3.0, 1.4, 0.2],   // setosa
  [7.0, 3.2, 4.7, 1.4],   // versicolor (class 1)
  [6.4, 3.2, 4.5, 1.5],   // versicolor
  [6.3, 3.3, 6.0, 2.5],   // virginica (class 2)
  [5.8, 2.7, 5.1, 1.9],   // virginica
]
const y = [0, 0, 1, 1, 2, 2]

const lr = 0.1
const epochs = 1000

for (let epoch = 0; epoch < epochs; epoch++) {
  let totalLoss = 0
  let correct = 0

  for (let i = 0; i < X.length; i++) {
    const fwd = forward(X[i])
    totalLoss += crossEntropy(fwd.probs, y[i])
    const pred = fwd.probs.indexOf(Math.max(...fwd.probs))
    if (pred === y[i]) correct++

    const grads = backward(X[i], fwd, y[i])
    step(grads, lr)
  }

  if (epoch % 100 === 0 || epoch === epochs - 1) {
    console.log(\`epoch \${epoch}  loss \${(totalLoss / X.length).toFixed(4)}  acc \${correct}/\${X.length}\`)
  }
}

// You'll see something like:
// epoch 0     loss 1.0982  acc 2/6
// epoch 100   loss 0.4521  acc 5/6
// epoch 200   loss 0.1132  acc 6/6
// epoch 1000  loss 0.0024  acc 6/6`}
        />
        <Callout kind="success" title="That's a training loop">
          80 lines of TS, no dependencies. The exact same shape every framework runs — PyTorch,
          TensorFlow, JAX, ML-Labs. The differences are speed (GPU, vectorisation), abstractions
          (autograd computes gradients for you), and quality-of-life (data loaders, optimisers, lr
          schedules).
        </Callout>
      </Section>

      <Section eyebrow="What ML-Labs adds" title="What you don't have to write.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Sigma} title="Real autograd" accent="cyan">
            rs-tensor does the backward-pass math for arbitrary computation graphs, not just MLPs.
            You don't write <code>backward()</code> manually.
          </InfoCard>
          <InfoCard icon={Brain} title="Better optimisers" accent="purple">
            Adam, AdamW. They track per-parameter momentum and adaptive scales — converge much faster
            than vanilla SGD on real problems.
          </InfoCard>
          <InfoCard icon={Workflow} title="Mini-batching" accent="green">
            Train on chunks of N (e.g. 32) samples at a time, not one. Faster per-epoch, and the
            gradient noise actually <em>regularises</em>.
          </InfoCard>
          <InfoCard icon={Wrench} title="LR schedules" accent="orange">
            Cosine decay, linear warmup. lr changes through training without you computing it.
          </InfoCard>
          <InfoCard icon={Sigma} title="Numerical stability" accent="cyan">
            Float32 + careful softmax + log_softmax. The above implementation works for small data;
            production trainers handle edge cases like exploding gradients (with clipping) and
            vanishing activations (with init choices).
          </InfoCard>
          <InfoCard icon={Brain} title="Persistence + observability" accent="pink">
            Save weights, restore lazily, log every epoch, recover from crashes, share across
            processes via SQLite. The hard part of an ML platform isn't the math — it's everything
            around it.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reading material" title="If this lit a curiosity.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <a href="https://karpathy.ai/zero-to-hero.html" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
              Andrej Karpathy's Zero to Hero
            </a>{" "}
            — implements micrograd (a tiny autograd engine) from scratch, then rebuilds the
            transformer. Best free resource on the topic.
          </li>
          <li>
            <a href="https://github.com/karpathy/micrograd" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
              micrograd
            </a>{" "}
            — Karpathy's 200-line autograd. Read the source.
          </li>
          <li>
            <a href="https://web.eecs.umich.edu/~justincj/teaching/eecs498/FA2020/" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
              Justin Johnson's EECS 498
            </a>{" "}
            — math-first computer vision course; the first 4 lectures cover MLPs and backprop in detail.
          </li>
          <li>
            <a href="https://github.com/wsyeabsera/ml-labs/blob/main/rs-tensor/src/" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
              rs-tensor source
            </a>{" "}
            — see how it's actually done in Rust. Same algorithms, more performance work.
          </li>
        </ul>
      </Section>
    </div>
  )
}
