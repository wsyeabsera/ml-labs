import {
  Terminal, RefreshCw, BookOpen, ArrowRight, Monitor, Package, Info,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { DataFlow } from "../components/DataFlow"
import { Table } from "../components/Table"
import { Callout } from "../components/Callout"

export function CliReference() {
  return (
    <div>
      <PageHeader
        eyebrow="ml-labs CLI"
        accent="cyan"
        title={<>The <span className="gradient-text">CLI</span>.</>}
        lede="The ml-labs CLI does the things a CLI is good at: scaffolding projects, syncing the global install, running the dashboard and docs servers. Everything else — training, predicting, sweeping — happens in Claude Code via MCP tools, in the dashboard, or in the TUI."
      />

      <div className="lab-panel p-5 mb-12 font-mono text-sm">
        <div className="text-lab-muted text-xs mb-3 uppercase tracking-widest">usage</div>
        <div className="space-y-1.5">
          {[
            ["ml-labs", "init",      "[project-name]", "Scaffold a new ML-Labs project"],
            ["ml-labs", "update",    "",               "Pull latest ML-Labs from GitHub"],
            ["ml-labs", "dashboard", "",               "Start the HTTP dashboard on :2626"],
            ["ml-labs", "docs",      "",               "Serve these docs on :5273"],
            ["ml-labs", "--version", "",               "Print the installed ML-Labs version"],
            ["neuron-tui", "",       "",               "Launch the 5-screen terminal UI"],
          ].map(([cmd, sub, arg, desc]) => (
            <div key={(cmd ?? "") + (sub ?? "")} className="flex items-baseline gap-2 flex-wrap">
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
          available — no manual <code>.mcp.json</code> editing required.
        </p>

        <Table
          caption="Files created by ml-labs init"
          columns={[
            { key: "file", header: "File",     mono: true, accent: "cyan" },
            { key: "what", header: "What it does" },
          ]}
          rows={[
            { file: ".mcp.json",         what: "Points Neuron at ~/.ml-labs/neuron/src/server.ts and sets NEURON_DB to ./data/neuron.db so each project has its own database." },
            { file: "neuron.config.ts",  what: "Your featurize function. Defaults to identity (pass-through) for CSV/tabular data. Uncomment the image block for computer vision tasks." },
            { file: ".claude/",          what: "9 slash commands (neuron-auto, neuron-train, neuron-ask, neuron-diagnose, neuron-import, neuron-tui, neuron-ui, neuron-inspect, neuron-load) + the Neuron skill file. Auto-loaded by Claude Code." },
            { file: "data/",             what: "Empty directory where neuron.db will live. Gitignored by default." },
            { file: "examples/",         what: "Sample datasets — iris.csv (150 rows, classification) + housing.csv (71 rows, regression). Useful for the first training run." },
            { file: ".gitignore",        what: "Pre-configured to exclude data/*.db*, node_modules/, .neuron/, and editor dirs." },
            { file: "README.md",         what: "Project README with your project name, a quick-start snippet, and a table of slash commands." },
          ]}
        />

        <Callout kind="note">
          <strong>Idempotent.</strong> Running <code>ml-labs init</code> in a directory that already
          has some of these files skips them (<em>&ldquo;already exists, skipped&rdquo;</em>) and only
          creates what's missing. Safe to re-run.
        </Callout>

        <CodeBlock
          lang="bash"
          title="example output"
          code={`$ ml-labs init iris-demo

Initializing ML-Labs project: iris-demo
Location: /Users/yab/Projects/iris-demo

  ✓  .mcp.json
  ✓  neuron.config.ts
  ✓  .gitignore
  ✓  .claude/ (skills + 9 commands)
  ✓  data/
  ✓  examples/ (iris.csv + housing.csv)
  ✓  README.md

Done! Next steps:

  1. Open iris-demo in Claude Code
  2. Claude picks up the Neuron MCP tools automatically
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
          Does a hard sync of <code>~/.ml-labs/</code> to <code>origin/main</code>, reinstalls any
          changed deps (neuron, cli, site), rebuilds the docs site, and re-copies skills so every
          existing project gets the new slash commands. Because every project's <code>.mcp.json</code>{" "}
          points at <code>~/.ml-labs/neuron/src/server.ts</code>, all projects on your machine pick
          up new Neuron tools the next time Claude Code loads.
        </p>

        <DataFlow
          nodes={[
            { label: "git fetch",    sub: "origin",       accent: "cyan" },
            { label: "reset --hard", sub: "origin/main",  accent: "purple" },
            { label: "bun install",  sub: "neuron/cli",    accent: "green" },
            { label: "docs:build",   sub: "site/dist",    accent: "orange" },
            { label: "skills copy",  sub: "all projects", accent: "pink" },
          ]}
        />

        <Callout kind="warn" title="Don't edit ~/.ml-labs/ directly">
          Files there get overwritten on every update. Edit in the{" "}
          <a href="https://github.com/wsyeabsera/ml-labs" className="text-cyan-neon hover:underline" target="_blank" rel="noreferrer">GitHub repo</a>{" "}
          and push — <code>ml-labs update</code> pulls the change down.
        </Callout>
      </Section>

      {/* ── ml-labs dashboard ── */}
      <Section eyebrow="ml-labs dashboard" title="HTTP dashboard + browser.">
        <CodeBlock lang="bash" code={`ml-labs dashboard   # → http://localhost:2626`} />
        <p>
          Starts the HTTP server at <code>src/api.ts</code> on port 2626 and opens your default
          browser. Reads the same <code>data/neuron.db</code> as the MCP server — so you can have
          Claude Code open in one terminal and the dashboard running in another, both hitting the
          same state. Full tour:{" "}
          <a href="/dashboard" className="text-cyan-neon hover:underline">Dashboard</a>.
        </p>
        <InfoCard icon={Monitor} title="Keep it running while you work" accent="purple">
          The server runs in the foreground. <kbd>Ctrl+C</kbd> stops it. Good terminal to leave open
          in a split pane next to Claude Code.
        </InfoCard>
      </Section>

      {/* ── ml-labs docs ── */}
      <Section eyebrow="ml-labs docs" title="Open these docs locally.">
        <CodeBlock lang="bash" code={`ml-labs docs   # → http://localhost:5273`} />

        <p>
          Serves the pre-built docs site at <code>http://localhost:5273</code>. If something is
          already on that port it gets killed first. Docs are built at install time so this starts
          instantly — no Vite, no node_modules, just Bun's built-in static server.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <InfoCard icon={BookOpen} title="First run" accent="cyan">
            If <code>site/dist/</code> doesn't exist yet (install script was skipped),{" "}
            <code>ml-labs docs</code> builds it on the spot before serving. Takes ~30s once.
          </InfoCard>
          <InfoCard icon={RefreshCw} title="Rebuild after update" accent="purple">
            <code>ml-labs update</code> rebuilds automatically. If pages look stale, re-run{" "}
            <code>ml-labs update</code> or <code>bun run docs:build</code> in <code>~/.ml-labs</code>.
          </InfoCard>
        </div>
      </Section>

      {/* ── neuron-tui ── */}
      <Section eyebrow="neuron-tui" title="The terminal UI.">
        <CodeBlock lang="bash" code={`neuron-tui`} />
        <p>
          5-screen Ink-based terminal UI: Dashboard, Dataset, Train, Runs, Predict. Same DB as the
          MCP server and the HTTP dashboard. Useful over SSH or in tmux.{" "}
          <a href="/tui" className="text-cyan-neon hover:underline">Full tour</a>.
        </p>
      </Section>

      {/* ── --version ── */}
      <Section eyebrow="ml-labs --version" title="Check what you have.">
        <CodeBlock lang="bash" code={`ml-labs --version
# ml-labs 1.10.0

ml-labs --help
# Usage: ml-labs <command> [args]
# ...`}
        />
      </Section>

      <Section eyebrow="What the CLI does not do" title="By design.">
        <Table
          compact
          columns={[
            { key: "what", header: "Not a CLI thing", accent: "pink" },
            { key: "why",  header: "Why, and where to go instead" },
          ]}
          rows={[
            { what: <><Terminal className="w-3.5 h-3.5 inline mr-1" /> train / predict / sweep</>, why: <>Live in MCP (Claude Code or the dashboard). See <a href="/training-flow" className="text-cyan-neon hover:underline">Training Flow</a>.</> },
            { what: <><Package className="w-3.5 h-3.5 inline mr-1" /> publish / import</>,         why: <>MCP-only tools (<code>publish_model</code>, <code>import_model</code>). See <a href="/registry-learning" className="text-cyan-neon hover:underline">Registry & Active Learning</a>.</> },
            { what: <><Info className="w-3.5 h-3.5 inline mr-1" /> per-project update</>,          why: <>There's only the global install. <code>ml-labs update</code> updates everything at once.</> },
          ]}
        />
      </Section>

      <Section eyebrow="More" title="Related pages.">
        <div className="grid md:grid-cols-2 gap-4">
          <a href="/dashboard" className="lab-panel p-5 hover:border-cyan-neon/40 transition-colors group">
            <Monitor className="w-5 h-5 text-cyan-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-cyan-neon transition-colors">Dashboard</div>
            <div className="text-sm text-lab-muted">Every route the HTTP server exposes + live SSE stream.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-cyan-neon transition-colors" />
          </a>
          <a href="/tui" className="lab-panel p-5 hover:border-green-neon/40 transition-colors group">
            <Terminal className="w-5 h-5 text-green-neon mb-3" />
            <div className="font-semibold text-lab-heading mb-1 group-hover:text-green-neon transition-colors">TUI</div>
            <div className="text-sm text-lab-muted">Keyboard shortcuts + the 5 screens.</div>
            <ArrowRight className="w-4 h-4 text-lab-muted mt-3 group-hover:text-green-neon transition-colors" />
          </a>
        </div>
      </Section>
    </div>
  )
}
