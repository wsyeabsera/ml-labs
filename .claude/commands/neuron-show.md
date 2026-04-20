---
allowed-tools: mcp__chrome-devtools__navigate_page, mcp__chrome-devtools__take_screenshot, mcp__chrome-devtools__list_pages, mcp__chrome-devtools__new_page, mcp__chrome-devtools__wait_for, mcp__neuron__list_tasks, mcp__neuron__list_runs
---

Navigate the ML-Labs dashboard to the specified task or run and take a screenshot.

Usage: `/neuron-show <task_id> [<run_id>]`

Steps:
1. If no `run_id` given, call `mcp__neuron__list_runs` for the task and use the latest completed run.
2. Build the URL:
   - With run: `http://localhost:5274/tasks/<task_id>/runs/<run_id>`
   - Without run: `http://localhost:5274/tasks/<task_id>`
3. Call `mcp__chrome-devtools__list_pages` to find an existing tab. If none, `mcp__chrome-devtools__new_page`.
4. `mcp__chrome-devtools__navigate_page` to the URL.
5. `mcp__chrome-devtools__wait_for` selector `.card` (1500ms timeout).
6. `mcp__chrome-devtools__take_screenshot` and describe what's visible — accuracy, metrics, status badges, any warnings.
