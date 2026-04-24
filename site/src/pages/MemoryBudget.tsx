import {
  HardDrive, Activity, AlertTriangle, CheckCircle2, ShieldAlert, Gauge,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Table } from "../components/Table"
import { InfoCard } from "../components/InfoCard"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function MemoryBudget() {
  return (
    <div>
      <PageHeader
        eyebrow="v1.8.0 · Phase 11.7"
        accent="orange"
        title={<>The <span className="gradient-text">memory budget</span>, and why it exists.</>}
        lede="ML-Labs is CPU-only and runs on your laptop. Some workloads will cheerfully allocate 6GB of JS heap and kill your Bun process. The memory budget is a small estimator that looks at a workload before training starts, labels it safe / advisory / heavy / refuse, and talks Claude out of the catastrophic ones."
      />

      <Section eyebrow="Why we built this" title="Fashion-MNIST tried to crash a laptop.">
        <p>
          Before v1.8.0, passing <code className="text-cyan-neon">auto_train</code> a 60,000-row × 784-feature
          dataset (Fashion-MNIST) would happily peak at ~3 GB of JavaScript heap before rs-tensor even got
          involved. On an 8 GB laptop that's a hard crash — Bun OOM-kills itself, the auto_train row is
          left "running" in SQLite, and the dashboard shows a ghost.
        </p>
        <p>
          Claude didn't know this was going to happen. The tools didn't tell it. It obediently ran the
          training anyway. So v1.8.0 added{" "}
          <code className="text-orange-neon">core/memory_budget.ts</code> — a small pure-TypeScript
          estimator that attaches a <code>training_budget</code> field to every tool that loads or
          inspects data, and that auto_train consults before spending a single epoch.
        </p>
        <Callout kind="learn" title="The term &ldquo;peak memory&rdquo;">
          Peak memory is the most RAM your process ever holds at one time during training. It's not the
          same as the size of your CSV on disk or the size of the final weights. The bulk comes from the
          input tensor: for each training sample you keep a row of D floating-point numbers in JavaScript
          memory until rs-tensor copies them, and JavaScript pays ~20 bytes per boxed number plus a
          JSON-encode pass for the MCP pipe. Multiply that by 60,000 samples × 784 pixels and it adds up
          fast.
        </Callout>
      </Section>

      <Section eyebrow="The estimator" title="What it multiplies.">
        <p>
          The estimator is intentionally stupid. No ML required. Given{" "}
          <code className="text-cyan-neon">N</code> samples,{" "}
          <code className="text-cyan-neon">D</code> features per sample,{" "}
          <code className="text-cyan-neon">K</code> classes, and the task kind, it models the peak like this:
        </p>
        <CodeBlock
          lang="ts"
          title="core/memory_budget.ts (simplified)"
          code={`const jsInputBytes   = N * D * 20       // JS number[] — boxed doubles
const jsTargetBytes  = N * K * 20       // one-hot targets
const jsonSendBytes  = N * D * 12       // stringified float floods MCP pipe
const rsTensorBytes  = N * D * 4        // Float32 copy on rs-tensor side

totalBytes = jsInputBytes + jsTargetBytes + jsonSendBytes + rsTensorBytes
peak_mb    = Math.round(totalBytes / 1024 / 1024)`}
        />
        <p>
          The key quantity is <strong>input cells</strong> = <code>N × D</code>. Everything else scales
          from there. The estimator picks a band based on how many millions of cells the workload has.
        </p>
      </Section>

      <Section eyebrow="The four bands" title="safe / advisory / heavy / refuse.">
        <Table
          caption="core/memory_budget.ts thresholds (input_cells = N × D)"
          columns={[
            { key: "level",   header: "Level",      accent: "cyan" },
            { key: "cells",   header: "Input cells",  mono: true },
            { key: "wall",    header: "Wall-clock per wave", mono: true },
            { key: "behaviour", header: "auto_train behaviour" },
            { key: "example", header: "Example dataset" },
          ]}
          rows={[
            {
              level:      <span className="chip-green">safe</span>,
              cells:      "< 5M",
              wall:       "1–60s",
              behaviour:  <>No warning. Runs without prompting.</>,
              example:    "Iris (150×4), Pima (768×8), Wine (178×13)",
            },
            {
              level:      <span className="chip-cyan">advisory</span>,
              cells:      "5M – 20M",
              wall:       "1–4 min",
              behaviour:  <>Runs, but <code>advice[]</code> hints appear in the tool output.</>,
              example:    "Digits (1797×64), small MNIST subsets, Adult Census",
            },
            {
              level:      <span className="chip-orange">heavy</span>,
              cells:      "20M – 60M",
              wall:       "3–15 min",
              behaviour:  <>Runs but yells in the headline: &ldquo;Heavy workload — CPU-only MLP will be slow.&rdquo; Recommends running during a break.</>,
              example:    "MNIST (70k×784 = 54.9M), CIFAR-10 grayscale",
            },
            {
              level:      <span className="chip-pink">refuse</span>,
              cells:      "&ge; 60M",
              wall:       "20 min – 1 hr+",
              behaviour:  <>Blocks auto_train unless <code>force: true</code>. This crashed 8 GB laptops in testing.</>,
              example:    "Fashion-MNIST full (60k×784 = 47M? close) + big CNN inputs",
            },
          ]}
        />
        <Callout kind="note">
          Band boundaries are not physics — they're calibrated from v1.7.1 smoke tests where a 60k × 784
          workload hit ~1.25 GB resident peak and a laptop with 8 GB of RAM promptly died. The estimator
          is a guardrail, not a profiler.
        </Callout>
      </Section>

      <Section eyebrow="Visual" title="Where common datasets land.">
        <AsciiDiagram title="input_cells (N × D) — log axis" accent="orange">
{`           safe        advisory    heavy       refuse
           |            |           |           |
  10³ ──●── 10⁴ ── 10⁵ ── 10⁶ ── 10⁷ ── 10⁸
         ▲           ▲            ▲       ▲        ▲
         iris        wine         digits  MNIST    FashionMNIST+aug
         (600)       (2.3k)       (115k)  (54.9M)  (300M+)

   peak_mb grows roughly linearly with input_cells:
     5M cells  →  ~280 MB peak
    20M cells  →  ~1.1 GB peak
    60M cells  →  ~3.3 GB peak`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="What tools return" title="The training_budget field.">
        <p>
          <code className="text-cyan-neon">load_csv</code>,{" "}
          <code className="text-cyan-neon">inspect_data</code>,{" "}
          <code className="text-cyan-neon">data_audit</code>, and the{" "}
          <code className="text-cyan-neon">auto_train({"{"}dry_run: true{"}"})</code> preview all return
          a <code>training_budget</code> object. It looks like this:
        </p>
        <CodeBlock
          lang="json"
          title="auto_train({ dry_run: true }) — excerpt"
          code={`{
  "ok": true,
  "dry_run": true,
  "task_id": "fashion",
  "would_refuse": false,
  "budget": {
    "N": 60000,
    "D": 784,
    "K": 10,
    "inputCells": 47040000,
    "peak_mb": 1075,
    "wall_clock_estimate_s": [180, 900],
    "level": "heavy",
    "headline": "Heavy workload (47,040,000 input cells, ~1075MB peak, ~3-15min per wave) — CPU-only MLP will be slow",
    "advice": [
      "For iteration speed, subset the dataset: e.g. keep the first 10-20k rows…",
      "Feature dimension D=784 is high. Consider a featurize() callback…",
      "Expect minutes per wave on CPU. Run overnight or during a break…"
    ]
  },
  "seed_configs": [ /* what the first wave will train */ ],
  "sweep_mode": "sequential",
  "max_waves": 2,
  "estimated_wall_clock_s": { "full_training": [360, 1800] }
}`}
        />
      </Section>

      <Section eyebrow="auto_train flags" title="force and dry_run.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={ShieldAlert} title="force: true" accent="orange">
            <p className="mb-2">
              Required to run a <strong>refuse</strong>-level workload. Without it, auto_train returns
              <code> ok: false</code> with the headline and advice and does nothing. The message is
              explicit: &ldquo;pass <code>force: true</code> if your machine has headroom.&rdquo;
            </p>
            <p>
              Think of it as &ldquo;are you sure?&rdquo; in machine-readable form. Claude is trained not
              to pass it unless the user asked for it.
            </p>
          </InfoCard>
          <InfoCard icon={Activity} title="dry_run: true" accent="cyan">
            <p className="mb-2">
              Returns the plan preview <em>without</em> starting training. You get back: the budget
              object, the seed wave's configs, the chosen sweep mode, and total estimated wall-clock.
            </p>
            <p>
              Intended flow: Claude runs <code>dry_run</code> first, presents the preview, asks you to
              confirm, then calls <code>auto_train</code> again without <code>dry_run</code>. Makes the
              cost explicit before you burn 15 minutes.
            </p>
          </InfoCard>
        </div>
        <Callout kind="tip" title="Typical Claude flow">
          &ldquo;Train on Fashion-MNIST&rdquo; → Claude calls{" "}
          <code>auto_train({"{"}dry_run: true{"}"})</code> → sees <code>level: "heavy"</code>, 15 min
          estimate → reports back: &ldquo;This will take 3-15 min per wave, ~1 GB peak memory. Want me
          to proceed?&rdquo; You say yes → Claude calls <code>auto_train</code> without{" "}
          <code>dry_run</code>. No surprises.
        </Callout>
      </Section>

      <Section eyebrow="The advice field" title="What the estimator suggests.">
        <p>
          When you're not at <strong>safe</strong>, the estimator attaches an{" "}
          <code>advice[]</code> array of human-readable tips. The current rules:
        </p>
        <Table
          columns={[
            { key: "trigger", header: "Trigger" },
            { key: "advice",  header: "Advice" },
          ]}
          rows={[
            {
              trigger: <span className="chip-cyan">level &ne; safe</span>,
              advice:  <>&ldquo;Subset the dataset: keep the first 10-20k rows in a new task and load_csv again.&rdquo; Fastest path to iteration.</>,
            },
            {
              trigger: <span className="chip-purple">D &gt; 128</span>,
              advice:  <>&ldquo;Feature dimension is high. Consider a featurize() in neuron.config.ts that downsamples (e.g. 28×28 → 14×14 → D=196, ~4× faster).&rdquo;</>,
            },
            {
              trigger: <span className="chip-orange">heavy or refuse</span>,
              advice:  <>&ldquo;Expect minutes per wave on CPU. Run overnight or during a break. Cancel with cancel_auto_train if stuck.&rdquo;</>,
            },
            {
              trigger: <span className="chip-pink">refuse</span>,
              advice:  <>&ldquo;To override, pass force: true. But this has crashed 8GB machines in testing.&rdquo; Also suggests a two-phase approach (hyperparam search on 20%, full run at the end).</>,
            },
          ]}
        />
      </Section>

      <Section eyebrow="How auto_train uses it" title="Preflight gate.">
        <p>
          Early in the auto_train controller (before the first wave), the estimator runs. If the level
          is <strong>refuse</strong> and you did not pass <code>force: true</code>, the controller
          writes a <code>data_issue</code> verdict with a pointer to dry_run and exits without spending
          an epoch. This is the single mechanism that protects your laptop.
        </p>
        <AsciiDiagram title="auto_train preflight gate" accent="orange">
{`    auto_train({ task_id, force?, dry_run? })
                  │
                  ▼
      estimateTrainingBudget(N, D, K, kind)
                  │
          ┌───────┴────────┐
          │                │
      level ≠ refuse    level = refuse
          │                │
          │         ┌──────┴──────┐
          │         │             │
          │    force: true    force: false (default)
          │         │             │
          ▼         ▼             ▼
      ┌──────────────────────┐  ┌──────────────────────────┐
      │ proceed to wave loop │  │ return {                 │
      └──────────────────────┘  │   ok: false,             │
                                │   headline, advice,      │
                                │   suggestion: "dry_run   │
                                │   first, then force:true"│
                                │ }                        │
                                └──────────────────────────┘`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Working around the guardrail" title="When you really do want the full run.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Gauge} title="Subset first" accent="cyan">
            Create a smaller task (e.g. <code>fashion-20k</code>) with the first 20,000 rows. Do all
            hyperparameter search there. When you've converged on a good config, run one final training
            on the full 60k set with exactly that config — one wave, no sweep.
          </InfoCard>
          <InfoCard icon={CheckCircle2} title="Downsample features" accent="green">
            Implement <code>featurize()</code> in <code>neuron.config.ts</code> to shrink D. A 28×28 →
            14×14 image reduces cells 4×. That's often enough to drop you a band.
          </InfoCard>
          <InfoCard icon={AlertTriangle} title="Pass force: true" accent="orange">
            If you have 16+ GB of RAM and actually want the full run, just pass <code>force: true</code>.
            The warnings are advisory, not load-bearing. Nothing behind this flag is broken — it's
            saying &ldquo;this will be slow and big.&rdquo;
          </InfoCard>
          <InfoCard icon={HardDrive} title="Kill and recover" accent="pink">
            If you start a heavy run and it's not going anywhere, <code>cancel_auto_train</code> works
            cross-process and the reaper (v1.10.0 Bug B fix) ensures no orphan child runs are left
            running in SQLite. You can start over cleanly.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
