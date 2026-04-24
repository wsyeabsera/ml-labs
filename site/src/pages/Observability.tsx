import { ListChecks, Bell, Activity, FileSearch } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { InfoCard } from "../components/InfoCard"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { AsciiDiagram } from "../components/AsciiDiagram"

export function Observability() {
  return (
    <div>
      <PageHeader
        eyebrow="See what the system is doing"
        accent="green"
        title={<>Events & <span className="gradient-text">observability</span>.</>}
        lede="Three mechanisms let you watch ML-Labs work: the events table (every interesting thing), the decision_log on auto_runs (what auto_train was thinking), and the live SSE stream (real-time feed)."
      />

      <Section eyebrow="Why it exists" title="Training is a multi-process story.">
        <p>
          auto_train spawns sub-agents. Sub-agents spawn child trainings. The HTTP server writes its
          own updates. Without an events bus, these surfaces get out of sync: the dashboard shows an
          active run that finished, Claude reports a config that was already tried, you ask{" "}
          <code>get_auto_status</code> and it's 5 seconds stale.
        </p>
        <p>
          The events bus solves this by funneling every state change through a single place (the{" "}
          <code>events</code> table) with a single cross-process API (<code>recordEvent()</code>) and
          a live stream anyone can subscribe to (<code>/api/events</code> SSE).
        </p>
      </Section>

      <Section eyebrow="The flow" title="Where events come from, where they go.">
        <AsciiDiagram title="Events bus" accent="green">
{`      training started           auto wave done         sweep completed
             │                          │                      │
             ▼                          ▼                      ▼
    ┌─────────────────────────────────────────────────────────────┐
    │             recordEvent({ kind, taskId, payload })          │
    └─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                     ┌────────────────────────┐
                     │  INSERT INTO events    │
                     │  (ts, source, kind,    │
                     │   task_id, run_id,     │
                     │   payload_json)        │
                     └────────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
              ▼                 ▼                  ▼
      ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
      │ listEvents() │   │ /api/events  │   │ (other read  │
      │ (synchronous │   │   SSE stream │   │  MCP tools)  │
      │  query)      │   │              │   │              │
      └──────────────┘   └──────────────┘   └──────────────┘
          │                 │                      │
          │                 ▼                      │
          │       ┌─────────────────┐              │
          │       │  dashboard UI   │              │
          │       │  TUI            │              │
          │       └─────────────────┘              │
          │                                        │
          └────────────── ad-hoc scripts ──────────┘`}
        </AsciiDiagram>
      </Section>

      <Section eyebrow="The events table" title="Source of truth for things that happened.">
        <CodeBlock
          lang="sql"
          title="events table schema"
          code={`CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,    -- unix seconds (WHEN the event was recorded)
  source     TEXT    NOT NULL,    -- "mcp" | "api" | "tui"
  kind       TEXT    NOT NULL,    -- event type (see table below)
  task_id    TEXT    NULL,
  run_id     INTEGER NULL,
  payload    TEXT    NULL         -- JSON blob with event-specific data
);`}
        />
        <Callout kind="learn" title="Why a single flat table">
          Every event goes in one place, so every consumer queries one place. The <code>kind</code>{" "}
          column is the type discriminator; <code>payload</code> is whatever schema that kind carries.
          Adds new event types without migrations.
        </Callout>
      </Section>

      <Section eyebrow="Event kinds" title="The canonical list.">
        <Table
          caption="Every event kind currently emitted"
          columns={[
            { key: "kind",    header: "kind",     mono: true, accent: "green" },
            { key: "when",    header: "When it fires" },
            { key: "payload", header: "Payload carries" },
          ]}
          rows={[
            // Training
            { kind: "run_started",      when: "A train run is about to begin.",                      payload: "lr, epochs, headArch, source" },
            { kind: "run_stage",        when: "The trainer moves to a new stage (featurize, init, train, eval).", payload: "stage, message" },
            { kind: "run_progress",     when: "Throttled (1/sec) progress heartbeat during training.", payload: "stage, i, n, message" },
            { kind: "run_completed",    when: "Training finished successfully.",                      payload: "accuracy, epochsDone, confusion_matrix (small K), mae" },
            { kind: "run_cancelled",    when: "cancel_training was called or abort fired.",           payload: "error" },
            { kind: "run_reaped",       when: "Orphan reaper force-cancelled a zombie row.",          payload: "reason" },
            { kind: "model_registered", when: "A run was promoted to active model for its task.",     payload: "accuracy, previousRunId" },

            // Sweeps
            { kind: "sweep_started",    when: "run_sweep began.",                                     payload: "configs, mode" },
            { kind: "sweep_progress",   when: "One sub-agent in the sweep completed.",                payload: "run_id, accuracy, completed, total" },
            { kind: "sweep_completed",  when: "run_sweep finished all configs.",                      payload: "best_run_id, best_accuracy" },
            { kind: "sweep_cancelled",  when: "Sweep was interrupted.",                               payload: "reason" },

            // Auto-train
            { kind: "auto_started",         when: "auto_train controller entered.",                   payload: "accuracy_target, budget_s, max_waves" },
            { kind: "auto_heavy_workload",  when: "The budget estimator returned heavy/refuse.",      payload: "level, peak_mb, advice" },
            { kind: "auto_wave_started",    when: "A new sweep wave began.",                          payload: "auto_run_id, wave, configs, strategy" },
            { kind: "auto_wave_completed",  when: "A wave finished.",                                 payload: "best_run_id, best_metric, configs_tried, is_overfit, eta_s" },
            { kind: "auto_collect_start",   when: "An auto_collect round began.",                     payload: "round" },
            { kind: "auto_collect_added",   when: "auto_collect inserted new samples.",               payload: "added" },
            { kind: "auto_completed",       when: "auto_train exited normally.",                      payload: "status, winner_run_id, accuracy" },
            { kind: "auto_cancelled",       when: "cancel_auto_train or abort fired.",                payload: "reason" },
            { kind: "auto_reaped",          when: "Startup reaper force-cancelled a stale auto_run.", payload: "reason" },
            { kind: "auto_note",            when: "log_auto_note was called.",                        payload: "stage, note" },

            // CV / calibration / drift
            { kind: "cv_started",       when: "cv_train began.",                                      payload: "k, task_id" },
            { kind: "cv_completed",     when: "cv_train finished.",                                   payload: "mean_accuracy, std_accuracy, per_fold_accuracy" },
            { kind: "calibrated",       when: "calibrate fit a temperature.",                         payload: "temperature, ece_before, ece_after" },
            { kind: "drift_detected",   when: "drift_check found drifting or severe features.",       payload: "verdict_summary, top_features" },

            // Data ingestion
            { kind: "csv_load_started",   when: "load_csv began reading.",                            payload: "path, bytes" },
            { kind: "csv_load_progress",  when: "Throttled progress during large CSV loads.",         payload: "rows, pct" },
            { kind: "csv_load_completed", when: "load_csv inserted all rows.",                        payload: "total, train, test" },
            { kind: "upload",             when: "Dashboard /api/upload accepted a file.",             payload: "filename, size" },
            { kind: "sample_labeled",     when: "Dashboard labeling UI updated a sample's label.",    payload: "sample_id, old_label, new_label" },

            // Batch predict
            { kind: "batch_predict_started",    when: "batch_predict began.",                         payload: "path, rows" },
            { kind: "batch_predict_progress",   when: "Throttled progress.",                          payload: "rows_done, pct" },
            { kind: "batch_predict_completed",  when: "batch_predict finished.",                      payload: "total, accuracy" },
            { kind: "batch_predict_failed",     when: "Error during batch prediction.",               payload: "error" },

            // Shadow models
            { kind: "shadow_attached",   when: "Shadow model attached to a task.",                    payload: "shadow_run_id" },
            { kind: "shadow_detached",   when: "Shadow detached.",                                    payload: "shadow_run_id" },
            { kind: "shadow_promoted",   when: "Shadow was promoted to active.",                      payload: "new_active_run_id" },

            // LLM
            { kind: "llm_loaded",        when: "llm_load finished.",                                  payload: "path, info" },
            { kind: "llm_generated",     when: "llm_generate produced tokens.",                       payload: "num_generated, elapsed_ms, tokens_per_sec" },

            // Task lifecycle
            { kind: "task_reset",        when: "reset_task was called (not deleted).",                payload: "confirm" },
            { kind: "task_deleted",      when: "reset_task({ delete_task: true }).",                  payload: "-" },

            // Tool calls (dashboard request log)
            { kind: "tool_call",         when: "A tool was invoked via the request-proxy endpoint.",  payload: "tool_name, duration_ms" },
            { kind: "request",           when: "HTTP request received.",                              payload: "method, path" },
            { kind: "response",          when: "HTTP response sent.",                                 payload: "status, duration_ms" },
          ]}
        />
      </Section>

      <Section eyebrow="Live SSE stream" title="/api/events.">
        <p>
          The HTTP server exposes <code>/api/events</code> as a Server-Sent Events endpoint. Every new
          row in the events table fires an event on the stream in the same shape:
        </p>
        <CodeBlock
          lang="txt"
          title="Sample SSE stream"
          code={`event: run_progress
data: {"id":5231,"ts":1714000001,"taskId":"iris","runId":42,"payload":{"stage":"train","i":120,"n":500,"message":"epoch 120/500"}}

event: run_progress
data: {"id":5232,"ts":1714000002,"taskId":"iris","runId":42,"payload":{"stage":"train","i":130,"n":500,"message":"epoch 130/500"}}

event: auto_wave_completed
data: {"id":5238,"ts":1714000047,"taskId":"iris","payload":{"auto_run_id":7,"wave":1,"best_run_id":42,"best_metric":0.983,"configs_tried":3,"target_reached":true}}`}
        />
        <Callout kind="tip" title="Tailing from a terminal">
          <code>curl -N http://localhost:2626/api/events</code> will stream events as they happen, one
          per line. Pipe through <code>jq</code> to pretty-print. This is how the dashboard stays live
          without polling.
        </Callout>
      </Section>

      <Section eyebrow="auto_runs.decision_log" title="The other kind of event.">
        <p>
          Separate from the events table, every <code>auto_run</code> has a{" "}
          <strong>decision_log</strong>: an append-only JSON array of entries describing the
          controller's reasoning. Where events are ephemeral progress signals, the decision_log is the
          permanent record of <em>why</em> auto_train made the choices it did.
        </p>

        <CodeBlock
          lang="ts"
          title="AutoLogEntry"
          code={`interface AutoLogEntry {
  ts:       string        // ISO 8601
  stage:    string        // e.g. "inspect", "sweep_wave_1_plan", "winner_selection"
  note:     string        // human-readable one-liner
  payload?: unknown       // optional structured data
}`}
        />

        <Table
          caption="Common decision_log stages"
          columns={[
            { key: "stage", header: "stage", mono: true, accent: "purple" },
            { key: "what",  header: "What it records" },
          ]}
          rows={[
            { stage: "inspect",              what: "Data health numbers from preflight (N, K, D, imbalance, warnings)." },
            { stage: "preflight_fail",       what: "Data not ready — controller exits without training." },
            { stage: "warm_start",           what: "Whether a prior pattern was found and used." },
            { stage: "sweep_wave_N_plan",    what: "Plan for wave N — configs + rules_fired + rule_explanations." },
            { stage: "sweep_wave_N_exec",    what: "Wave starting — mode (sub_agents/sequential), budget level." },
            { stage: "sweep_wave_N_done",    what: "Wave outcome — best run_id, best metric, overfit gap." },
            { stage: "diagnose",             what: "Diagnoser sub-agent output — primary_cause, evidence, recommendations." },
            { stage: "target_reached",       what: "Early stop — hit accuracy_target." },
            { stage: "stop",                 what: "Early stop for other reasons (no improvement, budget)." },
            { stage: "auto_collect_start",   what: "auto_collect round began." },
            { stage: "auto_collect_added",   what: "Number of samples synthesised/collected." },
            { stage: "winner_selection",     what: "Chosen winner run_id + score + overfit flag + reasoning." },
            { stage: "promote",              what: "Registered winner as active model." },
            { stage: "calibrate",            what: "Temperature + ECE before/after." },
            { stage: "publish",              what: "If publish_name was set, the URI." },
            { stage: "pattern_saved",        what: "Pattern memory updated with the winner config." },
            { stage: "cancel_reaped",        what: "v1.10.0 — ids of orphaned runs force-cancelled on exit." },
          ]}
        />
      </Section>

      <Section eyebrow="Querying from Claude" title="The tools for inspection.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={ListChecks} title="get_auto_status" accent="purple">
            Pass <code>task_id</code> (returns latest) or <code>auto_run_id</code> (specific one).
            Returns the full <code>auto_runs</code> row including the <code>decision_log</code> array.
            Safe to call during a run — polls DB directly.
          </InfoCard>
          <InfoCard icon={FileSearch} title="get_run_status" accent="cyan">
            Pass <code>run_id</code>. Returns live progress (stage, i/n, loss history) during training;
            full metrics once completed. Cross-process safe via DB fallback.
          </InfoCard>
          <InfoCard icon={Activity} title="Dashboard /activity" accent="green">
            The live feed. Filterable by task and kind. Great for watching a sequence of tool calls
            unfold.
          </InfoCard>
          <InfoCard icon={Bell} title="Drift alerting" accent="orange">
            <code>drift_detected</code> events fire from <code>drift_check</code>. Subscribe to the SSE
            stream and forward to a webhook for proper monitoring.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Files.">
        <Table
          columns={[
            { key: "file", header: "File", mono: true, width: "40%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "core/db/events.ts",         what: "events table schema + recordEvent + listEvents + listSince." },
            { file: "core/db/auto.ts",           what: "auto_runs schema + decision_log appender." },
            { file: "neuron/src/api.ts",         what: "The /api/events SSE handler + query endpoints." },
            { file: "tools/get_auto_status.ts",  what: "MCP tool that returns the auto_runs row + decision_log." },
            { file: "tools/get_run_status.ts",   what: "MCP tool for live run progress (cross-process)." },
            { file: "dashboard/src/routes/Activity.tsx", what: "Live feed UI consuming /api/events." },
          ]}
        />
      </Section>
    </div>
  )
}
