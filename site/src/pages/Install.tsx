import { Download, FolderGit2, Terminal, CheckCircle, AlertCircle, RefreshCw } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { InfoCard } from "../components/InfoCard"
import { Timeline } from "../components/Timeline"

export function Install() {
  return (
    <div>
      <PageHeader
        eyebrow="One command to rule them all"
        accent="cyan"
        title={<>Install <span className="gradient-text">ML-Labs</span> in 60 seconds.</>}
        lede="A single curl command clones the repo, installs deps, builds the docs, and drops an ml-labs binary into your PATH. That's it."
      />

      <Section eyebrow="Prerequisites" title="What you need first.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Terminal} title="Bun ≥ 1.1" accent="cyan">
            ML-Labs runs on Bun. If you don't have it:
            <CodeBlock lang="bash" code={`curl -fsSL https://bun.sh/install | bash`} />
          </InfoCard>
          <InfoCard icon={CheckCircle} title="Claude Code" accent="purple">
            The CLI, Mac app, or IDE plugin. Claude Code reads <code>.mcp.json</code> at project
            open and loads the Neuron tools automatically.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Install" title="The one-liner.">
        <CodeBlock
          lang="bash"
          title="terminal"
          code={`curl -fsSL https://raw.githubusercontent.com/wsyeabsera/ml-labs/main/install.sh | bash`}
        />

        <Timeline
          steps={[
            {
              step: "01",
              title: "Clones to ~/.ml-labs/",
              body: "Clones the full ML-Labs repo to your home directory. This is the single source of truth — Neuron, the TUI, the CLI, the docs site.",
              accent: "cyan",
            },
            {
              step: "02",
              title: "Installs deps",
              body: <>Runs <code>bun install</code> in <code>neuron/</code>, <code>cli/</code>, and <code>site/</code>. First run takes ~30s; subsequent updates are instant.</>,
              accent: "purple",
            },
            {
              step: "03",
              title: "Builds the docs site",
              body: <>Pre-builds the React docs site to <code>~/.ml-labs/site/dist/</code>. <code>ml-labs docs</code> serves these static files with no runtime deps.</>,
              accent: "green",
            },
            {
              step: "04",
              title: "Writes the ml-labs shell wrapper",
              body: <>Creates <code>~/.local/bin/ml-labs</code> — a two-line shell script that calls <code>bun run ~/.ml-labs/cli/index.ts</code>. No binary, no codesigning, no Gatekeeper issues.</>,
              accent: "orange",
            },
            {
              step: "05",
              title: "Patches PATH",
              body: <>Adds <code>~/.local/bin</code> to <code>~/.zshrc</code> or <code>~/.bashrc</code> if it's not already there. Reload your shell once and you're done.</>,
              accent: "pink",
            },
          ]}
        />
      </Section>

      <Section eyebrow="What lands where" title="The file layout after install.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={FolderGit2} title="~/.ml-labs/" accent="purple">
            <pre className="text-xs font-mono text-lab-muted leading-relaxed">
{`~/.ml-labs/
├── neuron/          ← MCP server + TUI
├── site/dist/       ← pre-built docs
├── cli/             ← CLI source
├── bin/ml-labs      ← shell wrapper
└── .git/            ← stays in sync via
                        ml-labs update`}
            </pre>
          </InfoCard>
          <InfoCard icon={Terminal} title="~/.local/bin/ml-labs" accent="cyan">
            <pre className="text-xs font-mono text-lab-muted leading-relaxed">
{`#!/usr/bin/env bash
exec bun run "$HOME/.ml-labs/cli/index.ts" "$@"`}
            </pre>
            <p className="text-xs text-lab-muted mt-3">
              A symlink from <code>~/.local/bin/ml-labs</code> points here. No compiled binary — bun interprets it directly.
            </p>
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Updating" title="Stay current.">
        <p>
          Any time you want the latest Neuron tools, docs, or CLI fixes — one command. It
          force-syncs your local <code>~/.ml-labs/</code> to <code>origin/main</code>, reinstalls
          any new deps, and every project on your machine gets the update immediately.
        </p>
        <CodeBlock lang="bash" code={`ml-labs update`} />
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <InfoCard icon={RefreshCw} title="What update does" accent="green">
            <ol className="text-xs space-y-1 list-decimal list-inside text-lab-muted">
              <li><code className="text-lab-text">git fetch origin</code></li>
              <li><code className="text-lab-text">git reset --hard origin/main</code></li>
              <li><code className="text-lab-text">bun install</code> in neuron/</li>
            </ol>
          </InfoCard>
          <InfoCard icon={AlertCircle} title="Local changes in ~/.ml-labs/" accent="orange">
            Don't edit files in <code>~/.ml-labs/</code> directly — they'll be wiped by{" "}
            <code>ml-labs update</code>. Edit in the repo and push; update pulls them down.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Uninstall" title="Clean removal.">
        <CodeBlock
          lang="bash"
          code={`rm -rf ~/.ml-labs ~/.local/bin/ml-labs
# then remove the PATH line from ~/.zshrc`}
        />
      </Section>
    </div>
  )
}
