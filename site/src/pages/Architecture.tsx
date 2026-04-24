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
import { Table } from "../components/Table"

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
    desc: "43 tools. Owns tasks, samples, runs, sweeps, the registry, auto-train controller, memory-budget guardrails, calibration, drift, and LLaMA inference.",
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
              <li>deterministic TS orchestrator</li>
              <li>Claude planners (rules/Claude/TPE/tournament)</li>
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
          <InfoCard icon={Zap} title="Claude for judgment, TS for orchestration" accent="green">
            The coordinator is a deterministic TypeScript controller that owns the budget, the
            registry, and the DB writes. Claude gets called only for the judgment calls — planning
            the next wave of hyperparameters, diagnosing a failed run. This replaced an earlier
            all-Claude coordinator in v1.5 because the all-Claude version was not reproducible.
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
          code={`-- Core
CREATE TABLE tasks          (id TEXT PK, kind TEXT, feature_shape JSON, labels JSON, normalize BOOL, …);
CREATE TABLE samples        (id INT PK, task_id, label, features JSON, raw BLOB, split TEXT, …);
CREATE TABLE runs           (id INT PK, task_id, status, hyperparams JSON, weights JSON,
                             accuracy REAL, val_accuracy REAL, loss_history JSON,
                             calibration_temperature REAL, cv_fold_id INT, cv_parent_id INT, …);
CREATE TABLE models         (task_id PK, run_id, registered_at);

-- Auto-train (Phase 5+ / 6+ / 11.7)
CREATE TABLE auto_runs      (id INT PK, task_id, status, decision_log JSON,
                             waves_used, winner_run_id, verdict, verdict_json JSON, …);
CREATE TABLE auto_patterns  (id INT PK, task_fingerprint TEXT, dataset_shape JSON,
                             best_config JSON, best_metric REAL, metric_name TEXT);
CREATE TABLE auto_rule_stats (fingerprint, rule_name, fired_count, produced_winner_count);

-- Observability (v1.0.0+)
CREATE TABLE events         (id INT PK, ts INT, source TEXT, kind TEXT, task_id, run_id, payload JSON);
CREATE TABLE predictions    (id INT PK, ts INT, task_id, run_id, features JSON, label TEXT, confidence REAL);

-- Production reliability (v1.1.0)
CREATE TABLE shadow_models  (task_id PK, shadow_run_id, attached_at, agreement_rate REAL);

-- Batch prediction tracking (v1.4.0)
CREATE TABLE batch_predictions (id INT PK, task_id, path, status, total, completed, accuracy, …);`}
        />

        <Table
          caption="What each table is for"
          columns={[
            { key: "t",    header: "Table",            mono: true, accent: "cyan" },
            { key: "for",  header: "Used by" },
          ]}
          rows={[
            { t: "tasks",            for: "create_task, list_tasks. Schema for the ML problem." },
            { t: "samples",          for: "Every data ingestion tool (load_csv, collect, load_images)." },
            { t: "runs",             for: "train, cv_train. Everything a completed training produces." },
            { t: "models",           for: "register_model, predict. One row per task, points to the active run." },
            { t: "auto_runs",        for: "auto_train controller — decision_log + structured verdict." },
            { t: "auto_patterns",    for: "Cross-task warm-start memory. Fingerprint → best config." },
            { t: "auto_rule_stats",  for: "Which rules actually produced winners. Fed back to the Claude planner as context." },
            { t: "events",           for: "The events bus. Every state change writes here; SSE stream reads from here." },
            { t: "predictions",      for: "Every predict / batch_predict call. Source data for drift_check." },
            { t: "shadow_models",    for: "Shadow-model A/B testing — Phase 8.5." },
            { t: "batch_predictions", for: "Tracking async batch_predict jobs from the dashboard." },
          ]}
        />

        <p>
          Because <code>weights</code> is just JSON, you can export, diff, and import any run with{" "}
          <code>jq</code>. <code>decision_log</code> is append-only JSON so a second terminal can
          poll <code>get_auto_status</code> and see the controller narrate its reasoning. See the
          <a href="/observability" className="text-cyan-neon hover:underline"> Observability</a> page
          for the full story of events + decision_log.
        </p>
      </Section>
    </div>
  )
}
