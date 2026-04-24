import {
  Zap, Brain, Gauge, GitBranch, BookOpen, Target, ArrowRight,
} from "lucide-react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function SweepsAuto() {
  return (
    <div>
      <PageHeader
        eyebrow="Parallel training, adaptive pipelines"
        accent="orange"
        title={<>Sweeps & <span className="gradient-text">auto-train</span>.</>}
        lede="run_sweep trains many configs. auto_train goes further — it picks the configs, runs the sweeps, diagnoses failures, promotes the winner, and calibrates. This page is the orientation. The deep dives are linked at the end of each section."
      />

      <Section eyebrow="The big idea" title="Sweeps vs auto-train.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Zap} title="run_sweep" accent="cyan">
            <p className="mb-2">
              You provide <em>the configs</em>. ML-Labs runs them all and reports which one won.
              Useful when you already know what hyperparameters to try.
            </p>
            <p>
              Two execution strategies: <strong>in-process sequential</strong> (low memory, slow) and{" "}
              <strong>parallel sub-agents</strong> (high memory, ~3× faster on safe workloads). See{" "}
              <Link to="/sweep-modes" className="text-cyan-neon hover:underline">Sweep Modes</Link>.
            </p>
          </InfoCard>
          <InfoCard icon={Brain} title="auto_train" accent="purple">
            <p className="mb-2">
              You state <em>a goal</em> (&ldquo;accuracy ≥ 0.9, budget 2 min&rdquo;). ML-Labs picks
              the configs itself, runs them, measures, refines, and delivers a trained + calibrated
              + registered model — or an actionable verdict if it can't get there.
            </p>
            <p>
              Deterministic TypeScript controller + Claude planners for judgment calls. Deep dive:{" "}
              <Link to="/auto-train-deep-dive" className="text-purple-neon hover:underline">Auto-Train Deep Dive</Link>.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="run_sweep in 30 seconds" title="Known configs, ranked.">
        <CodeBlock
          lang="typescript"
          title="explicit configs"
          code={`run_sweep({
  task_id: "iris",
  configs: [
    { lr: 0.005, epochs: 500 },
    { lr: 0.01,  epochs: 500 },
    { lr: 0.002, epochs: 1000 },
  ],
  concurrency: 3,
  promote_winner: true,
})
// → 3 runs. Highest-accuracy one is auto-registered.`}
        />
        <CodeBlock
          lang="typescript"
          title="grid search"
          code={`run_sweep({
  task_id: "iris",
  search: {
    lr: [0.001, 0.005, 0.01],
    epochs: [500, 1000],
    head_arch: [[4, 32, 3], [4, 64, 3]],
  },
  wave_size: 3,   // run 3 configs, wait, run next 3
})
// → Cartesian product: 3 × 2 × 2 = 12 configs, in 4 waves of 3.`}
        />

        <Callout kind="learn" title="&ldquo;concurrency&rdquo; vs &ldquo;wave_size&rdquo;">
          <strong>concurrency</strong> — how many configs run in <em>parallel</em> at any moment
          (sub-agents mode only). <strong>wave_size</strong> — how many configs in each sequential
          batch before waiting for the batch to finish. You almost always want wave_size on large
          grids; it prevents 20 sub-agents from fighting for CPU at once.
        </Callout>
      </Section>

      <Section eyebrow="auto_train in 30 seconds" title="One tool, the whole pipeline.">
        <CodeBlock
          lang="typescript"
          title="the happy path"
          code={`auto_train({
  task_id: "iris",
  accuracy_target: 0.95,      // optional, default 0.9
  max_waves: 2,               // optional, default 2
  budget_s: 120,              // optional, default 180
  promote: true,              // optional, default true
})

// Under the hood:
//   1. estimateTrainingBudget  (memory guardrail)
//   2. computeDataHealth       (preflight)
//   3. lookupBestPattern       (warm-start from past wins)
//   4. wave loop: plan → sweep → evaluate → diagnose → maybe stop
//   5. (optional) auto_collect rounds
//   6. winner selection (val-aware, overfit-penalised)
//   7. promote + calibrate + (optional) publish
//   8. saveVerdictJson + reap orphans`}
        />

        <AsciiDiagram title="auto_train data flow (high level)" accent="purple">
{`                ┌──────────────────┐
                │  auto_train()    │
                └──────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    memory check    data audit    pattern memory
         │              │              │
         └──────┬───────┴──────┬───────┘
                ▼              ▼
           ┌──────────────────────┐
           │   wave loop          │──── target hit ───────────┐
           │  plan (rules/Claude  │                            │
           │  /TPE/tournament)    │──── budget / max_waves ──┐ │
           │    ↓                 │                          │ │
           │  sweep (sub-agents   │                          │ │
           │  or sequential)      │                          │ │
           │    ↓                 │                          │ │
           │  signals + diagnose  │                          │ │
           └──────────────────────┘                          │ │
                         │                                   │ │
                         └─── loop ──────────────────────────┘ │
                                                               │
                  ┌────────────────────────────────────────────┘
                  ▼
            ┌──────────────────┐
            │ winner selection │  (val-aware + overfit penalty)
            └──────────────────┘
                  │
                  ▼
            ┌──────────────────┐
            │ promote + calib  │  (+ optional publish)
            └──────────────────┘
                  │
                  ▼
            ┌──────────────────┐
            │ structured       │
            │ verdict + reap   │
            └──────────────────┘`}
        </AsciiDiagram>

        <p>
          This is a guided tour. For every node in the diagram, there's a corresponding deeper
          explanation in the <Link to="/auto-train-deep-dive" className="text-purple-neon hover:underline">Auto-Train Deep Dive</Link>.
        </p>
      </Section>

      <Section eyebrow="The flags that matter most" title="Knobs you'll actually use.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Target} title="accuracy_target" accent="cyan">
            How high the best metric needs to go for auto_train to call it a win. Default 0.9. Hit it
            early → stop. Miss it at max_waves → verdict is <code>no_improvement</code> with
            actionable next_steps.
          </InfoCard>
          <InfoCard icon={Gauge} title="budget_s" accent="orange">
            Wall-clock budget in seconds (default 180). Hard-enforced via AbortController at{" "}
            <code>budget_s × 1.1</code>. If the timer fires, <code>budget_exceeded</code> verdict.
          </InfoCard>
          <InfoCard icon={GitBranch} title="max_waves" accent="green">
            Max refinement iterations (default 2). More = more chances to converge, but slower. The
            controller also stops early if signals say it's plateaued.
          </InfoCard>
          <InfoCard icon={Brain} title="tournament" accent="purple">
            Set <code>tournament: true</code> for hard problems. Each wave spawns 3 parallel Claude
            planners with different strategies (aggressive / conservative / exploratory); proposals
            are merged. Costs 3× per wave.
          </InfoCard>
          <InfoCard icon={BookOpen} title="dry_run" accent="pink">
            <code>dry_run: true</code> returns the plan (memory budget, seed configs, ETA) WITHOUT
            training. For heavy workloads, Claude is supposed to dry_run first, confirm with you,
            then auto_train for real.
          </InfoCard>
          <InfoCard icon={Zap} title="force" accent="orange">
            Required to run a <strong>refuse</strong>-level workload. Without it, auto_train refuses
            and explains why. See <Link to="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</Link>.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Watching it run" title="get_auto_status.">
        <p>
          auto_train is fire-and-forget but very chatty. Call <code>get_auto_status(task_id)</code> or{" "}
          <code>get_auto_status(auto_run_id)</code> from any Claude session — even a different
          terminal — to see the controller's decision log. Every stage (preflight, warm_start,
          sweep_wave_N_plan, sweep_wave_N_done, diagnose, winner_selection, promote, calibrate) emits
          a structured entry you can read live.
        </p>
        <CodeBlock
          lang="bash"
          title="from a second Claude session"
          code={`> /neuron-ask get_auto_status for task iris
# → stages with human notes, structured payloads, ETA`}
        />
        <p>
          The dashboard's <code>/auto-runs/:id</code> route renders the same data as a timeline.
        </p>
      </Section>

      <Section eyebrow="What comes back" title="The verdict.">
        <CodeBlock
          lang="json"
          title="auto_train result (success case)"
          code={`{
  "ok": true,
  "auto_run_id": 7,
  "status": "completed",
  "run_id": 42,
  "accuracy": 0.983,
  "waves_used": 1,
  "verdict": "accuracy=0.983 on run 42; 3 configs tried in 1 waves",
  "verdict_json": {
    "status": "completed",
    "winner": {
      "run_id": 42,
      "metric_value": 0.983,
      "metric_name": "accuracy",
      "is_overfit": false,
      "confidence": "high",
      "config": { "lr": 0.005, "epochs": 500, ... }
    },
    "attempted": { "configs_tried": 3, "waves_used": 1, "wall_clock_s": 47 },
    "data_issues": [],
    "next_steps": [],
    "summary": "target reached: accuracy=0.983 on run 42"
  },
  "wall_clock_s": 47
}`}
        />
        <p>
          Every other status — <code>no_improvement</code>, <code>budget_exceeded</code>,{" "}
          <code>cancelled</code>, <code>data_issue</code>, <code>failed</code> — returns the same
          shape, with <code>next_steps</code> spelling out what you can do about it. Full catalog in
          the <Link to="/auto-train-deep-dive" className="text-purple-neon hover:underline">deep dive</Link>.
        </p>
      </Section>

      <Section eyebrow="Where to go next" title="For deeper dives.">
        <div className="grid md:grid-cols-2 gap-4">
          <Link to="/auto-train-deep-dive" className="lab-panel p-5 hover:border-purple-neon/40 transition-colors group">
            <Brain className="w-5 h-5 text-purple-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-purple-neon transition-colors">Auto-Train Deep Dive</div>
            <div className="text-sm text-lab-muted">Every step of the controller. Planner selection, pattern memory, verdicts, reaper.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-purple-neon transition-colors" />
          </Link>
          <Link to="/sweep-modes" className="lab-panel p-5 hover:border-cyan-neon/40 transition-colors group">
            <Zap className="w-5 h-5 text-cyan-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-cyan-neon transition-colors">Sweep Modes</div>
            <div className="text-sm text-lab-muted">Sequential vs sub-agents, adaptive switch, NEURON_SWEEP_MODE.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-cyan-neon transition-colors" />
          </Link>
          <Link to="/memory-budget" className="lab-panel p-5 hover:border-orange-neon/40 transition-colors group">
            <Gauge className="w-5 h-5 text-orange-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-orange-neon transition-colors">Memory Budget</div>
            <div className="text-sm text-lab-muted">Why some workloads are refused + how force / dry_run work.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-orange-neon transition-colors" />
          </Link>
          <Link to="/training-config" className="lab-panel p-5 hover:border-green-neon/40 transition-colors group">
            <BookOpen className="w-5 h-5 text-green-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-green-neon transition-colors">Training Configuration</div>
            <div className="text-sm text-lab-muted">Every train arg: optimizer, schedule, regularisation, SWA.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-green-neon transition-colors" />
          </Link>
        </div>
      </Section>
    </div>
  )
}
