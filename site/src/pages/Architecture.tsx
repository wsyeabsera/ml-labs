import {
  Cpu,
  Database,
  Beaker,
  Brain,
  Terminal,
  Layers,
  Zap,
  FileCode,
  HardDrive,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { StackDiagram, type StackLayer } from "../components/StackDiagram"
import { InfoCard } from "../components/InfoCard"
import { CodeBlock } from "../components/CodeBlock"
import { DataFlow } from "../components/DataFlow"

const stack: StackLayer[] = [
  {
    label: "Claude Code",
    tag: "UI",
    desc: "Where humans type English. Turns intent into tool calls. Sub-agent spawn lives here.",
    icon: Terminal,
    accent: "pink",
  },
  {
    label: "Neuron MCP server",
    tag: "stdio · TypeScript · Bun",
    desc: "30 tools. Owns the task/sample/run model, the sweep orchestrator, the registry, and the auto-train coordinator.",
    icon: Beaker,
    accent: "purple",
  },
  {
    label: "SQLite (WAL) + rs-tensor",
    tag: "persistence + math",
    desc: "SQLite holds tasks, samples, runs, models, auto_runs. rs-tensor (separate MCP server, Rust) owns forward/backward and weights-in-memory.",
    icon: Database,
    accent: "cyan",
  },
]

export function Architecture() {
  return (
    <div>
      <PageHeader
        eyebrow="How it fits together"
        accent="purple"
        title={<>The whole <span className="gradient-text">stack</span>, bottom to top.</>}
        lede="Three processes, two MCP transports, one SQLite DB. Nothing goes over the network. Everything is replaceable."
      />

      <Section eyebrow="The three layers" title="Each layer does one job.">
        <p>
          Every arrow below is a stdio pipe carrying JSON-RPC. Nothing in this system waits on a
          cloud, nothing authenticates with a bearer token, and nothing is using HTTP except rs-tensor
          (which exposes itself as an HTTP MCP server for convenience).
        </p>
        <StackDiagram layers={stack} />
      </Section>

      <Section eyebrow="A call path" title="What happens when you say “train iris”.">
        <DataFlow
          nodes={[
            { label: "You", sub: "English", accent: "pink" },
            { label: "Claude Code", sub: "tool calls", accent: "purple" },
            { label: "Neuron MCP", sub: "stdio JSON-RPC", accent: "cyan" },
            { label: "rs-tensor", sub: "Rust tensors", accent: "green" },
            { label: "SQLite", sub: "weights + logs", accent: "orange" },
          ]}
        />
        <p>
          Claude picks the tool (<code>mcp__neuron__train</code>), Neuron receives JSON-RPC over
          stdin, it in turn calls <code>init_mlp</code> and <code>train_mlp</code> on rs-tensor,
          and when the run completes Neuron serializes weights back into a row of the{" "}
          <code>runs</code> table in SQLite. The whole thing is deterministic given a seed.
        </p>
      </Section>

      <Section eyebrow="What lives where" title="Processes, ports, paths.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Terminal} title="Neuron MCP server" accent="purple">
            <p className="mb-2">
              stdio transport spawned by Claude Code from <code>.mcp.json</code>.
            </p>
            <ul className="text-xs font-mono text-lab-muted list-disc list-inside space-y-0.5">
              <li>entry: <span className="text-lab-text">neuron/src/server.ts</span></li>
              <li>runner: <span className="text-lab-text">bun</span></li>
              <li>db: <span className="text-lab-text">data/neuron.db</span></li>
            </ul>
          </InfoCard>
          <InfoCard icon={Cpu} title="rs-tensor MCP server" accent="cyan">
            <p className="mb-2">
              Separate process. HTTP transport. Rust. Handles the actual GPU-free math.
            </p>
            <ul className="text-xs font-mono text-lab-muted list-disc list-inside space-y-0.5">
              <li>tools: init_mlp, train_mlp, tensor_create…</li>
              <li>state: MLPs live in in-memory maps</li>
            </ul>
          </InfoCard>
          <InfoCard icon={HardDrive} title="Local registry" accent="pink">
            <p className="mb-2">
              Global across all your projects, keyed by URI.
            </p>
            <ul className="text-xs font-mono text-lab-muted list-disc list-inside space-y-0.5">
              <li>root: <span className="text-lab-text">~/.neuron/registry/</span></li>
              <li>index: <span className="text-lab-text">~/.neuron/registry.db</span></li>
              <li>uri shape: <span className="text-lab-text">neuron://local/name@ver</span></li>
            </ul>
          </InfoCard>
          <InfoCard icon={Brain} title="Auto-train coordinator" accent="orange">
            <p className="mb-2">
              Ephemeral Claude sub-agent spawned via Agent SDK. Dies when done.
            </p>
            <ul className="text-xs font-mono text-lab-muted list-disc list-inside space-y-0.5">
              <li>orchestrator: core/auto/coordinator.ts</li>
              <li>11 tools on allowlist</li>
              <li>decision log: auto_runs.decision_log</li>
            </ul>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Why these tradeoffs" title="Key design choices.">
        <div className="space-y-4">
          <InfoCard icon={Layers} title="MCP all the way down" accent="cyan">
            Both rs-tensor and Neuron are MCP servers. That means Claude can talk to either
            directly — and when Neuron needs tensor math, it speaks the same protocol its own
            clients speak. One mental model, one debugging surface.
          </InfoCard>
          <InfoCard icon={Database} title="SQLite with WAL mode" accent="purple">
            Sweeps spawn sub-processes. Sub-processes each instantiate a neuron-mcp. They all need
            to read and write the same DB without serializing to a queue.{" "}
            <code className="text-purple-neon">journal_mode = WAL</code> is the cheapest multi-reader
            setup that exists, and it is embedded — no daemon to manage.
          </InfoCard>
          <InfoCard icon={Zap} title="Sub-agents as control flow" accent="green">
            The coordinator isn't a hard-coded TypeScript state machine. It's a Claude sub-agent
            with an allowlist of 11 tools and a prompt that explains the goal. Decisions like
            "should I retry with a deeper head?" are judgment calls — Claude does those well.
          </InfoCard>
          <InfoCard icon={FileCode} title="neuron.config.ts: the featurize seam" accent="pink">
            Every project picks its own feature transform in a single <code>neuron.config.ts</code>.
            Its hash travels with every published model so we refuse to load a model whose
            featurize is incompatible.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The database" title="The tables, briefly.">
        <CodeBlock
          lang="sql"
          title="data/neuron.db (simplified)"
          code={`CREATE TABLE tasks        (id TEXT PK, kind TEXT, feature_shape JSON, ...);
CREATE TABLE samples      (id INT PK, task_id, label, features JSON, raw BLOB, ...);
CREATE TABLE runs         (id INT PK, task_id, status, hyperparams JSON, weights JSON,
                           accuracy REAL, loss_history JSON, run_progress REAL, ...);
CREATE TABLE models       (task_id PK, run_id, registered_at);
CREATE TABLE auto_runs    (id INT PK, task_id, status, decision_log JSON,
                           waves_used, winner_run_id, verdict, ...);`}
        />
        <p>
          Because <code>weights</code> is just JSON, you can export, diff, and import any run with{" "}
          <code>jq</code>. <code>decision_log</code> is append-only JSON so a second terminal can
          poll <code>get_auto_status</code> and see the coordinator narrate its own reasoning.
        </p>
      </Section>
    </div>
  )
}
