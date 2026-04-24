import { Gauge, Database, Play, Eye, BarChart3 } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function TUI() {
  return (
    <div>
      <PageHeader
        eyebrow="Dashboard without leaving the terminal"
        accent="green"
        title={<>The <span className="gradient-text">TUI</span>.</>}
        lede="neuron-tui is a 5-screen terminal UI built with Ink (the React-for-terminals renderer). Same database as everything else, same live events, but usable over SSH, in tmux, or anywhere you're already in a shell."
      />

      <Section eyebrow="Starting it" title="One command.">
        <CodeBlock
          lang="bash"
          title="terminal"
          code={`neuron-tui

# or from source:
bun run tui`}
        />
        <Callout kind="tip">
          The TUI reads the same <code>data/neuron.db</code> as everything else. If the MCP server is
          running, the TUI will see live progress. If not, it shows whatever state the DB is in.
        </Callout>
      </Section>

      <Section eyebrow="The layout" title="Five tabs, one keyboard.">
        <AsciiDiagram title="neuron-tui — layout sketch" accent="green">
{`┌─[1 Dashboard] [2 Dataset] [3 Train] [4 Runs] [5 Predict]────────┐
│                                                                  │
│  Active run                                                      │
│  ─────────                                                       │
│    task: iris   run_id: 42   epoch: 310/500   loss: 0.04         │
│    [█████████████░░░░░░░░░░░░░]  62%   eta: ~18s                 │
│                                                                  │
│  Recent runs                                                     │
│  ───────────                                                     │
│    42  iris       0.983    completed    2m ago                   │
│    41  pima       0.771    completed    8m ago                   │
│    40  iris       0.967    completed    11m ago                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
 [?] help   [q] quit   [1-5] tabs   [j/k] navigate   [Enter] select`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="The five screens" title="What each tab does.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Gauge} title="1. Dashboard" accent="cyan">
            Active run card (live loss, progress bar, ETA), recent runs summary, quick nav links.
            Default screen on launch.
          </InfoCard>
          <InfoCard icon={Database} title="2. Dataset" accent="purple">
            Task list + sample counts. Pick a task to see its class distribution, recent samples, and
            quick actions: reset, load more data, inspect.
          </InfoCard>
          <InfoCard icon={Play} title="3. Train" accent="orange">
            Training launcher. Pick a task, pick hyperparameters or defaults, launch a training or
            auto_train. Progress shows on the Dashboard tab live.
          </InfoCard>
          <InfoCard icon={BarChart3} title="4. Runs" accent="green">
            Full run history. Select a run to see loss curve (ASCII plot), per-class accuracy,
            confusion matrix. Arrow keys to navigate.
          </InfoCard>
          <InfoCard icon={Eye} title="5. Predict" accent="pink">
            Run predict on a task. Enter a feature vector, see label + confidence. Handy for quick
            spot-checks without leaving the terminal.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Keyboard shortcuts" title="The cheat sheet.">
        <Table
          columns={[
            { key: "key",    header: "Key",     mono: true, accent: "green", width: "110px" },
            { key: "action", header: "Action" },
          ]}
          rows={[
            { key: "1 – 5",    action: "Switch tabs (Dashboard, Dataset, Train, Runs, Predict)" },
            { key: "q",        action: "Quit" },
            { key: "?",        action: "Toggle keyboard-shortcut overlay" },
            { key: "j / ↓",    action: "Move selection down" },
            { key: "k / ↑",    action: "Move selection up" },
            { key: "Enter",    action: "Confirm / drill into selection" },
            { key: "Esc",      action: "Go back / cancel" },
            { key: "Ctrl+C",   action: "Quit immediately (same as q)" },
          ]}
        />
      </Section>

      <Section eyebrow="When to reach for the TUI" title="vs. dashboard vs. Claude Code.">
        <Table
          columns={[
            { key: "use",  header: "Use case",                      accent: "cyan" },
            { key: "best", header: "Best tool" },
            { key: "why",  header: "Why" },
          ]}
          rows={[
            { use: "Planning a pipeline",            best: "Claude Code",     why: "Free-form conversation, tool chaining, explanations." },
            { use: "Watching a run complete",        best: "TUI or Dashboard", why: "Both have live progress; TUI if you're already in a shell." },
            { use: "Clicking around, exploring",     best: "Dashboard",       why: "Richer visuals, sortable tables, confusion matrices rendered properly." },
            { use: "SSH into a remote box",          best: "TUI",             why: "No browser, no port forwarding — just a terminal." },
            { use: "Quick one-off predict",          best: "TUI or Claude",    why: "Claude is chatty but smart; TUI is quick but manual." },
            { use: "Manually labeling samples",      best: "Dashboard",       why: "/label route has a proper labeling UI the TUI doesn't." },
          ]}
        />
      </Section>

      <Section eyebrow="Under the hood" title="Ink + the same DB.">
        <p>
          Ink renders React components as ANSI text. That's it — no curses library, no manual cursor
          juggling. Components look the same as web React. The TUI polls the DB directly (via the same{" "}
          <code>core/db/</code> helpers the MCP server uses), and its event subscription listens to the
          same events table.
        </p>
        <Callout kind="learn" title="Why Ink instead of a TUI library">
          Re-using the React mental model means one codebase patterns to two UIs (web dashboard + TUI).
          Ink is fast enough for 60fps updates on the active run card. The bundle is shipped as part of{" "}
          <code>neuron-tui</code> (second bin in <code>package.json</code>).
        </Callout>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "40%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/tui/index.tsx",        what: "Entry point. Renders <App /> via Ink." },
            { file: "neuron/src/tui/App.tsx",          what: "Tab routing + keyboard shortcut handler + help overlay." },
            { file: "neuron/src/tui/screens/",         what: "Dashboard, Dataset, Train, Runs, Predict screens." },
            { file: "neuron/src/tui/components/",      what: "Reusable TUI components (TabBar, progress bar, table, etc.)." },
            { file: "neuron/src/tui/store.ts",         what: "Simple app-state store for shared selection state." },
            { file: "neuron/src/tui/client/",          what: "DB adapters + event subscription (shares with MCP path)." },
          ]}
        />
      </Section>
    </div>
  )
}
