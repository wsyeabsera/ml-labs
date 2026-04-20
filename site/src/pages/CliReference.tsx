import { Terminal, FolderPlus, RefreshCw, BookOpen, ArrowRight } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"

export function CliReference() {
  return (
    <div>
      <PageHeader
        eyebrow="ml-labs CLI"
        accent="cyan"
        title={<>Three commands. <span className="gradient-text">That's the whole CLI.</span></>}
        lede="ml-labs init scaffolds a project. ml-labs update keeps it fresh. ml-labs docs opens the docs. Everything else happens in Claude Code via MCP tools."
      />

      <div className="lab-panel p-5 mb-12 font-mono text-sm">
        <div className="text-lab-muted text-xs mb-3 uppercase tracking-widest">usage</div>
        <div className="space-y-1.5">
          {[
            ["ml-labs", "init", "[project-name]", "Scaffold a new ML-Labs project"],
            ["ml-labs", "update", "", "Pull latest ML-Labs from GitHub"],
            ["ml-labs", "docs", "", "Serve the ML-Labs docs site locally"],
          ].map(([cmd, sub, arg, desc]) => (
            <div key={sub} className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lab-muted">{cmd}</span>
              <span className="text-cyan-neon font-semibold">{sub}</span>
              {arg && <span className="text-purple-neon">{arg}</span>}
              <span className="text-lab-muted/60 text-xs ml-2"># {desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── ml-labs init ── */}
      <Section eyebrow="ml-labs init" title="Scaffold a new project.">
        <CodeBlock
          lang="bash"
          code={`ml-labs init my-classifier      # creates my-classifier/ in current directory
ml-labs init .                  # wire ML-Labs into the current directory`}
        />

        <p>
          Creates a fully wired project directory. Open it in Claude Code and the Neuron tools are
          already available — no manual <code>.mcp.json</code> editing required.
        </p>

        <div className="lab-panel p-5 my-6">
          <div className="text-xs font-mono uppercase tracking-widest text-lab-muted mb-4">
            Files created by ml-labs init
          </div>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <code className="text-cyan-neon">.mcp.json</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  Points Neuron at <code>~/.ml-labs/neuron/src/server.ts</code> and sets{" "}
                  <code>NEURON_DB</code> to <code>./data/neuron.db</code> so each project has its own
                  database.
                </p>
              </div>
              <div>
                <code className="text-purple-neon">neuron.config.ts</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  Your featurize function. Defaults to identity (pass-through) for CSV/tabular
                  data. Uncomment the image block for computer vision tasks.
                </p>
              </div>
              <div>
                <code className="text-green-neon">.claude/</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  All 8 slash commands (<code>/neuron-auto</code>, <code>/neuron-train</code>, …)
                  and the Neuron skill file. Auto-loaded by Claude Code.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <code className="text-orange-neon">data/</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  Empty directory where <code>neuron.db</code> will live. Gitignored by default.
                </p>
              </div>
              <div>
                <code className="text-pink-neon">.gitignore</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  Pre-configured to exclude <code>data/*.db*</code>, <code>node_modules/</code>,{" "}
                  <code>.neuron/</code>, and editor dirs.
                </p>
              </div>
              <div>
                <code className="text-cyan-neon">README.md</code>
                <p className="text-lab-muted text-xs mt-0.5">
                  Project README with your project name filled in, quick-start snippet, and
                  table of available slash commands.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p>
          <strong className="text-lab-heading">Idempotent:</strong> running{" "}
          <code>ml-labs init</code> in a directory that already has some of these files will
          skip them (<em>"already exists, skipped"</em>) and only create what's missing.
        </p>

        <CodeBlock
          lang="bash"
          title="example output"
          code={`$ ml-labs init iris-demo

Initializing ML-Labs project: iris-demo
Location: /Users/yab/Projects/iris-demo

  ✓  .mcp.json
  ✓  neuron.config.ts
  ✓  .gitignore
  ✓  .claude/ (skills + commands)
  ✓  data/
  ✓  README.md

Done! Next steps:

  1. Open iris-demo in Claude Code
  2. Claude will pick up the Neuron MCP tools automatically
  3. Add your data:
       /neuron-load <task_id> <path/to/data.csv>
  4. Train:
       /neuron-auto <task_id>`}
        />
      </Section>

      {/* ── ml-labs update ── */}
      <Section eyebrow="ml-labs update" title="Pull the latest everything.">
        <CodeBlock lang="bash" code={`ml-labs update`} />

        <p>
          Does a hard sync of <code>~/.ml-labs/</code> to <code>origin/main</code>, then
          reinstalls any changed neuron deps. Because every project's{" "}
          <code>.mcp.json</code> points at <code>~/.ml-labs/neuron/src/server.ts</code>, all
          projects on your machine pick up new Neuron tools the next time Claude Code loads.
        </p>

        <DataFlow
          nodes={[
            { label: "git fetch", sub: "origin", accent: "cyan" },
            { label: "reset --hard", sub: "origin/main", accent: "purple" },
            { label: "bun install", sub: "neuron/", accent: "green" },
            { label: "all projects", sub: "updated", accent: "orange" },
          ]}
        />

        <div className="lab-panel p-5 mt-4 border-orange-neon/30 border">
          <div className="flex gap-3 items-start">
            <span className="text-orange-neon text-lg">!</span>
            <p className="text-sm text-lab-text/80">
              <strong className="text-lab-heading">Don't edit files in ~/.ml-labs/ directly.</strong>{" "}
              They get overwritten on every update. Edit in the{" "}
              <a href="https://github.com/wsyeabsera/ml-labs" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">
                GitHub repo
              </a>{" "}
              and push — <code>ml-labs update</code> pulls the change down.
            </p>
          </div>
        </div>
      </Section>

      {/* ── ml-labs docs ── */}
      <Section eyebrow="ml-labs docs" title="Open these docs locally.">
        <CodeBlock lang="bash" code={`ml-labs docs   # → http://localhost:5273`} />

        <p>
          Serves the pre-built docs site at <code>http://localhost:5273</code>. If something is
          already on that port it gets killed first. Docs are built at install time so this
          starts instantly — no vite, no node_modules, just Bun's built-in static server.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <InfoCard icon={BookOpen} title="First run" accent="cyan">
            If <code>site/dist/</code> doesn't exist yet (e.g. install script was skipped),{" "}
            <code>ml-labs docs</code> will build it on the spot before serving. Takes ~30s once.
          </InfoCard>
          <InfoCard icon={RefreshCw} title="Rebuild after update" accent="purple">
            After <code>ml-labs update</code>, run <code>ml-labs docs</code> once to
            regenerate <code>site/dist/</code> if the docs changed. It auto-detects the stale
            dist... actually it doesn't yet — just run <code>bun run docs:build</code> at{" "}
            <code>~/.ml-labs</code> if pages look stale.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="What the CLI does not do" title="By design.">
        <div className="lab-panel p-6">
          <ul className="space-y-2 text-sm text-lab-text/80">
            <li className="flex gap-2"><ArrowRight className="w-4 h-4 text-lab-muted shrink-0 mt-0.5" /><span><strong className="text-lab-heading">No train / predict commands.</strong> Training is MCP — it lives in Claude Code via <code>/neuron-auto</code> and the 30 tool calls. The CLI is just bootstrapping.</span></li>
            <li className="flex gap-2"><ArrowRight className="w-4 h-4 text-lab-muted shrink-0 mt-0.5" /><span><strong className="text-lab-heading">No project-level update.</strong> <code>ml-labs update</code> updates the global installation. All projects share one Neuron, so they all update together.</span></li>
            <li className="flex gap-2"><ArrowRight className="w-4 h-4 text-lab-muted shrink-0 mt-0.5" /><span><strong className="text-lab-heading">No publish / push to registry.</strong> Model publishing is a Claude Code operation (<code>/neuron-publish</code>), not a CLI operation.</span></li>
          </ul>
        </div>
      </Section>
    </div>
  )
}
