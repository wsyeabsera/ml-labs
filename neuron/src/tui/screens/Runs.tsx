import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import { useStore, useTaskPoller, refreshRuns, setCurrentTask } from "../store"
import { neuron, type RunDetail } from "../client/mcp"
import { Table } from "../components/Table"
import { LossChart } from "../components/LossChart"
import { ConfusionMatrix } from "../components/ConfusionMatrix"

type View = "tasks" | "runs" | "detail"

export function Runs() {
  useTaskPoller(true)
  const { tasks, runs, currentTaskId } = useStore()
  const [view, setView] = useState<View>("tasks")
  const [taskIdx, setTaskIdx] = useState(0)
  const [runIdx, setRunIdx] = useState(0)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [diagnosis, setDiagnosis] = useState<string | null>(null)
  const [status, setStatus] = useState("")

  useEffect(() => {
    const task = tasks[taskIdx]
    if (task && view === "runs") {
      setCurrentTask(task.id)
      refreshRuns(task.id)
    }
  }, [taskIdx, view, tasks.length])

  useInput((input, key) => {
    if (view === "tasks") {
      if (input === "j" || key.downArrow) setTaskIdx((i) => Math.min(tasks.length - 1, i + 1))
      if (input === "k" || key.upArrow) setTaskIdx((i) => Math.max(0, i - 1))
      if (key.return && tasks[taskIdx]) { setView("runs"); setRunIdx(0) }
    } else if (view === "runs") {
      if (input === "j" || key.downArrow) setRunIdx((i) => Math.min(runs.length - 1, i + 1))
      if (input === "k" || key.upArrow) setRunIdx((i) => Math.max(0, i - 1))
      if (key.return && runs[runIdx]) {
        const run = runs[runIdx]!
        setStatus("Loading…")
        neuron.evaluate(run.id).then((d) => {
          setDetail(d)
          setDiagnosis(null)
          setStatus("")
          setView("detail")
        }).catch((e) => setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`))
      }
      if (key.escape) setView("tasks")
    } else if (view === "detail") {
      if (key.escape) setView("runs")
      if (input === "d" && detail) {
        setStatus("Diagnosing…")
        neuron.diagnose(detail.id).then((d) => {
          setDiagnosis(d.summary + "\n" + d.recommendations.join("\n"))
          setStatus("")
        }).catch((e) => setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`))
      }
    }
  })

  const task = tasks[taskIdx]

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="cyan">Runs</Text>
      {status && <Text color="yellow">{status}</Text>}

      {view === "tasks" && (
        <Box flexDirection="column" gap={1}>
          <Text>Select a task (j/k to navigate, Enter to view runs):</Text>
          {tasks.map((t, i) => (
            <Text key={t.id} color={i === taskIdx ? "cyan" : "gray"} bold={i === taskIdx}>
              {i === taskIdx ? "▶ " : "  "}{t.id}
            </Text>
          ))}
          {tasks.length === 0 && <Text color="gray">No tasks.</Text>}
        </Box>
      )}

      {view === "runs" && task && (
        <Box flexDirection="column" gap={1}>
          <Text>Runs for <Text color="cyan">{task.id}</Text>:</Text>
          <Table
            rows={runs}
            selectedIndex={runIdx}
            emptyMessage="No runs yet."
            columns={[
              { key: "id", header: "Run", width: 8, render: (r) => `#${r.id}` },
              { key: "status", header: "Status", width: 12, color: (r) => r.status === "completed" ? "green" : r.status === "failed" ? "red" : "yellow" },
              { key: "accuracy", header: "Accuracy", width: 12, render: (r) => r.accuracy != null ? `${((r.accuracy as number) * 100).toFixed(1)}%` : "—" },
              { key: "duration_s", header: "Duration", width: 10, render: (r) => r.duration_s != null ? `${r.duration_s}s` : "—" },
              { key: "hyperparams", header: "lr / epochs", width: 18,
                render: (r) => {
                  const h = r.hyperparams as Record<string, unknown>
                  return `${h["lr"] ?? "?"} / ${h["epochs"] ?? "?"}`
                }
              },
            ]}
          />
          <Text color="gray" dimColor>Enter=details  Esc=back</Text>
        </Box>
      )}

      {view === "detail" && detail && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Run #{detail.id}  <Text color={detail.status === "completed" ? "green" : "red"}>{detail.status}</Text></Text>
          <Text>Accuracy: <Text color="green" bold>{detail.accuracy != null ? `${(detail.accuracy * 100).toFixed(1)}%` : "—"}</Text></Text>
          {detail.per_class_accuracy && (
            <Box gap={2}>
              {Object.entries(detail.per_class_accuracy).map(([l, v]) => (
                <Text key={l} color="gray">{l}: {(v * 100).toFixed(0)}%</Text>
              ))}
            </Box>
          )}
          {detail.confusion_matrix && (
            <ConfusionMatrix matrix={detail.confusion_matrix} labels={Object.keys(detail.per_class_accuracy ?? {})} />
          )}
          {detail.loss_history && <LossChart lossHistory={detail.loss_history} height={6} />}
          {diagnosis && (
            <Box flexDirection="column" borderStyle="single" paddingX={1}>
              <Text bold color="yellow">Diagnosis:</Text>
              {diagnosis.split("\n").map((l, i) => <Text key={i} color="gray">{l}</Text>)}
            </Box>
          )}
          <Text color="gray" dimColor>d=diagnose  Esc=back</Text>
        </Box>
      )}
    </Box>
  )
}
