import {
  Brain, Workflow, Target, Shield, Zap, Library,
  GitMerge, Flag, Gauge,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { Timeline } from "../components/Timeline"

export function AutoTrainDeepDive() {
  return (
    <div>
      <PageHeader
        eyebrow="The &ldquo;just make it work&rdquo; button"
        accent="purple"
        title={<>How <span className="gradient-text">auto_train</span> actually thinks.</>}
        lede="You ask Claude to train a model; Claude calls auto_train; a deterministic TypeScript controller orchestrates, calls Claude planners only for the judgment calls, and writes a structured verdict. This is the tour of everything that happens in between."
      />

      <Section eyebrow="The big picture" title="One tool, ten steps, many sub-processes.">
        <p>
          <code className="text-cyan-neon">auto_train</code> is the highest-level tool in ML-Labs — it
          swallows everything from &ldquo;is this dataset OK?&rdquo; to &ldquo;here's your promoted model.&rdquo; The
          implementation lives in <code>neuron/src/core/auto/controller.ts</code>. It's ~750 lines of
          TypeScript with Claude sampled in only when deciding <em>what to try next</em> or{" "}
          <em>why this run failed</em>.
        </p>
        <Callout kind="learn" title="Why TypeScript + Claude instead of all-Claude">
          The earliest auto_train was a single Claude sub-agent with a long prompt. It worked, but two
          calls on the same dataset produced different plans — not reproducible, hard to debug. v1.5
          split the responsibility: TypeScript owns orchestration (budget, DB writes, winner selection,
          reap), Claude owns judgment (hyperparameter planning, failure diagnosis). You get the
          reliability of code for the parts that need to be predictable and the smarts of an LLM for the
          parts that genuinely require taste.
        </Callout>
      </Section>

      <Section eyebrow="The lifecycle" title="Preflight → waves → promote.">
        <AsciiDiagram title="auto_train(task_id, …) end-to-end" accent="purple">
{`  ┌─────────────────────────────────────────────────────────┐
  │              auto_train({ task_id, ... })               │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 1. estimateBudget()  │  (memory_budget.ts)
             │    refuse + !force   │──╮ return plan preview
             └──────────────────────┘  │ + {ok:false}
                          │            ▼
                          │   auto_train({dry_run}) only
                          ▼
             ┌──────────────────────┐
             │ 2. computeDataHealth │  (signals.ts)
             │    + preflight       │
             └──────────────────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 3. lookupBestPattern │  warm-start from prior
             │    (patterns.ts)     │  run on same fingerprint
             └──────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   main wave loop      │
              │   while(wave < max):  │◀─────────────────┐
              └───────────────────────┘                  │
                          │                              │
                          ▼                              │
             ┌──────────────────────┐                    │
             │ 4. pick planner      │  rules / Claude /  │
             │    (per wave)        │  TPE / tournament  │
             └──────────────────────┘                    │
                          │                              │
                          ▼                              │
             ┌──────────────────────┐                    │
             │ 5. runSweep(...)     │  sequential OR     │
             │    or sequential     │  sub-agents, by    │
             └──────────────────────┘  budget level      │
                          │                              │
                          ▼                              │
             ┌──────────────────────┐                    │
             │ 6. collectSignals    │  run metrics +     │
             │    → diagnose?       │  overfit + curves  │
             └──────────────────────┘                    │
                          │                              │
                    target hit? ───────────── yes ─▶ break
                          │ no                           │
                          └───────── next wave ──────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 7. auto_collect?     │  optional active-
             │    (Phase 7)         │  learning rounds
             └──────────────────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 8. pickWinner()      │  val-aware, overfit-
             │    scoreClassification│  penalised
             └──────────────────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 9. promote +         │
             │    calibrate +       │
             │    publish (opt)     │
             └──────────────────────┘
                          │
                          ▼
             ┌──────────────────────┐
             │ 10. saveVerdictJson  │
             │     + reap orphans   │
             └──────────────────────┘`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Step 1 — budget gate" title="Refuse before a single epoch.">
        <p>
          Long before any training runs, the controller calls{" "}
          <code className="text-orange-neon">estimateTrainingBudget</code> (see the{" "}
          <a href="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</a> page).
          If the level is <strong>refuse</strong> and you didn't pass <code>force: true</code>, the
          controller returns a <code>data_issue</code> verdict and exits. This is the primary guardrail
          that keeps CPU-only laptops alive.
        </p>
      </Section>

      <Section eyebrow="Step 2 — signal bundle" title="Everything the planner sees.">
        <p>
          <code className="text-cyan-neon">collectSignals()</code> pulls together every piece of
          structured data the controller and its planners need. It's the single source of truth — no
          planner gets raw DB rows; they all get a typed <code>SignalBundle</code>. If a planner wants
          to know &ldquo;is this run overfitting?&rdquo; it reads{" "}
          <code>bundle.current_wave[i].overfit_gap</code>, not the <code>runs</code> table.
        </p>
        <CodeBlock
          lang="ts"
          title="core/auto/signals.ts (SignalBundle shape)"
          code={`interface SignalBundle {
  task_id: string
  task_kind: "classification" | "regression"
  data: {
    n: number; k: number; d: number
    imbalance_ratio: number | null
    warnings: string[]        // constant features, scale issues
    has_val_split: boolean
  }
  history: {
    prior_best_metric: number | null
    prior_best_config: SweepConfig | null
    waves_done: number
    budget_s: number
    budget_used_s: number
  }
  current_wave: RunSignals[]  // one entry per run in the last wave
  target: { metric: "accuracy" | "r2"; value: number }
}

interface RunSignals {
  run_id: number
  config: SweepConfig
  accuracy: number | null
  val_accuracy: number | null
  overfit_gap: number | null    // train_acc - val_acc
  still_improving: boolean      // did loss plateau?
  convergence_epoch: number | null
  per_class_variance: number | null
  severity: "minor" | "moderate" | "critical" | null
  metric: number | null         // the score the winner-selector ranks by
  metric_name: "accuracy" | "r2"
  r2: number | null
}`}
        />
      </Section>

      <Section eyebrow="Step 3 — pattern memory" title="Warm-starting from past wins.">
        <p>
          Before picking configs for wave 1, the controller asks: <em>Have we seen a task shaped like
          this before?</em> It hashes <code>(kind, K, D bucket, N bucket, imbalance bucket)</code> into
          a <strong>fingerprint</strong>, then queries the <code>auto_patterns</code> SQLite table for
          the best known config on that fingerprint. If found, wave 1 seeds with{" "}
          <code>[best_config, best_config×lr/2, best_config×lr×2]</code> — three variations around a
          known good point.
        </p>

        <Table
          caption="core/auto/patterns.ts — taskFingerprint()"
          columns={[
            { key: "dim",    header: "Dimension" },
            { key: "bucket", header: "Bucketing" },
            { key: "why",    header: "Why" },
          ]}
          rows={[
            { dim: "task_kind",       bucket: <code>classification | regression</code>, why: "Different loss functions, different metrics — configs do not transfer." },
            { dim: "K (num classes)", bucket: <code>k2, k3, k4, …</code>,                why: "Head size and class_weights behavior depend on K exactly." },
            { dim: "D (features)",    bucket: <code>d_xs &lt;5, d_s &lt;20, d_m &lt;100, d_l &ge;100</code>, why: "Head depth and activation choice shift with input dimensionality." },
            { dim: "N (samples)",     bucket: <code>xs &lt;50, s &lt;200, m &lt;1k, l &ge;1k</code>, why: "Epoch count and batch size depend heavily on dataset size." },
            { dim: "imbalance",       bucket: <code>bal &lt;2, mild &lt;5, severe &ge;5</code>,      why: "Triggers class_weights=&ldquo;balanced&rdquo; in the refinement rules." },
          ]}
        />

        <Callout kind="tip">
          Patterns are saved on successful auto_train runs only. Over time, repeated use on similar
          tasks makes the first wave a lot smarter without any manual tuning. If you train 10 Pima-like
          datasets, the 11th starts where the 10th finished.
        </Callout>
      </Section>

      <Section eyebrow="Step 4 — planner selection" title="Four planners, one interface.">
        <p>
          Every wave has to decide: <em>given what we know, what 3 configs should we try next?</em> The
          controller picks one of four planners depending on wave number, env vars, and available data.
        </p>

        <Table
          columns={[
            { key: "planner", header: "Planner",         accent: "purple" },
            { key: "when",    header: "When called" },
            { key: "how",     header: "How it works" },
            { key: "cost",    header: "Cost" },
          ]}
          rows={[
            {
              planner: <strong className="text-green-neon">rules</strong>,
              when:    <>Every wave's fallback. Forced when <code>NEURON_PLANNER=rules</code> (benchmarks).</>,
              how:     <>Deterministic TypeScript in <code>rules.ts</code>. Reads signals, produces 2-4 configs via explicit if-then statements (&ldquo;if overfit_gap &gt; 0.15, try smaller arch; if still_improving, add epochs&rdquo;).</>,
              cost:    "Free. ~1ms.",
            },
            {
              planner: <strong className="text-purple-neon">Claude</strong>,
              when:    <>Default for waves 0 and 1 when <code>tournament=false</code>.</>,
              how:     <>Single Claude sub-agent via Agent SDK. Gets the SignalBundle + last 6 decision-log entries + rule history. Returns strict JSON with configs + rationale + <code>rule_explanations</code>.</>,
              cost:    "One Claude call (~3-8s).",
            },
            {
              planner: <strong className="text-cyan-neon">TPE</strong>,
              when:    <>Wave 2+ when ≥3 observations exist.</>,
              how:     <>Tree-structured Parzen Estimator. Builds a density model of &ldquo;good&rdquo; vs &ldquo;bad&rdquo; configs from prior runs, samples from the <code>good / bad</code> ratio. Classical Bayesian HPO, no LLM. Falls back to rules if TPE output is out of range.</>,
              cost:    "Free. ~10ms.",
            },
            {
              planner: <strong className="text-pink-neon">Tournament</strong>,
              when:    <>When <code>auto_train(tournament: true)</code>.</>,
              how:     <>3 parallel Claude sub-agents with different strategies (aggressive / conservative / exploratory). Each returns a config list; controller merges and picks 3 diverse configs.</>,
              cost:    "3× Claude calls per wave (~10-25s total). Trades cost for robustness.",
            },
          ]}
        />

        <AsciiDiagram title="Planner selection flow" accent="purple">
{`         wave_index = 0?
              │
       ┌──────┴──────┐
       │             │
      yes            no ──── wave ≥ 2 AND ≥3 prior runs?
       │             │              │
       │       ┌─────┴─────┐  ┌─────┴────┐
       │       │           │  │          │
       │       wave 1      │ yes         no
       │       │           │  │          │
       │       │           │  ▼          │
       │       │           │  TPE ┬ safe ─── rules (fallback)
       │       │           │      └ unsafe ──┤
       │       ▼           │                 │
       ▼      NEURON_PLANNER=rules? ─ yes ─▶ rules
      rules                │ no              │
                           ▼                 │
                    tournament: true?        │
                           │                 │
                    ┌──────┴──────┐          │
                    │             │          │
                   yes            no         │
                    │             │          │
                    ▼             ▼          │
             tournament planner  Claude planner
             (3 sub-agents)      (1 sub-agent)`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Step 5 — wave execution" title="Sequential vs parallel sub-agents.">
        <p>
          Once the planner returns N configs, the controller hands them to the sweep orchestrator. But{" "}
          <em>how</em> those configs run is itself a decision — see the{" "}
          <a href="/sweep-modes" className="text-cyan-neon hover:underline">Sweep Modes</a> page for the
          full logic. The short version:
        </p>
        <Table
          columns={[
            { key: "budget", header: "Memory level",   accent: "orange" },
            { key: "mode",   header: "Sweep mode" },
            { key: "why",    header: "Why" },
          ]}
          rows={[
            { budget: <span className="chip-green">safe</span>, mode: <><code>runSweep</code> — 3 Claude sub-agents in parallel</>, why: "Real parallelism ~3× speedup. Extra ~300MB × 3 memory is fine at this size." },
            { budget: <span className="chip-cyan">advisory</span>, mode: <><code>runSweep</code> — parallel</>, why: "Still has headroom. Parallelism is worth the memory cost." },
            { budget: <span className="chip-orange">heavy</span>, mode: <><code>runSweepSequential</code> — one at a time, in-process</>, why: "Three sub-agents would blow RAM. Sequential is slower but predictable." },
            { budget: <span className="chip-pink">refuse</span>, mode: "Blocked at step 1 — never reaches here.", why: "Unless force: true, we never got to this step." },
          ]}
        />
        <Callout kind="warn" title="The behaviour reversed in v1.7.0">
          Prior to v1.7.0, sub-agents were the default for all workloads — and were the main reason the
          Fashion-MNIST crash mentioned in the <a href="/memory-budget" className="text-orange-neon hover:underline">Memory Budget</a>{" "}
          page was so lethal. v1.8.1 introduced the adaptive switch above so you get parallelism where
          it's safe and sequentially-gated memory where it isn't.
        </Callout>
      </Section>

      <Section eyebrow="Step 6 — post-wave" title="Collect signals, diagnose, maybe stop.">
        <p>
          After a wave finishes, the controller:
        </p>
        <Timeline
          steps={[
            {
              step: "A",
              title: "Collect run signals",
              body: (
                <>
                  Calls <code>collectSignals</code> again, now with the completed runs from this wave
                  folded in. This populates <code>val_accuracy</code>, <code>overfit_gap</code>,{" "}
                  <code>still_improving</code>, and a severity bucket for each run.
                </>
              ),
              accent: "cyan",
            },
            {
              step: "B",
              title: "Maybe diagnose",
              body: (
                <>
                  If the best run is still below target <em>and</em> looks critical (accuracy &lt; 0.6
                  or overfit_gap &gt; 0.2), spawn a Claude <strong>diagnoser</strong> sub-agent. It
                  looks at the confusion matrix, loss history, and recommends whether the next wave
                  should try regularization, different architecture, or stop. Purely advisory — gets
                  logged, doesn't force decisions.
                </>
              ),
              accent: "purple",
            },
            {
              step: "C",
              title: "Check stop conditions",
              body: (
                <>
                  If the best metric this wave &ge; <code>accuracy_target</code>, break immediately. If{" "}
                  <code>waves_used &ge; max_waves</code>, break. If the budget timer fired{" "}
                  (<code>AbortController</code> from <code>setTimeout(budget_s × 1.1 × 1000)</code>),
                  break. Otherwise, loop back to step 4.
                </>
              ),
              accent: "green",
            },
            {
              step: "D",
              title: "Record wave event",
              body: (
                <>
                  Emit an <code>auto_wave_completed</code> event with configs_tried, best_overall
                  metric, ETA, and whether the winner is overfit. The dashboard subscribes to this.
                </>
              ),
              accent: "orange",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Step 7 — active-learning (optional)" title="auto_collect, Phase 7.">
        <p>
          If you called <code>auto_train({"{"}auto_collect: true{"}"})</code> <em>and</em> your{" "}
          <code>neuron.config.ts</code> exports a <code>collect()</code> callback, the controller enters
          an extra loop of up to <code>max_collect_rounds</code> (default 2) rounds:
        </p>
        <Timeline
          steps={[
            { step: "1", title: "Find the weakest points",    body: <>Call <code>suggest_samples</code> to surface the uncertain / misclassified examples.</>, accent: "cyan" },
            { step: "2", title: "Ask your callback for more", body: <>Hand those examples to <code>collect()</code> — you decide how to synthesize, fetch, or label more samples for those weak spots.</>, accent: "purple" },
            { step: "3", title: "Insert as train samples",    body: <>The new samples go straight into the DB as <code>split=&ldquo;train&rdquo;</code>.</>, accent: "green" },
            { step: "4", title: "One refinement wave",        body: <>Run a single rules-driven refinement wave on the augmented data. Re-evaluate. If target reached, break; otherwise try the next round.</>, accent: "orange" },
          ]}
        />
        <Callout kind="tip">
          Without a <code>collect()</code> callback this step is a no-op. It's opt-in and user-provided —
          ML-Labs does not fabricate data behind your back.
        </Callout>
      </Section>

      <Section eyebrow="Step 8 — winner selection" title="Why val_accuracy matters.">
        <p>
          After the loop exits, the controller picks a single winner. The scoring function is
          deliberate:
        </p>
        <CodeBlock
          lang="ts"
          title="core/auto/verdict.ts — scoreClassification()"
          code={`export function scoreClassification(r: RunSignals): number {
  // Overfit penalty: if train_acc substantially beats val_acc,
  // discount the score so an honest-looking run can win.
  if (
    r.val_accuracy != null && r.accuracy != null
    && r.accuracy - r.val_accuracy > 0.15
  ) {
    return r.val_accuracy - 0.5 * (r.accuracy - r.val_accuracy)
  }
  return r.val_accuracy ?? r.accuracy ?? -Infinity
}`}
        />
        <Callout kind="learn" title="Why the penalty">
          Without it, a run that memorised the training set (train_acc 1.0, val_acc 0.6) would beat a
          run with honest generalisation (train_acc 0.85, val_acc 0.82). The penalty says: prefer a
          smaller-but-honest gap over a big-but-fake score. The 0.15 threshold and 0.5× discount were
          chosen after Fashion-MNIST crowned a memoriser on v1.10.0 pre-fix — see the{" "}
          <a href="/changelog" className="text-cyan-neon hover:underline">changelog</a> for details.
        </Callout>
      </Section>

      <Section eyebrow="Step 9 — promote + calibrate + publish" title="Making the model real.">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Flag} title="Promote" accent="green">
            If <code>promote: true</code> (default) and a winner exists, register the run as the active
            model for the task. Inference from this point onwards uses these weights.
          </InfoCard>
          <InfoCard icon={Gauge} title="Calibrate" accent="cyan">
            For classification winners with a val split, run <code>calibrate</code> — fit a temperature
            T on the val set so softmax confidences match empirical accuracy. Records ECE before/after
            in the decision log.
          </InfoCard>
          <InfoCard icon={Library} title="Publish (opt)" accent="pink">
            If <code>publish_name</code> is passed, bundle weights + metadata + adapter hash into{" "}
            <code>~/.neuron/registry/</code> under <code>neuron://local/&lt;name&gt;@&lt;version&gt;</code>{" "}
            so other projects can <code>import_model</code> it.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Step 10 — the verdict" title="Structured return + orphan reap.">
        <p>
          auto_train always returns the same schema — success, failure, or cancellation. Claude uses the
          structured fields to summarize back to you; the dashboard uses them to render the auto-run
          card.
        </p>
        <CodeBlock
          lang="ts"
          title="core/auto/verdict.ts — StructuredVerdict"
          code={`interface StructuredVerdict {
  status: "completed" | "data_issue" | "budget_exceeded"
        | "no_improvement" | "failed" | "cancelled"
  winner: {
    run_id: number | null
    metric_value: number | null
    metric_name: "accuracy" | "r2"
    is_overfit: boolean
    confidence: "high" | "low"     // low if no val split OR overfit
    config: SweepConfig | null
  }
  attempted: {
    configs_tried: number          // honest count, incl. reaped (v1.10.0)
    waves_used: number
    wall_clock_s: number
  }
  data_issues: string[]
  next_steps: string[]             // actionable follow-ups
  summary: string                  // one-line English
}`}
        />

        <Table
          caption="Verdict statuses"
          columns={[
            { key: "status",  header: "Status",   accent: "cyan" },
            { key: "trigger", header: "Triggered by" },
            { key: "next",    header: "Typical next_steps" },
          ]}
          rows={[
            { status: <span className="chip-green">completed</span>,      trigger: "Best wave metric ≥ accuracy_target",                                                next: "none — promoted and published" },
            { status: <span className="chip-cyan">no_improvement</span>,  trigger: "Budget/max_waves exhausted but below target",                                       next: "collect more minority-class samples; raise max_waves; consider class_weights" },
            { status: <span className="chip-orange">budget_exceeded</span>, trigger: "setTimeout(budget_s × 1.1) fired",                                                 next: "re-run with larger budget_s" },
            { status: <span className="chip-pink">cancelled</span>,       trigger: "cancel_auto_train called, OR external AbortController",                             next: "re-run to continue from scratch" },
            { status: <span className="chip-purple">data_issue</span>,    trigger: "preflight warnings, N too small, K&lt;2, refuse-level budget without force",        next: "load_csv more data; address warnings" },
            { status: <span className="chip-pink">failed</span>,          trigger: "All sweep configs failed (crashed or produced no metric)",                          next: "check logs — usually a data-shape issue" },
          ]}
        />

        <Callout kind="warn" title="The orphan reaper (v1.10.0 Bug B fix)">
          When a sweep sub-agent is still running when the controller exits (budget timer, cancel,
          crash), its DB row would historically be left stuck in <code>status=&ldquo;running&rdquo;</code>. The
          v1.10.0 reaper unions the in-process registry with a SQL scan of{" "}
          <code>runs WHERE status IN (&ldquo;running&rdquo;, &ldquo;pending&rdquo;) AND started_at &ge; t0</code> and
          force-cancels them. Runs on every terminal exit path.
        </Callout>
      </Section>

      <Section eyebrow="The decision log" title="What get_auto_status shows you.">
        <p>
          Every stage of the lifecycle emits a <code>decision_log</code> entry into the{" "}
          <code>auto_runs</code> row. Call <code>get_auto_status(auto_run_id)</code> or{" "}
          <code>get_auto_status(task_id)</code> — even from a different terminal — to see the
          controller narrate its reasoning in real time. Entries look like:
        </p>
        <CodeBlock
          lang="json"
          title="get_auto_status — sample decision_log"
          code={`[
  { "ts": "2026-04-20T15:02:01Z", "stage": "inspect",           "note": "N=150 K=3 D=4 imbalance=1.0" },
  { "ts": "2026-04-20T15:02:01Z", "stage": "warm_start",        "note": "prior pattern classification|k3|d_xs|s|bal: accuracy=0.967" },
  { "ts": "2026-04-20T15:02:01Z", "stage": "sweep_wave_1_plan", "note": "warm-start from prior accuracy=0.967 ± lr variants", "payload": { "source": "rules", "rules_fired": ["warm_start"] } },
  { "ts": "2026-04-20T15:02:02Z", "stage": "sweep_wave_1_exec", "note": "starting 3 configs (mode=sub_agents, budget=safe)" },
  { "ts": "2026-04-20T15:02:47Z", "stage": "sweep_wave_1_done", "note": "best accuracy=0.983 (3 completed, 0 failed)" },
  { "ts": "2026-04-20T15:02:47Z", "stage": "target_reached",    "note": "accuracy=0.983 ≥ 0.9" },
  { "ts": "2026-04-20T15:02:47Z", "stage": "winner_selection",  "note": "run 42 score=0.983 (raw accuracy=0.983, overfit=false)" },
  { "ts": "2026-04-20T15:02:47Z", "stage": "promote",           "note": "registered run 42 as active model" },
  { "ts": "2026-04-20T15:02:48Z", "stage": "calibrate",         "note": "T=1.08, ECE 0.042 → 0.019" },
  { "ts": "2026-04-20T15:02:48Z", "stage": "pattern_saved",     "note": "fingerprint=classification|k3|d_xs|s|bal" }
]`}
        />
      </Section>

      <Section eyebrow="When to reach for which feature" title="Practical recipes.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Workflow} title="Small, balanced tabular data" accent="cyan">
            Default flags. One or two waves is usually enough. Watch the fingerprint — the 5th time you
            train a Pima-shaped dataset, wave 1 is already near optimal via pattern memory.
          </InfoCard>
          <InfoCard icon={Brain} title="Unclear task, hard problem" accent="purple">
            Pass <code>tournament: true</code>. You get 3 strategies per wave (aggressive /
            conservative / exploratory) running in parallel; final proposals are merged. Costs ~3× but
            often escapes local optima.
          </InfoCard>
          <InfoCard icon={Target} title="Hit a specific bar" accent="green">
            Tighten <code>accuracy_target</code>. The controller will keep spending waves until it
            reaches the bar or budget expires. If it returns <code>no_improvement</code>, the
            <code> next_steps</code> are actionable.
          </InfoCard>
          <InfoCard icon={Shield} title="You don't trust the data" accent="orange">
            Run <code>auto_train({"{"}dry_run: true{"}"})</code> first. You'll see the budget level,
            seed configs, and ETA range before anything runs. Perfect for first contact with a new
            dataset.
          </InfoCard>
          <InfoCard icon={GitMerge} title="Reproducibility" accent="pink">
            Set <code>NEURON_PLANNER=rules</code> and pass <code>seed: N</code>. All Claude-sampled
            planners are skipped, TPE seeded deterministically, same output every run. Used by the
            internal benchmark suite.
          </InfoCard>
          <InfoCard icon={Zap} title="Iterating on a weak class" accent="cyan">
            Set <code>auto_collect: true</code> after defining a <code>collect()</code> callback in{" "}
            <code>neuron.config.ts</code>. The controller will ask you to generate/label more samples
            for exactly the rows the model is confused about.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Files you will want to read.">
        <Table
          columns={[
            { key: "file", header: "File",                   mono: true, width: "38%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "core/auto/controller.ts",    what: "The main loop. Start here." },
            { file: "core/auto/signals.ts",       what: "SignalBundle builder. Source of truth for what planners see." },
            { file: "core/auto/rules.ts",         what: "Deterministic if-then refinement logic." },
            { file: "core/auto/planner.ts",       what: "Claude planner prompt + tournament merge." },
            { file: "core/auto/tpe.ts",           what: "Tree-structured Parzen Estimator implementation." },
            { file: "core/auto/diagnoser.ts",     what: "Claude diagnoser sub-agent (post-wave advisory)." },
            { file: "core/auto/patterns.ts",      what: "Pattern memory — fingerprint + lookup + save." },
            { file: "core/auto/verdict.ts",       what: "Winner scoring + StructuredVerdict schema." },
            { file: "core/auto/registry.ts",      what: "In-process coordinator tracking (for cancel)." },
            { file: "core/auto/reaper.ts",        what: "Startup orphan-run reaper." },
            { file: "core/memory_budget.ts",      what: "The estimator that gates refuse-level workloads." },
          ]}
        />
      </Section>
    </div>
  )
}
