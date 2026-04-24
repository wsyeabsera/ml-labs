import { Zap, Cog, Beaker, AlertTriangle } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function SweepModes() {
  return (
    <div>
      <PageHeader
        eyebrow="Two execution strategies, one decision tree"
        accent="cyan"
        title={<>How sweeps <span className="gradient-text">actually run</span>.</>}
        lede="A sweep is N hyperparameter configs to train. You can run them sequentially in the same process or in parallel as Claude sub-agents. Each has a reason to exist. Picking between them is something the controller does adaptively."
      />

      <Section eyebrow="The two modes" title="In-process sequential vs parallel sub-agents.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Cog} title="In-process sequential" accent="green">
            <p className="mb-2">
              All configs train in the <em>same</em> Bun process, one at a time, via{" "}
              <code>startTrainBackground</code>.
            </p>
            <p className="mb-2">
              <strong>Lowest memory overhead</strong> — only one training worth of tensors allocated at
              a time. No sub-agent boot, no MCP hops, no extra rs-tensor child processes.
            </p>
            <p>
              <strong>Fully deterministic</strong> — benchmarks use this mode exclusively. File:{" "}
              <code>core/sweep/sequential.ts</code>.
            </p>
          </InfoCard>
          <InfoCard icon={Zap} title="Parallel sub-agents" accent="purple">
            <p className="mb-2">
              N Claude Agent SDK sub-agents spawn in parallel (default: 3). Each one opens a fresh MCP
              connection to Neuron and calls <code>train</code> with its assigned config.
            </p>
            <p className="mb-2">
              <strong>Real parallelism</strong> — wall-clock ≈ one run, not N runs. Big win on
              small/medium datasets.
            </p>
            <p>
              <strong>High memory overhead</strong> — each sub-agent adds ~300 MB Bun RSS plus its own
              rs-tensor connection. File: <code>core/sweep/orchestrator.ts</code>.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="How they compare" title="Side by side.">
        <Table
          columns={[
            { key: "axis",       header: "Axis",           accent: "cyan" },
            { key: "sequential", header: "Sequential" },
            { key: "subagents",  header: "Sub-agents" },
          ]}
          rows={[
            { axis: "Wall-clock for N=3",   sequential: "≈ 3× one run",                       subagents: "≈ 1× one run (true parallelism)" },
            { axis: "Peak memory",          sequential: "One run's worth",                    subagents: "Host + (N × sub-agent RSS ~300MB each)" },
            { axis: "CPU contention",       sequential: "None — serial",                      subagents: "High — N trainings fight for cores" },
            { axis: "Sub-agent boot time",  sequential: "Zero",                               subagents: "~1-2s per config (Agent SDK start + MCP handshake)" },
            { axis: "MCP serialization",    sequential: "None (in-process)",                  subagents: "Stdio JSON-RPC per train call" },
            { axis: "Cancellation",         sequential: "AbortSignal, instant",               subagents: "AbortController on each sub-agent — soft kill" },
            { axis: "Best for",             sequential: "Heavy workloads, benchmarks, CI",    subagents: "Small-to-medium data, fast iteration" },
            { axis: "File",                 sequential: <code>core/sweep/sequential.ts</code>, subagents: <code>core/sweep/orchestrator.ts</code> },
          ]}
        />
      </Section>

      <Section eyebrow="How auto_train picks" title="Adaptive by memory budget.">
        <p>
          The controller does not ask you which mode to use. It measures the workload (see{" "}
          <a href="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</a>) and
          picks adaptively.
        </p>

        <AsciiDiagram title="Adaptive sweep-mode selection (v1.8.1)" accent="cyan">
{`   estimateTrainingBudget(N, D, K, kind).level
                    │
        ┌───────────┼───────────┐
        │           │           │
      safe       advisory     heavy
        │           │           │
        ▼           ▼           ▼
     ┌─────────────────┐  ┌─────────────────┐
     │ sub-agents      │  │ sequential      │
     │ (parallel)      │  │ (in-process)    │
     └─────────────────┘  └─────────────────┘

   refuse level: blocked before picking a mode
   (auto_train returns early without force:true)

   Override via env:
     NEURON_SWEEP_MODE=sub_agents   →  always parallel
     NEURON_SWEEP_MODE=sequential   →  always in-process`}
        </AsciiDiagram>

        <Table
          caption="Decision matrix"
          columns={[
            { key: "budget", header: "Budget level",   accent: "orange" },
            { key: "env",    header: "NEURON_SWEEP_MODE" },
            { key: "mode",   header: "Mode used" },
            { key: "reason", header: "Why" },
          ]}
          rows={[
            { budget: <span className="chip-green">safe</span>,      env: "(unset)",      mode: <strong>sub-agents</strong>, reason: "Plenty of RAM; parallelism is a 3× wall-clock win." },
            { budget: <span className="chip-cyan">advisory</span>,   env: "(unset)",      mode: <strong>sub-agents</strong>, reason: "Still fits in memory; worth the parallelism." },
            { budget: <span className="chip-orange">heavy</span>,    env: "(unset)",      mode: <strong>sequential</strong>, reason: "3× sub-agents each holding ~1GB would OOM. Predictable memory &gt; speed." },
            { budget: <span className="chip-pink">refuse</span>,     env: "(unset)",      mode: <em>blocked</em>,          reason: "Never reaches sweep — gated at preflight unless force:true." },
            { budget: "any",                                         env: "sub_agents",   mode: <strong>sub-agents</strong>, reason: "Explicit user override." },
            { budget: "any",                                         env: "sequential",   mode: <strong>sequential</strong>, reason: "Explicit user override (used by benchmarks)." },
          ]}
        />
      </Section>

      <Section eyebrow="A worked example" title="3 configs on iris vs 3 configs on Fashion-MNIST.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Beaker} title="iris — 150×4" accent="green">
            <p className="mb-2">
              <code>inputCells = 600</code>, well under 5M → <strong>safe</strong>. Mode:{" "}
              <strong>sub-agents</strong>. 3 configs train in ~5s wall-clock (one config-time).
              Peak memory ~400MB host + 3×300MB sub-agents = ~1.3GB RSS briefly during the wave.
            </p>
          </InfoCard>
          <InfoCard icon={AlertTriangle} title="Fashion-MNIST — 60k×784" accent="orange">
            <p className="mb-2">
              <code>inputCells = 47M</code>, in the 20M-60M band → <strong>heavy</strong>. Mode:{" "}
              <strong>sequential</strong>. 3 configs train one at a time, ~9min wall-clock total. Peak
              memory ~1.2GB — single training budget, predictable. Was ~3.6GB crashed under old
              sub-agent default.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The env var" title="When to override explicitly.">
        <Table
          columns={[
            { key: "env",     header: "NEURON_SWEEP_MODE", mono: true },
            { key: "meaning", header: "Meaning" },
            { key: "when",    header: "Use this when…" },
          ]}
          rows={[
            { env: "(unset)",     meaning: "Adaptive — by memory budget.",                            when: "Default. Trust the controller." },
            { env: "sub_agents",  meaning: "Force parallel, even on heavy workloads.",                when: "You have 32GB+ RAM and want the wall-clock win on a big dataset." },
            { env: "sequential",  meaning: "Force in-process, even on small workloads.",              when: "Reproducibility, benchmarks, debugging an auto_run without MCP hops." },
            { env: "in_process",  meaning: "Alias for sequential.",                                   when: "Reads more naturally in some contexts." },
          ]}
        />

        <CodeBlock
          lang="bash"
          title="shell — pin sequential for benchmarks"
          code={`NEURON_PLANNER=rules \\
NEURON_SWEEP_MODE=sequential \\
NEURON_SEED=42 \\
bun run test/bench/run.ts`}
        />
      </Section>

      <Section eyebrow="run_sweep manually" title="Same modes apply.">
        <p>
          The <code>run_sweep</code> MCP tool can also be called directly by Claude outside of
          auto_train. It too respects <code>NEURON_SWEEP_MODE</code>. Unlike auto_train, it does{" "}
          <em>not</em> compute the budget automatically, so on very large data you're responsible for
          picking the mode.
        </p>
        <CodeBlock
          lang="ts"
          title="run_sweep signatures"
          code={`// Explicit configs
run_sweep({
  task_id: "iris",
  configs: [
    { lr: 0.005, epochs: 500 },
    { lr: 0.01,  epochs: 500 },
    { lr: 0.002, epochs: 1000 },
  ],
  concurrency: 3,
  promote_winner: true,
})

// Grid search
run_sweep({
  task_id: "iris",
  search: {
    lr: [0.001, 0.005, 0.01],
    epochs: [500, 1000],
  },
  wave_size: 3,    // run 3 at a time, then next 3
})`}
        />
      </Section>

      <Section eyebrow="History" title="Why sequential became the default in v1.7.0.">
        <p>
          Before v1.7.0, sub-agents were the default. A user tried to train on full Fashion-MNIST. 3
          sub-agents × ~1.2GB each + host process = OOM-kill on an 8GB laptop. v1.7.0 flipped the
          default to sequential; v1.8.1 added the adaptive switch so safe workloads still get
          parallelism.
        </p>
        <Callout kind="note" title="Why not always parallel?">
          Parallelism is cheap only when each worker fits comfortably in memory. MLP training is
          memory-bound (giant input tensors copy multiple times through the MCP pipe), so 3 parallel
          workers very easily become 3× the peak memory of one. The controller picks parallelism only
          when we've estimated it's safe.
        </Callout>
      </Section>

      <Section eyebrow="Reference" title="Files that matter.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "38%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "core/sweep/orchestrator.ts",     what: "runSweep() — parallel Agent SDK sub-agents, prompt per config, result aggregation." },
            { file: "core/sweep/sequential.ts",       what: "runSweepSequential() — in-process loop over startTrainBackground, polls the runs table." },
            { file: "core/sweep/configs.ts",          what: "SweepConfig shape + expandGrid helper for grid search." },
            { file: "core/auto/controller.ts (l.272)", what: "sweepMode selection logic — the adaptive switch." },
            { file: "core/memory_budget.ts",          what: "estimateTrainingBudget — produces the band used by the switch." },
          ]}
        />
      </Section>
    </div>
  )
}
