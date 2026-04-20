---
allowed-tools: Read, Bash, mcp__neuron__list_tasks, mcp__neuron__list_runs, mcp__neuron__evaluate, mcp__neuron__get_run_status, mcp__neuron__inspect_data, mcp__neuron__diagnose
---

Check for pending browser requests and answer each one using the task/run context.

Steps:
1. `Read` the file at the path shown by `Bash(cat /Users/yab/Projects/ml-agent/data/requests.jsonl 2>/dev/null || echo '')`. Parse each JSON line.
2. Filter lines where `answered` is `false` (or missing).
3. For each pending request:
   a. Read the `prompt` and `context` (route, taskId, runId).
   b. Gather relevant data: call `mcp__neuron__list_runs` or `mcp__neuron__evaluate` for the taskId/runId if present.
   c. Formulate a concise, data-backed answer.
   d. POST the answer: `Bash(curl -s -X POST http://localhost:2626/api/requests/<id>/response -H 'Content-Type: application/json' -d '{"answer":"<escaped answer>"}')`
4. Report which requests were answered (id + one-line summary).

If the requests file doesn't exist or is empty, report "No pending requests."
