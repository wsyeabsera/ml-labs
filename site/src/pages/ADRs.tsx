import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Callout } from "../components/Callout"
import type { ReactNode } from "react"

interface ADR {
  number: string
  title: string
  status: "accepted" | "deprecated" | "superseded"
  date: string
  context: ReactNode
  decision: ReactNode
  consequences: ReactNode
}

const adrs: ADR[] = [
  {
    number: "ADR-001",
    title: "TypeScript controller replaces Claude coordinator",
    status: "accepted",
    date: "2026-04-20 (v0.5.0)",
    context: (
      <>
        Initial auto_train (v0.1.4) was a single Claude sub-agent with a long prompt and an 11-tool
        allowlist. The agent ran preflight → suggest → sweep → evaluate → diagnose → promote in
        sequence based on the prompt. It worked, but had three problems:
        <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
          <li>Non-deterministic — two runs on the same data produced different sweeps.</li>
          <li>Hard to test — every change in the prompt was a behaviour change.</li>
          <li>Slow — every state transition was a Claude round-trip (~2-5s each).</li>
        </ol>
      </>
    ),
    decision: (
      <>
        Split orchestration from judgment. A deterministic TypeScript state machine
        (<code>core/auto/controller.ts</code>) owns the loop, the budget, the DB writes, and the
        winner-selection. Claude is called <em>only</em> for narrowly-scoped judgment calls —
        what hyperparameters to try (planner) and why a run failed (diagnoser). Each Claude call
        has a JSON output contract so the controller can parse and validate.
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Reproducibility.</strong> Same code + same data + same seed = same waves and same winner.</li>
        <li><strong>Auditability.</strong> Every decision logs to <code>auto_runs.decision_log</code>.</li>
        <li><strong>Speed.</strong> No Claude in the orchestration hot path — only in 1-2 judgment calls per wave.</li>
        <li><strong>Code size.</strong> 750-line controller + ~250-line planner. More than the prompt was, but each piece is testable.</li>
        <li><strong>Tradeoff.</strong> The system is more "engineered" — harder to tweak with prompt changes alone. Adding a new heuristic means writing TypeScript.</li>
      </ul>
    ),
  },
  {
    number: "ADR-002",
    title: "Sequential sweep is the default; sub-agents are opt-in",
    status: "accepted",
    date: "2026-04-21 (v1.7.0)",
    context: (
      <>
        Pre-v1.7.0, <code>run_sweep</code> always spawned 3 Claude Agent SDK sub-agents in parallel.
        For small datasets this was a 2-3× wall-clock win. For Fashion-MNIST it was a 3.6 GB
        peak-RSS disaster — each sub-agent loaded its own copy of the input tensor (~1.2 GB for
        60k×784), times 3 sub-agents, plus the host Bun process. 8 GB laptops OOM-killed.
      </>
    ),
    decision: (
      <>
        Flip the default to <code>runSweepSequential</code> — one config at a time, in-process, via
        <code> startTrainBackground</code>. Sub-agents become opt-in via{" "}
        <code>NEURON_SWEEP_MODE=sub_agents</code>. v1.8.1 then added the adaptive switch in
        auto_train: pick sub-agents for safe / advisory budget, sequential for heavy.
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Memory safety.</strong> Default mode no longer crashes 8GB hosts on big data.</li>
        <li><strong>Slower small-data sweeps.</strong> Without the auto-detect (v1.7.0 only), iris went from 4s to 12s.</li>
        <li><strong>Adaptive switch (v1.8.1).</strong> Restored the speed for safe workloads while keeping the safety for heavy ones.</li>
        <li><strong>Tradeoff.</strong> More complexity — two execution paths to maintain.</li>
      </ul>
    ),
  },
  {
    number: "ADR-003",
    title: "Local-first, no-cloud architecture",
    status: "accepted",
    date: "2026-04-19 (v0.1.1)",
    context: (
      <>
        Most ML platforms (W&amp;B, MLflow, Determined) require a cloud account or a self-hosted
        server. ML-Labs's target user starts a Claude Code session and types &ldquo;train iris&rdquo; —
        anything that requires &ldquo;first sign up at...&rdquo; loses 90% of those users in the first
        minute.
      </>
    ),
    decision: (
      <>
        Everything runs on the user's laptop. SQLite for state, Rust child process for math, Bun for
        the server, no network calls. <code>~/.neuron/registry/</code> is the only cross-project
        store, and it's a local directory. No accounts, no API keys (other than the user's existing
        Claude Code key).
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Zero onboarding friction.</strong> <code>curl | bash</code> install, immediate usable.</li>
        <li><strong>Privacy.</strong> No data leaves your machine unless Claude makes an API call (Sampling).</li>
        <li><strong>Capped at CPU-scale.</strong> No GPU, no distributed training.</li>
        <li><strong>Sharing is opt-in.</strong> Cross-project model sharing happens via <code>scp</code> bundle directories or shared filesystem mounts. No central registry.</li>
        <li><strong>Tradeoff.</strong> If you do want a team-wide registry, you have to build the sync yourself (or run multiple <code>~/.neuron/</code> mounts).</li>
      </ul>
    ),
  },
  {
    number: "ADR-004",
    title: "MCP everywhere: rs-tensor, neuron, dashboard all expose MCP",
    status: "accepted",
    date: "2026-04-19 (v0.1.1)",
    context: (
      <>
        rs-tensor predates ML-Labs and was already an MCP server. Building neuron-mcp on top meant
        we had two choices:
        <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
          <li>Have neuron <em>shell out</em> to rs-tensor as a Rust library.</li>
          <li>Have neuron <em>speak MCP</em> to rs-tensor as a child process.</li>
        </ol>
      </>
    ),
    decision: (
      <>
        Speak MCP. Neuron spawns rs-tensor as a child process and talks to it over the same
        protocol Claude uses to talk to neuron. Two consequences fall out:
        <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
          <li>One mental model. If you understand MCP for Claude→neuron, you understand it for neuron→rs-tensor.</li>
          <li>Distributed by default. <code>RS_TENSOR_MCP_URL</code> can point at a remote rs-tensor with no other code changes.</li>
        </ol>
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Composability.</strong> Adding a new tensor op means adding a tool, not exposing a function.</li>
        <li><strong>Debuggability.</strong> Every neuron→rs-tensor call is structured JSON. Tail with <code>strace</code> or in dev dump to a file.</li>
        <li><strong>Overhead.</strong> JSON serialization on every call. Significant for tiny tensors. We mitigate by sending flat number[] instead of nested arrays (v1.7.1).</li>
        <li><strong>Tradeoff.</strong> Two processes instead of one. Tying the lifecycle (neuron must boot rs-tensor) is mild operational cost.</li>
      </ul>
    ),
  },
  {
    number: "ADR-005",
    title: "SQLite WAL is the only durable store",
    status: "accepted",
    date: "2026-04-19 (v0.1.1)",
    context: (
      <>
        Multiple processes need to read and write the same state: the MCP server, the HTTP
        dashboard, sub-agents during a sweep, the TUI. Options were a queue (Redis), a network DB
        (Postgres), or an embedded engine.
      </>
    ),
    decision: (
      <>
        SQLite in WAL mode. WAL allows N readers + 1 writer simultaneously without locking;
        embedded means no daemon to manage; SQL is universal; and{" "}
        <code>jq</code>-friendly JSON columns let us punt on rigid schema for nested state
        (decision_log, weights, hyperparams).
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Zero ops.</strong> No daemon, no port, no auth.</li>
        <li><strong>Concurrency works.</strong> 3 sub-agents writing to <code>runs</code> simultaneously is fine.</li>
        <li><strong>Tooling.</strong> sqlite3 + jq + any GUI just works.</li>
        <li><strong>Cap.</strong> Single-machine. If we ever need cross-machine state, we add a sync layer (rsync, litestream) on top — don't change the storage layer.</li>
        <li><strong>JSON-in-text columns.</strong> Schema migrations via <code>ensureColumns</code>; flexible payloads via JSON. Tradeoff: less rigorous typing.</li>
      </ul>
    ),
  },
  {
    number: "ADR-006",
    title: "CPU-only, no GPU support in rs-tensor",
    status: "accepted",
    date: "2026-04-19 (v0.1.1)",
    context: (
      <>
        Adding GPU support to rs-tensor would mean wgpu / CUDA / Metal kernels, build dependencies,
        per-platform binaries, driver compatibility issues. Significant code, significant
        operational cost. The use case ML-Labs targets — small tabular, small image, prototype LLM
        inference — runs fine on CPU.
      </>
    ),
    decision: (
      <>
        rs-tensor is CPU-only. The memory_budget guardrail (Phase 11.7) makes this honest by
        refusing workloads that would crash a CPU host. Power users who need GPU should use PyTorch
        / JAX directly; ML-Labs is not for them.
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>One binary.</strong> No <code>cargo install</code> permutations, no CUDA driver hell.</li>
        <li><strong>Capped at small-to-medium data.</strong> Anything past ~60M input cells (Fashion-MNIST scale) is slow.</li>
        <li><strong>LLM inference is slow.</strong> 5-10 tok/s on a 1B model. Fine for pipelines, miserable for chat.</li>
        <li><strong>Honest scope.</strong> ML-Labs's tagline doesn't promise GPU performance.</li>
      </ul>
    ),
  },
  {
    number: "ADR-007",
    title: "Adapter hash gates model imports",
    status: "accepted",
    date: "2026-04-21 (v1.6.2)",
    context: (
      <>
        Cross-project model sharing via <code>publish_model</code> + <code>import_model</code>{" "}
        creates a silent failure mode: project A's <code>featurize()</code> normalises pixels to
        [0, 1]; project B's normalises to [-1, 1]. Importing A's model into B works
        syntactically — it has the right shape — but produces garbage predictions silently. No
        error, no warning, just bad output.
      </>
    ),
    decision: (
      <>
        SHA-256 the entire <code>neuron.config.ts</code> file at publish time. Store the hash in the
        bundle as <code>adapter.hash</code>. On import, compute the destination's hash and refuse
        on mismatch. The user can pass <code>force: true</code> to bypass — but only after consciously
        verifying the featurize functions match.
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Silent failure becomes loud failure.</strong> Better.</li>
        <li><strong>False positives.</strong> Cosmetic edits to neuron.config.ts (whitespace, comments) trigger the guard. Workaround: <code>force: true</code>.</li>
        <li><strong>Best-effort.</strong> Doesn't catch <em>data</em> changes, only adapter changes. So if you publish at training-time normalize and the data shifted underneath you, the guard won't help. drift_check is the runtime answer for that.</li>
      </ul>
    ),
  },
  {
    number: "ADR-008",
    title: "Decision log as append-only JSON in a single SQLite cell",
    status: "accepted",
    date: "2026-04-21 (v0.5.0)",
    context: (
      <>
        Every auto_train invocation needs to record what it did, why, and in what order. Options
        were:
        <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
          <li>A separate <code>auto_log_entries</code> table with one row per entry.</li>
          <li>A JSON array column on <code>auto_runs</code>, appended to.</li>
          <li>An external log file per auto_run.</li>
        </ol>
      </>
    ),
    decision: (
      <>
        JSON array on <code>auto_runs.decision_log</code>. Read-only-from-the-controller's-perspective
        is enforced by the <code>appendAutoLog</code> helper. <code>get_auto_status</code> returns
        the array verbatim.
      </>
    ),
    consequences: (
      <ul className="list-disc list-inside space-y-1 text-sm">
        <li><strong>Atomic with the run.</strong> Cancellation, deletion, etc. operate on one row.</li>
        <li><strong>Single query.</strong> get_auto_status is a single SELECT.</li>
        <li><strong>Limit.</strong> The blob can get big (~30-50 entries). For our scale, fine. Past ~thousands, would need sharding.</li>
        <li><strong>Querying.</strong> SQLite's JSON1 extension handles inspection with <code>json_extract</code>.</li>
      </ul>
    ),
  },
]

export function ADRs() {
  return (
    <div>
      <PageHeader
        eyebrow="The why behind the how"
        accent="purple"
        title={<>Architecture <span className="gradient-text">decision records</span>.</>}
        lede="Most projects bury design rationale in commit messages. This page surfaces the big calls — when we made them, why, and what we paid for them. ADRs are perma-historical: even when a decision is reversed, the original ADR stays so future you can read why."
      />

      <Section eyebrow="Format" title="Each ADR has the same shape.">
        <div className="lab-panel p-5 my-4">
          <ul className="list-disc list-inside space-y-1 text-sm text-lab-text/85">
            <li><strong>Context.</strong> The problem at the moment we made the call.</li>
            <li><strong>Decision.</strong> What we picked and why.</li>
            <li><strong>Consequences.</strong> What we got and what we gave up. Honest about both.</li>
          </ul>
        </div>
        <Callout kind="learn" title="Why ADRs">
          The decision-making process itself is a primary artefact. Reading why we did X often
          beats reading what X is — especially for new contributors deciding whether they should
          challenge a design choice.
        </Callout>
      </Section>

      <div className="space-y-8">
        {adrs.map((adr) => (
          <Section
            key={adr.number}
            eyebrow={`${adr.number} · ${adr.date}`}
            title={adr.title}
          >
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className={`text-xs font-mono px-2 py-0.5 rounded-md ${
                adr.status === "accepted" ? "bg-green-neon/10 text-green-neon border border-green-neon/30" :
                adr.status === "deprecated" ? "bg-orange-neon/10 text-orange-neon border border-orange-neon/30" :
                "bg-pink-neon/10 text-pink-neon border border-pink-neon/30"
              }`}>
                status: {adr.status}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-cyan-neon mb-2">Context</div>
                <div className="text-sm text-lab-text/85">{adr.context}</div>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-purple-neon mb-2">Decision</div>
                <div className="text-sm text-lab-text/85">{adr.decision}</div>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-orange-neon mb-2">Consequences</div>
                <div className="text-sm text-lab-text/85">{adr.consequences}</div>
              </div>
            </div>
          </Section>
        ))}
      </div>

      <Section eyebrow="Where they come from" title="Living in the changelog.">
        <p>
          ADRs aren't separate files in this repo (yet). They're extracted from the
          phase summaries in <code>CHANGELOG.md</code> and the rationale text in commit messages.
          See the <a href="/changelog" className="text-cyan-neon hover:underline">Changelog</a>{" "}
          for the firsthand account of each decision.
        </p>
        <Callout kind="tip" title="Adding a new ADR">
          When you make a load-bearing decision (something a new contributor would otherwise have to
          guess about), add a paragraph to the next CHANGELOG entry, then surface it here. Keep it
          to context / decision / consequences — each section &lt;200 words. Long ADRs don't get
          read.
        </Callout>
      </Section>
    </div>
  )
}
