import { Activity, Brain } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { CodeBlock } from "../components/CodeBlock"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { InfoCard } from "../components/InfoCard"

export function TPEExplained() {
  return (
    <div>
      <PageHeader
        eyebrow="Bayesian HPO without the calculus"
        accent="cyan"
        title={<><span className="gradient-text">TPE</span> explained.</>}
        lede="auto_train uses Tree-structured Parzen Estimator (TPE) for hyperparameter search starting at wave 2. It's a classical Bayesian HPO algorithm — no LLM. This page demystifies what it's actually doing, why it works, and when it pays off."
      />

      <Section eyebrow="The problem" title="Pick the next config to try.">
        <p>
          You've tried 5 hyperparameter configs. 2 worked great, 3 were mediocre. You have budget
          for 3 more. Which 3 should you try?
        </p>
        <p>
          Random search is a baseline — pick uniformly. Grid search is exhaustive but wasteful. TPE
          says: <em>build a model of what's been working, sample from regions of the search space
          that look promising, avoid regions that don't.</em>
        </p>
        <Callout kind="learn" title="Where the name comes from">
          <strong>Tree-structured</strong> — handles conditional hyperparameters (e.g.{" "}
          <code>warmup_epochs</code> is only meaningful when <code>lr_schedule=linear_warmup</code>).{" "}
          <strong>Parzen estimator</strong> — a kernel density estimator. <strong>Together</strong> —
          two kernel density models, one for &ldquo;good&rdquo; configs, one for &ldquo;bad&rdquo;
          ones, sampled from a ratio.
        </Callout>
      </Section>

      <Section eyebrow="The core idea" title="Two density models, one ratio.">
        <p>
          Given N past observations (configs + their metric scores):
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Sort by metric. Define a <strong>quantile</strong> (default 25%): the top quarter is &ldquo;good,&rdquo; the rest is &ldquo;bad.&rdquo;</li>
          <li>Build two density models — <code>l(x)</code> over good configs, <code>g(x)</code> over bad ones.</li>
          <li>For a candidate x, compute <code>l(x) / g(x)</code>. High ratio means &ldquo;looks more like good than bad.&rdquo;</li>
          <li>Sample many candidates from <code>l(x)</code>, return the few with highest ratio.</li>
        </ol>

        <AsciiDiagram title="TPE density estimation, 1D (lr only)" accent="cyan">
{`   past observations (each has lr value, each marked good/bad)

         lr (log scale):  0.001       0.01       0.1
                            │           │           │
   accuracy = good (top 25%):     ◆          ◆     ◆
   accuracy = bad:           ●         ●  ●     ●           ●

   l(x): density of "good" lr's
                       _______
                      /       \\___
                     /            \\___
   ─────────────────                   ──────────

   g(x): density of "bad" lr's
              ___                          ___
        ____/   \\___                ____/    \\____
   ────                          ────                ─────

   l/g ratio: where good outweighs bad
                          ___
                       __/   \\__
   ──────────────────                 ─────────────

   ↑ this peak is the lr region TPE samples from next.`}
        </AsciiDiagram>
        <Callout kind="learn" title="Why this beats random search">
          Random search has no memory. TPE uses every prior observation to bias its next pick. By
          observation 10-20, TPE has narrowed in on a small region of parameter space — random
          search is still uniformly sampling the whole thing.
        </Callout>
      </Section>

      <Section eyebrow="When ML-Labs uses it" title="Wave 2 onward, with enough observations.">
        <p>
          From <code>controller.ts</code>:
        </p>
        <CodeBlock
          lang="ts"
          code={`} else if (wavesDone >= 2 && allRunSignals.length >= 3) {
  // Hand off to TPE once rules + planner have had two passes and we have
  // enough observations to do surrogate-style search.
  const fallback = refineFromSignals(bundle)
  const tpe = tpePlan(allRunSignals, 3, args.seed)
  // Sanity-check TPE configs — fall back to rules if any are out of range.
  const safeTpe = tpe.configs.every(
    (c) => (c.lr ?? 0) >= 0.001 && (c.lr ?? 0) <= 0.1 && (c.epochs ?? 0) >= 50,
  )
  plan = safeTpe ? tpe : { ...fallback, source: "rules" as const }
}`}
        />
        <p>
          So TPE only kicks in when (a) we're past wave 2, (b) we have at least 3 prior runs to
          model from, and (c) the suggested configs are in sane ranges. Otherwise the rules
          planner runs.
        </p>
      </Section>

      <Section eyebrow="The math, very lightly" title="What l(x) actually computes.">
        <p>
          A Parzen estimator is just a sum of bumps centered on each observation. With Gaussian
          kernels:
        </p>
        <CodeBlock
          lang="ts"
          title="Parzen kernel density estimator"
          code={`function kde(x: number, observations: number[], bandwidth: number): number {
  // For each observation, compute a Gaussian bump around it,
  // sum them. Result is the density at point x.
  let sum = 0
  for (const o of observations) {
    const z = (x - o) / bandwidth
    sum += Math.exp(-0.5 * z * z) / (bandwidth * Math.sqrt(2 * Math.PI))
  }
  return sum / observations.length
}`}
        />
        <p>
          Bandwidth is a smoothing parameter (small = jagged density, large = oversmoothed).
          ML-Labs's <code>core/auto/tpe.ts</code> uses a heuristic bandwidth based on the spread of
          observations.
        </p>
      </Section>

      <Section eyebrow="Multi-dimensional TPE" title="Independent per-axis.">
        <p>
          ML-Labs's TPE handles multiple hyperparameters by treating them <em>independently</em>:
          one l(x)/g(x) ratio per axis (lr, epochs, weight_decay, etc.), product the ratios. This
          loses correlations (TPE doesn't know that lr=0.1 + epochs=10000 is a bad combo unless
          both have appeared in bad observations) but keeps the math tractable.
        </p>
        <Callout kind="note">
          For a real production HPO library (<a href="https://optuna.org" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">Optuna</a>), TPE handles correlated dimensions better via tree-structured grouping. ML-Labs's
          implementation is simplified — it's deliberate; we trade some search efficiency for
          implementation simplicity.
        </Callout>
      </Section>

      <Section eyebrow="When TPE pays off" title="And when it doesn't.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Brain} title="Pays off when..." accent="green">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Search space is large (3+ axes)</li>
              <li>You have 5+ observations to model from</li>
              <li>The good region is narrow but findable</li>
              <li>Configs have stable cost (same epoch budget across configs)</li>
            </ul>
          </InfoCard>
          <InfoCard icon={Activity} title="Doesn't help when..." accent="orange">
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Search space is tiny (1-2 axes — random is fine)</li>
              <li>You have &lt;3 observations (TPE has nothing to model)</li>
              <li>Metric is very noisy (TPE will overfit on noise)</li>
              <li>Hyperparameters are highly correlated (independent KDE misses the structure)</li>
            </ul>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Forcing TPE off" title="When you don't want it.">
        <CodeBlock
          lang="bash"
          code={`# Force the rules planner everywhere — TPE is bypassed
NEURON_PLANNER=rules auto_train ...`}
        />
        <p>
          Used by the benchmark suite for determinism. With NEURON_PLANNER=rules and a fixed seed,
          you can reproduce auto_train output exactly.
        </p>
      </Section>

      <Section eyebrow="Reading list" title="Going deeper.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <a href="https://papers.nips.cc/paper_files/paper/2011/hash/86e8f7ab32cfd12577bc2619bc635690-Abstract.html" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">Bergstra et al., 2011 — Algorithms for Hyper-Parameter Optimization</a>{" "}
            — the original TPE paper. Mathy.
          </li>
          <li>
            <a href="https://optuna.readthedocs.io/en/stable/reference/samplers/generated/optuna.samplers.TPESampler.html" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">Optuna's TPESampler docs</a>{" "}
            — production-grade implementation. Way more sophisticated than ML-Labs's; worth reading
            to see how the algorithm scales.
          </li>
          <li>
            ML-Labs source: <code>neuron/src/core/auto/tpe.ts</code> + <code>tpe_adapter.ts</code> —
            ~150 lines of TS. Read it to see the simple version.
          </li>
        </ul>
      </Section>
    </div>
  )
}
