import {
  FileText,
  Layers,
  Play,
  LineChart,
  Trophy,
  Activity,
  Database,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Timeline, type TimelineStep } from "../components/Timeline"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"

const steps: TimelineStep[] = [
  {
    step: "01",
    title: "create_task — define the schema",
    body: (
      <>
        Give the task an id, a kind ("classification"), and the feature shape. Iris has 4 features
        and 3 classes so we say <code>[4]</code>. Neuron writes one row to <code>tasks</code>.
      </>
    ),
    accent: "cyan",
  },
  {
    step: "02",
    title: "load_csv — batch-ingest samples",
    body: (
      <>
        Point at an iris.csv. Neuron reads, label-encodes species into integers, and bulk-inserts
        into <code>samples</code>. By default each row's feature vector is pulled from every
        non-label column. 150 rows in, 150 rows out.
      </>
    ),
    accent: "purple",
  },
  {
    step: "03",
    title: "preflight_check — catch data problems early",
    body: (
      <>
        Verdict is one of <code>ready</code>, <code>warning</code>, <code>not_ready</code>. It
        checks class balance, sample count, feature variance. Iris is textbook so we get ready. A
        dataset with 3 samples returns not_ready before we burn any compute.
      </>
    ),
    accent: "green",
  },
  {
    step: "04",
    title: "suggest_hyperparams — sensible defaults",
    body: (
      <>
        Neuron reads the task shape and class count and returns a seed config:{" "}
        <code>lr=0.05</code>, <code>epochs=800</code>, <code>head_arch=[4, 32, 3]</code>. Backed by
        Sampling so it's not just a lookup table.
      </>
    ),
    accent: "orange",
  },
  {
    step: "05",
    title: "train — talk to rs-tensor",
    body: (
      <>
        Neuron calls <code>init_mlp</code>, streams samples into <code>train_mlp</code>, and polls
        progress. The run's <code>run_progress</code> column updates every ~epoch so a second
        terminal can watch via <code>get_run_status</code>. On completion the trained weights are
        serialized back into <code>runs.weights</code>.
      </>
    ),
    accent: "pink",
  },
  {
    step: "06",
    title: "evaluate + diagnose — what did we just do",
    body: (
      <>
        Evaluate returns the confusion matrix and per-class accuracy. Diagnose turns that into
        English: severity + bullet-pointed recommendations. If accuracy is great, severity is{" "}
        <code>minor</code>. If one class is collapsing, severity is <code>critical</code>.
      </>
    ),
    accent: "cyan",
  },
  {
    step: "07",
    title: "register_model — promote the winner",
    body: (
      <>
        Writes to the <code>models</code> table. From now on, <code>predict</code> for this task
        uses this run. The previous run_id is returned so you know what you're rolling forward
        from.
      </>
    ),
    accent: "green",
  },
]

export function TrainingFlow() {
  return (
    <div>
      <PageHeader
        eyebrow="One sample's journey"
        accent="green"
        title={<>From <span className="gradient-text">CSV row</span> to softmax confidence.</>}
        lede="Every training run — whether you call train by hand or let auto_train drive — passes through this same seven-step pipeline. Learn it once."
      />

      <DataFlow
        nodes={[
          { label: "iris.csv", sub: "raw", accent: "cyan" },
          { label: "samples", sub: "sqlite", accent: "purple" },
          { label: "rs-tensor", sub: "MLP", accent: "green" },
          { label: "weights", sub: "json blob", accent: "orange" },
          { label: "predict()", sub: "softmax", accent: "pink" },
        ]}
      />

      <Section title="The seven steps.">
        <Timeline steps={steps} />
      </Section>

      <Section eyebrow="End-to-end script" title="The whole thing in Claude-call form.">
        <p>
          This is what Claude Code actually sends. Each line is one MCP tool call. The{" "}
          <code>/neuron-train</code> slash command wraps steps 3–5.
        </p>
        <CodeBlock
          lang="typescript"
          title="one iris run"
          code={`// 1. Define the task
await mcp__neuron__create_task({ id: "iris", kind: "classification", feature_shape: [4] })

// 2. Load samples
await mcp__neuron__load_csv({
  task_id: "iris",
  path: "./iris.csv",
  label_column: "species",
  feature_columns: ["sepal_length", "sepal_width", "petal_length", "petal_width"],
})

// 3. Validate we have enough data
const pre = await mcp__neuron__preflight_check({ task_id: "iris" })
if (pre.verdict === "not_ready") throw new Error(pre.reason)

// 4. Get a starting point
const hp = await mcp__neuron__suggest_hyperparams({ task_id: "iris" })

// 5. Train
const run = await mcp__neuron__train({
  task_id: "iris",
  lr: hp.lr,
  epochs: hp.epochs,
  head_arch: hp.head_arch,
  auto_register: true,
})

// 6. Look at it
await mcp__neuron__evaluate({ run_id: run.run_id })
await mcp__neuron__diagnose({ run_id: run.run_id })

// 7. Predict
const pred = await mcp__neuron__predict({
  task_id: "iris",
  features: [5.1, 3.5, 1.4, 0.2],
})
// => { label: "setosa", confidence: 0.99, probs: { setosa: 0.99, ... } }`}
        />
      </Section>

      <Section eyebrow="Under the hood" title="What's actually moving around.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={FileText} title="Featurize in neuron.config.ts" accent="cyan">
            Every task has a featurize function that turns raw bytes into a feature vector. For CSV
            tasks the default is identity. For images it's a decode + resize + normalize. Its sha256
            travels with published models.
          </InfoCard>
          <InfoCard icon={Layers} title="MLP in rs-tensor memory" accent="purple">
            <code>init_mlp</code> allocates weights and biases as random tensors and stores the
            whole MLP under a name like <code>iris</code>. <code>train_mlp</code> runs forward,
            backward, SGD step; it updates those tensors in place.
          </InfoCard>
          <InfoCard icon={Play} title="Progress polling" accent="green">
            During training, Neuron calls into rs-tensor with a progress callback; each callback
            writes to <code>runs.run_progress</code>. Any other process can read that column and
            report accurate progress — cross-session, no shared memory needed.
          </InfoCard>
          <InfoCard icon={LineChart} title="Weights dumped to JSON" accent="orange">
            On completion we iterate named tensors, pull the f32 data, and stick{" "}
            <code>{"{data:[...], shape:[...]}"}</code> in a JSON blob. Human-readable, grep-able,
            diffable. No proprietary format, no pickle.
          </InfoCard>
          <InfoCard icon={Trophy} title="register_model — models table" accent="pink">
            One row per task. It's just a pointer to a run_id. Swapping models is an UPDATE. The
            old run is still there if you want to roll back.
          </InfoCard>
          <InfoCard icon={Activity} title="predict: lazy weight restore" accent="cyan">
            If you kill the server and restart, the MLP is gone from rs-tensor memory. The first
            predict call catches the missing-MLP error, re-runs <code>init_mlp</code>, overwrites
            weights from the DB, and retries. You never notice.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What you won't see in the trace" title="Things the flow hides for you.">
        <div className="lab-panel p-6">
          <ul className="space-y-3 text-sm text-lab-text/85">
            <li className="flex gap-3">
              <Database className="w-4 h-4 mt-0.5 text-cyan-neon shrink-0" />
              <span>
                <strong className="text-lab-heading">Label encoding:</strong> string labels become
                integer class indices behind the scenes. The class-to-index map lives on the task.
              </span>
            </li>
            <li className="flex gap-3">
              <Database className="w-4 h-4 mt-0.5 text-purple-neon shrink-0" />
              <span>
                <strong className="text-lab-heading">One-hot targets:</strong> MSE loss needs dense
                targets, so class index <code>2</code> becomes <code>[0, 0, 1]</code> before it
                hits <code>train_mlp</code>.
              </span>
            </li>
            <li className="flex gap-3">
              <Database className="w-4 h-4 mt-0.5 text-green-neon shrink-0" />
              <span>
                <strong className="text-lab-heading">Softmax at inference:</strong> the MLP outputs
                raw logits. Neuron applies softmax and argmax to produce a label + confidence.
              </span>
            </li>
          </ul>
        </div>
      </Section>
    </div>
  )
}
