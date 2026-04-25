import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"
import { Table } from "../components/Table"

export function MentalModel() {
  return (
    <div>
      <PageHeader
        eyebrow="What's actually happening when you type"
        accent="purple"
        title={<>Prompts as <span className="gradient-text">tool calls</span>.</>}
        lede="ML-Labs feels magic — type 'train iris' and a pipeline runs. Underneath, Claude is reading your message, picking tools from a list, and calling them. This page demystifies the loop. Once you internalise it, you can debug your own prompts."
      />

      <Section eyebrow="The mental model" title="Three things that aren't obvious.">
        <ol className="list-decimal list-inside space-y-3 text-sm">
          <li><strong>Claude doesn't know about your data.</strong> It only knows what tools the MCP server exposes and what you've told it in this conversation.</li>
          <li><strong>Claude picks the tool, not you.</strong> When you say &ldquo;train iris,&rdquo; Claude reads its tool list, decides <code>auto_train</code> matches, and parses the args from your text.</li>
          <li><strong>Each tool call is one round-trip.</strong> Claude → MCP server → tool result → Claude. Nothing streams. Long tools (auto_train, train) block the round-trip until done.</li>
        </ol>
      </Section>

      <Section eyebrow="The loop" title="How a message becomes tool calls.">
        <AsciiDiagram title="One Claude turn" accent="purple">
{`   You: "Train a good model for iris with 95% accuracy."
                     │
                     ▼
   ┌──────────────────────────────────────────────────────┐
   │  Claude reads:                                        │
   │    - your message                                     │
   │    - the system prompt (if any)                       │
   │    - .claude/skills/neuron/SKILL.md (if loaded)       │
   │    - the conversation history                         │
   │    - the list of available MCP tools                  │
   └──────────────────────────────────────────────────────┘
                     │
                     ▼
   ┌──────────────────────────────────────────────────────┐
   │  Claude decides:                                      │
   │    "auto_train looks right.                           │
   │     task_id='iris', accuracy_target=0.95."            │
   └──────────────────────────────────────────────────────┘
                     │
                     ▼
   ┌──────────────────────────────────────────────────────┐
   │  MCP call:                                            │
   │    auto_train({                                       │
   │      task_id: "iris",                                 │
   │      accuracy_target: 0.95                            │
   │    })                                                 │
   └──────────────────────────────────────────────────────┘
                     │
                     ▼
   ┌──────────────────────────────────────────────────────┐
   │  Neuron runs the controller, returns the verdict      │
   └──────────────────────────────────────────────────────┘
                     │
                     ▼
   ┌──────────────────────────────────────────────────────┐
   │  Claude reads the verdict, summarises in English,     │
   │  shows it back to you.                                │
   └──────────────────────────────────────────────────────┘`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="Slash commands" title="Why they make a difference.">
        <p>
          A slash command is just a prompt template that pre-narrows the choice. Compare:
        </p>

        <CodeBlock
          lang="ts"
          title="Without a slash command"
          code={`> Train iris.

# Claude sees ~43 tools, has to figure out:
#  - is "iris" a task that already exists?
#  - if not, do I create_task first?
#  - do I run train, run_sweep, or auto_train?
#  - what hyperparameters?
#  - 80% of the time it picks auto_train. The 20%
#    you don't have a task yet, so it create_task's
#    first. Sometimes it asks you a clarifying Q.`}
        />

        <CodeBlock
          lang="ts"
          title="With /neuron-auto"
          code={`> /neuron-auto iris 0.95

# Claude reads .claude/commands/neuron-auto.md, which has:
#   allowed-tools: mcp__neuron__auto_train, mcp__neuron__get_auto_status
#   prompt: "Call auto_train with task_id=$1, accuracy_target=$2."
#
# So it ONLY has those two tools to work with. It calls auto_train
# with parsed args. No ambiguity, no clarifying questions. Faster.`}
        />

        <Callout kind="learn" title="Why slash commands aren't required">
          You can absolutely just talk in English. Slash commands are a pre-flighted shortcut — they
          give Claude (a) a smaller toolbox so it picks faster, (b) a parsing template so it doesn't
          guess what you meant, (c) a consistent reporting format. Use them for verbs you reach for
          often.
        </Callout>
      </Section>

      <Section eyebrow="The skills file" title="Ambient context.">
        <p>
          <code>.claude/skills/neuron/SKILL.md</code> is loaded as context every Claude session,
          regardless of whether you use a slash command. It gives Claude the &ldquo;rules of thumb&rdquo;
          it needs without you repeating them every conversation.
        </p>
        <CodeBlock
          lang="md"
          title=".claude/skills/neuron/SKILL.md (excerpt)"
          code={`# Neuron MCP — usage rules

When the user wants to train a model:
- For new tasks, prefer auto_train (it handles preflight + sweep + diagnose).
- For known tasks, prefer the slash command if one exists.
- When data is heavy (refuse-level), always run dry_run first and confirm.

When predict returns a wrong-confidence answer:
- Suggest calibrate(run_id) on the active model.

When the user mentions production / deployment:
- Surface drift_check + the predictions table.

Never:
- Pass force: true without explicit user permission.
- Modify weights / runs rows directly via SQLite.`}
        />
        <Callout kind="tip" title="Repeating yourself? Add to SKILL.md">
          If you find you're explaining the same thing to Claude every session (&ldquo;don't use
          load_csv on this file, use load_json…&rdquo;), append it to <code>SKILL.md</code>. Next
          session, it'll already know.
        </Callout>
      </Section>

      <Section eyebrow="What Claude can't see" title="Common surprises.">
        <Table
          columns={[
            { key: "thing",  header: "Thing",                   accent: "purple" },
            { key: "claude", header: "Claude sees?" },
            { key: "why",    header: "Why" },
          ]}
          rows={[
            { thing: "Tool source code",          claude: "No",   why: "Claude only sees the tool's name, description, arg schema — not the implementation. It calls the tool blind." },
            { thing: "Files in your project",      claude: "Only via Read tool", why: "Claude Code has a Read tool but it's separate from MCP tools. Different surface." },
            { thing: "DB rows",                    claude: "Only via tools",     why: "list_tasks, list_runs, get_run_status all wrap SQL queries. Claude can't run free-form SQL." },
            { thing: "Live progress of a tool",    claude: "Only after it returns", why: "MCP tool calls block until done. Use a separate session + get_run_status / get_auto_status to peek mid-flight." },
            { thing: "What you said an hour ago",  claude: "Yes (in same conversation)", why: "Within one Claude Code session, conversation history is in context. Across sessions, it's gone." },
            { thing: "Other Claude sessions",      claude: "No",   why: "Each session is isolated. The DB is the only shared state — that's why we put everything in SQLite." },
          ]}
        />
      </Section>

      <Section eyebrow="When Claude gets it wrong" title="Debug your own prompt.">
        <p>
          If Claude does something unexpected:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>
            <strong>Was it ambiguous?</strong> &ldquo;Train it&rdquo; without context could mean a
            dozen things. Be specific: <em>&ldquo;Train task iris with default hyperparameters.&rdquo;</em>
          </li>
          <li>
            <strong>Is the right tool exposed?</strong> Check the MCP panel in Claude Code — if the
            tool you expected isn't listed, your <code>.mcp.json</code> isn't loaded.
          </li>
          <li>
            <strong>Did you contradict the skills file?</strong> Skills tell Claude not to pass{" "}
            <code>force: true</code> without permission. If you say &ldquo;just force it,&rdquo; you
            override that — explicitly.
          </li>
          <li>
            <strong>Try a slash command.</strong> Slash commands narrow the toolbox. If the same
            request fails in chat but works as <code>/neuron-auto</code>, the problem was tool
            ambiguity.
          </li>
          <li>
            <strong>Read the tool description.</strong> Every MCP tool's description is in the panel.
            If the description says &ldquo;requires task to exist first,&rdquo; that's why Claude did
            create_task before train.
          </li>
        </ol>
      </Section>

      <Section eyebrow="Sub-agents" title="Claude calling itself.">
        <p>
          Some tools (<code>auto_train</code>, <code>run_sweep</code>'s sub-agent mode) spawn{" "}
          <em>nested</em> Claude sessions internally. Each sub-agent has its own conversation, its
          own (narrower) tool list, and its own response pipeline back to the parent.
        </p>
        <AsciiDiagram title="auto_train spawns sub-agents" accent="cyan">
{`     You ─ message ──▶ Claude (parent)
                          │
                          │ calls
                          ▼
                     auto_train
                          │
                          │ may spawn (planner phase)
                          ▼
              ┌───── Claude (planner sub-agent) ─────┐
              │   Tools: just neuron MCP             │
              │   Prompt: "given these signals,       │
              │            propose 3 configs"         │
              │   Returns: {configs: [...]}           │
              └──────────────────────────────────────┘
                          │
                          │ may spawn (sweep wave)
                          ▼
        ┌── Claude (config 1) ── Claude (config 2) ── Claude (config 3) ──┐
        │   Tools: just train     just train          just train          │
        │   Each runs one config, returns {run_id, accuracy}              │
        └────────────────────────────────────────────────────────────────┘
                          │
                          ▼
                    auto_train returns verdict to parent`}
        </AsciiDiagram>
        <Callout kind="learn" title="Why sub-agents">
          Sub-agents have isolated context windows, narrowed toolsets, and predictable parsers. The
          parent session stays clean (you don't see the sub-agent reasoning) and the sub-agent stays
          focused (one tool, one job). Cost: an extra Claude API call per sub-agent. See the{" "}
          <a href="/inside-subagent" className="text-cyan-neon hover:underline">Inside a Sub-agent</a>{" "}
          page.
        </Callout>
      </Section>

      <Section eyebrow="Practical takeaways" title="Five rules to internalise.">
        <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
          <li><strong>Claude is reading and reasoning, not executing.</strong> It picks tools — the tools do the work.</li>
          <li><strong>Specificity helps.</strong> &ldquo;Train iris with 1000 epochs at lr=0.01&rdquo; is faster than &ldquo;train it.&rdquo;</li>
          <li><strong>Slash commands shortcut the picking step.</strong> Use them for verbs you do daily.</li>
          <li><strong>SKILL.md is your repeating-myself file.</strong> If you explain something twice, write it down.</li>
          <li><strong>The DB is the only shared state.</strong> Cross-session, cross-process, cross-tool — everything goes through SQLite.</li>
        </ol>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: ".mcp.json (project root)",                what: "Tells Claude Code which MCP servers to load. The handshake." },
            { file: ".claude/commands/neuron-*.md",            what: "Per-project slash commands. ml-labs init scaffolds, ml-labs update refreshes." },
            { file: ".claude/skills/neuron/SKILL.md",          what: "Ambient context. Loaded every session." },
            { file: "neuron/src/server.ts",                    what: "MCP server entrypoint. Registers all 43 tools." },
            { file: "neuron/src/tools/<name>.ts",              what: "One file per tool. Schema (Zod) + handler." },
            { file: "cli/templates/.claude/",                  what: "Source of truth for what ml-labs init copies." },
          ]}
        />
      </Section>
    </div>
  )
}
