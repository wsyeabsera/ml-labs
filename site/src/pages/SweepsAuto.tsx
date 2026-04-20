import { Zap, Brain, GitBranch, Gauge, Layers, ListTree, Radar, Workflow } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Timeline } from "../components/Timeline"

export function SweepsAuto() {
  return (
    <div>
      <PageHeader
        eyebrow="Parallel training, adaptive pipelines"
        accent="orange"
        title={<>Ship <span className="gradient-text">three configs</span> in the time of one.</>}
        lede="run_sweep fans out configs across Agent SDK sub-agents. auto_train wraps the whole pipeline in a coordinator that can actually decide what to do next."
      />

      <Section eyebrow="run_sweep" title="Parallel grid search, the short version.">
        <p>
          Give it a list of configs (or a <code>search</code> object that expands into a grid).
          Neuron spawns one Claude sub-agent per config. Each sub-agent has exactly one tool on
          its allowlist — <code>mcp__neuron__train</code> — and one job: run that config, report
          back JSON.
        </p>

        <CodeBlock
          lang="typescript"
          title="sweep a small grid"
          code={`await mcp__neuron__run_sweep({
  task_id: "iris",
  search: {
    lr: [0.01, 0.05, 0.1],
    epochs: [500, 1000],
  },
  concurrency: 3,
  promote_winner: true,
})
// → 6 runs. Wall clock ≈ time of the slowest single run.
// → The winning run_id is auto-promoted to the active model.`}
        />

        <div className="grid md:grid-cols-3 gap-4 mt-6">
          <InfoCard icon={Zap} title="Agent SDK fan-out" accent="cyan">
            Each sub-agent boots its own neuron-mcp subprocess. They share the same SQLite DB via
            WAL, so runs show up live in <code>list_runs</code>.
          </InfoCard>
          <InfoCard icon={Gauge} title="Wave mode" accent="purple">
            Pass <code>wave_size=4</code> to run configs in sequential chunks of 4. Useful when
            memory or an external API limits how many can go at once.
          </InfoCard>
          <InfoCard icon={GitBranch} title="Winner auto-promote" accent="green">
            <code>promote_winner: true</code> calls <code>register_model</code> on the highest
            accuracy run before returning. Safety-net off by default.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="auto_train" title="Now let Claude drive.">
        <p>
          <code>auto_train</code> is the headline tool. It spawns one coordinator sub-agent with a
          curated 11-tool allowlist and a state-machine prompt. The coordinator decides how many
          waves to run, what to narrow on, and whether to stop early. It writes a decision log as
          it goes. You can <code>get_auto_status</code> from a second Claude Code session and
          watch it think.
        </p>

        <CodeBlock
          lang="typescript"
          title="one-line everything"
          code={`const result = await mcp__neuron__auto_train({
  task_id: "iris",
  accuracy_target: 0.95,
  max_waves: 2,
  budget_s: 120,
  promote: true,
})

// result = {
//   ok: true,
//   auto_run_id: 7,
//   status: "completed",
//   run_id: 42,
//   accuracy: 0.973,
//   waves_used: 1,
//   decision_log: [
//     { stage: "preflight", note: "ready, 150 samples, balanced" },
//     { stage: "suggest",   note: "lr=0.05, epochs=800, head=[4,32,3]" },
//     { stage: "sweep_wave_1", payload: { configs: 3 } },
//     { stage: "evaluate_wave_1", note: "best run 42 @ 0.973" },
//     { stage: "promote", note: "registered run 42" },
//   ],
//   verdict: "Promoted run 42 at 97.3%. Target met in one wave.",
// }`}
        />
      </Section>

      <Section eyebrow="The coordinator's brain" title="What the coordinator actually does.">
        <Timeline
          steps={[
            {
              step: "01",
              title: "preflight_check",
              body: (
                <>
                  If verdict is <code>not_ready</code>, log it and stop. No point sweeping over a
                  dataset that can't be trained.
                </>
              ),
              accent: "cyan",
            },
            {
              step: "02",
              title: "suggest_hyperparams",
              body: "Seeds the first wave with a sensible (lr, epochs, head) triple.",
              accent: "purple",
            },
            {
              step: "03",
              title: "run_sweep — wave 1",
              body: (
                <>
                  Varies lr around the suggestion ([×0.5, ×1, ×2] clamped) and runs 3–4 configs in
                  parallel. Logs with <code>stage=sweep_wave_1</code>.
                </>
              ),
              accent: "green",
            },
            {
              step: "04",
              title: "evaluate + diagnose",
              body: (
                <>
                  If the best run hits target, we're done. If diagnose says{" "}
                  <code>severity=critical</code> and we have wave budget, move on.
                </>
              ),
              accent: "orange",
            },
            {
              step: "05",
              title: "run_sweep — wave 2 (optional)",
              body: "Narrow lr around the wave-1 winner, go deeper or wider on the head, more epochs.",
              accent: "pink",
            },
            {
              step: "06",
              title: "suggest_samples (fallback)",
              body: (
                <>
                  If we're still under target, the coordinator calls{" "}
                  <code>suggest_samples</code> and returns a verdict that points at the data gaps —
                  instead of claiming victory on a bad model.
                </>
              ),
              accent: "cyan",
            },
            {
              step: "07",
              title: "promote + publish",
              body: (
                <>
                  <code>register_model</code> flips the active model. If{" "}
                  <code>publish_name</code> was passed, <code>publish_model</code> ships it to the
                  registry.
                </>
              ),
              accent: "green",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Why this isn't a hard-coded state machine" title="Sub-agent vs TS loop.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Brain} title="Claude decides, not if/else" accent="purple">
            "Should we retry because per-class accuracy is collapsing on one label?" That is not a
            boolean. Diagnose gives severity; the coordinator interprets it. The judgment is the
            feature.
          </InfoCard>
          <InfoCard icon={Radar} title="Tool allowlist = safety rails" accent="cyan">
            The coordinator can't run Bash, can't write files, can't talk to the internet. Eleven
            tools. <code>disallowedTools</code> explicitly names Bash/Read/Edit/Write/Glob/Grep.
          </InfoCard>
          <InfoCard icon={ListTree} title="Decision log = debuggability" accent="green">
            Every meaningful decision ends in <code>log_auto_note</code>. You get a timeline. You
            can grep it. You can show it to a teammate.
          </InfoCard>
          <InfoCard icon={Workflow} title="Budget is a soft deadline" accent="orange">
            <code>budget_s</code> is checked at wave boundaries, not inside training. Worst-case
            overrun = one wave. No cross-process kill required to ship v1.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Watching from another session" title="Live progress via get_auto_status.">
        <p>
          Both <code>auto_train</code> and <code>run_sweep</code> persist state to SQLite. A second
          Claude Code window can read that state via <code>get_auto_status</code> or{" "}
          <code>get_run_status</code> — the decision log streams in as the coordinator thinks.
        </p>
        <CodeBlock
          lang="typescript"
          code={`// session A, running:
mcp__neuron__auto_train({ task_id: "iris" })

// session B, a few seconds later:
const status = await mcp__neuron__get_auto_status({ task_id: "iris" })
// status.status        -> "running"
// status.waves_used    -> 1
// status.decision_log  -> [{stage:"preflight",...}, {stage:"suggest",...}, ...]`}
        />
      </Section>

      <Section eyebrow="When to reach for which" title="A tiny decision table.">
        <div className="lab-panel p-6">
          <div className="grid md:grid-cols-3 gap-5 text-sm">
            <div>
              <div className="chip-cyan mb-3">train</div>
              <p className="text-lab-text/80">
                You know the hyperparams. You want one run. You're iterating on data and the model
                architecture is stable.
              </p>
            </div>
            <div>
              <div className="chip-orange mb-3">run_sweep</div>
              <p className="text-lab-text/80">
                You have 3–9 candidate configs you want to compare. The grid is fixed. You want
                wall-clock parallelism.
              </p>
            </div>
            <div>
              <div className="chip-purple mb-3">auto_train</div>
              <p className="text-lab-text/80">
                You said <em>"train a good model for X"</em> and want to walk away. You're okay
                with 1–2 minutes of budget.
              </p>
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}
