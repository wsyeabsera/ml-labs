import { Brain, Workflow, Zap } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { InfoCard } from "../components/InfoCard"

export function InsideSubagent() {
  return (
    <div>
      <PageHeader
        eyebrow="A nested Claude session, demystified"
        accent="purple"
        title={<>Inside a <span className="gradient-text">sub-agent</span>.</>}
        lede="Three places spawn Claude sub-agents: the auto_train planner, the diagnoser, and (when enabled) the parallel sweep mode. They look like magic — Claude calling itself? — but the mechanism is straightforward. This page shows what's happening."
      />

      <Section eyebrow="What a sub-agent is" title="A child Claude session with its own context.">
        <p>
          A sub-agent is a fresh Claude session spawned via the{" "}
          <code>@anthropic-ai/claude-agent-sdk</code> from inside a tool. It has its own conversation
          history (empty), its own system prompt (set by the spawner), and its own allowlist of tools.
          It runs to completion, returns its result to the parent tool, and dies.
        </p>
        <AsciiDiagram title="Spawning a sub-agent" accent="purple">
{`     parent Claude (your session)
                │
                ▼
            [tool call]
                │
                ▼
       ML-Labs tool: auto_train
                │
                │ wants Claude's judgment on hyperparams
                ▼
       SDK.query({
         systemPrompt: "You are a hyperparameter planner.",
         allowedTools: ["mcp__neuron__..."],
         maxTurns: 10,
         disallowedTools: ["Bash", "Read", "Edit", ...],
       })
                │
                ▼
       ┌───────────────────────────────────┐
       │  child Claude session              │
       │   - own conversation               │
       │   - sees only what spawner sent     │
       │   - can call only allowedTools     │
       │   - returns when "result" message  │
       │     fires, OR maxTurns hits        │
       └───────────────────────────────────┘
                │
                ▼
            result returned
                │
                ▼
       auto_train uses the result, finishes the tool call
                │
                ▼
     parent Claude continues normally`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Three callers" title="Where ML-Labs spawns sub-agents.">
        <Callout kind="learn" title="Each is narrow on purpose">
          Sub-agents are deliberately scoped tightly. Wide-toolbox sub-agents are slow (the LLM
          spends turns &ldquo;exploring&rdquo;). Narrow ones are fast and predictable.
        </Callout>

        <div className="space-y-4">
          <InfoCard icon={Brain} title="auto_train planner — wave config proposer" accent="purple">
            <CodeBlock
              lang="ts"
              title="core/auto/planner.ts (essence)"
              code={`SDK.query({
  systemPrompt: PLANNER_SYSTEM_PROMPT,   // strict JSON output contract
  allowedTools: [],                       // no tool calls — just JSON output
  disallowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
  maxTurns: 2,
  persistSession: false,
  mcpServers: { neuron: { type: "stdio", command: "bun", args: [SERVER_PATH] } },
})`}
            />
            <p>
              The planner gets the SignalBundle in its prompt, writes a JSON config list, returns.
              No tool calls — pure prompt → text output. Cost: 1 Claude API call per wave (~3-8s).
            </p>
          </InfoCard>

          <InfoCard icon={Workflow} title="auto_train diagnoser — failed-run analyser" accent="cyan">
            <p>
              Same shape as the planner. Spawned only when wave-best is below target AND severity is
              critical. Returns a structured JSON diagnosis (primary_cause + recommendations). Cost:
              one Claude call per diagnosis (only fires when needed, so often 0 per auto_train run).
            </p>
          </InfoCard>

          <InfoCard icon={Zap} title="run_sweep — one sub-agent per config (sub_agents mode)" accent="green">
            <CodeBlock
              lang="ts"
              title="core/sweep/orchestrator.ts (essence)"
              code={`// One sub-agent per config, run in Promise.all
const results = await Promise.all(
  configs.map((c) => runOneConfig(taskId, c, signal)),
)`}
            />
            <p>
              Each sub-agent has exactly one tool — <code>mcp__neuron__train</code> — and a prompt
              like &ldquo;train the task with these args, then output{" "}
              <code>{`{run_id, accuracy}`}</code>.&rdquo; Cost: one Claude API call per config + one
              MCP server boot per sub-agent (~1-2s).
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The cost" title="What each sub-agent really costs.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Latency.</strong> ~1-2s for the Agent SDK to boot a fresh session (load tools, advertise capabilities).</li>
          <li><strong>Memory.</strong> Each sub-agent process is ~250-300MB of Bun RSS. Plus its own MCP child-process to neuron. Plus rs-tensor's child for the train sub-agents. Adds up fast.</li>
          <li><strong>API tokens.</strong> Each sub-agent is a fresh Claude conversation — its context is sent on every turn. Short prompts keep cost low; that's why our planner prompt is tight.</li>
          <li><strong>Determinism.</strong> Each sub-agent's Claude call is non-deterministic by default (LLM sampling). NEURON_PLANNER=rules avoids spawning Claude planners; sub-agent sweeps still use Claude for the &ldquo;parse my args + call train + return JSON&rdquo; loop.</li>
        </ul>
      </Section>

      <Section eyebrow="Allowlists" title="The protective fence.">
        <p>
          Every sub-agent declares <code>allowedTools</code> + <code>disallowedTools</code>. The
          allowlist is positive (these are the tools you may call), the disallow list is for{" "}
          Claude Code's built-ins (Bash, Read, Edit, Write, Glob, Grep) that we never want a
          sub-agent to use — even if they'd be useful, they're a footgun.
        </p>
        <Callout kind="warn" title="Why disallowedTools is critical">
          A sub-agent with <code>Bash</code> access can do anything on your machine. Without explicit
          disallows, the SDK would inherit the parent session's tool list. We always disallow the
          file-system + shell tools so the sub-agent can <em>only</em> talk to neuron-mcp. If you
          add a new sub-agent caller in ML-Labs, copy this disallow list verbatim.
        </Callout>
      </Section>

      <Section eyebrow="The strict JSON output contract" title="Why parsing works.">
        <p>
          Planners and diagnosers return <em>only</em> JSON. The system prompt is explicit about
          this:
        </p>
        <CodeBlock
          lang="txt"
          title="core/auto/planner.ts — system prompt excerpt"
          code={`OUTPUT CONTRACT — strict JSON, nothing else:
{
  "configs": [<2-4 config objects>],
  "rationale": "<one short sentence>",
  "rules_fired": ["<tag>"],
  "rule_explanations": [
    { "name": "<id>", "title": "<headline>", "why": "<reason>", "evidence": ["<fact>"] }
  ]
}

Each config is a JSON object with optional keys: lr, epochs, head_arch, ...
HARDWARE CONSTRAINTS: CPU-only. Avoid epochs × N > 10M. Keep models < 1M params.

Think briefly, then commit. Reason per rule_explanation with concrete evidence.`}
        />
        <Callout kind="learn" title="Why the contract is strict">
          The parent tool needs to <code>JSON.parse</code> the result. Free-form prose breaks. The
          system prompt is engineered (and tested) so Claude reliably outputs valid JSON. Falls
          back to the rules planner if parsing fails — see <a href="/sampling-fallback" className="text-purple-neon hover:underline">Sampling Fallback</a>.
        </Callout>
      </Section>

      <Section eyebrow="maxTurns" title="The hard cap on how long a sub-agent can think.">
        <p>
          Each sub-agent has a <code>maxTurns</code> setting. Reaching it forces the session to
          end, regardless of whether Claude has produced output. Defaults:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Planner:</strong> maxTurns = 2. Pure JSON output; no thinking-out-loud round-trips.</li>
          <li><strong>Diagnoser:</strong> maxTurns = 2. Same.</li>
          <li><strong>Sweep sub-agents:</strong> maxTurns = 10. Need to call train (which can be long) and parse its result.</li>
        </ul>
      </Section>

      <Section eyebrow="Persistence" title="persistSession: false.">
        <p>
          Every ML-Labs sub-agent is spawned with <code>persistSession: false</code>. Each call is
          a fresh session — no memory of prior sub-agent runs. This is intentional: sub-agents are
          stateless workers, not long-running advisors.
        </p>
      </Section>

      <Section eyebrow="Cancellation" title="When sub-agents die mid-flight.">
        <p>
          The parent tool's AbortController propagates to spawned sub-agents. When auto_train's
          budget timer fires:
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Controller calls <code>ac.abort()</code></li>
          <li>The signal propagates to <code>runSweep</code></li>
          <li>Each sub-agent's <code>SDK.query</code> sees the signal and returns early</li>
          <li>If a sub-agent had already started a <code>train</code> call mid-flight, that train's underlying rs-tensor process also aborts (via train's own signal handling)</li>
          <li>Some sub-agent processes may not finish writing back to runs.status — that's why the v1.10.0 reaper unions registry with DB scan. See <a href="/postmortems" className="text-orange-neon hover:underline">Postmortem #3</a>.</li>
        </ol>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <CodeBlock
          lang="bash"
          code={`# Sub-agent spawners
neuron/src/core/auto/planner.ts        # Wave config planner
neuron/src/core/auto/diagnoser.ts      # Failed-run advisor
neuron/src/core/sweep/orchestrator.ts  # One per sweep config

# All three use the same SDK API
import { query } from "@anthropic-ai/claude-agent-sdk"

# The disallow list everyone shares
disallowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"]`}
        />
        <Callout kind="learn" title="If you add a new sub-agent caller">
          Copy the patterns: same SDK call shape, same disallowedTools, strict JSON output prompt,
          maxTurns ≤ 10, persistSession=false. Test the JSON parsing path with a fallback —
          <em>always</em> have a non-LLM fallback, because Sampling can be unavailable.
        </Callout>
      </Section>
    </div>
  )
}
