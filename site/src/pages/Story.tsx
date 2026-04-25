import { Sparkles, MessageSquare, Cpu, Layers } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function Story() {
  return (
    <div>
      <PageHeader
        eyebrow="Why this exists"
        accent="pink"
        title={<>The <span className="gradient-text">story</span>.</>}
        lede="ML-Labs didn't start as 'the Claude-native ML platform.' It started as a Rust tensor library and the question 'what if Claude could just train a model for me?' This page is the origin story — what we tried, what worked, what got cut, and why the system looks the way it does."
      />

      <Section eyebrow="The premise" title="Most ML platforms assume you already know ML.">
        <p>
          sklearn assumes you know what a pipeline is. PyTorch Lightning assumes you can read class
          hierarchies. MLflow assumes you've already trained a model and need to track it. Even the
          best of them — Weights &amp; Biases, ClearML — start with &ldquo;you wrote the training
          loop, we'll log it.&rdquo;
        </p>
        <p>
          That's fine for production teams. It's brutal for someone who's <em>asking the question
          for the first time</em>: &ldquo;I have a CSV. What's the next step?&rdquo;
        </p>
        <Callout kind="learn" title="The opening idea">
          What if the answer to &ldquo;what's the next step?&rdquo; was: <strong>just type</strong>{" "}
          what you want into Claude. The platform fills in the gaps. You don't learn the API; you
          learn the intent.
        </Callout>
      </Section>

      <Section eyebrow="The starting blocks" title="Two pieces in hand.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Cpu} title="rs-tensor existed" accent="cyan">
            <p>
              A Rust tensor library — born as a Hacking-the-North-style hobby. MLP training,
              autograd, GGUF inference. Already exposed as an MCP server because that's how it talks
              to other tools.
            </p>
          </InfoCard>
          <InfoCard icon={MessageSquare} title="MCP existed" accent="purple">
            <p>
              Anthropic's Model Context Protocol had just become real. Claude could now call tools
              that ran in your terminal, not just web APIs. The piece that made &ldquo;Claude as
              control plane&rdquo; possible.
            </p>
          </InfoCard>
        </div>
        <p className="mt-6">
          Combine them: an MCP server that wraps rs-tensor with task / sample / run abstractions,
          plus a small set of tools Claude can call. That was Phase 1, and that was v0.1.1.
        </p>
      </Section>

      <Section eyebrow="The first inversion" title="From CLI to chat.">
        <p>
          The original instinct was: build a CLI. <code>neuron train iris.csv</code>. <code>neuron
          predict --features ...</code>. Standard. Then we tried it with Claude:
        </p>
        <Callout kind="learn">
          <strong>You</strong>: &ldquo;Train a good model for iris.&rdquo; <br />
          <strong>Claude</strong>: <em>(calls preflight, suggest_hyperparams, train, evaluate, register_model in sequence)</em> <br />
          <strong>You</strong>: &ldquo;What's the accuracy?&rdquo; <br />
          <strong>Claude</strong>: &ldquo;97.3% on iris. The model is registered as the active one.&rdquo;
        </Callout>
        <p>
          The CLI was redundant. Every command we'd dreamed up — <code>train</code>,{" "}
          <code>sweep</code>, <code>diagnose</code> — was already a tool Claude could call.
          Designing a <em>verb-noun</em> CLI on top of the tools just hid them.
        </p>
        <p>
          So we cut the CLI's verb surface and kept only what Claude can't do: scaffolding (
          <code>ml-labs init</code>), updates (<code>ml-labs update</code>), serving the dashboard
          (<code>ml-labs dashboard</code>), serving docs (<code>ml-labs docs</code>). The training
          verbs all live in MCP. <strong>Three commands instead of thirty.</strong>
        </p>
      </Section>

      <Section eyebrow="The auto_train arc" title="Three coordinator architectures in twelve weeks.">
        <p>
          The <em>headline</em> tool — <code>auto_train</code> — has been rewritten three times. Each
          rewrite taught us something:
        </p>

        <div className="space-y-4">
          <div className="lab-panel p-5 border-purple-neon/30 border">
            <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-1">v0.1.4</div>
            <div className="font-semibold mb-1">All Claude — a single sub-agent prompt.</div>
            <p className="text-sm text-lab-text/80">
              Spawn one Claude sub-agent with an 11-tool allowlist and a long prompt: &ldquo;run
              preflight, suggest, sweep, evaluate, diagnose, promote.&rdquo; It worked. It was also
              non-deterministic — two runs on the same dataset gave different waves and different
              winners. Hard to test, hard to benchmark, hard to debug.
            </p>
          </div>

          <div className="lab-panel p-5 border-cyan-neon/30 border">
            <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-neon mb-1">v0.5.0</div>
            <div className="font-semibold mb-1">TS controller, Claude planner.</div>
            <p className="text-sm text-lab-text/80">
              The big rewrite. A deterministic TypeScript state machine owns the loop, the budget,
              and DB writes. Claude is called <em>only</em> for the judgment calls — what
              hyperparameters to try, why a run failed. Reproducible (seed in, same waves out),
              auditable (every decision is logged), faster (no Claude round-trips for the
              orchestration). The architecture has been stable since.
            </p>
          </div>

          <div className="lab-panel p-5 border-orange-neon/30 border">
            <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-1">v0.12.x — v1.10</div>
            <div className="font-semibold mb-1">Iterative smarts on top.</div>
            <p className="text-sm text-lab-text/80">
              Pattern memory (warm-start from past wins). TPE planner (Bayesian HPO once we have
              observations). Tournament mode (3 strategies in parallel). Memory budget guardrail (
              v1.8). Bug fixes through v1.10. The shape of the controller didn't change — we just
              kept layering judgment-call modules on top.
            </p>
          </div>
        </div>
      </Section>

      <Section eyebrow="The three principles" title="What we tell ourselves when arguing about features.">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Sparkles} title="Local-first" accent="cyan">
            <p>
              Everything runs on your laptop. No cloud, no auth, no telemetry. SQLite + Rust + Bun.
              You can use ML-Labs offline.
            </p>
            <p className="mt-2 text-xs text-lab-muted">
              Tradeoff: capped at CPU-scale workloads.
            </p>
          </InfoCard>
          <InfoCard icon={MessageSquare} title="Claude-native" accent="purple">
            <p>
              Designed for Claude Code, not against it. MCP is the primary surface. Tools are the
              language.
            </p>
            <p className="mt-2 text-xs text-lab-muted">
              Tradeoff: harder to use without an LLM (we expose HTTP / TUI but the experience is
              best with Claude).
            </p>
          </InfoCard>
          <InfoCard icon={Layers} title="Deterministic where it matters" accent="green">
            <p>
              Benchmarks must produce identical numbers across runs. <code>NEURON_PLANNER=rules + NEURON_SEED + NEURON_SWEEP_MODE=sequential</code>{" "}
              gives you bit-equivalence.
            </p>
            <p className="mt-2 text-xs text-lab-muted">
              Tradeoff: extra code paths. We chose this anyway.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What got cut" title="Things we tried, then deleted.">
        <ul className="space-y-3 text-sm">
          <li>
            <strong className="text-orange-neon">A verb-rich CLI.</strong> Tried <code>neuron train</code>,{" "}
            <code>neuron predict</code>, <code>neuron sweep</code>. All redundant once Claude was
            calling tools. Cut in v0.2.
          </li>
          <li>
            <strong className="text-orange-neon">A web auth layer.</strong> The dashboard had auth
            originally. Realised it's local-only by design; auth is dead weight. Removed.
            <code>NEURON_SERVE_TOKEN</code> remains as opt-in for tunnels.
          </li>
          <li>
            <strong className="text-orange-neon">An all-Claude coordinator.</strong> See above —
            replaced by the TS controller in v0.5.
          </li>
          <li>
            <strong className="text-orange-neon">Sub-agents as the always-default sweep.</strong> The
            v1.7.0 Fashion-MNIST OOM saga. Sub-agents are powerful but not free. We made them
            opt-in for safe workloads, mandatory for refuse, adaptive in between.
          </li>
          <li>
            <strong className="text-orange-neon">Fancy CNNs.</strong> Considered. Decided MLP-only
            until we have a real reason. ML-Labs is for tabular + small image + LLM-embedding
            workflows; CNNs add a lot of surface for diminishing returns.
          </li>
          <li>
            <strong className="text-orange-neon">A custom registry protocol.</strong> Considered HTTP
            registries with auth. Decided <code>~/.neuron/registry.db</code> + a URI scheme is
            enough. Cross-machine sharing happens via <code>scp</code> a bundle directory, not via a
            running server.
          </li>
        </ul>
      </Section>

      <Section eyebrow="What's coming" title="Where the project heads.">
        <p>
          The shape feels right. Future work is mostly <em>more of the same</em>: more rules in the
          planner, better calibration, smarter active-learning hooks, more featurize examples in the
          adapter cookbook. A few bigger ones:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Remote rs-tensor (HTTP mode) so heavy workloads can run on a beefier box.</li>
          <li>An &ldquo;ML-Labs cloud&rdquo; companion service — opt-in remote registry sharing.</li>
          <li>Better support for the LLM-as-featurizer pattern; treat <code>llm_generate</code> as a first-class adapter primitive.</li>
          <li>More worked examples — image walkthroughs, time-series patterns, NLP cookbook.</li>
        </ul>
        <Callout kind="note">
          The Roadmap is informally maintained in the CHANGELOG. Each release lists what got dropped
          permanently and what got deferred. We try to be honest about scope; ML-Labs will never be
          PyTorch.
        </Callout>
      </Section>

      <Section eyebrow="The tagline" title="What ML-Labs is, in one sentence.">
        <div className="lab-panel p-7 mt-4 text-center">
          <p className="text-2xl font-semibold gradient-text leading-snug">
            A Claude-native ML platform — train, sweep, and ship models from your terminal.
          </p>
        </div>
        <p className="mt-6 text-sm text-lab-muted leading-relaxed">
          Every word in that sentence is load-bearing. <em>Claude-native</em> = MCP-first.{" "}
          <em>Platform</em> = not a library; opinionated, batteries-included. <em>Train, sweep, and
          ship</em> = the verbs that matter, in order. <em>From your terminal</em> = local, not
          cloud.
        </p>
      </Section>

      <Section eyebrow="Credits" title="Who built this.">
        <p>
          ML-Labs is a side project of Yeabsera (
          <a href="https://github.com/wsyeabsera" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">@wsyeabsera</a>),
          built in collaboration with Claude. The architecture decisions, code review, and a lot of
          the prose come from those conversations — see the <code>Co-Authored-By</code> trailers in
          the git log.
        </p>
        <p>
          The Rust tensor backend (rs-tensor) is older than ML-Labs and was the seed. MCP is
          Anthropic's protocol. Bun, Vite, React, Tailwind, Ink, sharp, csv-parse — every one is a
          gift we depend on.
        </p>
      </Section>
    </div>
  )
}
