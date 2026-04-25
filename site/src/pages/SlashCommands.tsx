import { Terminal, Workflow, Search, Database, GitBranch, Eye, Package, Activity, Sparkles } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"

export function SlashCommands() {
  return (
    <div>
      <PageHeader
        eyebrow="Type a slash, get a workflow"
        accent="pink"
        title={<><span className="gradient-text">Slash commands</span>.</>}
        lede="Slash commands live in .claude/commands/ and ship with every project ml-labs init creates. Each is a small markdown prompt that wires Claude to specific MCP tools and a clear job. Type /neuron-auto in Claude Code and you don't need to remember the underlying tool names."
      />

      <Section eyebrow="What's a slash command?" title="A prompt + an allowlist.">
        <p>
          A file like <code>.claude/commands/neuron-auto.md</code> has two parts: frontmatter that
          declares the allowed MCP tools and the argument hint, then a prompt body. Claude Code reads
          these on session start and exposes them as <code>/neuron-auto &lt;args&gt;</code>. When you
          type the slash command, Claude sees the prompt body with <code>$1</code> / <code>$2</code>{" "}
          replaced by your arguments.
        </p>
        <CodeBlock
          lang="md"
          title=".claude/commands/neuron-auto.md (excerpt)"
          code={`---
description: Auto-train a model for <task_id> — preflight, sweep, diagnose, promote
argument-hint: <task_id> [accuracy_target] [budget_s]
allowed-tools: mcp__neuron__auto_train, mcp__neuron__get_auto_status
---

Call mcp__neuron__auto_train with task_id="$1", accuracy_target=\${2:-0.9}, budget_s=\${3:-180}.

While it runs, show the user what's happening. When it returns, report:
status, final accuracy, waves_used, verdict, and the decision_log summary.`}
        />
        <Callout kind="learn" title="Why slash commands and not 'just talk to Claude'?">
          You can absolutely just say &ldquo;train iris&rdquo; — Claude will pick the tool. But slash
          commands give you (a) a stable verb you can muscle-memorise, (b) a curated tool allowlist
          (so Claude doesn't go off and call something unrelated), and (c) a consistent reporting
          format. They're shortcuts, not requirements.
        </Callout>
      </Section>

      <Section eyebrow="The full set" title="Every command ml-labs init scaffolds.">
        <Table
          caption=".claude/commands/ — 10 slash commands"
          columns={[
            { key: "cmd",    header: "Command",      mono: true, accent: "pink", width: "180px" },
            { key: "args",   header: "Arguments",    mono: true },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            {
              cmd:  "/neuron-auto",
              args: "<task_id> [target] [budget_s]",
              what: "Full pipeline: preflight → sweep waves → diagnose → promote → calibrate → publish (optional). The headline command. Reports decision_log summary when done.",
            },
            {
              cmd:  "/neuron-load",
              args: "<task_id> <path>",
              what: "Auto-detect format (CSV / JSON / images) and call the right loader. Asks for label_column / feature_columns if not obvious.",
            },
            {
              cmd:  "/neuron-train",
              args: "<task_id> [lr] [epochs]",
              what: "Manual single-run training with overrides. Prints progress + final accuracy.",
            },
            {
              cmd:  "/neuron-sweep",
              args: "<task_id> [concurrency]",
              what: "Parallel hyperparameter sweep. Shows configs, runs them, picks the winner.",
            },
            {
              cmd:  "/neuron-diagnose",
              args: "<task_id>",
              what: "Evaluate the latest completed run + run diagnose. Returns severity + recommendations.",
            },
            {
              cmd:  "/neuron-status",
              args: "(none)",
              what: "Tabular dump of every task — samples, runs, accuracy, active model. Live progress for any in-flight training.",
            },
            {
              cmd:  "/neuron-publish",
              args: "<run_id> <name> [version]",
              what: "Push a run to ~/.neuron/registry/. Returns the URI.",
            },
            {
              cmd:  "/neuron-import",
              args: "[uri]",
              what: "Pull a model from the registry. Without an arg, lists what's available first.",
            },
            {
              cmd:  "/neuron-show",
              args: "<task_id> [run_id]",
              what: "Open the dashboard at the right URL via chrome-devtools MCP. Takes a screenshot. Pairs nicely with auto_train running in another terminal.",
            },
            {
              cmd:  "/neuron-ask",
              args: "(none)",
              what: "Answer pending browser requests. Used by the dashboard's 'AskClaude' widget — when you ask Claude something from the dashboard, /neuron-ask is what answers.",
            },
          ]}
        />
      </Section>

      <Section eyebrow="The five most useful" title="What we actually reach for daily.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Sparkles} title="/neuron-auto" accent="purple">
            90% of training sessions start with this. <code>/neuron-auto iris</code> handles
            everything end-to-end. If accuracy_target is hit, you're done; if not, the verdict tells
            you what to do next.
          </InfoCard>
          <InfoCard icon={Database} title="/neuron-load" accent="cyan">
            <code>/neuron-load mytask ./data.csv</code>. Don't remember whether to use load_csv vs
            load_json — let Claude figure it out from the extension.
          </InfoCard>
          <InfoCard icon={Workflow} title="/neuron-status" accent="green">
            One line: where am I? Outputs the table of all tasks. First thing to type when you sit
            down to a project you haven't touched in a week.
          </InfoCard>
          <InfoCard icon={Search} title="/neuron-diagnose" accent="orange">
            Latest run was bad? <code>/neuron-diagnose mytask</code> returns severity + concrete
            recommendations. Better than reading the loss curve yourself.
          </InfoCard>
          <InfoCard icon={Eye} title="/neuron-show" accent="pink">
            Hands-free dashboard navigation when paired with chrome-devtools MCP. Useful in
            screen-share contexts.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="How they compose" title="Typical session flow.">
        <CodeBlock
          lang="bash"
          title="a fresh project, start to deployed"
          code={`# Day 1
> /neuron-load churn ./customers.csv
# → loads, splits 80/20, asks for label_column ('churned') and confirms

> /neuron-auto churn 0.85
# → preflight + sweep + diagnose + promote + calibrate
# → "completed: accuracy=0.87 on run 12, 2 waves, 38s"

> /neuron-show churn
# → dashboard opens to the run detail page

# Day 30 (after the model has been predicting)
> /neuron-status
# → shows churn task is still active, X predictions logged

> drift_check task_id="churn"
# (or the dashboard's Drift tab — drift_check doesn't have its own slash command)
# → "PSI severe on feature_3, recommend retraining"

> /neuron-load churn ./customers_30days.csv
> /neuron-auto churn 0.85`}
        />
      </Section>

      <Section eyebrow="Adding a custom one" title="It's a markdown file.">
        <p>
          Drop a new <code>.md</code> file into <code>.claude/commands/</code> and Claude Code picks
          it up next session. Three required parts:
        </p>
        <CodeBlock
          lang="md"
          title=".claude/commands/my-command.md"
          code={`---
description: One-line summary that shows in Claude Code's command list.
argument-hint: <required-arg> [optional-arg]
allowed-tools: mcp__neuron__list_tasks, mcp__neuron__evaluate
---

Your prompt body goes here. $1, $2, $3 substitute positional args.
${"${1:-default}"} works for fallbacks. $ARGUMENTS is the entire arg string.

Use Markdown freely — Claude reads this verbatim.`}
        />
        <Table
          compact
          columns={[
            { key: "key",     header: "Frontmatter key", mono: true, accent: "pink" },
            { key: "purpose", header: "Purpose" },
          ]}
          rows={[
            { key: "description",   purpose: "Shown in /commands list and tooltip." },
            { key: "argument-hint", purpose: "Hint shown after the command name (e.g. <task_id>). Purely cosmetic — Claude still reads $ARGUMENTS." },
            { key: "allowed-tools", purpose: "Comma-separated MCP tool names. Claude can ONLY call these during the command. Critical — without it, the command can use the full toolbox." },
          ]}
        />
      </Section>

      <Section eyebrow="Where they live" title="Per-project + global.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Package} title="Per-project" accent="cyan">
            <code>.claude/commands/</code> at project root. Created by <code>ml-labs init</code>;
            scoped to that project only. Edit them per-project for project-specific workflows.
          </InfoCard>
          <InfoCard icon={GitBranch} title="Global (your dotfiles)" accent="purple">
            <code>~/.claude/commands/</code> — available in every Claude Code session regardless of
            project. Good for personal commands that you want everywhere.
          </InfoCard>
          <InfoCard icon={Activity} title="ml-labs update re-copies" accent="green">
            Each release, <code>ml-labs update</code> overwrites the per-project commands with the
            current versions in <code>~/.ml-labs/cli/templates/.claude/</code>. So if a new release
            adds <code>/neuron-foo</code>, every project gets it.
          </InfoCard>
          <InfoCard icon={Terminal} title="Custom commands survive update" accent="orange">
            Files <em>not</em> shipped by ml-labs init aren't touched by update. Add{" "}
            <code>.claude/commands/my-custom.md</code> and it stays through updates.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="The skills file" title=".claude/skills/neuron/SKILL.md.">
        <p>
          Alongside the commands, <code>ml-labs init</code> drops a SKILL.md that's loaded as
          ambient context every Claude session. It contains the Neuron mental model, common patterns,
          and rules of thumb — so even when you're not using a slash command, Claude knows the
          shape of the system.
        </p>
        <Callout kind="tip">
          If you find yourself repeating the same explanation to Claude (&ldquo;normalize=true means
          per-feature Z-score…&rdquo;), append it to <code>SKILL.md</code> instead. Next session,
          Claude will already know.
        </Callout>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "cli/templates/.claude/commands/", what: "Source of truth — the files copied to every project's .claude/commands/ on init/update." },
            { file: ".claude/commands/neuron-*.md (per-project)", what: "Per-project copies. Same content as the templates by default." },
            { file: "cli/templates/.claude/skills/neuron/SKILL.md", what: "Ambient context loaded every session." },
            { file: "cli/commands/init.ts", what: "The code that copies templates into a fresh project." },
            { file: "cli/commands/update.ts", what: "The code that re-copies skills + commands on update." },
          ]}
        />
        <Callout kind="learn" title="Want to learn more about slash commands generally?">
          Slash commands are a Claude Code feature, not ML-Labs-specific. The Anthropic docs cover
          them under &ldquo;custom commands.&rdquo; ML-Labs just ships a useful starter set.
        </Callout>
      </Section>
    </div>
  )
}
