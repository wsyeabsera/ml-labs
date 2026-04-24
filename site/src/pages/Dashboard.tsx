import {
  Monitor, Server, Database, ListTree, Activity, Wifi, Rocket,
} from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function Dashboard() {
  return (
    <div>
      <PageHeader
        eyebrow="Your runs, rendered"
        accent="cyan"
        title={<>The <span className="gradient-text">HTTP dashboard</span>.</>}
        lede="Neuron ships with a second transport: a small HTTP server on port 2626 that shares the same SQLite database as the MCP server and serves a React dashboard on top. Open http://localhost:2626 while training runs to watch it narrate itself in real time."
      />

      <Section eyebrow="Why a dashboard" title="MCP is great for Claude; humans prefer visuals.">
        <p>
          Everything the dashboard shows comes from the same SQLite database the MCP server writes to.
          You can train from Claude Code and see it tick on the dashboard. Or start training from the
          dashboard and ask Claude about the result. They're two views on the same state.
        </p>
        <Callout kind="learn" title="Two transports, one database">
          MCP (stdio, JSON-RPC) is what Claude speaks. HTTP (port 2626, REST-ish JSON) is what the
          React UI speaks. Both call the same TypeScript functions under the hood. The{" "}
          <code>runs</code> table is authoritative — every run status update flows through it — so
          neither surface gets out of sync.
        </Callout>
      </Section>

      <Section eyebrow="Starting it" title="One command.">
        <CodeBlock
          lang="bash"
          title="terminal — start the HTTP server + dashboard"
          code={`ml-labs dashboard

# listens on :2626
# serves the pre-built React app at /
# exposes /api/* and /events SSE stream
# opens your default browser automatically`}
        />
        <Callout kind="tip">
          Runs in the foreground. <kbd>Ctrl+C</kbd> to stop. Runs independently from Claude Code —
          you can have Claude open in one terminal and the dashboard server in another, both hitting
          the same DB. Useful when you want to poke at a run visually while Claude is orchestrating.
        </Callout>
      </Section>

      <Section eyebrow="Architecture" title="How the processes fit.">
        <AsciiDiagram title="Three processes, one DB" accent="cyan">
{`           ┌─────────────────────────────────────────────────┐
           │                  data/neuron.db                 │  (shared)
           │    tasks · samples · runs · models · auto_runs  │
           │    events · predictions · shadow · auto_patterns│
           └─────────────────────────────────────────────────┘
              ▲                    ▲                    ▲
              │ SQLite/WAL         │                    │
              │                    │                    │
     ┌────────┴─────────┐  ┌───────┴────────┐  ┌────────┴─────────┐
     │  neuron-mcp      │  │  HTTP dashboard│  │  sub-agent       │
     │  (stdio)         │  │  :2626 + UI    │  │  (sweep wave)    │
     │  src/server.ts   │  │  src/api.ts    │  │  src/server.ts   │
     └──────────────────┘  └────────────────┘  └──────────────────┘
              ▲                    ▲                    ▲
              │ stdio              │ HTTP               │ stdio
              │                    │                    │
     ┌────────┴─────────┐  ┌───────┴────────┐  ┌────────┴─────────┐
     │  Claude Code     │  │  your browser  │  │  Claude Agent    │
     │                  │  │                │  │  SDK (spawned)   │
     └──────────────────┘  └────────────────┘  └──────────────────┘

   Everyone writes the same DB. No message broker, no daemon.`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="The pages" title="What's on the dashboard.">
        <Table
          columns={[
            { key: "route",   header: "Route",        mono: true },
            { key: "purpose", header: "Purpose",      accent: "cyan" },
            { key: "notable", header: "Notable features" },
          ]}
          rows={[
            { route: "/",                purpose: "Overview",       notable: "Task cards, active run card (live ETA), recent auto_run summaries." },
            { route: "/tasks",           purpose: "Tasks",          notable: "Full task list, sample counts, click through to upload/train/predict." },
            { route: "/upload",          purpose: "Upload",         notable: "Drag-drop CSV/JSON. Configure label column, feature columns, test_size, stratify." },
            { route: "/train",           purpose: "Train",          notable: "Manual training launcher — pick lr/epochs/optimizer etc. or trigger auto_train." },
            { route: "/sweep",           purpose: "Sweep",          notable: "Visual grid-sweep launcher. Watch sub-agents complete in real time." },
            { route: "/runs",            purpose: "All runs",       notable: "Sortable run history across all tasks." },
            { route: "/runs/:id",        purpose: "Run detail",     notable: "Loss curve, per-class accuracy, confusion matrix, ETA, calibration info, weights metadata." },
            { route: "/compare",         purpose: "Compare runs",   notable: "Select 2+ runs, see metrics side-by-side with diffs highlighted." },
            { route: "/auto-runs",       purpose: "Auto-runs",      notable: "List of every auto_train invocation — status, winner, waves, wall-clock, verdict." },
            { route: "/auto-runs/:id",   purpose: "Auto-run detail", notable: "Full decision_log rendered as a timeline. Per-wave plans and outcomes." },
            { route: "/predict",         purpose: "Predict",        notable: "Single-sample prediction form — paste features, see label + confidence + scores." },
            { route: "/drift",           purpose: "Drift",          notable: "Per-feature PSI + KS + verdict table. Uses the predictions table as the current window." },
            { route: "/activity",        purpose: "Activity",       notable: "Live feed of every event written to the events table (SSE-powered)." },
            { route: "/label",           purpose: "Label",          notable: "In-browser labeling UI for raw / uncertain samples. Surface: suggest_samples output." },
            { route: "/playground",      purpose: "LLM playground", notable: "llm_load + llm_generate UI. Paste GGUF path, type prompt, watch tokens stream." },
          ]}
        />
      </Section>

      <Section eyebrow="The API surface" title="What /api/* exposes.">
        <p>
          The dashboard React app is the primary consumer, but every endpoint is plain JSON — you can
          script against it with <code>curl</code>, <code>fetch</code>, or anything else.
        </p>
        <Table
          columns={[
            { key: "method", header: "Method",                   mono: true, width: "80px" },
            { key: "path",   header: "Path",                     mono: true, accent: "cyan" },
            { key: "purpose", header: "What it does" },
          ]}
          rows={[
            { method: "GET",    path: "/api/health",              purpose: "Liveness + version + rs-tensor status." },
            { method: "GET",    path: "/api/config",              purpose: "Resolved adapter config path, featurize details." },
            { method: "GET",    path: "/api/tasks",               purpose: "All tasks with sample/run counts and active model." },
            { method: "POST",   path: "/api/tasks",               purpose: "Create a task." },
            { method: "DELETE", path: "/api/tasks/:id",           purpose: "Delete a task and all its data." },
            { method: "GET",    path: "/api/runs",                purpose: "All runs across all tasks, paginated." },
            { method: "GET",    path: "/api/runs/:id",            purpose: "Run detail — hyperparams, metrics, loss history, progress." },
            { method: "POST",   path: "/api/train",               purpose: "Kick off a train run in the background." },
            { method: "POST",   path: "/api/sweep",               purpose: "Kick off a sweep." },
            { method: "POST",   path: "/api/auto-train",          purpose: "Kick off auto_train." },
            { method: "GET",    path: "/api/auto",                purpose: "List auto_runs." },
            { method: "GET",    path: "/api/auto/:id",            purpose: "Auto-run detail with decision log." },
            { method: "POST",   path: "/api/predict",             purpose: "Run predict() with feature array in the body." },
            { method: "POST",   path: "/api/batch-predict",       purpose: "Run batch_predict over an uploaded file." },
            { method: "GET",    path: "/api/drift/:task_id",      purpose: "Trigger a drift_check and return the report." },
            { method: "GET",    path: "/api/events",              purpose: "SSE stream — every event as it's written. The live feed." },
            { method: "POST",   path: "/api/upload",              purpose: "Multipart upload + load_csv / load_json dispatch." },
            { method: "POST",   path: "/api/llm/load",            purpose: "Load a GGUF file for the playground." },
            { method: "POST",   path: "/api/llm/generate",        purpose: "Generate text — returns the same shape as llm_generate." },
          ]}
        />
      </Section>

      <Section eyebrow="Live updates" title="The SSE event stream.">
        <p>
          The dashboard subscribes to <code>/api/events</code>, a Server-Sent Events stream that fires
          one line per event written to the <code>events</code> table. That's how the active run card
          knows to update the loss curve, the sweep page can show sub-agents completing, and the
          activity feed refreshes without polling.
        </p>
        <CodeBlock
          lang="bash"
          title="Tail the stream from a terminal"
          code={`curl -N http://localhost:2626/api/events

# event: run_progress
# data: {"runId":42,"stage":"train","i":120,"n":500,"message":"epoch 120/500"}

# event: auto_wave_completed
# data: {"auto_run_id":7,"wave":1,"best_metric":0.93,"configs_tried":3,...}`}
        />
        <Callout kind="note">
          Events are fire-and-forget — if you miss them, they're gone from the stream (but still in the{" "}
          <code>events</code> table). Query <code>/api/runs/:id</code> or <code>/api/auto/:id</code> to
          read authoritative state.
        </Callout>
      </Section>

      <Section eyebrow="The standout widgets" title="Three you'll see most.">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Rocket} title="ActiveRunCard" accent="cyan">
            Shows on the Overview + Task Detail pages whenever training is running. Live ETA (from
            v1.9.0): <code>elapsed / ~eta</code>, <code>ms/epoch</code> or <code>s/epoch</code>, and a
            cancel button that calls <code>cancel_training</code>.
          </InfoCard>
          <InfoCard icon={ListTree} title="Decision-log timeline" accent="purple">
            On the AutoRunDetail page. Renders every <code>decision_log</code> entry as a timeline:
            stage, human note, expandable payload. The single best place to understand why auto_train
            made a given decision.
          </InfoCard>
          <InfoCard icon={Activity} title="Activity feed" accent="green">
            On the Activity page. One line per event, newest at top, filterable by task or kind. Great
            for debugging a run that's doing something unexpected.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Pairing with Claude" title="Two surfaces, one project.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Server} title="Claude drives" accent="purple">
            Train / sweep / auto_train from Claude Code. Watch it tick on the dashboard. Good for the
            first few minutes of a new project.
          </InfoCard>
          <InfoCard icon={Monitor} title="Dashboard drives" accent="cyan">
            Start training from the dashboard &ldquo;Train&rdquo; page. Ask Claude to predict on a
            specific sample once it's registered. Good for quick manual runs.
          </InfoCard>
          <InfoCard icon={Database} title="Both read" accent="green">
            Every write is to SQLite; every read hits the same tables. Changes from one surface show
            up in the other after the next refresh (dashboards poll/subscribe; MCP answers fresh every
            call).
          </InfoCard>
          <InfoCard icon={Wifi} title="Nothing networked" accent="orange">
            Port 2626 is bound to localhost only. No auth, no TLS. It's a laptop UI, not a public
            server. If you want to share a dashboard, use something like ngrok or Cloudflare Tunnel
            and know what you're doing.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Key files.">
        <Table
          columns={[
            { key: "file",   header: "File",        mono: true, width: "42%" },
            { key: "what",   header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/api.ts",                   what: "The HTTP server. Routes, SSE stream, multipart upload, CORS." },
            { file: "neuron/src/api/trainBg.ts",           what: "Background training path (non-MCP)." },
            { file: "neuron/src/api/batchPredictBg.ts",    what: "Background batch prediction path." },
            { file: "dashboard/src/routes/",               what: "React pages — Overview, Train, Sweep, Predict, AutoRunDetail, Drift, Playground, etc." },
            { file: "dashboard/src/components/ActiveRunCard.tsx", what: "The live ETA + loss-curve strip." },
            { file: "cli/index.ts (ml-labs dashboard)",    what: "The CLI entry that spawns the HTTP server and opens the browser." },
          ]}
        />
      </Section>
    </div>
  )
}
