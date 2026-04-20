import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import { useStore, useTaskPoller, setCurrentTask } from "../store"
import { neuron, type InspectResult } from "../client/mcp"
import { Table } from "../components/Table"

interface SampleCountRow { [key: string]: unknown; label: string; count: number }

export function Dataset() {
  useTaskPoller(true)
  const { tasks, currentTaskId } = useStore()
  const [taskIdx, setTaskIdx] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [inspect, setInspect] = useState<InspectResult | null>(null)
  const [status, setStatus] = useState("")

  const task = tasks[taskIdx]

  useEffect(() => {
    if (!task) return
    setCurrentTask(task.id)
    neuron.listSamples(task.id, { limit: 1 }).then((r) => {
      setCounts(r.counts)
      setTotal(r.total)
    }).catch(() => {})
    neuron.inspectData(task.id).then(setInspect).catch(() => {})
  }, [task?.id])

  useInput((input) => {
    if (input === "j" || input === "ArrowDown") setTaskIdx((i) => Math.min(tasks.length - 1, i + 1))
    if (input === "k" || input === "ArrowUp") setTaskIdx((i) => Math.max(0, i - 1))
  })

  const countRows: SampleCountRow[] = Object.entries(counts).map(([label, count]) => ({ label, count }))

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="cyan">Dataset</Text>
      {tasks.length === 0 && <Text color="gray">No tasks yet.</Text>}
      <Box gap={4}>
        <Box flexDirection="column" width={26}>
          <Text bold>Tasks (j/k to select)</Text>
          {tasks.map((t, i) => (
            <Text key={t.id} color={i === taskIdx ? "cyan" : "gray"} bold={i === taskIdx}>
              {i === taskIdx ? "▶ " : "  "}{t.id}
            </Text>
          ))}
        </Box>
        {task && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Task: <Text color="cyan">{task.id}</Text>  <Text color="gray">({task.kind})</Text></Text>
            <Text>Total samples: <Text color="cyan">{total}</Text>
              {inspect?.splits && inspect.splits.train + inspect.splits.test > 0 && (
                <Text color="gray">  train: <Text color="green">{inspect.splits.train}</Text>  test: <Text color="yellow">{inspect.splits.test}</Text></Text>
              )}
            </Text>
            {inspect?.normalize_enabled && <Text color="gray" dimColor>normalize: <Text color="cyan">on</Text></Text>}
            <Table<SampleCountRow>
              rows={countRows}
              emptyMessage="No samples"
              columns={[
                { key: "label", header: "Label", width: 20 },
                { key: "count", header: "Count", width: 10, render: (r) => String(r.count), color: (r) => r.count > 10 ? "green" : "yellow" },
              ]}
            />
            {inspect?.warnings && inspect.warnings.length > 0 && (
              <Box flexDirection="column">
                {inspect.warnings.map((w, i) => <Text key={i} color="yellow">⚠ {w}</Text>)}
              </Box>
            )}
            {status && <Text color="yellow">{status}</Text>}
          </Box>
        )}
      </Box>
      <Text color="gray" dimColor>j/k=select task</Text>
    </Box>
  )
}
