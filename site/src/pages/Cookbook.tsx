import { ChefHat, Database, GitBranch, RefreshCw, Layers, Activity, Zap, Trophy, ShieldCheck, Package, FileSearch, MessageSquare } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function Cookbook() {
  return (
    <div>
      <PageHeader
        eyebrow="Paste-able recipes"
        accent="green"
        title={<><span className="gradient-text">Cookbook</span>.</>}
        lede="Common workflows in copy-paste form. No theory — just &ldquo;here's the snippet that does the thing.&rdquo; Each recipe is self-contained; mix and match."
      />

      <Section eyebrow="Setup" title="The five recipes you'll do once.">
        <div className="space-y-6">
          <RecipeCard icon={ChefHat} title="Recipe 1 — Brand new project, train iris in five minutes" accent="cyan">
            <CodeBlock
              lang="bash"
              code={`# 1. Scaffold
ml-labs init iris-demo
cd iris-demo

# 2. Open in Claude Code (you should see Neuron tools in the MCP panel)
# 3. Drop iris.csv into ./examples/ (init copies one in for you)
# 4. In Claude Code:`}
            />
            <CodeBlock
              lang="ts"
              title="In Claude Code chat"
              code={`> /neuron-load iris ./examples/iris.csv
> /neuron-auto iris

# That's it. ~50s wall-clock. Trained, calibrated, registered.

> Predict for sepal_length=5.1, sepal_width=3.5, petal_length=1.4, petal_width=0.2
# → setosa, confidence 0.99`}
            />
          </RecipeCard>

          <RecipeCard icon={Database} title="Recipe 2 — Move to a fresh machine, keep your model" accent="purple">
            <CodeBlock
              lang="bash"
              title="Old machine"
              code={`# Bundle the trained model + adapter
mcp__neuron__export_model({
  task_id: "iris",
  bundle_path: "/tmp/iris-bundle"
})

# Copy to new machine
scp -r /tmp/iris-bundle new-host:/tmp/`}
            />
            <CodeBlock
              lang="bash"
              title="New machine"
              code={`# Install ml-labs
curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash

# Init a project
ml-labs init iris-demo
cd iris-demo

# Import — creates the task + active model
mcp__neuron__import_model({
  bundle_path: "/tmp/iris-bundle"
})

# Predict immediately
mcp__neuron__predict({
  task_id: "iris",
  features: [5.1, 3.5, 1.4, 0.2]
})`}
            />
          </RecipeCard>

          <RecipeCard icon={Trophy} title="Recipe 3 — Resume a cancelled run" accent="orange">
            <CodeBlock
              lang="ts"
              code={`// You cancelled run 7 mid-training. The checkpoint column has its state.
// Resume from where it left off:

mcp__neuron__train({
  task_id: "iris",
  run_id: 7,        // ← reuse the same run row
  // hyperparams not needed — read from runs.hyperparams
})

// Resume picks up at runs[7].checkpoint.epochsDone + 1.
// Loss history continues from where it stopped.`}
            />
            <Callout kind="note">
              Only works if the run was cancelled cleanly (status='cancelled' with checkpoint
              populated). If it crashed without checkpointing, start fresh.
            </Callout>
          </RecipeCard>
        </div>
      </Section>

      <Section eyebrow="Daily" title="Recipes you'll touch often.">
        <div className="space-y-6">
          <RecipeCard icon={GitBranch} title="Recipe 4 — Compare two architectures" accent="purple">
            <CodeBlock
              lang="ts"
              code={`// Train two configs side-by-side, then compare metrics.
const r1 = await mcp__neuron__train({
  task_id: "iris",
  head_arch: [4, 32, 3],
  optimizer: "sgd",
  auto_register: false,
})

const r2 = await mcp__neuron__train({
  task_id: "iris",
  head_arch: [4, 64, 32, 3],
  optimizer: "adamw",
  weight_decay: 1e-4,
  auto_register: false,
})

// Side-by-side diff
mcp__neuron__compare_runs({ run_ids: [r1.run_id, r2.run_id] })

// Promote whichever wins
mcp__neuron__register_model({
  task_id: "iris",
  run_id: r1.accuracy > r2.accuracy ? r1.run_id : r2.run_id,
})`}
            />
          </RecipeCard>

          <RecipeCard icon={Layers} title="Recipe 5 — Cross-validate before promoting" accent="green">
            <CodeBlock
              lang="ts"
              code={`// Run k-fold CV with the config you're considering.
const cv = await mcp__neuron__cv_train({
  task_id: "iris",
  k: 5,
  // training args — same shape as train()
  optimizer: "adamw",
  weight_decay: 1e-4,
})

// cv = {
//   mean_accuracy: 0.96,
//   std_accuracy: 0.03,
//   per_fold_accuracy: [0.97, 0.93, 1.0, 0.97, 0.93],
//   ...
// }

// Trust threshold: std < 0.05
if (cv.std_accuracy < 0.05) {
  // do one final training on full data to promote
} else {
  // investigate variance — collect more samples or stratify differently
}`}
            />
          </RecipeCard>

          <RecipeCard icon={ShieldCheck} title="Recipe 6 — Calibrate confidence" accent="pink">
            <CodeBlock
              lang="ts"
              code={`// After registering a classification model, calibrate it
// so predict.confidence matches reality.
const calib = await mcp__neuron__calibrate({ run_id: 42 })

// calib = {
//   ok: true,
//   temperature: 1.234,
//   ece_before: 0.062,
//   ece_after: 0.018,
// }

// Now predict applies T automatically.
const pred = await mcp__neuron__predict({
  task_id: "iris",
  features: [...],
})
// pred.confidence is now calibrated`}
            />
          </RecipeCard>

          <RecipeCard icon={Activity} title="Recipe 7 — Monitor for drift" accent="orange">
            <CodeBlock
              lang="ts"
              code={`// After your model has been predicting for a while
const drift = await mcp__neuron__drift_check({
  task_id: "iris",
  current_window: 1000,   // last 1000 predictions
})

// drift = {
//   features: [
//     { feature_name: "petal_length", psi: 0.31, verdict: "severe", ... },
//     ...
//   ],
//   verdict_summary: { stable: 2, drifting: 1, severe: 1 }
// }

// If anything is severe → retrain on recent data
const severe = drift.features.filter((f) => f.verdict === "severe")
if (severe.length > 0) {
  // pull latest data + auto_train
}`}
            />
          </RecipeCard>

          <RecipeCard icon={FileSearch} title="Recipe 8 — Find weak data points" accent="cyan">
            <CodeBlock
              lang="ts"
              code={`// What samples is the model unsure or wrong about?
const sug = await mcp__neuron__suggest_samples({
  task_id: "iris",
  n_suggestions: 10,
  confidence_threshold: 0.7,
})

// sug.uncertain_samples = [
//   { sample_id: 42, true_label: "virginica",
//     predicted_label: "versicolor", confidence: 0.52, features: [...] },
//   ...
// ]
// sug.recommendations = [
//   "virginica averages 76% confidence — collect ~20 more borderline examples"
// ]
// sug.per_class = [...]

// Use these to direct labelling effort or auto_collect.`}
            />
          </RecipeCard>
        </div>
      </Section>

      <Section eyebrow="Iteration" title="Sweep, search, retrain.">
        <div className="space-y-6">
          <RecipeCard icon={Zap} title="Recipe 9 — Hyperparameter grid search" accent="cyan">
            <CodeBlock
              lang="ts"
              code={`// Cartesian product across dimensions
mcp__neuron__run_sweep({
  task_id: "iris",
  search: {
    lr: [0.001, 0.005, 0.01],
    epochs: [500, 1000],
    head_arch: [[4, 32, 3], [4, 64, 3]],
    // 3 × 2 × 2 = 12 configs
  },
  wave_size: 3,           // 3 at a time, then next 3
  promote_winner: true,
})`}
            />
            <Callout kind="tip">
              For exploratory search use <code>auto_train</code> instead — TPE will home in faster
              than grid search after the first wave.
            </Callout>
          </RecipeCard>

          <RecipeCard icon={Trophy} title="Recipe 10 — auto_train with manual confirmation for heavy data" accent="orange">
            <CodeBlock
              lang="ts"
              code={`// Heavy datasets should preview first
const preview = await mcp__neuron__auto_train({
  task_id: "fashion-mnist",
  dry_run: true,
})

// preview = {
//   would_refuse: false,
//   budget: { level: "heavy", peak_mb: 1075, ... },
//   estimated_wall_clock_s: { full_training: [360, 1800] },
//   ...
// }

// Show to user, get confirmation
if (preview.budget.level === "refuse") {
  console.log("This would crash. Pass force:true if you really mean it.")
  return
}
if (preview.estimated_wall_clock_s.full_training[1] > 600) {
  // Ask user OK
}

// Then real call
await mcp__neuron__auto_train({
  task_id: "fashion-mnist",
  budget_s: 1800,         // upper end of estimate
})`}
            />
          </RecipeCard>

          <RecipeCard icon={RefreshCw} title="Recipe 11 — Active-learning loop" accent="purple">
            <CodeBlock
              lang="ts"
              title="neuron.config.ts"
              code={`import type { NeuronConfig } from "@neuron/mcp/src/adapter/types"

export default <NeuronConfig>{
  taskId: "support-tickets",
  featureShape: [128],

  // The collect() callback
  collect: async ({ uncertain_samples, recommendations }) => {
    // Send to a labelling queue, wait for human labels
    await postToLabelingQueue(uncertain_samples)
    const labelled = await waitForLabels({ timeoutMs: 600_000 })
    return labelled
  },
}`}
            />
            <CodeBlock
              lang="ts"
              title="auto_train invocation"
              code={`// Now auto_train will iterate
mcp__neuron__auto_train({
  task_id: "support-tickets",
  auto_collect: true,
  max_collect_rounds: 3,
  accuracy_target: 0.85,
})

// Each round: train → suggest_samples → your collect() → insert → retrain.`}
            />
          </RecipeCard>
        </div>
      </Section>

      <Section eyebrow="Operational" title="Recovering, scripting, debugging.">
        <div className="space-y-6">
          <RecipeCard icon={Package} title="Recipe 12 — Recover from a corrupted DB" accent="orange">
            <CodeBlock
              lang="bash"
              code={`# 1. Stop everything
pkill -f neuron-mcp; pkill -f "ml-labs dashboard"

# 2. Backup the broken DB
cp data/neuron.db data/neuron.db.broken

# 3. Try recovery
sqlite3 data/neuron.db ".recover" | sqlite3 data/recovered.db

# 4. If recovered.db is good, swap it in
mv data/recovered.db data/neuron.db

# 5. Restart
ml-labs dashboard
ml-labs status   # confirm tasks are still there`}
            />
            <Callout kind="warn">
              If recovery fails, you can usually still re-import published models from{" "}
              <code>~/.neuron/registry.db</code>. Per-project sample data is gone, but trained
              weights survive in the global registry.
            </Callout>
          </RecipeCard>

          <RecipeCard icon={Activity} title="Recipe 13 — Run benchmarks in CI" accent="green">
            <CodeBlock
              lang="yaml"
              title=".github/workflows/bench.yml"
              code={`name: Benchmarks
on:
  pull_request: {}
  push: { branches: [main] }
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: cd rs-tensor && cargo build --release --bin mcp
      - name: Benchmarks
        env:
          NEURON_PLANNER: rules
          NEURON_SWEEP_MODE: sequential
          NEURON_SEED: "42"
        run: bun run --cwd neuron bench
      # Fails if any bench regressed >2% below baseline.`}
            />
          </RecipeCard>

          <RecipeCard icon={MessageSquare} title="Recipe 14 — Tail the live event stream" accent="cyan">
            <CodeBlock
              lang="bash"
              code={`# Pretty-print every event as it happens
curl -N http://localhost:2626/api/events?stream=1 | \\
  while IFS= read -r line; do
    if [[ "$line" == data:* ]]; then
      echo "${"${line#data: }"}" | jq '.'
    fi
  done

# Filter to one task only
curl -N http://localhost:2626/api/events?stream=1 | \\
  grep --line-buffered '"task_id":"iris"'`}
            />
          </RecipeCard>

          <RecipeCard icon={Database} title="Recipe 15 — Subset a too-big dataset" accent="purple">
            <CodeBlock
              lang="bash"
              code={`# Original is 60k×784 (Fashion-MNIST) — refuse-level
head -1 fashion.csv > fashion-10k.csv
shuf -n 10000 <(tail -n +2 fashion.csv) >> fashion-10k.csv

# Load the subset for fast iteration
mcp__neuron__create_task({
  id: "fashion-10k",
  kind: "classification",
  feature_shape: [784],
})

mcp__neuron__load_csv({
  task_id: "fashion-10k",
  path: "./fashion-10k.csv",
  label_column: "label",
  test_size: 0.2,
})

# Iterate to a good config — fast
mcp__neuron__auto_train({ task_id: "fashion-10k" })

# When you've found a good config, do ONE final training on full data
mcp__neuron__create_task({ id: "fashion", ... })
mcp__neuron__load_csv({ task_id: "fashion", path: "./fashion.csv", ... })
mcp__neuron__train({
  task_id: "fashion",
  // ...the winning config from fashion-10k
})`}
            />
          </RecipeCard>
        </div>
      </Section>

      <Section eyebrow="More to come" title="What's next.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Layers} title="Patterns we'll add" accent="cyan">
            Image classification end-to-end, time-series sliding window, NLP via llm_generate
            embeddings. See the <a href="/image-classification" className="text-cyan-neon hover:underline">Image</a>,{" "}
            <a href="/time-series" className="text-cyan-neon hover:underline">Time Series</a>, and{" "}
            <a href="/nlp-workflows" className="text-cyan-neon hover:underline">NLP</a> pages.
          </InfoCard>
          <InfoCard icon={ChefHat} title="Got a recipe?" accent="green">
            Open a PR with your snippet and a one-paragraph context. Recipes are easy to add — they
            live in <code>site/src/pages/Cookbook.tsx</code>.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}

function RecipeCard({
  icon: Icon,
  title,
  accent,
  children,
}: {
  icon: typeof ChefHat
  title: string
  accent: "cyan" | "purple" | "green" | "orange" | "pink"
  children: React.ReactNode
}) {
  const accentText = {
    cyan: "text-cyan-neon",
    purple: "text-purple-neon",
    green: "text-green-neon",
    orange: "text-orange-neon",
    pink: "text-pink-neon",
  }[accent]
  const accentBorder = {
    cyan: "border-cyan-neon/30",
    purple: "border-purple-neon/30",
    green: "border-green-neon/30",
    orange: "border-orange-neon/30",
    pink: "border-pink-neon/30",
  }[accent]
  return (
    <div className={`lab-panel p-5 border ${accentBorder}`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-5 h-5 ${accentText}`} />
        <h3 className="text-lab-heading font-semibold">{title}</h3>
      </div>
      <div className="text-sm text-lab-text/85">{children}</div>
    </div>
  )
}
