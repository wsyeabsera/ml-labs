import { Settings2, FileCog, Network, Layers, Zap, Database } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function EnvVars() {
  return (
    <div>
      <PageHeader
        eyebrow="Process-level configuration"
        accent="purple"
        title={<>Environment <span className="gradient-text">variables</span>.</>}
        lede="ML-Labs reads a small set of environment variables for cross-cutting configuration — paths, ports, planner mode, sweep mode, seeds. This page lists every one we honour, what it does, when to set it."
      />

      <Section eyebrow="Storage paths" title="Where ML-Labs reads and writes.">
        <Table
          columns={[
            { key: "var",     header: "Variable",        mono: true, accent: "cyan", width: "200px" },
            { key: "default", header: "Default",         mono: true },
            { key: "what",    header: "What it does" },
          ]}
          rows={[
            {
              var: "NEURON_DB",
              default: "data/neuron.db",
              what: "Path to the SQLite database. Override to put it elsewhere or share it across projects. ml-labs init wires .mcp.json so each project has its own ./data/neuron.db, but you can point multiple projects at one shared file if you want a unified registry/runs view.",
            },
            {
              var: "NEURON_DB_PATH",
              default: "(alias for NEURON_DB)",
              what: "Older name; still respected. Prefer NEURON_DB.",
            },
            {
              var: "NEURON_HOME",
              default: "$HOME/.neuron",
              what: "Root for the cross-project registry — bundles + registry.db live under here. Override only if you want to relocate the shared registry.",
            },
            {
              var: "NEURON_LOG_FILE",
              default: "(stdout only)",
              what: "When set, also append every Neuron log line to this file. Useful for capturing MCP-server output from a Claude Code session for offline debugging.",
            },
            {
              var: "DASHBOARD_DIST",
              default: "../../dashboard/dist (relative to api.ts)",
              what: "Override where the HTTP server looks for the pre-built dashboard React bundle. Defaults to the in-repo build; only override if you're hosting a custom build elsewhere.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="HTTP server" title="Networking + auth.">
        <Table
          columns={[
            { key: "var",     header: "Variable",   mono: true, accent: "cyan", width: "200px" },
            { key: "default", header: "Default",    mono: true },
            { key: "what",    header: "What it does" },
          ]}
          rows={[
            {
              var: "NEURON_API_PORT",
              default: "2626",
              what: "Port the HTTP dashboard listens on. ml-labs dashboard always uses this. Change if 2626 collides.",
            },
            {
              var: "NEURON_SERVE_TOKEN",
              default: "(none)",
              what: "When set, the HTTP server requires Authorization: Bearer <token> on /api/* requests. Off by default — local-only dashboards don't need auth — but enable when exposing the dashboard over a network.",
            },
            {
              var: "NEURON_PREDICTION_SAMPLE_RATE",
              default: "1.0",
              what: "Fraction of predict / batch_predict calls written to the predictions table (used by drift_check). 1.0 = log every call. Drop to 0.1 in high-throughput contexts to keep the predictions table from blowing up.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="rs-tensor backend" title="The Rust math layer.">
        <Table
          columns={[
            { key: "var",     header: "Variable",  mono: true, accent: "green", width: "230px" },
            { key: "default", header: "Default",   mono: true },
            { key: "what",    header: "What it does" },
          ]}
          rows={[
            {
              var: "RS_TENSOR_BIN",
              default: "rs-tensor/target/release/mcp",
              what: "Path to the rs-tensor MCP binary. Defaults relative to the install. Override if you've built rs-tensor elsewhere or want to pin a specific version.",
            },
            {
              var: "RS_TENSOR_MCP_URL",
              default: "(none)",
              what: "When set, neuron talks to rs-tensor over HTTP at this URL instead of spawning a child process. For pointing at a remote rs-tensor (e.g. a heavier machine).",
            },
            {
              var: "RS_TENSOR_TIMEOUT_MS",
              default: "120000 (2 min)",
              what: "Per-call timeout when neuron talks to rs-tensor. Bump for very large training jobs.",
            },
            {
              var: "RS_TENSOR_MAX_TIMEOUT_MS",
              default: "1800000 (30 min)",
              what: "Hard cap on the per-call timeout. Even per-call overrides cannot exceed this.",
            },
          ]}
        />
        <Callout kind="learn" title="rs-tensor is a separate process">
          Neuron spawns rs-tensor as a child process by default (stdio MCP). For shared / remote
          inference, set <code>RS_TENSOR_MCP_URL</code> to point at an HTTP-mode rs-tensor and skip
          the spawn.
        </Callout>
      </Section>

      <Section eyebrow="auto_train behavior" title="Determinism + sweep modes.">
        <Table
          columns={[
            { key: "var",     header: "Variable",       mono: true, accent: "purple", width: "230px" },
            { key: "default", header: "Default",        mono: true },
            { key: "what",    header: "What it does" },
          ]}
          rows={[
            {
              var: "NEURON_SEED",
              default: "(none — non-deterministic)",
              what: "Default seed for stochastic ops (mini-batch shuffle, kfold assignment, weight init). Per-call seed argument always wins; this is the fallback. Set to a fixed value for reproducible runs.",
            },
            {
              var: "NEURON_PLANNER",
              default: "(adaptive — Claude when available)",
              what: "Set to 'rules' to skip Claude planner sub-agents — auto_train uses only the deterministic rules planner. Combined with NEURON_SWEEP_MODE=sequential and a fixed NEURON_SEED, makes auto_train bit-deterministic. Used by the benchmark suite.",
            },
            {
              var: "NEURON_SWEEP_MODE",
              default: "(adaptive by memory budget)",
              what: "Force the sweep execution mode. 'sub_agents' = always parallel sub-agents. 'sequential' or 'in_process' = always one-at-a-time. Default (unset) is adaptive: sub-agents for safe/advisory budgets, sequential for heavy.",
            },
          ]}
        />

        <Callout kind="tip" title="Reproducibility checklist">
          For fully bit-identical auto_train output across machines:
          <CodeBlock
            lang="bash"
            code={`NEURON_PLANNER=rules \\
NEURON_SWEEP_MODE=sequential \\
NEURON_SEED=42 \\
bun run <your script>`}
          />
        </Callout>
      </Section>

      <Section eyebrow="In .mcp.json" title="What ml-labs init writes by default.">
        <p>
          Every project's <code>.mcp.json</code> sets the per-project DB explicitly so different
          projects don't trample each other:
        </p>
        <CodeBlock
          lang="json"
          title=".mcp.json (generated)"
          code={`{
  "mcpServers": {
    "neuron": {
      "command": "bun",
      "args": ["run", "$HOME/.ml-labs/neuron/src/server.ts"],
      "env": {
        "NEURON_DB": "./data/neuron.db"
      }
    }
  }
}`}
        />
        <p>
          Add other env vars to the <code>env</code> block as needed — they'll only apply to this
          project's neuron-mcp instance.
        </p>
      </Section>

      <Section eyebrow="Common patterns" title="When to set what.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Database} title="Shared registry across projects" accent="cyan">
            Set <code>NEURON_HOME=/data/neuron</code> in every project. The bundle directory and
            <code> registry.db</code> become a shared resource. Useful in monorepos.
          </InfoCard>
          <InfoCard icon={Network} title="Remote rs-tensor" accent="purple">
            Run rs-tensor on a beefy box, set <code>RS_TENSOR_MCP_URL=http://gpu-box:9090</code>{" "}
            on your laptop. Skip the local Rust build.
          </InfoCard>
          <InfoCard icon={Layers} title="Reproducible benchmarks" accent="green">
            <code>NEURON_PLANNER=rules NEURON_SWEEP_MODE=sequential NEURON_SEED=42</code> in CI for
            bit-identical bench output.
          </InfoCard>
          <InfoCard icon={Zap} title="High-throughput inference" accent="orange">
            <code>NEURON_PREDICTION_SAMPLE_RATE=0.1</code> if you're serving thousands of predicts
            per minute and don't want the predictions table to grow huge — keeps drift_check accurate
            but cheap.
          </InfoCard>
          <InfoCard icon={Settings2} title="Networked dashboard" accent="pink">
            <code>NEURON_API_PORT=8080 NEURON_SERVE_TOKEN=&lt;random&gt;</code> if you're exposing
            the dashboard over a tunnel/VPN. Even local-only setups should consider the token if
            multiple users share a host.
          </InfoCard>
          <InfoCard icon={FileCog} title="Capture MCP logs to disk" accent="cyan">
            <code>NEURON_LOG_FILE=/tmp/neuron.log</code> in <code>.mcp.json</code>'s env to tail what
            Claude was telling you, especially after the Claude session ends.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Precedence" title="What wins when there's a conflict.">
        <Table
          compact
          columns={[
            { key: "rank", header: "Order",   accent: "cyan", width: "70px" },
            { key: "what", header: "Source" },
          ]}
          rows={[
            { rank: "1",  what: "Per-call argument (e.g. train({ seed: 7 }))" },
            { rank: "2",  what: "Project .mcp.json env block" },
            { rank: "3",  what: "Process environment (export NEURON_SEED=42)" },
            { rank: "4",  what: "ML-Labs default" },
          ]}
        />
      </Section>

      <Section eyebrow="Reference" title="Where these are read.">
        <p>
          The canonical list comes from the source — search for <code>process.env.NEURON_</code>:
        </p>
        <CodeBlock
          lang="bash"
          code={`grep -RE 'process\\.env\\.[A-Z_]+' neuron/src cli dashboard/src \\
  | grep -oE 'process\\.env\\.[A-Z_]+' | sort -u`}
        />
        <Callout kind="note">
          If we ever add a new env var, it'll appear in that grep before it appears here. The grep is
          the source of truth — this page is the explanation.
        </Callout>
      </Section>
    </div>
  )
}
