import {
  Gauge, Layers, Zap, Scale, Settings2, Brain, Dices, ShieldAlert,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"

export function TrainingConfig() {
  return (
    <div>
      <PageHeader
        eyebrow="Every knob on the train tool"
        accent="orange"
        title={<>Training <span className="gradient-text">configuration</span> reference.</>}
        lede="Over the v1.5→v1.7 arc the train tool picked up every knob a modern MLP trainer needs: optimizer, schedule, batching, regularization, early stopping, SWA, label smoothing. This page walks each one in plain English — what it does, what's sensible, when to touch it."
      />

      <Section eyebrow="The whole thing" title="One call, many arguments.">
        <p>
          You rarely need most of these. <code>suggest_hyperparams</code> picks sensible defaults and
          auto_train's planners set the rest. Read this page when you want to reason about what's
          happening or when a specific run is misbehaving.
        </p>
        <CodeBlock
          lang="ts"
          title="train — full argument shape"
          code={`train({
  task_id:            "iris",
  lr:                 0.005,
  epochs:             500,
  head_arch:          [4, 32, 3],
  class_weights:      "balanced",      // or undefined
  weight_decay:       1e-4,
  optimizer:          "adamw",         // "sgd" | "adam" | "adamw"
  batch_size:         32,              // or omit for full-batch
  lr_schedule:        "cosine",        // "constant" | "cosine" | "linear_warmup"
  warmup_epochs:      10,
  min_lr:             1e-5,
  grad_clip:          1.0,
  loss:               "cross_entropy", // "mse" | "cross_entropy"
  activation:         "relu",          // "tanh" | "relu" | "gelu" | "leaky_relu"
  init:               "auto",          // "auto" | "xavier" | "kaiming"
  seed:               42,
  swa:                true,
  label_smoothing:    0.1,
  early_stop_patience: 50,
  run_id:             undefined,       // pass to resume a cancelled run
  auto_register:      true,
})`}
        />
      </Section>

      <Section eyebrow="Core" title="The three knobs you always touch.">
        <Table
          columns={[
            { key: "arg",     header: "Argument",  mono: true, accent: "cyan", width: "160px" },
            { key: "default", header: "Default",   mono: true },
            { key: "meaning", header: "Meaning" },
            { key: "typical", header: "Typical range" },
          ]}
          rows={[
            {
              arg:     "lr",
              default: "0.005",
              meaning: "Learning rate. How big a step to take down the gradient each update. Too high: loss oscillates or explodes. Too low: training takes forever.",
              typical: "0.001 – 0.1 (SGD); 0.0003 – 0.003 (Adam).",
            },
            {
              arg:     "epochs",
              default: "500",
              meaning: "How many passes over the training set. Loss usually plateaus well before the cap. Pair with early_stop_patience to cut early.",
              typical: "100 – 3000 for tabular; more for tiny data.",
            },
            {
              arg:     "head_arch",
              default: "[D, max(D,32), K]",
              meaning: "Layer sizes. First must equal D (feature dim); last must equal K (class count for classification, 1 for regression). Each intermediate is a hidden layer width.",
              typical: "1-2 hidden layers, width 32-256.",
            },
          ]}
        />
        <Callout kind="learn" title="&ldquo;head_arch&rdquo; — why the weird name">
          In ML parlance, the &ldquo;head&rdquo; is the classifier/regressor on top of some feature
          extractor. Since ML-Labs is feature-in (no CNN/ViT stack), <em>the head is the whole
          model</em>. [D, hidden, K] means &ldquo;an MLP that takes D features, projects through
          `hidden` units, then outputs K scores.&rdquo;
        </Callout>
      </Section>

      <Section eyebrow="Optimizer" title="SGD vs Adam vs AdamW.">
        <InfoCard icon={Gauge} title="optimizer" accent="cyan">
          <p className="mb-3">
            The optimizer decides how to translate gradients into weight updates.
          </p>
          <Table
            compact
            columns={[
              { key: "opt",    header: "Value",  mono: true,  accent: "cyan" },
              { key: "how",    header: "How it works" },
              { key: "pair",   header: "Good pairing" },
            ]}
            rows={[
              {
                opt:  "sgd",
                how:  "Classic. w ← w − lr × grad. Simple, predictable, high-lr friendly.",
                pair: "Large datasets, low weight_decay, constant or cosine lr_schedule.",
              },
              {
                opt:  "adam",
                how:  "Adaptive per-parameter learning rates using first + second moment estimates. Fast convergence on harder problems.",
                pair: "Hard tasks, smaller lr (~1e-3), any schedule.",
              },
              {
                opt:  "adamw",
                how:  "Adam + decoupled weight decay (not mixed into the gradient). The current default-good choice for most transformer / modern-MLP work.",
                pair: "Overfitting-prone problems, non-zero weight_decay.",
              },
            ]}
          />
        </InfoCard>
        <Callout kind="tip">
          <strong>Default heuristic</strong>: SGD for anything that already works. AdamW + smaller lr
          when SGD won't converge or the task has many features / high noise.
        </Callout>
      </Section>

      <Section eyebrow="Learning-rate schedule" title="Not all training epochs want the same lr.">
        <Table
          columns={[
            { key: "schedule", header: "lr_schedule", mono: true, accent: "purple", width: "160px" },
            { key: "what",     header: "What it does" },
            { key: "companion", header: "Companion args" },
          ]}
          rows={[
            {
              schedule:  "constant",
              what:      <>The default. lr never changes. Simple; fine when <code>early_stop_patience</code> takes care of termination.</>,
              companion: "—",
            },
            {
              schedule:  "cosine",
              what:      <>lr starts at <code>lr</code>, decays smoothly to <code>min_lr</code> across all epochs using half a cosine curve. Common and generally good.</>,
              companion: <><code>min_lr</code> (default 0) — the floor the decay approaches.</>,
            },
            {
              schedule:  "linear_warmup",
              what:      <>Linearly ramps lr from 0 → <code>lr</code> over <code>warmup_epochs</code>, then stays constant. Prevents early divergence for high initial lr.</>,
              companion: <><code>warmup_epochs</code> (default 10). Commonly paired with a subsequent cosine schedule in deeper networks; here it stays flat after warmup.</>,
            },
          ]}
        />
      </Section>

      <Section eyebrow="Activation function" title="tanh / relu / gelu / leaky_relu.">
        <Table
          columns={[
            { key: "act",    header: "activation", mono: true, accent: "pink", width: "130px" },
            { key: "shape",  header: "Shape" },
            { key: "use",    header: "When to use it" },
            { key: "init",   header: "Pairs with init" },
          ]}
          rows={[
            {
              act:   "tanh",
              shape: "Smooth, symmetric [-1, 1]. Saturates at extremes (can kill gradients in deep nets).",
              use:   "Default (v1.0 - ). Small tabular MLPs where gradients stay well-behaved.",
              init:  '"xavier" (auto default for tanh)',
            },
            {
              act:   "relu",
              shape: "max(0, x). Fast, non-saturating on positive side, zero gradient on negative.",
              use:   "Modern default for most MLPs. Simpler, trains faster than tanh.",
              init:  '"kaiming" (auto default for relu family)',
            },
            {
              act:   "gelu",
              shape: "x · Φ(x) — smooth version of relu that the transformer people love.",
              use:   "Mid-depth to deep MLPs. Marginally better than relu in many tasks at negligible cost.",
              init:  '"kaiming"',
            },
            {
              act:   "leaky_relu",
              shape: "max(0.01x, x). relu that doesn't fully zero out negative gradients.",
              use:   "Rescue for relu that's killing too many neurons (watch for loss stuck at chance level).",
              init:  '"kaiming"',
            },
          ]}
        />
        <Callout kind="tip">
          <code>init: &ldquo;auto&rdquo;</code> (default) picks Xavier for tanh, Kaiming for relu/gelu/leaky_relu.
          Mismatch activation + init → converges slower or gets stuck. Just trust auto.
        </Callout>
      </Section>

      <Section eyebrow="Loss function" title="mse vs cross_entropy.">
        <InfoCard icon={Scale} title="loss" accent="green">
          <Table
            compact
            columns={[
              { key: "loss", header: "Value",            mono: true, accent: "green" },
              { key: "for",  header: "Use for" },
              { key: "why",  header: "Why" },
            ]}
            rows={[
              {
                loss: "mse",
                for:  "Regression (default for regression tasks).",
                why:  "Mean-squared-error. Matches the geometric intuition of regression.",
              },
              {
                loss: "cross_entropy",
                for:  "Classification — numerically stable, the modern default.",
                why:  "Cross-entropy maximizes the log-likelihood of the correct class. Pairs with softmax. More stable than applying MSE to one-hot targets (which is what the v1.0 path did and is now being phased out).",
              },
            ]}
          />
        </InfoCard>
      </Section>

      <Section eyebrow="Batching" title="batch_size — full-batch vs mini-batch.">
        <InfoCard icon={Layers} title="batch_size" accent="purple">
          <p className="mb-2">
            <strong>Omit</strong> (default) → full-batch: use the entire training set every epoch.
            Stable gradients, no shuffle noise, slowest.
          </p>
          <p className="mb-2">
            <strong>Pass a value</strong> → mini-batch SGD. Each epoch, split training into
            <code> N/batch_size</code> shuffled batches, update weights per batch. Adds helpful
            stochastic noise and scales to larger datasets.
          </p>
          <Table
            compact
            columns={[
              { key: "range",   header: "batch_size", accent: "purple" },
              { key: "meaning", header: "Meaning" },
            ]}
            rows={[
              { range: "(omit)",     meaning: "Full-batch. Good for N<200. Slow but smooth." },
              { range: "8 – 32",     meaning: "Noisy updates, good for small data that needs regularisation." },
              { range: "64 – 128",   meaning: "Typical for 1k+ samples. Balanced." },
              { range: "256+",       meaning: "Approaches full-batch behavior. Needs bigger lr." },
            ]}
          />
        </InfoCard>
      </Section>

      <Section eyebrow="Regularisation" title="weight_decay, grad_clip, label_smoothing.">
        <Table
          columns={[
            { key: "arg",     header: "Argument",    mono: true, accent: "orange", width: "180px" },
            { key: "typical", header: "Typical",      mono: true },
            { key: "what",    header: "What it does" },
            { key: "when",    header: "When to set" },
          ]}
          rows={[
            {
              arg:     "weight_decay",
              typical: "1e-5 – 1e-2",
              what:    "L2 penalty on weights. Shrinks them toward zero. Fights overfitting without reducing capacity.",
              when:    "Train accuracy >> val accuracy. Try 1e-4 first, bump to 1e-3 if still overfitting.",
            },
            {
              arg:     "grad_clip",
              typical: "1.0 – 5.0",
              what:    "Caps the global L2 gradient norm. If gradients exceed the cap, they're scaled down.",
              when:    "Loss explodes or oscillates on high lr. Especially useful with schedule=linear_warmup.",
            },
            {
              arg:     "label_smoothing",
              typical: "0.0 – 0.2",
              what:    "Instead of training against one-hot [0,0,1,0], train against [α/K, α/K, 1-α+α/K, α/K]. Prevents over-confidence in the chosen class.",
              when:    "Classification with >3 classes. Try 0.1. Improves calibration (ECE) at a small accuracy cost.",
            },
            {
              arg:     "early_stop_patience",
              typical: "20 – 100",
              what:    "Stop training when loss hasn't improved for N consecutive epochs. Saves time; doesn't change final model quality.",
              when:    "Almost always. Set patience to ~10% of max epochs.",
            },
            {
              arg:     "class_weights",
              typical: '"balanced"',
              what:    "Oversample minority classes so every class contributes equally to the loss.",
              when:    "Imbalance ratio > 3. Alternative: collect more minority samples via auto_collect.",
            },
          ]}
        />
        <Callout kind="learn" title="Label smoothing math">
          With 10 classes and α=0.1, the hard target [0,0,…,1,…,0] becomes [0.01, 0.01, …, 0.91, …,
          0.01]. The minimum possible cross-entropy on that target is not 0 — it's the entropy of the
          smoothed distribution, ≈ 0.5. So if your loss plateaus at ~0.5 with label_smoothing=0.1 and
          10 classes, that's the floor, not a bug. (This is what confused our Fashion-MNIST bug report
          in v1.10.0 — see the changelog.)
        </Callout>
      </Section>

      <Section eyebrow="SWA" title="Stochastic Weight Averaging.">
        <InfoCard icon={Brain} title="swa" accent="cyan">
          <p className="mb-2">
            Classic trick. Instead of using the final weights at the last epoch, average the weights
            across the last ~25% of epochs. Tends to produce flatter minima (better generalisation)
            with zero extra training cost.
          </p>
          <p className="mb-2">
            Pass <code>swa: true</code> and an optional <code>swa_start_epoch</code> (defaults to ~75%
            of total epochs). The trainer maintains a running average of weights; when training ends,
            it's these averaged weights that get saved.
          </p>
          <Callout kind="tip">
            Turn on for hard classification tasks where val accuracy fluctuates late in training. Leave
            off for quick iteration — it's a polish step.
          </Callout>
        </InfoCard>
      </Section>

      <Section eyebrow="Reproducibility" title="seed.">
        <p>
          <code>seed</code> controls shuffle order (for mini-batch), weight init random stream, and
          any other randomness used during training. Same seed + same data + same hyperparameters =
          bit-identical run. Crucial for benchmarks and debugging.
        </p>
        <CodeBlock
          lang="bash"
          title="env override"
          code={`# All runs in this shell use seed=42 unless explicitly overridden
NEURON_SEED=42 bun run <your thing>

# Or pass per-call:
train({ task_id: "iris", seed: 42 })`}
        />
      </Section>

      <Section eyebrow="Presets" title="Configurations worth memorising.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Dices} title="Minimal tabular baseline" accent="cyan">
            <CodeBlock
              lang="ts"
              code={`train({
  task_id, lr: 0.005, epochs: 500,
  optimizer: "sgd", loss: "cross_entropy",
})`}
            />
            <p>Fast, smooth. If this works, stop — no need to touch anything else.</p>
          </InfoCard>
          <InfoCard icon={Zap} title="Hard problem, bigger MLP" accent="purple">
            <CodeBlock
              lang="ts"
              code={`train({
  task_id, lr: 1e-3, epochs: 1000,
  optimizer: "adamw", weight_decay: 1e-4,
  activation: "relu", loss: "cross_entropy",
  lr_schedule: "cosine", min_lr: 1e-5,
  head_arch: [D, 256, 128, K],
  early_stop_patience: 50,
})`}
            />
            <p>Modern default-good. Use when SGD + defaults doesn't converge.</p>
          </InfoCard>
          <InfoCard icon={ShieldAlert} title="Overfitting-prone" accent="orange">
            <CodeBlock
              lang="ts"
              code={`train({
  task_id, lr: 1e-3, epochs: 1000,
  optimizer: "adamw", weight_decay: 1e-3,
  label_smoothing: 0.1, swa: true,
  class_weights: "balanced",
  early_stop_patience: 30,
})`}
            />
            <p>All the regularisation at once. Sacrifices a couple of accuracy points for generalisation.</p>
          </InfoCard>
          <InfoCard icon={Settings2} title="Reproducibility" accent="green">
            <CodeBlock
              lang="ts"
              code={`train({
  task_id, lr: 0.005, epochs: 500,
  seed: 42,
})`}
            />
            <p>Pair with <code>NEURON_SWEEP_MODE=sequential</code> + <code>NEURON_PLANNER=rules</code> for fully deterministic auto_train.</p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What suggest_hyperparams picks" title="For reference.">
        <p>
          When Claude (or auto_train) needs hyperparameters, it calls <code>suggest_hyperparams</code>.
          That tool returns a full modern config. Here's what a typical output looks like:
        </p>
        <CodeBlock
          lang="json"
          title="suggest_hyperparams({ task_id: &quot;pima&quot; }) — excerpt"
          code={`{
  "lr": 0.001,
  "epochs": 800,
  "head_arch": [8, 32, 16, 2],
  "optimizer": "adamw",
  "activation": "relu",
  "lr_schedule": "cosine",
  "loss": "cross_entropy",
  "batch_size": 32,
  "weight_decay": 0.0001,
  "early_stop_patience": 50,
  "label_smoothing": 0.0,
  "class_weights": "balanced",
  "reasoning": [
    "N=768, moderate size → batch_size 32 is a reasonable balance.",
    "K=2 binary classification → cross_entropy.",
    "Pima has mild class imbalance (~2:1) → class_weights=balanced.",
    "AdamW + cosine is a safe general-purpose starting point."
  ]
}`}
        />
        <Callout kind="note">
          If Claude Sampling isn't available (no API key, offline, etc.), <code>suggest_hyperparams</code>
          falls back to deterministic heuristics based on N / D / K / imbalance. Degraded but usable.
        </Callout>
      </Section>
    </div>
  )
}
