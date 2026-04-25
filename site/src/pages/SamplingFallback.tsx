import { Brain, Cpu, Zap, ShieldAlert } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Table } from "../components/Table"
import { InfoCard } from "../components/InfoCard"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function SamplingFallback() {
  return (
    <div>
      <PageHeader
        eyebrow="When Claude is talking to itself"
        accent="purple"
        title={<><span className="gradient-text">MCP Sampling</span> + the fallback path.</>}
        lede="Some MCP tools want to ask the host LLM a question — not to do the work, but to make a judgment call (which hyperparameters to try, how to diagnose a failure). MCP Sampling is the protocol mechanism for that. ML-Labs uses it in three places. When it's unavailable, deterministic heuristics take over so nothing breaks."
      />

      <Section eyebrow="What MCP Sampling is" title="The tool asks the host.">
        <p>
          MCP servers usually call out — &ldquo;here's a tool, you call it.&rdquo; Sampling inverts
          that direction: the server asks the host (Claude Code) to run a completion with a given
          prompt, and the host returns the LLM's reply. The tool then uses that reply in its own
          response.
        </p>
        <AsciiDiagram title="Normal MCP call vs Sampling" accent="purple">
{`  Normal:
    Claude  ──── tool call ───▶  MCP server
            ◀── tool result ───

  Sampling:
    Claude  ──── tool call ───▶  MCP server
              (server thinks)
            ◀── sampling req ──   "Hey Claude, here's a prompt..."
            ──── completion ──▶
              (server uses it)
            ◀── tool result ───`}
        </AsciiDiagram>
        <Callout kind="learn" title="Why it's useful">
          ML-Labs has three places where the right answer needs <em>judgment</em>: what
          hyperparameters to try, why a failed run failed, what wave of configs to plan next. Hand-coding
          rules works but produces lifeless suggestions. Asking Claude — without leaving the tool's
          context — produces tailored, contextual reasoning.
        </Callout>
      </Section>

      <Section eyebrow="Where ML-Labs uses it" title="Three places.">
        <Table
          columns={[
            { key: "tool",     header: "Tool",                accent: "purple" },
            { key: "asks",     header: "What it asks Claude" },
            { key: "fallback", header: "If Sampling unavailable" },
          ]}
          rows={[
            {
              tool: <code>suggest_hyperparams</code>,
              asks: "Given task shape + data health, recommend lr / epochs / head_arch / optimizer / loss / etc.",
              fallback: "Heuristic: small N → smaller arch + more epochs; high D → cosine schedule + AdamW; imbalanced → class_weights='balanced'. Always returns SOMETHING.",
            },
            {
              tool: <code>diagnose</code>,
              asks: "Given confusion matrix + per-class accuracy + loss history, what went wrong and what to try next?",
              fallback: "Severity bucketing by accuracy + per-class variance. Recommendations from a fixed rule list (overfit → weight_decay; one weak class → class_weights; flat loss → lr).",
            },
            {
              tool: <span><code>auto_train</code> Claude planner</span>,
              asks: "Given current wave's signals, propose 3 configs for the next wave.",
              fallback: "core/auto/rules.ts — deterministic if-then refinement. Used when NEURON_PLANNER=rules or Sampling fails.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="The decision tree" title="When does sampling fire vs the fallback.">
        <AsciiDiagram title="Per-call sampling decision" accent="purple">
{`        tool wants to call sampling
                    │
                    ▼
       ┌─────────────────────────────────┐
       │ MCP server has Sampling capability? │
       │ (host advertised it on init?)    │
       └─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
       yes                      no
        │                        │
        ▼                        ▼
   ┌─────────────┐         ┌─────────────────┐
   │ send req    │         │ skip — call     │
   │ (with timeout) │         │ heuristic       │
   └─────────────┘         └─────────────────┘
        │                        │
   ┌────┴─────┐                  │
  ok         err                  │
   │          │                  │
   ▼          ▼                  ▼
 use     ┌──────────┐    ┌──────────────┐
 reply   │ heuristic│    │ heuristic    │
         │ (fallback)│    │ (deterministic)│
         └──────────┘    └──────────────┘`}
        </AsciiDiagram>

        <p>
          Three cases trigger the fallback path:
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>The host (Claude Code) didn't advertise Sampling capability on connect (e.g. headless agent SDK invocation, batch CI script).</li>
          <li>The Sampling request errored or timed out.</li>
          <li>Environment variable forces it: <code>NEURON_PLANNER=rules</code> for the auto_train planner.</li>
        </ol>
      </Section>

      <Section eyebrow="The heuristic fallbacks" title="What deterministic looks like.">
        <Table
          caption="suggest_hyperparams — heuristic decision table"
          columns={[
            { key: "if",     header: "If",      accent: "cyan" },
            { key: "then",   header: "Then" },
          ]}
          rows={[
            { if: "kind = regression",                          then: <>loss = mse, K = 1, output = scaled regression value</> },
            { if: "kind = classification, K ≥ 2",               then: <>loss = cross_entropy, K = num_classes</> },
            { if: "imbalance_ratio &gt; 3",                     then: <>add class_weights = &ldquo;balanced&rdquo;</> },
            { if: "N &lt; 100",                                 then: <>full-batch (omit batch_size), more epochs (1000+)</> },
            { if: "N ≥ 100",                                    then: <>batch_size = min(32, N/10), epochs = 500</> },
            { if: "D ≥ 100",                                    then: <>activation = relu (ReLU family), init = kaiming, optimizer = adamw, weight_decay = 1e-4</> },
            { if: "D &lt; 100",                                 then: <>activation = tanh, init = xavier, optimizer = sgd</> },
            { if: "(any uncertainty)",                          then: <>cosine lr_schedule with min_lr = lr × 0.01, early_stop_patience = 50</> },
          ]}
        />

        <Callout kind="note">
          The heuristics never produce a <em>great</em> config — but they always produce a working
          one. When the LLM is online, expect ~5pp better accuracy on average. When it's not, you
          still get something trainable.
        </Callout>
      </Section>

      <Section eyebrow="What controls availability" title="Three ways to disable Sampling.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Brain} title="Host doesn't advertise" accent="purple">
            Claude Code advertises Sampling capability on connect. Other MCP hosts (some SDK
            embeddings, headless tooling) may not. Check via <code>/api/health</code>.
          </InfoCard>
          <InfoCard icon={Cpu} title="No API key / offline" accent="cyan">
            Even when Claude Code is running, Sampling needs network egress to Anthropic's API.
            Offline → falls back automatically.
          </InfoCard>
          <InfoCard icon={Zap} title="NEURON_PLANNER=rules" accent="green">
            Force-disable for the auto_train planner specifically. Used by the benchmark suite for
            determinism.
          </InfoCard>
          <InfoCard icon={ShieldAlert} title="Per-call timeout" accent="orange">
            Each Sampling request has a timeout. If the LLM takes too long (transient network
            issue), the tool falls back to heuristics for that call only.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Detection" title="Did Sampling actually fire?">
        <p>
          Tools that use Sampling include a <code>source</code> field in their output:
        </p>
        <CodeBlock
          lang="json"
          title="suggest_hyperparams output"
          code={`{
  "lr": 0.001,
  "epochs": 800,
  "head_arch": [4, 32, 3],
  "optimizer": "adamw",
  "...",
  "source": "claude",     // "claude" | "rules"
  "reasoning": [
    "Claude noted the small N (150) suggests full-batch.",
    "K=3 → cross_entropy."
  ]
}`}
        />

        <CodeBlock
          lang="json"
          title="auto_train decision_log entry"
          code={`{
  "stage": "sweep_wave_1_plan",
  "note": "...",
  "payload": {
    "source": "rules",   // "rules" | "planner" | "tournament" | "tpe"
    "configs": [...],
    "rules_fired": ["warm_start"]
  }
}`}
        />
      </Section>

      <Section eyebrow="Reproducibility" title="Forcing the deterministic path.">
        <CodeBlock
          lang="bash"
          title="The full deterministic recipe"
          code={`# Claude planner is bypassed
export NEURON_PLANNER=rules

# Sub-agent sweep mode is bypassed (would itself spawn Claude calls)
export NEURON_SWEEP_MODE=sequential

# Random shuffle / init is fixed
export NEURON_SEED=42

# Now auto_train output is bit-identical across runs
auto_train({ task_id: "iris" })`}
        />
        <Callout kind="tip">
          This is exactly what <code>bun run bench</code> uses. If you're CI-ing model quality, do
          this — the &ldquo;same code in, same numbers out&rdquo; guarantee makes regressions
          obvious.
        </Callout>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/tools/suggest_hyperparams.ts", what: "Sampling call + heuristic fallback for hyperparameter suggestions." },
            { file: "neuron/src/tools/diagnose.ts",            what: "Sampling call + rule-based diagnosis fallback." },
            { file: "neuron/src/core/auto/planner.ts",         what: "Claude planner sub-agent prompt + JSON parsing." },
            { file: "neuron/src/core/auto/rules.ts",           what: "Deterministic if-then refinement rules. Used as fallback throughout." },
            { file: "neuron/src/core/auto/diagnoser.ts",       what: "Claude diagnoser sub-agent (post-wave advisory)." },
          ]}
        />
      </Section>
    </div>
  )
}
