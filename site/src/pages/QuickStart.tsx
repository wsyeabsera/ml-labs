import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Timeline } from "../components/Timeline"
import { Link } from "react-router-dom"
import { Download, Terminal, FolderGit2, Lightbulb, Rocket, ArrowRight, Workflow, Zap, BookMarked } from "lucide-react"

export function QuickStart() {
  return (
    <div>
      <PageHeader
        eyebrow="From zero to trained"
        accent="cyan"
        title={<>Get <span className="gradient-text">ML-Labs running</span> in five minutes.</>}
        lede="One install command. One init command. Open in Claude Code and type /neuron-auto. That's the whole list."
      />

      <Section eyebrow="Prerequisites" title="What you need first.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Download} title="Bun ≥ 1.1" accent="cyan">
            ML-Labs runs on Bun. If you don't have it:
            <CodeBlock lang="bash" code={`curl -fsSL https://bun.sh/install | bash`} />
          </InfoCard>
          <InfoCard icon={Terminal} title="Claude Code" accent="purple">
            The CLI, Mac app, or IDE plugin. Claude Code reads <code>.mcp.json</code> at project
            open and loads the Neuron tools automatically.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Five steps" title="Install, init, train.">
        <Timeline
          steps={[
            {
              step: "01",
              title: "Install ML-Labs",
              body: (
                <>
                  Run the one-liner. It clones to <code>~/.ml-labs/</code>, installs deps, builds
                  docs, and drops <code>ml-labs</code> in your PATH. Takes ~30s.
                  <CodeBlock
                    lang="bash"
                    code={`curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash`}
                  />
                  Then reload your shell: <code>source ~/.zshrc</code> (or open a new terminal).
                  <br /><br />
                  See the <Link to="/install" className="text-cyan-neon hover:underline">Installation page</Link> for what this does step-by-step.
                </>
              ),
              accent: "cyan",
            },
            {
              step: "02",
              title: "Scaffold your project",
              body: (
                <>
                  <code>ml-labs init</code> creates a fully wired directory — <code>.mcp.json</code>,{" "}
                  <code>neuron.config.ts</code>, all 8 slash commands, and a README.
                  <CodeBlock
                    lang="bash"
                    code={`ml-labs init iris-demo
cd iris-demo`}
                  />
                  Or wire ML-Labs into an existing folder: <code>ml-labs init .</code>
                </>
              ),
              accent: "purple",
            },
            {
              step: "03",
              title: "Open in Claude Code and load your data",
              body: (
                <>
                  Open <code>iris-demo/</code> in Claude Code. The Neuron MCP tools appear
                  automatically (check the MCP panel — you should see ~30 tools).
                  <br /><br />
                  Drop your CSV in the project root, then:
                  <CodeBlock
                    lang="bash"
                    title="in Claude Code"
                    code={`/neuron-load iris ./iris.csv`}
                  />
                  Or use a JSON file, image folder, or let Claude pick the right loader.
                </>
              ),
              accent: "green",
            },
            {
              step: "04",
              title: "Run auto-train",
              body: (
                <>
                  One command triggers the full pipeline: preflight → suggest hyperparams →
                  parallel sweep → evaluate → diagnose → promote winner.
                  <CodeBlock
                    lang="bash"
                    title="in Claude Code"
                    code={`/neuron-auto iris

# Behind the scenes:
#   ✓ preflight_check
#   ✓ suggest_hyperparams
#   ✓ run_sweep  (configs in parallel)
#   ✓ evaluate + diagnose
#   ✓ register_model
#
# "Promoted run #42 at 97.3% accuracy. 2 waves, 48s."`}
                  />
                </>
              ),
              accent: "orange",
            },
            {
              step: "05",
              title: "Predict",
              body: (
                <>
                  Your model is registered. Predict any time — even after restarting Claude Code.
                  Weights restore lazily from SQLite on first predict.
                  <CodeBlock
                    lang="bash"
                    title="in Claude Code"
                    code={`> Predict: sepal_length=5.1, sepal_width=3.5, petal_length=1.4, petal_width=0.2

# → class: setosa  (confidence 0.98)`}
                  />
                </>
              ),
              accent: "pink",
            },
          ]}
        />
      </Section>

      <Section eyebrow="Verify" title="Confirm the full stack works.">
        <CodeBlock
          lang="bash"
          code={`# from ~/.ml-labs/neuron/
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
          <InfoCard icon={FolderGit2} title="Your project (iris-demo/)" accent="purple">
            <pre className="text-xs font-mono text-lab-muted leading-relaxed">
{`iris-demo/
├── .mcp.json          ← wires Neuron
├── neuron.config.ts   ← your featurize fn
├── .claude/           ← 8 slash commands
├── data/
│   └── neuron.db      ← your task + runs
└── README.md`}
            </pre>
          </InfoCard>
          <InfoCard icon={FolderGit2} title="Shared install (~/.ml-labs/)" accent="cyan">
            <pre className="text-xs font-mono text-lab-muted leading-relaxed">
{`~/.ml-labs/
├── neuron/            ← MCP server + TUI
│   └── src/
│       └── server.ts  ← pointed to by all
│                         .mcp.json files
├── site/dist/         ← pre-built docs
├── cli/               ← ml-labs CLI
└── bin/ml-labs        ← shell wrapper`}
            </pre>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Common gotchas" title="Stuff that trips people up.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Lightbulb} title="Neuron tools don't appear" accent="orange">
            After running <code>ml-labs init</code>, open the project directory in Claude Code
            (not a parent folder). Claude reads <code>.mcp.json</code> at project root on startup.
            Check the MCP panel to confirm ~30 tools loaded.
          </InfoCard>
          <InfoCard icon={Lightbulb} title="Predict fails after restart" accent="cyan">
            Should self-heal via lazy weight restore. If not, your task has no registered model —
            run a training sweep first, then <code>register_model</code> on a completed run.
          </InfoCard>
          <InfoCard icon={Lightbulb} title="Adapter hash mismatch on import" accent="purple">
            Your project's <code>neuron.config.ts</code> featurize function differs from the one
            the model was trained with. Align the featurize functions or pass{" "}
            <code>force: true</code> to <code>import_model</code>.
          </InfoCard>
          <InfoCard icon={Rocket} title="Sweeps feel slow" accent="pink">
            Each sub-agent boot is ~1–2s. For 3 configs this is background noise; for 20+,
            use <code>wave_size</code> to stage configs into sequential batches.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What's next" title="Go deeper.">
        <div className="grid md:grid-cols-3 gap-4">
          <Link to="/training-flow" className="lab-panel p-5 hover:border-cyan-neon/40 transition-colors group">
            <Workflow className="w-5 h-5 text-cyan-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-cyan-neon transition-colors">Training Flow</div>
            <div className="text-sm text-lab-muted">Follow a row from CSV to softmax confidence.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-cyan-neon transition-colors" />
          </Link>
          <Link to="/sweeps-auto" className="lab-panel p-5 hover:border-purple-neon/40 transition-colors group">
            <Zap className="w-5 h-5 text-purple-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-purple-neon transition-colors">Sweeps & Auto-Train</div>
            <div className="text-sm text-lab-muted">How the coordinator sub-agent thinks.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-purple-neon transition-colors" />
          </Link>
          <Link to="/tool-reference" className="lab-panel p-5 hover:border-green-neon/40 transition-colors group">
            <BookMarked className="w-5 h-5 text-green-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-green-neon transition-colors">Tool Reference</div>
            <div className="text-sm text-lab-muted">All 30 MCP tools, signatures, and examples.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-green-neon transition-colors" />
          </Link>
        </div>
      </Section>
    </div>
  )
}
