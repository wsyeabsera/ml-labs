import { Database, Activity, Package, Zap } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { Table } from "../components/Table"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function HttpApiReference() {
  return (
    <div>
      <PageHeader
        eyebrow="The HTTP surface"
        accent="cyan"
        title={<>HTTP API <span className="gradient-text">reference</span>.</>}
        lede="The HTTP server (started by ml-labs dashboard) exposes /api/* for the React dashboard, the TUI, and any other client. Every endpoint returns JSON. CORS is open. No auth by default. This page documents every route — method, params, request body, response shape."
      />

      <Section eyebrow="Conventions" title="What's the same everywhere.">
        <Table
          columns={[
            { key: "what",  header: "What",          accent: "cyan" },
            { key: "value", header: "Value",         mono: true },
          ]}
          rows={[
            { what: "Base URL",            value: "http://localhost:2626 (override via NEURON_API_PORT)" },
            { what: "Content type",        value: "application/json on every request and response" },
            { what: "CORS",                value: "Access-Control-Allow-Origin: * (local-only by default)" },
            { what: "Auth",                value: "None — set NEURON_SERVE_TOKEN to require Bearer auth" },
            { what: "Errors",              value: "{ error: string } with non-2xx status" },
            { what: "Cancellation",        value: "DELETE on the resource (eg DELETE /api/tasks/iris/train)" },
          ]}
        />
        <Callout kind="warn" title="Local-only by default">
          The dashboard server binds to all interfaces but is intended for localhost. Don't expose
          it to the internet. If you must, set <code>NEURON_SERVE_TOKEN</code> for bearer auth and
          consider tunnelling through Cloudflare/ngrok.
        </Callout>
      </Section>

      <Section eyebrow="Health + config" title="Liveness probes.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "cyan" },
            { key: "what",   header: "What it returns" },
          ]}
          rows={[
            { method: "GET", path: "/api/health",  what: "{ ok, version, dbPath, taskCount, rsTensor: { ok, mode, connected } }" },
            { method: "GET", path: "/api/config",  what: "Resolved adapter config — path to neuron.config.ts, hash, featureShape, etc." },
          ]}
        />
        <CodeBlock
          lang="bash"
          title="curl"
          code={`curl http://localhost:2626/api/health
# {"ok":true,"version":"1.10.2","dbPath":"./data/neuron.db","taskCount":3,
#  "rsTensor":{"ok":true,"mode":"stdio","connected":true}}`}
        />
      </Section>

      <Section eyebrow="Tasks" title="CRUD on tasks.">
        <Table
          columns={[
            { key: "method", header: "Method",    mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",      mono: true, accent: "cyan" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET",    path: "/api/tasks",                  what: "List every task with sample count, train/test split sizes, run count, active model, last run." },
            { method: "GET",    path: "/api/tasks/:id",              what: "Per-task detail: schema, samples, runs, model, last events." },
            { method: "DELETE", path: "/api/tasks/:id",              what: "Reset task (clears samples + runs) or delete it entirely. Body: { confirm: true, delete_task?: boolean }." },
            { method: "GET",    path: "/api/tasks/:id/inspect",      what: "Equivalent to inspect_data MCP tool — per-feature stats, class distribution, training_budget." },
            { method: "GET",    path: "/api/tasks/:id/runs",         what: "List of runs for this task." },
            { method: "POST",   path: "/api/tasks/:id/samples",      what: "Equivalent to collect MCP tool — append a single sample. Body: { label, features?, raw? }." },
          ]}
        />
      </Section>

      <Section eyebrow="Training + sweeps" title="The kick-off endpoints.">
        <Table
          columns={[
            { key: "method", header: "Method",    mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",      mono: true, accent: "orange" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "POST",   path: "/api/tasks/:id/train",          what: "Start a single train run in the background. Body: full train args (lr, epochs, head_arch, optimizer, etc). Returns { runId } immediately; poll /api/runs/:runId for progress." },
            { method: "DELETE", path: "/api/tasks/:id/train",          what: "Cancel the in-flight train for this task. Equivalent to cancel_training." },
            { method: "POST",   path: "/api/tasks/:id/sweep",          what: "Start a sweep (parallel sub-agents OR sequential, by NEURON_SWEEP_MODE). Body: { configs: [...] } or { search: {...} }. Returns sweep handle." },
            { method: "GET",    path: "/api/tasks/:id/sweep",          what: "Get the current sweep state for this task." },
            { method: "DELETE", path: "/api/tasks/:id/sweep",          what: "Cancel an in-flight sweep." },
          ]}
        />
        <CodeBlock
          lang="bash"
          title="POST /api/tasks/iris/train"
          code={`curl -X POST http://localhost:2626/api/tasks/iris/train \\
  -H "Content-Type: application/json" \\
  -d '{
    "lr": 0.005,
    "epochs": 500,
    "optimizer": "adamw",
    "weight_decay": 1e-4
  }'

# {"ok": true, "runId": 42}`}
        />
      </Section>

      <Section eyebrow="Inference" title="predict + batch_predict.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "purple" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "POST", path: "/api/tasks/:id/predict",        what: "Body: { features: number[] } → { label, confidence, scores } (classification) or { value } (regression). Logged to predictions table." },
            { method: "POST", path: "/api/tasks/:id/batch_predict",  what: "Multipart upload of a CSV. Body: file + label_column? + feature_columns?. Returns batch_predict_run id; poll /api/batch_predict/:id for progress." },
            { method: "GET",  path: "/api/tasks/:id/batch_predict",  what: "List batch_predict runs for this task." },
            { method: "GET",  path: "/api/batch_predict/:id",        what: "Detail of a specific batch_predict run including per-row results once done." },
            { method: "POST", path: "/api/registry/:name@:version/predict",       what: "Predict using a published model directly — no task creation needed. Body: { features: number[] }." },
            { method: "POST", path: "/api/registry/:name@:version/batch_predict", what: "Same but for batch CSV." },
          ]}
        />
      </Section>

      <Section eyebrow="Active learning + labeling" title="suggest + queue.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "green" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "POST", path: "/api/tasks/:id/suggest_samples", what: "Equivalent to suggest_samples MCP tool. Returns uncertain rows + per-class stats + recommendations." },
            { method: "GET",  path: "/api/tasks/:id/label-queue",     what: "Queue of samples flagged for labeling (used by the dashboard's /label route). Pagination via ?limit & ?offset." },
          ]}
        />
      </Section>

      <Section eyebrow="Validation + drift" title="Reliability tools.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "orange" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET", path: "/api/tasks/:id/drift",         what: "Run drift_check. Query: ?current_window=N (default 1000). Returns per-feature PSI/KS verdicts." },
            { method: "GET", path: "/api/tasks/:id/drift-status",  what: "Cached drift status for the task — for showing a status banner without re-running drift_check." },
          ]}
        />
      </Section>

      <Section eyebrow="Shadow models" title="A/B testing endpoints.">
        <Table
          columns={[
            { key: "method", header: "Method",    mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",      mono: true, accent: "pink" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET",    path: "/api/tasks/:id/shadow",          what: "Get current shadow attachment + agreement rate." },
            { method: "POST",   path: "/api/tasks/:id/shadow",          what: "Attach a shadow model. Body: { run_id }." },
            { method: "DELETE", path: "/api/tasks/:id/shadow",          what: "Detach the shadow." },
            { method: "POST",   path: "/api/tasks/:id/shadow/promote",  what: "Promote shadow to active model. Equivalent to register_model on the shadow_run_id." },
          ]}
        />
      </Section>

      <Section eyebrow="Runs + auto_runs" title="Read-side detail.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "cyan" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET", path: "/api/runs",                  what: "List every run across every task (paginated)." },
            { method: "GET", path: "/api/runs/:id",              what: "Run detail — hyperparams, metrics, loss history, progress, calibration." },
            { method: "GET", path: "/api/runs/:id/events",       what: "Filtered event stream for this run only." },
            { method: "GET", path: "/api/runs/:id/confusions",   what: "Just the confusion matrix in the most renderable form. Query: ?normalize=row|col|none." },
            { method: "GET", path: "/api/auto",                  what: "List auto_runs — paginated, filterable by task." },
            { method: "GET", path: "/api/auto/:id",              what: "Auto-run detail with full decision_log + verdict_json." },
          ]}
        />
      </Section>

      <Section eyebrow="LLM playground" title="GGUF inference endpoints.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "purple" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET",  path: "/api/llm/status",   what: "Whether a model is loaded + its config (dim, n_layers, vocab_size, etc)." },
            { method: "POST", path: "/api/llm/load",     what: "Load a GGUF file. Body: { path }. Replaces any previously-loaded model." },
            { method: "POST", path: "/api/llm/generate", what: "Generate. Body: { prompt? | token_ids?, max_tokens?, temperature? }. Returns { text, token_ids, num_generated, elapsed_ms, tokens_per_sec }." },
          ]}
        />
      </Section>

      <Section eyebrow="Events stream + ingestion" title="The bus + multipart upload.">
        <Table
          columns={[
            { key: "method", header: "Method", mono: true, accent: "green", width: "80px" },
            { key: "path",   header: "Path",   mono: true, accent: "green" },
            { key: "what",   header: "What it does" },
          ]}
          rows={[
            { method: "GET",  path: "/api/events",            what: "Default: REST list of recent events. With Accept: text/event-stream OR ?stream=1 → live SSE stream of new events." },
            { method: "POST", path: "/api/upload",            what: "Multipart file upload. Auto-routes to load_csv / load_json / load_images by content type. Form fields: file + task_id + label_column? + feature_columns? + test_size?" },
            { method: "POST", path: "/api/requests",          what: "Used by the dashboard's AskClaude widget — posts a question; /neuron-ask in Claude picks up requests.jsonl and answers." },
            { method: "POST", path: "/api/requests/:id/response", what: "Internal — neuron-ask uses this to attach an answer to a queued request." },
          ]}
        />

        <CodeBlock
          lang="bash"
          title="Tail the SSE stream"
          code={`# Line-buffered SSE
curl -N http://localhost:2626/api/events?stream=1

# event: run_progress
# data: {"runId":42,"stage":"train","i":150,"n":500,"message":"epoch 150/500"}

# event: auto_wave_completed
# data: {"auto_run_id":7,"wave":1,"best_metric":0.93,"configs_tried":3}`}
        />
      </Section>

      <Section eyebrow="Status codes" title="What you'll see.">
        <Table
          compact
          columns={[
            { key: "code", header: "Code", mono: true, accent: "cyan", width: "100px" },
            { key: "when", header: "When" },
          ]}
          rows={[
            { code: "200 OK",                when: "Success." },
            { code: "201 Created",           when: "POST that created a resource (eg start train)." },
            { code: "400 Bad Request",       when: "Malformed body, missing required field, invalid enum value." },
            { code: "404 Not Found",         when: "Task/run/auto_run id doesn't exist, or unmatched /api/* route." },
            { code: "409 Conflict",          when: "Operation can't run in the current state (eg start train while one is running)." },
            { code: "500 Internal",          when: "Trainer / rs-tensor errored out." },
          ]}
        />
      </Section>

      <Section eyebrow="Patterns" title="Common scripted flows.">
        <div className="grid md:grid-cols-2 gap-4">
          <InfoCard icon={Zap} title="Kick a training and watch progress" accent="cyan">
            <CodeBlock
              lang="bash"
              code={`# Start
RUN=$(curl -s -X POST :2626/api/tasks/iris/train \\
  -H "Content-Type: application/json" \\
  -d '{"epochs":500}' | jq -r .runId)

# Watch
while true; do
  curl -s :2626/api/runs/$RUN | jq '.status, .runProgress.message'
  sleep 1
done`}
            />
          </InfoCard>

          <InfoCard icon={Activity} title="Tail events as they happen" accent="green">
            <CodeBlock
              lang="bash"
              code={`# Use SSE for low-latency notifications
curl -N :2626/api/events?stream=1 | \\
  while IFS= read -r line; do
    [[ "$line" == data:* ]] && echo "$line"
  done`}
            />
          </InfoCard>

          <InfoCard icon={Database} title="Query a published model" accent="pink">
            <CodeBlock
              lang="bash"
              code={`# Predict using a registry URI directly,
# no task creation needed
curl -X POST \\
  ":2626/api/registry/iris-classifier@2026-04-19/predict" \\
  -H "Content-Type: application/json" \\
  -d '{"features":[5.1,3.5,1.4,0.2]}'`}
            />
          </InfoCard>

          <InfoCard icon={Package} title="Schedule drift checks via cron" accent="orange">
            <CodeBlock
              lang="bash"
              code={`# crontab entry — daily 4am
0 4 * * *  curl -s :2626/api/tasks/churn/drift?current_window=1000 \\
            | jq '.verdict_summary.severe' \\
            | xargs -I{} sh -c '[ {} -gt 0 ] && \\
                /usr/local/bin/alert-pagerduty "drift severe on churn"'`}
            />
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Reference" title="Where these are implemented.">
        <Table
          columns={[
            { key: "file", header: "File",                       mono: true, width: "44%" },
            { key: "what", header: "What's in it" },
          ]}
          rows={[
            { file: "neuron/src/api.ts",                  what: "The router. ~1500 lines; one handler per route." },
            { file: "neuron/src/api/trainBg.ts",          what: "Background training (POST /api/tasks/:id/train)." },
            { file: "neuron/src/api/batchPredictBg.ts",   what: "Background batch prediction." },
            { file: "neuron/src/core/db/events.ts",       what: "Backs /api/events stream + REST." },
          ]}
        />
        <Callout kind="learn" title="Why one big router file">
          api.ts is intentionally flat. Every endpoint can be read at a glance, no decorator magic.
          When the file gets unwieldy we'll split — but a single 1500-line router is much easier
          for a junior to grep through than 30 small files.
        </Callout>
      </Section>
    </div>
  )
}
