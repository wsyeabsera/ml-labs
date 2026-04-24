import {
  FileText, Layers, Play, LineChart, Trophy, Activity, Database,
  Gauge, Sparkles, ShieldCheck, ArrowRight,
} from "lucide-react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Timeline, type TimelineStep } from "../components/Timeline"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"
import { Table } from "../components/Table"

const steps: TimelineStep[] = [
  {
    step: "01",
    title: "create_task — define the schema",
    body: (
      <>
        Give the task an id, a kind (<code>&ldquo;classification&rdquo;</code> or{" "}
        <code>&ldquo;regression&rdquo;</code>), and a feature shape. Iris has 4 features and 3 classes
        so <code>feature_shape: [4]</code>. Pass <code>normalize: true</code> to Z-score-normalize
        feature columns using stats computed from the training split at train time. Neuron writes one
        row to <code>tasks</code>.
      </>
    ),
    accent: "cyan",
  },
  {
    step: "02",
    title: "load_csv — batch-ingest + split",
    body: (
      <>
        Point at an iris.csv. Neuron streams rows (v1.7.1 memory fix — no giant arrays), label-encodes
        strings into class indices, and bulk-inserts into <code>samples</code> in 500-row batches. If
        you pass <code>test_size: 0.2</code>, 20% of rows land in a <code>test</code> split
        stratified by class; the rest go to <code>train</code>. That split is what <code>train</code>{" "}
        fits on and what <code>evaluate</code>/<code>calibrate</code>/<code>drift_check</code> read.
      </>
    ),
    accent: "purple",
  },
  {
    step: "03",
    title: "preflight / data_audit — catch problems early",
    body: (
      <>
        <code>data_audit</code> is a one-call combo of <code>inspect_data</code> +{" "}
        <code>preflight_check</code>. It returns <code>ready</code> / <code>warning</code> /{" "}
        <code>not_ready</code>, class distribution, imbalance ratio, and a list of warnings (constant
        features, extreme scale differences, mismatched shapes). It also attaches a{" "}
        <code>training_budget</code> — see the{" "}
        <Link to="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</Link>{" "}
        page. auto_train calls this automatically.
      </>
    ),
    accent: "green",
  },
  {
    step: "04",
    title: "suggest_hyperparams — sensible defaults",
    body: (
      <>
        Reads data shape + imbalance + warnings, asks Claude (via MCP Sampling) for a full modern
        config: <code>lr</code>, <code>epochs</code>, <code>head_arch</code>,{" "}
        <code>optimizer</code>, <code>activation</code>, <code>lr_schedule</code>,{" "}
        <code>loss</code>, <code>batch_size</code>, <code>weight_decay</code>,{" "}
        <code>early_stop_patience</code>, <code>label_smoothing</code>, <code>SWA</code>, and{" "}
        <code>class_weights</code>. Falls back to deterministic heuristics if Sampling is unavailable.
        See the <Link to="/training-config" className="text-orange-neon hover:underline">Training Configuration</Link>{" "}
        page for what every knob does.
      </>
    ),
    accent: "orange",
  },
  {
    step: "05",
    title: "train — talk to rs-tensor",
    body: (
      <>
        Neuron creates a <code>runs</code> row, calls <code>init_mlp</code>, streams the flat input
        tensor into <code>train_mlp</code>, and polls progress. <code>run_progress</code> updates
        every ~epoch so a second terminal can watch via <code>get_run_status</code>. On completion
        the weights are serialized back into <code>runs.weights</code> and the held-out val split is
        evaluated to populate <code>val_accuracy</code> (v1.10.0 fix — both MCP and HTTP paths now
        do this).
      </>
    ),
    accent: "pink",
  },
  {
    step: "06",
    title: "evaluate + diagnose — what did we just do",
    body: (
      <>
        <code>evaluate</code> returns the confusion matrix + per-class accuracy.{" "}
        <code>get_training_curves</code> surfaces convergence epoch, still_improving, overfit_gap
        (train − val accuracy). <code>diagnose</code> rolls those into a structured severity
        (<code>minor</code> / <code>moderate</code> / <code>critical</code>) and actionable
        recommendations. Claude-sampled; falls back to rules when Sampling is unavailable.
      </>
    ),
    accent: "cyan",
  },
  {
    step: "07",
    title: "validate — cv_train + calibrate",
    body: (
      <>
        Optional but highly recommended.{" "}
        <Link to="/validation" className="text-green-neon hover:underline">cv_train(k=5)</Link> trains
        five models on rotating folds and reports mean ± std — if std &gt;0.05 don't trust a single
        accuracy. <Link to="/validation" className="text-green-neon hover:underline">calibrate</Link>{" "}
        fits a temperature on held-out logits so softmax confidences match empirical accuracy
        (auto_train does this automatically on the promoted run).
      </>
    ),
    accent: "green",
  },
  {
    step: "08",
    title: "register_model — promote the winner",
    body: (
      <>
        Writes to the <code>models</code> table. From now on, <code>predict</code> for this task
        uses this run. The previous <code>run_id</code> is returned so you know what you're rolling
        forward from. If <code>auto_register: true</code> was passed to <code>train</code> (default),
        this happens automatically; otherwise call it yourself on the run you like best.
      </>
    ),
    accent: "pink",
  },
  {
    step: "09",
    title: "drift_check — monitor over time",
    body: (
      <>
        Not a one-time step. As the model serves <code>predict</code>/<code>batch_predict</code>{" "}
        calls, each call writes to the <code>predictions</code> table.{" "}
        <Link to="/validation" className="text-orange-neon hover:underline">drift_check</Link>{" "}
        compares the training distribution to the recent prediction window via PSI + KS tests and
        flags features as <code>stable</code> / <code>drifting</code> / <code>severe</code>.
      </>
    ),
    accent: "orange",
  },
]

export function TrainingFlow() {
  return (
    <div>
      <PageHeader
        eyebrow="One sample's journey"
        accent="green"
        title={<>From <span className="gradient-text">CSV row</span> to softmax confidence.</>}
        lede="Every training run — whether you call train by hand or let auto_train drive — passes through this pipeline. The post-training steps (calibrate / cv_train / drift_check) are optional but they're what makes the difference between &ldquo;I trained a model&rdquo; and &ldquo;I shipped a model I trust.&rdquo;"
      />

      <DataFlow
        nodes={[
          { label: "iris.csv",   sub: "raw",        accent: "cyan"   },
          { label: "samples",    sub: "sqlite",     accent: "purple" },
          { label: "rs-tensor",  sub: "MLP",        accent: "green"  },
          { label: "weights",    sub: "json blob",  accent: "orange" },
          { label: "calibrate",  sub: "T + ECE",    accent: "pink"   },
          { label: "predict()",  sub: "soft + T",   accent: "cyan"   },
          { label: "predictions", sub: "for drift", accent: "purple" },
        ]}
      />

      <Section title="The nine steps.">
        <Timeline steps={steps} />
      </Section>

      <Section eyebrow="End-to-end script" title="The whole thing in Claude-call form.">
        <p>
          This is what Claude Code actually sends. You can do it all by hand or let{" "}
          <code>auto_train</code> (step 4–8) drive it for you.
        </p>
        <CodeBlock
          lang="typescript"
          title="manual iris run, every step visible"
          code={`// 1. Define the task
await mcp__neuron__create_task({
  id: "iris",
  kind: "classification",
  feature_shape: [4],
  normalize: true,           // Z-score features
})

// 2. Load samples + split
await mcp__neuron__load_csv({
  task_id: "iris",
  path: "./iris.csv",
  label_column: "species",
  test_size: 0.2,            // 20% stratified held-out
  stratify: "auto",
})

// 3. Data audit (all-in-one inspect + preflight)
const audit = await mcp__neuron__data_audit({ task_id: "iris" })
if (audit.verdict === "not_ready") throw new Error(audit.summary)

// 4. Get a starting config
const hp = await mcp__neuron__suggest_hyperparams({
  task_id: "iris",
  data_health: { imbalance_ratio: audit.imbalance_ratio, warnings: audit.warnings },
})

// 5. Train (val_accuracy now populated automatically, v1.10.0)
const run = await mcp__neuron__train({
  task_id: "iris",
  lr: hp.lr,
  epochs: hp.epochs,
  head_arch: hp.head_arch,
  optimizer: hp.optimizer,
  loss: hp.loss,
  auto_register: false,      // we'll promote manually after checking
})

// 6. Check it
await mcp__neuron__get_training_curves({ run_id: run.run_id })
await mcp__neuron__diagnose({ run_id: run.run_id })

// 7. Cross-validate + calibrate
await mcp__neuron__cv_train({ task_id: "iris", k: 5 })        // optional
await mcp__neuron__calibrate({ run_id: run.run_id })          // optional but strongly recommended

// 8. Promote
await mcp__neuron__register_model({ task_id: "iris", run_id: run.run_id })

// 9. Predict
const pred = await mcp__neuron__predict({
  task_id: "iris",
  features: [5.1, 3.5, 1.4, 0.2],
})
// → { label: "setosa", confidence: 0.99, scores: {...} }  (calibrated via T)

// ...later, after the model has been predicting for a while:
await mcp__neuron__drift_check({ task_id: "iris", current_window: 500 })`}
        />
      </Section>

      <Section eyebrow="The one-line version" title="auto_train does all of this.">
        <p>
          Everything above in a single call. auto_train calls{" "}
          <code>data_audit</code> → <code>suggest_hyperparams</code> → wave-loop(train) →{" "}
          <code>diagnose</code> → <code>register_model</code> → <code>calibrate</code>, and returns a
          structured verdict. See the{" "}
          <Link to="/auto-train-deep-dive" className="text-purple-neon hover:underline">Auto-Train Deep Dive</Link>{" "}
          for everything that's happening under the hood.
        </p>
        <CodeBlock
          lang="typescript"
          title="the automated path"
          code={`await mcp__neuron__auto_train({
  task_id: "iris",
  accuracy_target: 0.95,
})
// → completed + promoted + calibrated, 47s wall-clock.`}
        />
      </Section>

      <Section eyebrow="Under the hood" title="What's actually moving around.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={FileText} title="Featurize in neuron.config.ts" accent="cyan">
            Every task has a featurize function that turns raw bytes into a feature vector. For CSV
            tasks the default is identity (the columns go straight through). For images it's a decode
            + resize + normalize. Its sha256 travels with published models, and{" "}
            <code>import_model</code> refuses mismatches unless you pass <code>force: true</code>.
          </InfoCard>
          <InfoCard icon={Layers} title="Streaming + flat tensors" accent="purple">
            v1.7.1 memory fix. The trainer no longer materializes <code>[N][D]</code> nested arrays.
            It streams samples from SQLite with a bun:sqlite <code>.iterate()</code> cursor, fills
            ONE flat <code>number[]</code> of size <code>N × D</code>, and normalizes in place. For
            60k × 784 that's ~380MB instead of ~3GB.
          </InfoCard>
          <InfoCard icon={Play} title="Progress polling via DB" accent="green">
            During training, Neuron calls rs-tensor with a progress callback; each callback writes to
            <code> runs.run_progress</code>. Any other process can read that column and report
            accurate progress — cross-session, no shared memory needed. That's how the dashboard's
            ActiveRunCard stays live.
          </InfoCard>
          <InfoCard icon={LineChart} title="Weights dumped to JSON" accent="orange">
            On completion we iterate named tensors, pull the f32 data, and stick{" "}
            <code>{"{data:[...], shape:[...]}"}</code> in a JSON blob. Human-readable, grep-able,
            diffable. No pickle, no binary protobuf. <code>export_model({"{"}bundle_path{"}"})</code>{" "}
            writes the same thing plus an adapter hash.
          </InfoCard>
          <InfoCard icon={Trophy} title="register_model — one UPDATE" accent="pink">
            The <code>models</code> table holds one row per task: a pointer to a <code>run_id</code>.
            Swapping models is a one-line SQL update. The old run is still there — roll back any time
            by calling <code>register_model</code> on it again.
          </InfoCard>
          <InfoCard icon={Activity} title="predict: lazy weight restore" accent="cyan">
            If you kill the server and restart, the MLP is gone from rs-tensor memory. The first
            predict call catches the missing-MLP error, re-runs <code>init_mlp</code>, overwrites
            weights from the DB, and retries. You never notice.
          </InfoCard>
          <InfoCard icon={Gauge} title="Val accuracy writes from both paths" accent="green">
            v1.10.0 fix. Before, only the HTTP path (trainBg.ts) ran post-training eval on the test
            split. Sub-agent sweeps (tools/train.ts) came back with <code>val_accuracy=null</code>,
            and winner selection fell back to training accuracy — a memoriser could beat an honest
            run. Now both paths call the same <code>evalValAccuracy</code> helper.
          </InfoCard>
          <InfoCard icon={ShieldCheck} title="predictions table" accent="purple">
            Every <code>predict</code>/<code>batch_predict</code> call writes to the{" "}
            <code>predictions</code> table. This is the source of truth for <code>drift_check</code>{" "}
            (compares training distribution vs recent predictions) and for auditing what the model
            did in production.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What's hidden" title="Stuff you don't see in the trace.">
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
                <strong className="text-lab-heading">One-hot targets:</strong> for cross-entropy loss
                the trainer prefers integer targets; for MSE it builds one-hot vectors (class{" "}
                <code>2</code> → <code>[0, 0, 1]</code>). Label smoothing turns this into a soft
                distribution — see the <Link to="/training-config" className="text-purple-neon hover:underline">config reference</Link>.
              </span>
            </li>
            <li className="flex gap-3">
              <Database className="w-4 h-4 mt-0.5 text-green-neon shrink-0" />
              <span>
                <strong className="text-lab-heading">Softmax at inference:</strong> the MLP outputs
                raw logits. Neuron applies softmax and argmax for the label + confidence. If the run
                has a <code>calibration_temperature</code> set, logits are divided by T before
                softmax.
              </span>
            </li>
            <li className="flex gap-3">
              <Database className="w-4 h-4 mt-0.5 text-orange-neon shrink-0" />
              <span>
                <strong className="text-lab-heading">Normalization at predict:</strong> if the run
                was trained with <code>normalize=true</code>, the run's stored mean/std are applied
                to every inference input before the forward pass. You never need to normalize by
                hand.
              </span>
            </li>
          </ul>
        </div>
      </Section>

      <Section eyebrow="Where to go next" title="Related pages.">
        <Table
          compact
          columns={[
            { key: "page", header: "Page" },
            { key: "why",  header: "Why" },
          ]}
          rows={[
            { page: <Link to="/auto-train-deep-dive" className="text-purple-neon hover:underline flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Auto-Train Deep Dive</Link>, why: "Every step of the controller that drives this flow automatically." },
            { page: <Link to="/sweep-modes"         className="text-cyan-neon hover:underline flex items-center gap-1"><ArrowRight className="w-3.5 h-3.5" /> Sweep Modes</Link>,          why: "Sequential vs sub-agents vs adaptive — how multiple configs run." },
            { page: <Link to="/validation"          className="text-green-neon hover:underline flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Validation</Link>,          why: "cv_train, calibrate, drift_check in detail with diagrams." },
            { page: <Link to="/memory-budget"       className="text-orange-neon hover:underline flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> Memory Budget</Link>,           why: "Why some workloads are refused + the force / dry_run flags." },
            { page: <Link to="/training-config"     className="text-orange-neon hover:underline flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Training Configuration</Link>, why: "Every train arg: optimizer, schedule, regularisation, SWA." },
          ]}
        />
      </Section>
    </div>
  )
}
