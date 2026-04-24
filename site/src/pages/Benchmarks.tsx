import { Trophy, Flower2, Wine, HeartPulse, Home as HomeIcon, Grid3x3, CheckCircle2 } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"

export function Benchmarks() {
  return (
    <div>
      <PageHeader
        eyebrow="Regression testing for the ML platform"
        accent="pink"
        title={<>The <span className="gradient-text">benchmarks</span>.</>}
        lede="Every v1.6+ changelog entry mentions &ldquo;benchmarks pass.&rdquo; What does that mean, and how do you run them? This page walks through the 5-dataset suite, what each one tests, and how to bless new baselines."
      />

      <Section eyebrow="Why benchmarks" title="Catching silent regressions.">
        <p>
          ML-Labs has many moving parts — the planner, the rules, the trainer, the sweep orchestrator,
          the memory guardrail. Any one of them could silently degrade accuracy by a few points and
          no unit test would catch it. The benchmarks run the <em>whole system</em> end-to-end on five
          small public datasets, under a fully deterministic configuration, and compare against a
          blessed baseline. If your changes made iris drop from 96% to 88%, the bench fails loudly.
        </p>
        <Callout kind="learn" title="Determinism is the point">
          Running benchmarks sets <code>NEURON_PLANNER=rules</code>,{" "}
          <code>NEURON_SWEEP_MODE=sequential</code>, and <code>seed=42</code>. That means: no Claude
          Sampling (rules-only planner), no sub-agent parallelism, fixed random stream. Same code +
          same seed = bit-identical output. The harness asserts that the accuracy and the fingerprint
          hash match the baseline, so a change in behavior fails loudly regardless of whether it
          happened in the planner, trainer, or post-processing.
        </Callout>
      </Section>

      <Section eyebrow="The five datasets" title="Covering the usual ML problem shapes.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Flower2} title="iris — 150×4, 3 classes" accent="cyan">
            The classic. 3 species, 4 measurements. Linear separability is easy for two classes, harder
            for the third. Smoke test for the whole pipeline; target 0.90.
          </InfoCard>
          <InfoCard icon={Wine} title="wine — 178×13, 3 classes" accent="purple">
            Wine-quality proxy. 13 chemical features. More features than iris, still small. Tests that
            normalization and D-scaled architectures work. Target 0.90.
          </InfoCard>
          <InfoCard icon={HeartPulse} title="breast-cancer — 569×30, 2 classes" accent="pink">
            Binary classification with 30 features. High-dimensional for its size. Tests binary-class
            handling + class_weights when <code>balanced</code> is picked by rules. Target 0.92.
          </InfoCard>
          <InfoCard icon={HomeIcon} title="housing — 506×13, regression" accent="green">
            Boston Housing. Tests the regression path end-to-end: min-max target normalization, R² as
            the metric, regression-specific verdict. Target R² ≥ 0.50.
          </InfoCard>
          <InfoCard icon={Grid3x3} title="digits — 1797×64, 10 classes" accent="orange">
            8×8 digits (sklearn's digits). Highest D and K of the suite. Tests multi-class accuracy +
            larger head architecture. Target 0.85.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Running the suite" title="Two commands.">
        <CodeBlock
          lang="bash"
          title="terminal — from neuron/"
          code={`# Run all 5 benchmarks (~3-5 min on a laptop)
bun run test/bench/run.ts

# Run a subset
bun run test/bench/run.ts iris wine

# Write a new baseline (after a change you want to bless)
bun run test/bench/run.ts --bless`}
        />

        <Callout kind="tip">
          The <code>bun run bench</code> package script wraps this. <code>bun run bench:fast</code>{" "}
          runs only the iris + wine subset. Add <code>bun run bench</code> to your CI and you'll know
          immediately if any change moves the model quality.
        </Callout>
      </Section>

      <Section eyebrow="What a run looks like" title="Sample output.">
        <CodeBlock
          lang="txt"
          title="bun run test/bench/run.ts"
          code={`=== ml-labs benchmark harness ===
Running 5 bench(es): iris, wine, breast-cancer, housing, digits
Mode: deterministic (seed=42, planner=rules, sweep=sequential)
Baseline: loaded (2026-04-18T22:41:08.312Z)

  [iris]          ✓  accuracy=0.967  waves=1  configs=3  t=4s   on baseline
  [wine]          ✓  accuracy=0.944  waves=1  configs=3  t=4s   on baseline
  [breast-cancer] ✓  accuracy=0.956  waves=1  configs=3  t=9s   on baseline
  [housing]       ✓  r2=0.738        waves=2  configs=6  t=17s  on baseline
  [digits]        ✓  accuracy=0.900  waves=2  configs=6  t=38s  on baseline

✓ done (5/5 completed)`}
        />
      </Section>

      <Section eyebrow="What the baseline stores" title="The contract.">
        <CodeBlock
          lang="json"
          title="test/bench/results/baseline.json (excerpt)"
          code={`{
  "generated_at": "2026-04-21T14:10:20Z",
  "neuron_version": "1.10.0",
  "seed": 42,
  "entries": [
    {
      "name": "iris",
      "metric_name": "accuracy",
      "metric_value": 0.967,
      "waves_used": 1,
      "configs_tried": 3,
      "fingerprint_hash": "7a3e...b04f",      // hash of (data, config, metrics)
      "wall_clock_s": 4
    },
    ...
  ]
}`}
        />
        <Table
          caption="Pass / regress rules"
          columns={[
            { key: "status", header: "Status",     accent: "pink" },
            { key: "rule",   header: "Fires when" },
          ]}
          rows={[
            { status: <span className="chip-green">pass</span>,        rule: "metric within 2% of baseline AND fingerprint matches." },
            { status: <span className="chip-orange">regress</span>,    rule: "metric dropped >2% below baseline." },
            { status: <span className="chip-pink">hash_mismatch</span>, rule: "fingerprint changed — behavior shifted even if accuracy coincidentally matches." },
            { status: <span className="chip-cyan">no_baseline</span>,   rule: "first run, no baseline file — info only, not a failure." },
          ]}
        />
      </Section>

      <Section eyebrow="Blessing a new baseline" title="When and how.">
        <p>
          If you made a deliberate change that moves benchmarks (e.g. better rules, different default
          architecture), the previous baseline is wrong. Re-run with <code>--bless</code> to overwrite
          it:
        </p>
        <CodeBlock
          lang="bash"
          title="terminal"
          code={`# Run + write current results as the new baseline
bun run test/bench/run.ts --bless

# Commit the updated baseline.json
git add neuron/test/bench/results/baseline.json
git commit -m "bless: new baseline after <reason>"`}
        />
        <Callout kind="warn">
          Only bless after confirming <em>why</em> the numbers moved. If iris accuracy dropped and
          you're not sure why, don't bless — investigate. The baseline is load-bearing for catching
          silent regressions.
        </Callout>
      </Section>

      <Section eyebrow="Harness internals" title="What each file does.">
        <Table
          columns={[
            { key: "file", header: "File",             mono: true, width: "38%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "test/bench/run.ts",       what: "Entry point. Orchestrates the runs, loads/writes baseline, decides pass/fail." },
            { file: "test/bench/configs.ts",   what: "The 5 BenchConfig records — CSV path, target, budget_s, test_size." },
            { file: "test/bench/harness.ts",   what: "runBench() — sets env vars, loads CSV, calls auto_train, reads verdict." },
            { file: "test/bench/compare.ts",   what: "Diffs a run's metric and fingerprint against the baseline, returns a verdict." },
            { file: "test/bench/data/",        what: "The 5 CSV files, checked in." },
            { file: "test/bench/results/",     what: "baseline.json + per-run results (gitignored or checked in, by convention)." },
          ]}
        />
      </Section>

      <Section eyebrow="CI integration" title="Making sure it stays green.">
        <p>
          The <code>bun run ci</code> script in <code>neuron/package.json</code> chains{" "}
          <code>typecheck + unit tests</code>. Benchmarks aren't in CI by default because they take a
          few minutes and need the rs-tensor child process. Add them if you want stronger guarantees:
        </p>
        <CodeBlock
          lang="yaml"
          title=".github/workflows/bench.yml (example)"
          code={`name: Benchmarks
on:
  pull_request: {}
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run --cwd neuron bench
      # Fails the PR if any bench regressed by >2%.`}
        />
      </Section>

      <Section eyebrow="When new pages or features land" title="Keep the bench honest.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Trophy} title="New feature that affects accuracy" accent="cyan">
            Run benchmarks first (expect drift), then bless intentionally. Include the bench diff in
            the PR description — human reviewers should see what moved.
          </InfoCard>
          <InfoCard icon={CheckCircle2} title="Bug fix that changes behavior" accent="green">
            Run benchmarks. If the bug was causing over-accuracy (memorisation, data leak), expect
            metrics to drop <em>and that's the fix working</em>. Bless with a note explaining.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
