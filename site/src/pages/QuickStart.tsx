import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Timeline } from "../components/Timeline"
import { Download, Settings, Terminal, Rocket, FolderGit2, Lightbulb } from "lucide-react"

export function QuickStart() {
  return (
    <div>
      <PageHeader
        eyebrow="From zero to trained"
        accent="cyan"
        title={<>Get <span className="gradient-text">ML-Labs running</span> in five minutes.</>}
        lede="Install Bun. Wire Neuron into your project's .mcp.json. Run a slash command. That's the list."
      />

      <Section eyebrow="Prereqs" title="What you need on your machine.">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Download} title="Bun ≥ 1.1" accent="cyan">
            The Neuron server runs on Bun. <code>curl -fsSL https://bun.sh/install | bash</code>.
          </InfoCard>
          <InfoCard icon={Terminal} title="Claude Code" accent="purple">
            The CLI, the Mac app, or the IDE plugin. Any of them can spawn MCP servers.
          </InfoCard>
          <InfoCard icon={Settings} title="rs-tensor MCP" accent="green">
            Already running as an HTTP MCP server on your machine (Neuron delegates all math to
            it).
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Install" title="Clone and wire up.">
        <Timeline
          steps={[
            {
              step: "01",
              title: "Put Neuron somewhere stable",
              body: (
                <>
                  Clone or symlink the <code>neuron/</code> directory wherever you keep tools. The
                  server is self-contained — one <code>bun install</code> and it runs.
                </>
              ),
              accent: "cyan",
            },
            {
              step: "02",
              title: "Install deps",
              body: (
                <CodeBlock
                  lang="bash"
                  code={`cd neuron
bun install`}
                />
              ),
              accent: "purple",
            },
            {
              step: "03",
              title: "Wire it into your project via .mcp.json",
              body: (
                <CodeBlock
                  lang="json"
                  title=".mcp.json"
                  code={`{
  "mcpServers": {
    "neuron": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/neuron/src/server.ts"]
    }
  }
}`}
                />
              ),
              accent: "green",
            },
            {
              step: "04",
              title: "Drop in the neuron skill + slash commands",
              body: (
                <>
                  Copy <code>.claude/skills/neuron/</code> and <code>.claude/commands/</code> into
                  your project's <code>.claude/</code>. Now Claude auto-loads the skill and your{" "}
                  <code>/neuron-*</code> commands light up.
                </>
              ),
              accent: "orange",
            },
            {
              step: "05",
              title: "Ship your first model",
              body: (
                <>
                  Type <code>/neuron-auto iris</code> in Claude Code with an <code>iris.csv</code>{" "}
                  handy. You're done.
                </>
              ),
              accent: "pink",
            },
          ]}
        />
      </Section>

      <Section eyebrow="One command, full pipeline" title="Your first training run.">
        <p>
          If you've never trained an iris classifier in your life, today's your day.
        </p>
        <CodeBlock
          lang="bash"
          title="in Claude Code"
          code={`> Use Neuron to train an iris classifier from ./iris.csv

# Claude will call:
#   create_task → load_csv → auto_train
# and come back with a run id, an accuracy,
# and a published model URI you can share.`}
        />
      </Section>

      <Section eyebrow="Verify" title="How to know it worked.">
        <CodeBlock
          lang="bash"
          code={`# from neuron/
bun run test/e2e_phase5.ts

# expected final line:
#   Phase 5 verification complete.`}
        />
        <p>
          This runs the full stack end-to-end: trains an iris classifier, kills the server, spins
          up a fresh server, and confirms <code>predict</code> works across sessions.
        </p>
      </Section>

      <Section eyebrow="Folder layout" title="What lives where.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={FolderGit2} title="neuron/" accent="purple">
            <pre className="text-xs font-mono text-lab-muted">
{`src/
  server.ts         ← MCP entry
  tools/            ← one file per tool
  core/
    auto/           ← coordinator
    sweep/          ← sub-agents
    db/             ← schema + CRUD
  neuron.config.ts  ← featurize
data/
  neuron.db         ← SQLite + WAL
test/
  e2e_phase5.ts     ← full stack`}
            </pre>
          </InfoCard>
          <InfoCard icon={FolderGit2} title="~/.neuron/" accent="pink">
            <pre className="text-xs font-mono text-lab-muted">
{`registry/
  bundles/
    iris-classifier_2026-04-19/
      weights.json
      meta.json
      adapter.hash
registry.db          ← registry index`}
            </pre>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Common gotchas" title="Stuff that trips people up.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Lightbulb} title="Server doesn't show up" accent="orange">
            After editing <code>.mcp.json</code>, restart Claude Code — it reads the config at
            startup. Check the MCP panel to see the tool list.
          </InfoCard>
          <InfoCard icon={Lightbulb} title="Predict fails after restart" accent="cyan">
            Should self-heal via lazy weight restore. If not, your task has no registered model —
            run <code>register_model</code> on a completed run.
          </InfoCard>
          <InfoCard icon={Lightbulb} title="Adapter hash mismatch on import" accent="purple">
            Your project's <code>neuron.config.ts</code> differs from the one the model was
            trained with. Either align the featurize or pass <code>force: true</code>.
          </InfoCard>
          <InfoCard icon={Rocket} title="Sweeps feel slow" accent="pink">
            Each sub-agent boot is ~1–2s. For 3 configs this is background noise; for 20+, consider{" "}
            <code>wave_size</code> to amortize.
          </InfoCard>
        </div>
      </Section>
    </div>
  )
}
