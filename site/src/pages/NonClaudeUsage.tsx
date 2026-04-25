import { Server, Terminal, Globe } from "lucide-react"
import { PageHeader } from "../components/PageHeader"
import { Section } from "../components/Section"
import { CodeBlock } from "../components/CodeBlock"
import { Callout } from "../components/Callout"
import { InfoCard } from "../components/InfoCard"

export function NonClaudeUsage() {
  return (
    <div>
      <PageHeader
        eyebrow="ML-Labs without an LLM"
        accent="orange"
        title={<>Using ML-Labs <span className="gradient-text">from scripts, cron, and CI</span>.</>}
        lede="Most users come to ML-Labs through Claude Code. But underneath, it's just a Bun server with two transports — MCP over stdio and HTTP on :2626. You can drive it from any language, any process, any environment that can speak JSON. This page shows the patterns."
      />

      <Section eyebrow="Three options" title="How to call ML-Labs without Claude.">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon={Globe} title="HTTP" accent="cyan">
            Simplest. <code>ml-labs dashboard</code> serves <code>/api/*</code>. Use{" "}
            <code>curl</code>, <code>fetch</code>, <code>requests</code> — anything that does HTTP.
          </InfoCard>
          <InfoCard icon={Terminal} title="MCP stdio" accent="purple">
            Spawn <code>neuron-mcp</code> as a child process and speak JSON-RPC over its stdin /
            stdout. Standard MCP protocol — any MCP client works.
          </InfoCard>
          <InfoCard icon={Server} title="Direct DB" accent="green">
            Open <code>data/neuron.db</code> with <code>sqlite3</code>. Read-only access for
            inspection / monitoring. Don't write — go through one of the above for that.
          </InfoCard>
        </div>
      </Section>

      <Section eyebrow="Pattern 1: HTTP" title="The simplest path.">
        <p>
          Start the dashboard server in one terminal, fire HTTP requests from another. CORS is wide
          open by default, no auth.
        </p>
        <CodeBlock
          lang="bash"
          title="Start the server"
          code={`# Terminal 1
ml-labs dashboard
# → http://localhost:2626 (now also serves /api/*)`}
        />

        <CodeBlock
          lang="bash"
          title="Train + predict via curl"
          code={`# Create task
curl -X POST :2626/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '{"id":"churn","kind":"classification","feature_shape":[8]}'

# Upload CSV (multipart)
curl -X POST :2626/api/upload \\
  -F "file=@./churn.csv" \\
  -F "task_id=churn" \\
  -F "label_column=churned" \\
  -F "test_size=0.2"

# Train
RUN=$(curl -s -X POST :2626/api/tasks/churn/train \\
  -H "Content-Type: application/json" \\
  -d '{"epochs":500,"optimizer":"adamw"}' | jq -r .runId)

# Wait until done
while true; do
  STATUS=$(curl -s :2626/api/runs/$RUN | jq -r .status)
  [ "$STATUS" = "completed" ] && break
  sleep 2
done

# Predict
curl -X POST :2626/api/tasks/churn/predict \\
  -H "Content-Type: application/json" \\
  -d '{"features":[6,148,72,35,0,33.6,0.627,50]}'`}
        />

        <CodeBlock
          lang="python"
          title="Same in Python"
          code={`import requests, time

BASE = "http://localhost:2626/api"

# Create task
requests.post(f"{BASE}/tasks", json={
    "id": "churn", "kind": "classification", "feature_shape": [8]
})

# Upload CSV
with open("churn.csv", "rb") as f:
    requests.post(f"{BASE}/upload", files={"file": f}, data={
        "task_id": "churn",
        "label_column": "churned",
        "test_size": 0.2,
    })

# Train
run_id = requests.post(
    f"{BASE}/tasks/churn/train",
    json={"epochs": 500, "optimizer": "adamw"},
).json()["runId"]

# Poll
while requests.get(f"{BASE}/runs/{run_id}").json()["status"] != "completed":
    time.sleep(2)

# Predict
result = requests.post(
    f"{BASE}/tasks/churn/predict",
    json={"features": [6, 148, 72, 35, 0, 33.6, 0.627, 50]},
).json()
print(result)
# {"label": "1", "confidence": 0.84, ...}`}
        />

        <Callout kind="tip" title="Auth for non-localhost">
          If you're exposing the server beyond localhost (tunnel, internal network), set{" "}
          <code>NEURON_SERVE_TOKEN=&lt;random&gt;</code> and pass{" "}
          <code>Authorization: Bearer &lt;token&gt;</code> on every request. See{" "}
          <a href="/env-vars" className="text-cyan-neon hover:underline">Environment Variables</a>.
        </Callout>
      </Section>

      <Section eyebrow="Pattern 2: MCP stdio" title="When you need an MCP client.">
        <p>
          The MCP transport is JSON-RPC over stdio. Spawn <code>neuron-mcp</code> as a child process
          and write JSON requests to its stdin; read responses from stdout.
        </p>

        <CodeBlock
          lang="ts"
          title="Bun"
          code={`import { spawn } from "node:child_process"

const proc = spawn("neuron-mcp", [], { stdio: ["pipe", "pipe", "pipe"] })

let nextId = 1
function call(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const req = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"
    proc.stdin.write(req)

    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\\n").filter(Boolean)) {
        const msg = JSON.parse(line)
        if (msg.id === id) {
          proc.stdout.off("data", onData)
          msg.error ? reject(msg.error) : resolve(msg.result)
        }
      }
    }
    proc.stdout.on("data", onData)
  })
}

// Initialize
await call("initialize", {
  protocolVersion: "2024-11-05",
  clientInfo: { name: "my-script", version: "0.1.0" },
})

// Call tools
const result = await call("tools/call", {
  name: "auto_train",
  arguments: { task_id: "iris" },
})
console.log(result)

proc.kill()`}
        />

        <Callout kind="learn" title="When to prefer MCP over HTTP">
          MCP is more efficient (no HTTP overhead, persistent connection, full protocol features).
          But it's more code to manage. Use it when you're integrating with another MCP host (eg
          a different MCP-aware app), or when you specifically want Sampling-via-MCP. Otherwise,
          HTTP is simpler.
        </Callout>
      </Section>

      <Section eyebrow="Pattern 3: cron job" title="Scheduled drift checks.">
        <CodeBlock
          lang="bash"
          title="crontab — daily 4am drift check"
          code={`0 4 * * *  /usr/local/bin/check-drift.sh`}
        />
        <CodeBlock
          lang="bash"
          title="check-drift.sh"
          code={`#!/usr/bin/env bash
set -euo pipefail

# Make sure the dashboard server is running. If not, start it briefly.
if ! curl -s -o /dev/null :2626/api/health; then
  ml-labs dashboard &
  DASHBOARD_PID=$!
  sleep 5
  trap "kill $DASHBOARD_PID 2>/dev/null" EXIT
fi

# Run drift_check on every task
TASKS=$(curl -s :2626/api/tasks | jq -r '.[].id')

for TASK in $TASKS; do
  REPORT=$(curl -s ":2626/api/tasks/$TASK/drift?current_window=1000")
  SEVERE=$(echo "$REPORT" | jq -r '.verdict_summary.severe // 0')

  if [ "$SEVERE" -gt 0 ]; then
    /usr/local/bin/alert "$TASK has $SEVERE severe-drift features"
  fi
done`}
        />
      </Section>

      <Section eyebrow="Pattern 4: CI integration" title="Train on every PR.">
        <CodeBlock
          lang="yaml"
          title=".github/workflows/train-and-test.yml"
          code={`name: Train and validate
on:
  pull_request: {}
jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: cd rs-tensor && cargo build --release --bin mcp

      # Start the dashboard server
      - run: bun --cwd neuron run src/api.ts &
      - run: sleep 5  # let it boot

      # Train + test
      - name: Train
        env:
          NEURON_PLANNER: rules
          NEURON_SWEEP_MODE: sequential
          NEURON_SEED: "42"
        run: |
          curl -X POST :2626/api/tasks -d '{"id":"test","kind":"classification","feature_shape":[4]}'
          curl -X POST :2626/api/upload -F "file=@./test_data.csv" -F "task_id=test" -F "label_column=label"
          curl -s -X POST :2626/api/tasks/test/auto-train | tee result.json

      # Assert val accuracy
      - run: |
          ACC=$(jq -r .accuracy result.json)
          [ "$(echo "$ACC > 0.85" | bc)" -eq 1 ] || (echo "Accuracy regressed: $ACC" && exit 1)`}
        />
      </Section>

      <Section eyebrow="Pattern 5: serving registered models" title="HTTP inference for an ML-Labs model.">
        <p>
          Once you've published a model with <code>publish_model</code>, you can call it via the
          registry endpoint <em>without</em> creating a per-project task:
        </p>
        <CodeBlock
          lang="bash"
          code={`# Direct prediction via the registry URI
curl -X POST :2626/api/registry/iris-classifier@2026-04-19/predict \\
  -H "Content-Type: application/json" \\
  -d '{"features":[5.1,3.5,1.4,0.2]}'

# Same for batch
curl -X POST :2626/api/registry/iris-classifier@2026-04-19/batch_predict \\
  -F "file=@./samples.csv"`}
        />
        <Callout kind="tip">
          This is the path for <em>model serving</em> — the model lives in the registry, the server
          runs as a daemon, and any client can hit it. Useful when ML-Labs is the inference engine
          for some upstream app.
        </Callout>
      </Section>

      <Section eyebrow="Pattern 6: monitoring scripts" title="Read-only DB access.">
        <p>
          For dashboards, alerting, and metrics: open <code>data/neuron.db</code> directly with
          sqlite3 in read-only mode. Don't write — go through HTTP/MCP for anything mutating.
        </p>
        <CodeBlock
          lang="python"
          title="Recent prediction volume to Prometheus"
          code={`import sqlite3
import time
from prometheus_client import Counter, start_http_server

start_http_server(9100)
predictions_total = Counter("neuron_predictions_total", "predict calls", ["task_id"])

last_id = 0
db = sqlite3.connect("file:data/neuron.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row

while True:
    rows = db.execute(
        "SELECT id, task_id FROM predictions WHERE id > ? ORDER BY id",
        (last_id,),
    ).fetchall()
    for r in rows:
        predictions_total.labels(task_id=r["task_id"]).inc()
        last_id = r["id"]
    time.sleep(5)`}
        />
      </Section>

      <Section eyebrow="Pattern 7: AI agents that aren't Claude" title="Other LLMs / orchestrators.">
        <p>
          MCP is Anthropic's protocol but it's open. Other agent frameworks can speak it (or you can
          wrap the HTTP API). Patterns:
        </p>
        <ul className="list-disc list-inside space-y-2 text-sm">
          <li>
            <strong>OpenAI / GPT — function calling.</strong> Wrap each MCP tool as an OpenAI{" "}
            <code>function</code>; have GPT call your wrapper which calls{" "}
            <code>POST :2626/api/...</code>.
          </li>
          <li>
            <strong>LangChain / LangGraph.</strong> Build a Python tool that calls the HTTP API.
            ML-Labs becomes one node in the graph.
          </li>
          <li>
            <strong>Local LLMs (Ollama, llama.cpp).</strong> Same wrapper pattern. Or use ML-Labs's
            own llm_load + llm_generate so it's all one process.
          </li>
        </ul>
        <Callout kind="learn">
          The advantage of staying on Claude is that it's MCP-native and ML-Labs's slash commands
          and SKILL.md were designed for it. The advantage of leaving is access to other model
          tradeoffs (cheaper, faster, on-prem). Pick what fits.
        </Callout>
      </Section>

      <Section eyebrow="Limitations" title="What you can't do without Claude.">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>MCP Sampling.</strong> Without Claude as host, no Sampling — so{" "}
            <code>suggest_hyperparams</code> and <code>diagnose</code> fall back to deterministic
            heuristics. The headline-pretty Claude reasoning is gone, but functionality is intact.
            See <a href="/sampling-fallback" className="text-purple-neon hover:underline">Sampling Fallback</a>.
          </li>
          <li>
            <strong>Tournament mode for auto_train.</strong> Tournament spawns 3 Claude planner
            sub-agents. Without Claude they fall back to rules; you lose the multi-strategy angle.
          </li>
          <li>
            <strong>Slash commands.</strong> They're a Claude Code construct. The HTTP API doesn't
            have them — you call tools directly.
          </li>
        </ul>
        <Callout kind="note">
          Everything else — auto_train (rules-only), cv_train, calibrate, drift_check, predict,
          publish/import, all of it — works without Claude. ML-Labs is fully usable headless; it
          just gets less interactive.
        </Callout>
      </Section>
    </div>
  )
}
