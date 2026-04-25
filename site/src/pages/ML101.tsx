import { BookOpen, TrendingDown, AlertTriangle, Layers, Scale, Brain } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { InfoCard } from "../components/InfoCard"

export function ML101() {
  return (
    <div>
      <PageHeader
        eyebrow="The intuition"
        accent="green"
        title={<>ML <span className="gradient-text">101</span> for ML-Labs users.</>}
        lede="If you've never trained a model before, this page builds up the intuition behind every concept ML-Labs uses. We won't do calculus and we won't pretend everything's a neural network — but you'll come out understanding what auto_train is doing, and why."
      />

      <Section eyebrow="The big picture" title="What is supervised learning?">
        <p>
          Supervised learning is fancy interpolation. You give the computer a bunch of{" "}
          <em>(input, correct answer)</em> pairs, and it learns a <em>function</em> that maps new
          inputs to plausible answers. That's it. Everything else — neural networks, gradient descent,
          regularisation — is mechanics for doing the interpolation well.
        </p>
        <AsciiDiagram title="The learning loop" accent="green">
{`              training data
              ┌───────────────┐
              │ (in1 → out1)  │
              │ (in2 → out2)  │
              │ (in3 → out3)  │
              │ ...           │
              └───────────────┘
                     │
                     ▼
              ┌───────────────┐
              │  fit a model  │  (← this is "training")
              │  parameters   │
              └───────────────┘
                     │
                     ▼
                  model f(x)
                     │
                     ▼
              ┌───────────────┐
              │  predict on   │  (← this is "inference")
              │  new inputs   │
              └───────────────┘`}
        </AsciiDiagram>
        <Callout kind="learn" title="Two flavours of supervised learning">
          <strong>Classification</strong> — output is a category (spam / not spam, cat / dog / bird).
          ML-Labs uses cross-entropy loss + softmax for these.
          <br />
          <strong>Regression</strong> — output is a real number (house price, temperature). ML-Labs
          uses MSE loss + a single linear output for these.
        </Callout>
      </Section>

      <Section eyebrow="Tensors" title="The container for numbers.">
        <p>
          A <strong>tensor</strong> is just an N-dimensional array of numbers. A scalar (5) is 0-d, a
          vector ([1, 2, 3]) is 1-d, a matrix ([[1, 2], [3, 4]]) is 2-d, an image is 3-d (height ×
          width × channels), a batch of images is 4-d.
        </p>
        <CodeBlock
          lang="ts"
          title="What ML-Labs sees"
          code={`// One sample (a tabular row, e.g. iris)
const x = [5.1, 3.5, 1.4, 0.2]   // shape: [4]

// A batch of N samples
const X = [
  [5.1, 3.5, 1.4, 0.2],
  [4.9, 3.0, 1.4, 0.2],
  ...
]                                  // shape: [N, 4]

// One image (28×28 grayscale)
const img = [...]                  // shape: [784] flat, or [28, 28]`}
        />
        <Callout kind="note">
          ML-Labs's rs-tensor stores everything as float32. Tensor names are global — you can think
          of <code>init_mlp("iris")</code> as <code>const iris = createMLP()</code>.
        </Callout>
      </Section>

      <Section eyebrow="Loss functions" title="How wrong is the model?">
        <p>
          A <strong>loss function</strong> takes (predicted, correct) and returns a number. Higher
          number = more wrong. Training is the process of changing the model's parameters to make
          this number as small as possible across all the training samples.
        </p>
        <InfoCard icon={Scale} title="MSE — mean squared error (regression)" accent="cyan">
          <CodeBlock
            lang="ts"
            code={`// For each sample: square the error, then average
loss = sum((predicted - actual)^2) / N

// Worked example, N=3
predicted = [2.5, 4.0, 7.0]
actual    = [3.0, 4.0, 6.5]
errors    = [0.25, 0.0, 0.25]
loss      = 0.5 / 3 = 0.167`}
          />
          <p>
            Squaring punishes big mistakes more than small ones. A prediction off by 5 contributes
            25 to the loss; off by 1 contributes 1.
          </p>
        </InfoCard>

        <InfoCard icon={Layers} title="Cross-entropy (classification)" accent="purple">
          <CodeBlock
            lang="ts"
            code={`// For each sample:
//   take softmax of model outputs to get probabilities
//   take the -log of the probability assigned to the correct class
loss_per_sample = -log(prob_of_correct_class)
loss = mean(loss_per_sample)

// Worked example: 3 classes, correct=class 1
logits      = [2.0, 1.0, 0.5]
softmax     = [0.557, 0.205, 0.124]   // sum = 1
correct_idx = 1
loss        = -log(0.205) = 1.586

// If the model were perfect (prob = 1.0 for correct):
loss        = -log(1.0) = 0   // zero loss`}
          />
          <p>
            Cross-entropy rewards confident-correct predictions and punishes confident-wrong ones
            sharply (because <code>-log</code> shoots toward infinity as probability → 0).
          </p>
        </InfoCard>
      </Section>

      <Section eyebrow="Gradient descent" title="How the model gets better.">
        <p>
          Gradient descent is the method for minimising the loss. It works like this:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>Start with random model parameters (weights).</li>
          <li>Compute the loss on a batch of training samples.</li>
          <li>Compute <em>the gradient</em>: how much would the loss change if I nudged each weight?</li>
          <li>Step each weight in the direction that <em>decreases</em> loss, scaled by a small <strong>learning rate</strong>.</li>
          <li>Repeat.</li>
        </ol>
        <CodeBlock
          lang="ts"
          title="Pseudocode"
          code={`for (let epoch = 0; epoch < epochs; epoch++) {
  const loss = computeLoss(model, batch)
  const grad = computeGradient(loss, model.weights)
  for (const w of model.weights) {
    w -= lr * grad[w]   // step opposite the gradient
  }
}`}
        />
        <Callout kind="learn" title="Why opposite the gradient">
          The gradient points in the direction of <em>steepest increase</em>. We want to go down, so
          we move opposite. Imagine you're on a foggy hill trying to find the lowest point — you
          feel which way the ground tilts and step downhill.
        </Callout>
        <Callout kind="warn" title="Learning rate is the most important hyperparameter">
          Too high → you overshoot the bottom and the loss explodes. Too low → you're stepping with
          tiny shoes and never get there. Most ML-Labs failures with NaN loss are lr-too-high.
        </Callout>
      </Section>

      <Section eyebrow="MLPs" title="What ML-Labs trains.">
        <p>
          A <strong>multi-layer perceptron</strong> is a stack of fully-connected layers separated by
          non-linear activation functions. ML-Labs's <code>head_arch: [4, 32, 3]</code> means: input
          of size 4 → hidden layer of size 32 → output of size 3. Two layers of weights.
        </p>
        <AsciiDiagram title="A 2-layer MLP for iris (4 features → 3 classes)" accent="cyan">
{`     input        layer 1 (32)        layer 2 (3)
   ─────────      ─────────────       ──────────

     x₁ ────────●               ●──── logit_setosa
                ●               ●
     x₂ ────────● ─── activation ●──── logit_versicolor
                ●               ●
     x₃ ────────●               ●──── logit_virginica
                ●
     x₄ ────────●               ●──── softmax → probabilities


   Each ─── is a weight (multiply + sum + bias).
   Each ● is an activation (e.g. ReLU: max(0, x)).
   Total weights here: 4×32 + 32×3 = 224.`}
        </AsciiDiagram>
        <Callout kind="learn" title="Why activations matter">
          Without activations, stacking linear layers collapses to one big linear layer (matrix
          algebra). Activations introduce non-linearity — that's what lets the network learn
          functions more complex than &ldquo;weighted sum.&rdquo;
        </Callout>
      </Section>

      <Section eyebrow="Overfitting" title="When the model memorises.">
        <AsciiDiagram title="Train vs val loss over time" accent="orange">
{`   loss
    │           ◇ overfit start
    │   train_loss
    │     \\___
    │         \\______
    │                \\__________ ← model is memorising
    │
    │   val_loss
    │     \\___
    │         \\___
    │             \\___      ___ ← val starts going UP
    │                 \\____/
    │
    └─────────────────────────────  epoch
           ↑
           sweet spot — stop here

   Training accuracy keeps improving, but the model is learning
   noise specific to the training set. Val accuracy stops following.`}
        </AsciiDiagram>
        <p>
          When train accuracy keeps rising while validation accuracy plateaus or drops, the model is
          overfitting. The flag in <code>get_training_curves</code> is{" "}
          <code>overfit_gap = train_acc - val_acc</code>.
        </p>
        <InfoCard icon={AlertTriangle} title="Five ways to fight overfitting" accent="orange">
          <ol className="list-decimal list-inside space-y-1">
            <li><strong>weight_decay</strong> — penalises big weights. Encourages simple solutions.</li>
            <li><strong>label_smoothing</strong> — softens one-hot targets so the model doesn't get over-confident.</li>
            <li><strong>SWA</strong> — average weights across late epochs, finds flatter minima.</li>
            <li><strong>Smaller arch</strong> — fewer parameters means less capacity to memorise.</li>
            <li><strong>More data</strong> — the actual root fix when possible.</li>
          </ol>
        </InfoCard>
      </Section>

      <Section eyebrow="Underfitting" title="The opposite problem.">
        <p>
          When both train and val accuracy plateau low (e.g. 0.55 on a binary classification —
          barely better than guessing), the model is too simple to capture the pattern. Fix with a
          deeper / wider <code>head_arch</code>, more epochs, or a fancier optimizer (Adam over SGD).
        </p>
        <Callout kind="learn" title="Bias-variance tradeoff">
          Two failure modes: high bias (underfit) and high variance (overfit). Practitioners spend a
          lot of time triangulating the sweet spot. ML-Labs's auto_train + diagnose chase that
          automatically; you'll get there manually if you read the signals.
        </Callout>
      </Section>

      <Section eyebrow="Validation" title="Why we hold out data.">
        <p>
          The number that matters is <strong>val_accuracy</strong> — accuracy on data the model
          hasn't seen during training. <code>load_csv test_size=0.2</code> reserves 20% as a
          held-out test split. Training fits on the 80%; <code>evaluate</code> measures on the 20%.
        </p>
        <Callout kind="warn" title="Without a val split, you're flying blind">
          A model that &ldquo;trains to 100% accuracy&rdquo; on its own training data is meaningless —
          it could be memorising. The val_accuracy on data it didn't see is the only honest signal.
          (This was the v1.10.0 bug fix story — see the{" "}
          <a href="/postmortems" className="text-orange-neon hover:underline">postmortems</a>.)
        </Callout>
      </Section>

      <Section eyebrow="Hyperparameters" title="The knobs you set vs the numbers learned.">
        <p>
          <strong>Parameters</strong> are the weights inside the model — learned by training.{" "}
          <strong>Hyperparameters</strong> are choices you make before training: lr, epochs, head_arch,
          optimizer, etc. There's no gradient for hyperparameters; you tune them by trying values
          (manually, via <code>run_sweep</code>, or via <code>auto_train</code>).
        </p>
        <Callout kind="tip" title="The hyperparameter loop">
          (1) train with current hyperparameters → (2) measure val_accuracy → (3) try different
          hyperparameters → repeat. <code>auto_train</code> automates this with smarts (rules, TPE,
          Claude planner) so you don't have to hand-grid-search.
        </Callout>
      </Section>

      <Section eyebrow="Going deeper" title="Where to learn more.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={BookOpen} title="Build it yourself" accent="cyan">
            See the <a href="/build-trainer" className="text-cyan-neon hover:underline">Build the
            Trainer Yourself</a> page — implement an MLP from scratch in 80 lines of TS, see exactly
            what's happening under the hood.
          </InfoCard>
          <InfoCard icon={Brain} title="Free courses" accent="purple">
            <ul className="list-disc list-inside space-y-0.5 text-sm">
              <li><a href="https://course.fast.ai/" className="text-purple-neon hover:underline" target="_blank" rel="noreferrer">fast.ai's Practical Deep Learning</a> — top-down, code-first.</li>
              <li><a href="https://www.coursera.org/learn/machine-learning" className="text-purple-neon hover:underline" target="_blank" rel="noreferrer">Andrew Ng's Machine Learning</a> — bottom-up, math-first.</li>
              <li><a href="https://karpathy.ai/zero-to-hero.html" className="text-purple-neon hover:underline" target="_blank" rel="noreferrer">Karpathy's Zero to Hero</a> — best free deep-dive on neural nets, written from a TS-friendly angle.</li>
            </ul>
          </InfoCard>
          <InfoCard icon={TrendingDown} title="Glossary" accent="green">
            Every term you've seen here is in the <a href="/glossary" className="text-green-neon hover:underline">Glossary</a>{" "}
            with a one-line summary + a fuller explanation.
          </InfoCard>
          <InfoCard icon={AlertTriangle} title="Anti-patterns" accent="orange">
            See the <a href="/anti-patterns" className="text-orange-neon hover:underline">Anti-patterns</a>{" "}
            page for common mistakes, with the right and wrong way side-by-side.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
